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
      fetchJson<{ usage: Record<string, string[]> }>('component-usage'),
    ])
    libraries.value = catalog?.libraries ?? []
    const map = new Map<string, string[]>()
    for (const [name, files] of Object.entries(usage?.usage ?? {})) {
      map.set(name, files)
    }
    usageByName.value = map
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
  renderedFiles.value = new Set(files)
}

/** Components referenced anywhere in `src/`. */
const usedProjectSet = computed<Set<string>>(() => {
  const s = new Set<string>()
  for (const [name, files] of usageByName.value.entries()) {
    if (files.length > 0) s.add(name)
  }
  return s
})

/** Components whose usage files intersect the currently-rendered file set. */
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
        const used = usedProjectSet.value
        comps = comps.filter(c => used.has(c.name))
      } else if (mode === 'onPage') {
        const onPage = usedOnPageSet.value
        comps = comps.filter(c => onPage.has(c.name))
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
    highlightsAdapter?.setFocus(comp.name)
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
  const seen = new Set<string>()
  for (const lib of libraries.value) {
    for (const c of lib.components) {
      if (seen.has(c.name)) continue
      const files = usageByName.value.get(c.name) ?? []
      const onPage = files.filter(f => rendered.has(f))
      if (onPage.length === 0) continue
      seen.add(c.name)
      sources.push({
        name: c.name,
        kind: 'composable',
        sites: onPage.map(file => ({ file, line: 0, tag: c.name })),
        defaultLabel: c.name,
        color: colorForLibrary(lib.name),
      })
    }
  }
  highlightsAdapter.setSources(sources)
  highlightsAdapter.setFocus(null)
}

/** Emphasize one component's rects (and by extension the matching list row
 *  when App.vue propagates the focus). `null` clears the emphasis. */
function setFocus(name: string | null): void {
  highlightsAdapter?.setFocus(name)
}

// Re-emit the on-page set whenever the iframe's rendered file set changes
// (SPA navigation, HMR) — but only while the list view is active. Detail
// view keeps its narrower per-component sources.
watch(renderedFiles, () => {
  if (!selectedComponent.value) pushAllOnPageHighlights()
})

let usagesFetchSeq = 0
async function loadUsagesFor(comp: LibraryComponent): Promise<void> {
  const seq = ++usagesFetchSeq
  isUsagesLoading.value = true
  usages.value = []
  // Drop prior-component highlights immediately — avoids a stale overlay
  // flashing while this fetch is in-flight.
  highlightsAdapter?.setSources([])
  try {
    const data = await fetchJson<{ examples?: UsageExample[] }>(
      `component-examples/${encodeURIComponent(comp.name)}?limit=10`,
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
  const sites: DataHighlightSite[] = []
  const seen = new Set<string>()
  for (const ex of examples) {
    const key = `${ex.file}::${ex.line}`
    if (seen.has(key)) continue
    seen.add(key)
    // `tag: comp.name` scopes the iframe match to elements whose source tag
    // equals this component's name — keeps a Card's 920×215 card div and
    // drops e.g. a Checkbox that happens to sit on the same source line.
    sites.push({ file: ex.file, line: ex.line, tag: comp.name })
  }
  const lib = selectedLibrary.value ?? ''
  const sources: DataHighlightSource[] = [{
    name: comp.name,
    kind: 'composable' as const,
    sites,
    defaultLabel: comp.name,
    // All components from the same library share one color — less visual
    // noise than a distinct color per component when a handful are rendered.
    color: colorForLibrary(lib),
  }]
  highlightsAdapter.setSources(sources)
  highlightsAdapter.setFocus(comp.name)
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
  }
}
