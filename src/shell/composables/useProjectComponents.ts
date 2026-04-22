/**
 * Components view state: library-component catalog from
 * `/api/components`, per-component detail, and usage highlighting via
 * `/api/component-examples/:name`.
 *
 * Parallels useDataSources/useProjectComponents flows: list on the left,
 * select → fetch detail + push highlight sources into the shared
 * useDataHighlights adapter.
 */
import { ref, computed, watch } from 'vue'
import { colorForSource, type DataHighlightSource, type DataHighlightSite } from './useDataHighlights'
import type { useIframeManager } from './useIframeManager'
import { useWorkspace } from './useWorkspace'

/** All components from one library share this color on the iframe overlay. */
export function colorForLibrary(libraryName: string): string {
  return colorForSource(`lib:${libraryName}`)
}

export interface LibraryProp {
  name: string
  type: string | null
  required: boolean
  default?: unknown
  description?: string | null
  options?: string[]
}

export interface LibrarySlot {
  name: string
  description?: string | null
  scoped?: boolean
}

export interface LibraryEvent {
  name: string
  payloadType?: string | null
  description?: string | null
}

export interface LibraryComponent {
  name: string
  module?: string
  description?: string | null
  category?: string | null
  tags?: string[]
  deprecated?: boolean
  props: LibraryProp[]
  slots?: LibrarySlot[]
  events?: LibraryEvent[]
  sourceFile?: string | null
}

export interface LibraryCatalog {
  name: string
  version: string
  components: LibraryComponent[]
}

export interface LibraryComponentsIndex {
  libraries: LibraryCatalog[]
}

export interface ComponentsHighlightsAdapter {
  setSources: (list: DataHighlightSource[]) => void
  setFocus: (name: string | null) => void
  clear: () => void
}

const libraries = ref<LibraryCatalog[]>([])
/** componentName → files[] referencing it, from /api/component-usage. */
const usageByName = ref<Map<string, string[]>>(new Map())
/** file → (name → module sources that imported `name` in `file`). Drives the
 *  per-library attribution that prevents two libraries exposing the same
 *  component name (Button, Card, etc.) from cross-highlighting each other. */
const importsByFile = ref<Map<string, Map<string, string[]>>>(new Map())
/** Files currently rendered in the iframe (distinct data-annotask-file). */
const renderedFiles = ref<Set<string>>(new Set())
const isLoading = ref(false)
const loadError = ref<string | null>(null)

const filterText = ref('')
export type ComponentsFilterMode = 'all' | 'used' | 'onPage'
const filterMode = ref<ComponentsFilterMode>('all')

const selectedKey = ref<string | null>(null)          // "library:::component"
const selectedComponent = ref<LibraryComponent | null>(null)
const selectedLibrary = ref<string | null>(null)

interface UsageExample {
  file: string
  line: number
  snippet?: string
  import_path?: string
}
const usages = ref<UsageExample[]>([])
const isUsagesLoading = ref(false)

let highlightsAdapter: ComponentsHighlightsAdapter | null = null

export function attachComponentsHighlights(adapter: ComponentsHighlightsAdapter): void {
  highlightsAdapter = adapter
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`/__annotask/api/${path}`)
    if (!res.ok) return null
    return await res.json() as T
  } catch { return null }
}

async function load(iframe?: ReturnType<typeof useIframeManager>): Promise<void> {
  // Clear any residual highlights left from a previous view (Data sources
  // etc. use the same shared adapter). Without this the old overlays stay
  // visible in the iframe until the view pushes its own sources below.
  highlightsAdapter?.setSources([])
  highlightsAdapter?.setFocus(null)
  isLoading.value = true
  loadError.value = null
  try {
    const [catalog, usage] = await Promise.all([
      fetchJson<LibraryComponentsIndex>('components'),
      fetchJson<{ usage: Record<string, string[]>; imports?: Record<string, Record<string, string[]>> }>('component-usage'),
    ])
    libraries.value = catalog?.libraries ?? []
    const map = new Map<string, string[]>()
    for (const [name, files] of Object.entries(usage?.usage ?? {})) {
      map.set(name, files)
    }
    usageByName.value = map
    const impMap = new Map<string, Map<string, string[]>>()
    for (const [file, perFile] of Object.entries(usage?.imports ?? {})) {
      const inner = new Map<string, string[]>()
      for (const [name, froms] of Object.entries(perFile)) inner.set(name, froms)
      impMap.set(file, inner)
    }
    importsByFile.value = impMap
    if (iframe) await refreshRenderedFiles(iframe)
    // With the list visible (no selection yet), pre-populate highlights for
    // every component rendered on the current route — drives both the
    // hover-row-to-iframe and hover-iframe-to-row interactions.
    if (!selectedComponent.value) pushAllOnPageHighlights()
  } catch (err) {
    loadError.value = (err as Error).message ?? 'Failed to load components'
  } finally {
    isLoading.value = false
  }
}

async function refreshRenderedFiles(iframe: ReturnType<typeof useIframeManager>): Promise<void> {
  const { files } = await iframe.listRenderedFiles()
  // The bridge returns package-local paths (relative to vite's root = the
  // running package). Convert each to its workspace-relative form so the
  // shell can intersect them against the workspace-rooted component-usage
  // catalog. MFE elements carry their tag and use the catalog's MFE dir;
  // un-tagged elements fall back to the running package's own dir.
  const ws = useWorkspace()
  const dirByMfe = new Map<string, string>()
  for (const pkg of ws.info.value?.packages ?? []) {
    if (pkg.mfe) dirByMfe.set(pkg.mfe, pkg.dir)
  }
  const currentDir = ws.info.value?.currentDir ?? ''
  const out = new Set<string>()
  for (const entry of files) {
    const dir = entry.mfe ? dirByMfe.get(entry.mfe) : currentDir
    out.add(dir ? `${dir}/${entry.file}` : entry.file)
  }
  renderedFiles.value = out
}

/** Does an import specifier (`from '…'`) belong to this library? Matches the
 *  package name exactly or as a subpath prefix so `@mantine/core` attributes
 *  imports from `@mantine/core/Button`, `primevue` attributes
 *  `primevue/button`, etc. */
function fromMatchesLibrary(from: string, libName: string): boolean {
  return from === libName || from.startsWith(libName + '/')
}

/** Files where `compName` is imported from a module that belongs to `libName`.
 *  Used by every library-scoped predicate below so two libraries that export
 *  the same component name don't bleed into each other's highlights. */
function filesForLibComponent(libName: string, compName: string): string[] {
  const all = usageByName.value.get(compName) ?? []
  if (all.length === 0) return []
  const out: string[] = []
  for (const file of all) {
    const froms = importsByFile.value.get(file)?.get(compName)
    // No recorded import source for this (file, name) — can't attribute it
    // to any library, so skip. Eliminates the cross-library ghosts.
    if (!froms) continue
    if (froms.some(f => fromMatchesLibrary(f, libName))) out.push(file)
  }
  return out
}

function isUsedInLib(libName: string, compName: string): boolean {
  return filesForLibComponent(libName, compName).length > 0
}

function isOnPageInLib(libName: string, compName: string): boolean {
  const rendered = renderedFiles.value
  if (rendered.size === 0) return false
  for (const f of filesForLibComponent(libName, compName)) {
    if (rendered.has(f)) return true
  }
  return false
}

/** Components referenced anywhere in `src/` — bare-name count, used for the
 *  header badge next to "Used". */
const usedProjectSet = computed<Set<string>>(() => {
  const s = new Set<string>()
  for (const [name, files] of usageByName.value.entries()) {
    if (files.length > 0) s.add(name)
  }
  return s
})

/** Components whose usage files intersect the currently-rendered file set —
 *  bare-name count, used for the header badge next to "On page". */
const usedOnPageSet = computed<Set<string>>(() => {
  const out = new Set<string>()
  const rendered = renderedFiles.value
  if (rendered.size === 0) return out
  for (const [name, files] of usageByName.value.entries()) {
    if (files.some(f => rendered.has(f))) out.add(name)
  }
  return out
})

const filteredLibraries = computed<LibraryCatalog[]>(() => {
  const q = filterText.value.trim().toLowerCase()
  const mode = filterMode.value
  const ws = useWorkspace()
  const selected = ws.selectedMfes.value
  return libraries.value
    .map(lib => {
      let comps = lib.components
      if (q) {
        comps = comps.filter(c =>
          c.name.toLowerCase().includes(q)
          || (c.module?.toLowerCase().includes(q) ?? false)
          || (c.description?.toLowerCase().includes(q) ?? false),
        )
      }
      if (mode === 'used') {
        comps = comps.filter(c => isUsedInLib(lib.name, c.name))
      } else if (mode === 'onPage') {
        comps = comps.filter(c => isOnPageInLib(lib.name, c.name))
      }
      if (selected.size > 0) {
        // Keep components with at least one library-scoped usage file under
        // any selected MFE. Drops unused components and cross-library ghosts.
        comps = comps.filter(c => {
          const files = filesForLibComponent(lib.name, c.name)
          if (files.length === 0) return false
          for (const f of files) {
            const id = ws.mfeForFile(f)
            if (id && selected.has(id)) return true
          }
          return false
        })
      }
      return { ...lib, components: comps }
    })
    .filter(lib => lib.components.length > 0)
})

function select(libraryName: string, componentName: string): void {
  selectedKey.value = `${libraryName}:::${componentName}`
  selectedLibrary.value = libraryName
  const lib = libraries.value.find(l => l.name === libraryName)
  const comp = lib?.components.find(c => c.name === componentName) ?? null
  selectedComponent.value = comp
  if (comp) {
    loadUsagesFor(comp)
    highlightsAdapter?.setFocus(sourceName(libraryName, comp.name))
  } else {
    usages.value = []
  }
}

function clearSelection(): void {
  selectedKey.value = null
  selectedComponent.value = null
  selectedLibrary.value = null
  usages.value = []
  // Back to the list view — repopulate the on-page wildcard highlights.
  pushAllOnPageHighlights()
}

/** Build one DataHighlightSource per on-page component, using the file-level
 *  wildcard (line: 0) so the iframe matches every element whose source-tag
 *  equals the component name in a rendered file. Cheap to compute — no
 *  per-component API calls needed — and keeps the iframe watching those
 *  elements so `data:hover` events drive row highlighting in the list. */
function pushAllOnPageHighlights(): void {
  if (!highlightsAdapter) return
  const rendered = renderedFiles.value
  if (rendered.size === 0 || usageByName.value.size === 0) {
    highlightsAdapter.setSources([])
    highlightsAdapter.setFocus(null)
    return
  }
  const sources: DataHighlightSource[] = []
  // One source per (library, component) pair. No bare-name dedup, because
  // that caused two libraries exposing the same name (Mantine Button vs
  // Radix Button) to collapse into a single source whose file list mixed
  // both — which then highlighted both lib's instances in the iframe.
  for (const lib of libraries.value) {
    for (const c of lib.components) {
      const libFiles = filesForLibComponent(lib.name, c.name)
      const onPage = libFiles.filter(f => rendered.has(f))
      if (onPage.length === 0) continue
      sources.push({
        name: sourceName(lib.name, c.name),
        kind: 'composable',
        sites: onPage.map(file => ({
          file,
          line: 0,
          tag: c.name,
          // Pass the library package name as a module filter. The bridge
          // matches `data-annotask-source-module` exactly or as a subpath
          // (so `@kobalte/core` picks up `@kobalte/core/button`), which
          // keeps Radix/Mantine/Kobalte Buttons on the same page distinct.
          module: lib.name,
        })),
        defaultLabel: c.name,
        color: colorForLibrary(lib.name),
      })
    }
  }
  highlightsAdapter.setSources(sources)
  highlightsAdapter.setFocus(null)
}

/** Library-scoped source key. The shared highlight adapter uses `name` to
 *  dedupe and to drive focused-source emphasis, so two libraries sharing a
 *  component name need distinct keys. Display-facing UI still reads
 *  `defaultLabel` / the component's real name. */
export function sourceName(libName: string, compName: string): string {
  return `${libName}\u0001${compName}`
}

/** Emphasize one component's rects (and by extension the matching list row
 *  when App.vue propagates the focus). `null` clears the emphasis. */
function setFocus(name: string | null): void {
  highlightsAdapter?.setFocus(name)
}

// Re-emit highlights whenever the iframe's rendered file set changes (SPA
// navigation, HMR). List view repaints every on-page component; detail view
// re-runs its precise (or wildcard-fallback) highlights for the selected
// component so the overlay keeps tracking the current route.
watch(renderedFiles, () => {
  const comp = selectedComponent.value
  if (!comp) pushAllOnPageHighlights()
  else pushHighlightsFor(comp, usages.value)
})

let usagesFetchSeq = 0
async function loadUsagesFor(comp: LibraryComponent): Promise<void> {
  const seq = ++usagesFetchSeq
  isUsagesLoading.value = true
  usages.value = []
  // Paint the file-level wildcard highlights for this component *before* the
  // examples fetch so the iframe never flashes empty during the roundtrip.
  // Once examples arrive we narrow to precise (file, line) sites.
  pushHighlightsFor(comp, [])
  try {
    // Thread the selected library through so the returned examples can't
    // cross-contaminate with a same-name component from another library —
    // e.g. Mantine `Button` vs Radix `Button`. The server applies the same
    // `fromMatchesLibrary` rule the shell uses for highlight attribution.
    const lib = selectedLibrary.value
    const libQs = lib ? `&library=${encodeURIComponent(lib)}` : ''
    const data = await fetchJson<{ examples?: UsageExample[] }>(
      `component-examples/${encodeURIComponent(comp.name)}?limit=10${libQs}`,
    )
    // If another select() raced ahead of us, drop this response.
    if (seq !== usagesFetchSeq) return
    const list = (data?.examples ?? []).filter(e => e.file)
    usages.value = list
    pushHighlightsFor(comp, list)
  } finally {
    if (seq === usagesFetchSeq) isUsagesLoading.value = false
  }
}

function pushHighlightsFor(comp: LibraryComponent, examples: UsageExample[]): void {
  if (!highlightsAdapter) return
  const lib = selectedLibrary.value ?? ''
  const sites: DataHighlightSite[] = []
  const seen = new Set<string>()
  for (const ex of examples) {
    const key = `${ex.file}::${ex.line}`
    if (seen.has(key)) continue
    seen.add(key)
    // `tag: comp.name` scopes the iframe match to elements whose source tag
    // equals this component's name — keeps a Card's 920×215 card div and
    // drops e.g. a Checkbox that happens to sit on the same source line.
    // `module: lib` adds the library disambiguator so the selector never
    // cross-highlights a same-named component from another library.
    sites.push({ file: ex.file, line: ex.line, tag: comp.name, module: lib })
  }
  // Fallback: the examples endpoint returned nothing (or hasn't responded
  // yet). Use the library-scoped usage files intersected with the on-page
  // set so the overlay still paints every matching element in each rendered
  // file — matches the behaviour of the list view's on-page highlights.
  if (sites.length === 0) {
    const rendered = renderedFiles.value
    for (const file of filesForLibComponent(lib, comp.name)) {
      if (rendered.size > 0 && !rendered.has(file)) continue
      sites.push({ file, line: 0, tag: comp.name, module: lib })
    }
  }
  const sources: DataHighlightSource[] = [{
    name: sourceName(lib, comp.name),
    kind: 'composable' as const,
    sites,
    defaultLabel: comp.name,
    // All components from the same library share one color — less visual
    // noise than a distinct color per component when a handful are rendered.
    color: colorForLibrary(lib),
  }]
  highlightsAdapter.setSources(sources)
  highlightsAdapter.setFocus(sourceName(lib, comp.name))
}

export function useComponentLibrary(iframe?: ReturnType<typeof useIframeManager>) {
  return {
    libraries,
    usedProjectSet,
    usedOnPageSet,
    renderedFiles,
    isLoading,
    loadError,
    filterText,
    filterMode,
    filteredLibraries,
    selectedKey,
    selectedLibrary,
    selectedComponent,
    usages,
    isUsagesLoading,
    load: () => load(iframe),
    refreshRenderedFiles: iframe ? () => refreshRenderedFiles(iframe) : async () => {},
    select,
    clearSelection,
    setFocus,
    sourceName,
    isUsedInLib,
    isOnPageInLib,
    filesForLibComponent,
  }
}
