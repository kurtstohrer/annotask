/**
 * State + fetching for the Data view: project data sources, discovered API
 * schemas, and per-source definition details. Creates `api_update` tasks for
 * in-repo data sources; external sources are exposed but non-editable.
 */
import { ref, computed } from 'vue'
import type {
  ApiSchema,
  DataSource,
  DataSourceCatalog,
  DataSourceDetailsResult,
  DataSourceLibrary,
  ProjectDataEntry,
  SourceBindingGraph,
} from '../../schema'
import { colorForSource } from './useDataHighlights'
import type { DataHighlightSource, DataHighlightSite } from './useDataHighlights'

/** Adapter handed over by App.vue so selection/load events can drive highlights without a cyclic import. */
export interface DataHighlightsAdapter {
  setSources: (list: DataHighlightSource[]) => void
  setFocus: (name: string | null) => void
  clear: () => void
}

export type DataListItem =
  | {
      kind: 'data-source'
      id: string
      name: string
      dataKind: DataSource['kind']
      file: string
      line?: number
      endpoint?: string
      used_count: number
      library?: string
    }
  | {
      kind: 'api-schema'
      id: string
      schema: ApiSchema
    }
  | {
      kind: 'library'
      id: string
      library: DataSourceLibrary
    }

export interface LibraryUsage {
  file: string
  line: number
  pattern: string
  snippet?: string
  import_path?: string
}

const catalog = ref<DataSourceCatalog | null>(null)
const schemas = ref<ApiSchema[]>([])
const isLoading = ref(false)
const loadError = ref<string | null>(null)

const selectedId = ref<string | null>(null)
const details = ref<DataSourceDetailsResult | null>(null)
const isDetailsLoading = ref(false)
const detailsError = ref<string | null>(null)

const libraryUsages = ref<LibraryUsage[]>([])
const isLibraryUsagesLoading = ref(false)

const filterText = ref('')

/** Per-source binding graph, keyed by source name. Populated after loadAll. */
const bindingsByName = ref<Map<string, SourceBindingGraph>>(new Map())
/** Back-compat consumer-file map (used by the match-count chip on rows). */
const consumerFilesByName = ref<Map<string, string[]>>(new Map())
let highlightsAdapter: DataHighlightsAdapter | null = null

/** Which tab the highlights currently represent — 'apis' | 'hooks' | null. */
type HighlightTab = 'apis' | 'hooks' | 'libraries' | null
let activeHighlightTab: HighlightTab = null

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`/__annotask/api/${path}`)
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    return null
  }
}

async function loadAll(): Promise<void> {
  isLoading.value = true
  loadError.value = null
  try {
    const [cat, schemaRes] = await Promise.all([
      fetchJson<DataSourceCatalog>('data-sources'),
      fetchJson<{ schemas: ApiSchema[] }>('api-schemas?detail=true'),
    ])
    catalog.value = cat
    schemas.value = schemaRes?.schemas ?? []
    await rebuildHighlightSources()
    // Refresh highlights for whatever tab is currently active.
    if (activeHighlightTab) pushHighlightsForTab(activeHighlightTab)
  } catch (err) {
    loadError.value = (err as Error).message ?? 'Failed to load data sources'
  } finally {
    isLoading.value = false
  }
}

/**
 * Fetch the binding graph for each project entry in parallel. The graph
 * holds precise (file, line) sites produced by the server-side binding
 * analyzer — no more file-level matching. Back-compat consumer-file map is
 * derived from the sites so the row match-count UI still works.
 */
async function rebuildHighlightSources(): Promise<void> {
  const cat = catalog.value
  if (!cat) return
  const entries = cat.project_entries
  if (entries.length === 0) {
    bindingsByName.value = new Map()
    consumerFilesByName.value = new Map()
    return
  }

  const results = await Promise.all(
    entries.map(async entry => {
      const graph = await fetchJson<SourceBindingGraph>(
        `data-source-bindings/${encodeURIComponent(entry.name)}`,
      )
      return { entry, graph }
    }),
  )

  const graphMap = new Map<string, SourceBindingGraph>()
  const fileMap = new Map<string, string[]>()
  for (const { entry, graph } of results) {
    if (!graph || graph.sites.length === 0) continue
    graphMap.set(entry.name, graph)
    const files = new Set<string>()
    for (const s of graph.sites) files.add(normalizeFile(s.file))
    fileMap.set(entry.name, [...files])
  }
  bindingsByName.value = graphMap
  consumerFilesByName.value = fileMap
}

/** Build the hooks tab's highlight source list from the cached binding graphs. */
function buildHookHighlightSources(): DataHighlightSource[] {
  const cat = catalog.value
  if (!cat) return []
  const out: DataHighlightSource[] = []
  for (const entry of cat.project_entries) {
    const graph = bindingsByName.value.get(entry.name)
    if (!graph || graph.sites.length === 0) continue
    const sites: DataHighlightSite[] = graph.sites.map(s => ({
      file: normalizeFile(s.file),
      line: s.line,
      // Label the site with the hook name by default; the UI can show
      // `planet.moons` later if we want to render tainted_symbols.
    }))
    out.push({
      name: entry.name,
      kind: entry.kind,
      sites,
      defaultLabel: entry.name,
    })
  }
  return out
}

/**
 * Build the APIs tab's highlight source list. Each API schema becomes a
 * highlight "source" whose sites are the union of sites from every project
 * data source whose endpoint matches one of the schema's operations.
 * Per-site label = the matched operation's path.
 */
function buildApiHighlightSources(): DataHighlightSource[] {
  const cat = catalog.value
  if (!cat) return []
  const out: DataHighlightSource[] = []
  for (const schema of schemas.value) {
    const sites: DataHighlightSite[] = []
    const seen = new Set<string>()
    for (const entry of cat.project_entries) {
      if (!entry.endpoint) continue
      const match = schema.operations.find(op => {
        if (!op.path) return false
        if (op.path === entry.endpoint) return true
        const a = op.path.toLowerCase()
        const b = entry.endpoint!.toLowerCase()
        return a.includes(b) || b.includes(a)
      })
      if (!match) continue
      const graph = bindingsByName.value.get(entry.name)
      if (!graph) continue
      const opLabel = match.path
      // Overlays use the schema-level color (same as the sidebar swatch) for
      // consistency. The "Routes on this page" chips in the detail pane show
      // per-operation colors as the disambiguating legend.
      for (const s of graph.sites) {
        const file = normalizeFile(s.file)
        const key = `${file}::${s.line}`
        if (seen.has(key)) continue
        seen.add(key)
        sites.push({ file, line: s.line, label: opLabel })
      }
    }
    if (sites.length === 0) continue
    out.push({
      name: schema.location,
      kind: 'rpc',
      sites,
      defaultLabel: schema.location,
    })
  }
  return out
}

/**
 * For the currently-selected API schema, derive the list of operations that
 * have at least one highlight on the current route, with their color chip.
 * Used by the detail pane to show "routes on this page".
 */
export interface OpOnPage {
  path: string
  method: string
  color: string
  count: number
}

function operationsOnPage(schemaLocation: string, rects: Array<{ sourceName: string; label: string; color: string }>): OpOnPage[] {
  const s = schemas.value.find(x => x.location === schemaLocation)
  if (!s) return []
  const byPath = new Map<string, OpOnPage>()
  for (const r of rects) {
    if (r.sourceName !== schemaLocation) continue
    const op = s.operations.find(o => o.path === r.label)
    const method = op?.method ?? ''
    const key = `${method}|${r.label}`
    const existing = byPath.get(key)
    if (existing) { existing.count += 1; continue }
    // Per-op color derived from (location, method, path) hash — independent
    // of the rect color so each route chip gets a distinct legend color.
    const color = colorForSource(`${schemaLocation}|${method}|${r.label}`)
    byPath.set(key, { path: r.label, method, color, count: 1 })
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Called by the page when the user switches tabs. Each tab maps to its own
 * set of highlight targets; the Libraries tab clears them entirely.
 */
function pushHighlightsForTab(tab: HighlightTab): void {
  activeHighlightTab = tab
  if (!highlightsAdapter) return
  if (tab === 'hooks') {
    highlightsAdapter.setSources(buildHookHighlightSources())
  } else if (tab === 'apis') {
    highlightsAdapter.setSources(buildApiHighlightSources())
  } else {
    highlightsAdapter.setSources([])
  }
  // Reset focus when context changes — the previous focused name likely
  // doesn't exist in the new list.
  highlightsAdapter.setFocus(null)
}

function setHighlightTab(tab: HighlightTab): void {
  pushHighlightsForTab(tab)
}

function normalizeFile(raw: string): string {
  let f = raw.replace(/\\/g, '/')
  if (f.startsWith('./')) f = f.slice(2)
  return f
}

async function loadDetails(item: DataListItem): Promise<void> {
  if (item.kind === 'library') {
    details.value = null
    await loadLibraryUsages(item.library)
    return
  }
  if (item.kind !== 'data-source') {
    details.value = null
    libraryUsages.value = []
    return
  }
  libraryUsages.value = []
  isDetailsLoading.value = true
  detailsError.value = null
  try {
    const qs = new URLSearchParams({
      kind: item.dataKind,
      file: item.file,
    }).toString()
    const result = await fetchJson<DataSourceDetailsResult>(
      `data-source-details/${encodeURIComponent(item.name)}?${qs}`,
    )
    details.value = result
  } catch (err) {
    detailsError.value = (err as Error).message ?? 'Failed to load details'
    details.value = null
  } finally {
    isDetailsLoading.value = false
  }
}

interface RawExample {
  file: string
  line?: number
  snippet?: string
  import_path?: string
}

/**
 * Aggregate project usages for a library by fetching data-source-examples for
 * each detected pattern in parallel. Dedupes by file:line.
 */
async function loadLibraryUsages(lib: DataSourceLibrary): Promise<void> {
  isLibraryUsagesLoading.value = true
  libraryUsages.value = []
  try {
    const results = await Promise.all(
      lib.detected_patterns.map(pat =>
        fetchJson<{ examples?: RawExample[] }>(
          `data-source-examples/${encodeURIComponent(pat)}?limit=10`,
        ),
      ),
    )
    const seen = new Set<string>()
    const merged: LibraryUsage[] = []
    for (let i = 0; i < results.length; i++) {
      const pat = lib.detected_patterns[i]
      for (const ex of results[i]?.examples ?? []) {
        if (!ex.file) continue
        const key = `${ex.file}:${ex.line ?? 0}:${pat}`
        if (seen.has(key)) continue
        seen.add(key)
        merged.push({
          file: normalizeFile(ex.file),
          line: ex.line ?? 0,
          pattern: pat,
          snippet: ex.snippet,
          import_path: ex.import_path,
        })
      }
    }
    libraryUsages.value = merged
  } finally {
    isLibraryUsagesLoading.value = false
  }
}

/**
 * Find the API schema that most likely backs a data-source, by matching on
 * endpoint / path heuristics. Used to expose `schema_in_repo` on the detail
 * pane and wire the `Create API Update Task` button.
 */
function matchSchemaForEntry(entry: ProjectDataEntry, all: ApiSchema[]): { schema: ApiSchema; operation?: ApiSchema['operations'][number] } | null {
  if (!entry.endpoint) return null
  const needle = entry.endpoint.toLowerCase()
  for (const schema of all) {
    for (const op of schema.operations) {
      if (op.path && (op.path === entry.endpoint || op.path.toLowerCase().includes(needle) || needle.includes(op.path.toLowerCase()))) {
        return { schema, operation: op }
      }
    }
  }
  return null
}

const listItems = computed<DataListItem[]>(() => {
  const out: DataListItem[] = []
  const cat = catalog.value
  if (cat) {
    for (const entry of cat.project_entries) {
      out.push({
        kind: 'data-source',
        id: `source:${entry.file}:${entry.name}`,
        name: entry.name,
        dataKind: entry.kind,
        file: entry.file,
        line: entry.line,
        endpoint: entry.endpoint,
        used_count: entry.used_count,
      })
    }
    for (const lib of cat.libraries) {
      out.push({
        kind: 'library',
        id: `lib:${lib.name}`,
        library: lib,
      })
    }
  }
  for (const schema of schemas.value) {
    out.push({
      kind: 'api-schema',
      id: `schema:${schema.kind}:${schema.location}`,
      schema,
    })
  }
  return out
})

const filteredItems = computed<DataListItem[]>(() => {
  const q = filterText.value.trim().toLowerCase()
  if (!q) return listItems.value
  return listItems.value.filter(item => {
    if (item.kind === 'data-source') {
      return item.name.toLowerCase().includes(q)
        || item.file.toLowerCase().includes(q)
        || (item.endpoint?.toLowerCase().includes(q) ?? false)
    }
    if (item.kind === 'api-schema') {
      return item.schema.location.toLowerCase().includes(q)
        || (item.schema.title?.toLowerCase().includes(q) ?? false)
        || item.schema.kind.includes(q)
    }
    // library
    return item.library.name.toLowerCase().includes(q)
      || item.library.detected_patterns.some(p => p.toLowerCase().includes(q))
  })
})

type DataSourceItem = Extract<DataListItem, { kind: 'data-source' }>
type ApiSchemaItem = Extract<DataListItem, { kind: 'api-schema' }>

const dataSourceItems = computed<DataSourceItem[]>(() =>
  listItems.value.filter((i): i is DataSourceItem => i.kind === 'data-source'),
)

const apiSchemaItems = computed<ApiSchemaItem[]>(() =>
  listItems.value.filter((i): i is ApiSchemaItem => i.kind === 'api-schema'),
)

const libraries = computed(() => catalog.value?.libraries ?? [])

const filteredDataSources = computed<DataSourceItem[]>(() => {
  const q = filterText.value.trim().toLowerCase()
  if (!q) return dataSourceItems.value
  return dataSourceItems.value.filter(item =>
    item.name.toLowerCase().includes(q)
    || item.file.toLowerCase().includes(q)
    || (item.endpoint?.toLowerCase().includes(q) ?? false),
  )
})

const filteredApiSchemas = computed<ApiSchemaItem[]>(() => {
  const q = filterText.value.trim().toLowerCase()
  if (!q) return apiSchemaItems.value
  return apiSchemaItems.value.filter(item =>
    item.schema.location.toLowerCase().includes(q)
    || (item.schema.title?.toLowerCase().includes(q) ?? false)
    || item.schema.kind.includes(q),
  )
})

const filteredLibraries = computed(() => {
  const q = filterText.value.trim().toLowerCase()
  if (!q) return libraries.value
  return libraries.value.filter(lib =>
    lib.name.toLowerCase().includes(q)
    || lib.detected_patterns.some(p => p.toLowerCase().includes(q)),
  )
})

const selectedItem = computed<DataListItem | null>(() => {
  const id = selectedId.value
  if (!id) return null
  return listItems.value.find(i => i.id === id) ?? null
})

/**
 * For the currently selected data-source, find the matching schema (if any)
 * and return `{ schema_in_repo, schema, operation }` so the detail pane can
 * decide whether to show the "Create API Update Task" button.
 */
const selectedSchemaLink = computed<
  { schema_in_repo: boolean; schema: ApiSchema; operation?: ApiSchema['operations'][number] } | null
>(() => {
  const item = selectedItem.value
  if (!item || item.kind !== 'data-source') return null
  const cat = catalog.value
  if (!cat) return null
  const entry = cat.project_entries.find(e => e.file === item.file && e.name === item.name)
  if (!entry) return null
  const match = matchSchemaForEntry(entry, schemas.value)
  if (!match) return null
  return {
    schema_in_repo: match.schema.in_repo,
    schema: match.schema,
    operation: match.operation,
  }
})

function select(id: string): void {
  selectedId.value = id
  const item = listItems.value.find(i => i.id === id)
  if (!item) return
  loadDetails(item)
  // Focus mapping depends on which tab's highlight context is active.
  if (item.kind === 'data-source' && activeHighlightTab === 'hooks') {
    highlightsAdapter?.setFocus(item.name)
  } else if (item.kind === 'api-schema' && activeHighlightTab === 'apis') {
    highlightsAdapter?.setFocus(item.schema.location)
  } else {
    highlightsAdapter?.setFocus(null)
  }
}

function clearSelection(): void {
  selectedId.value = null
  details.value = null
  highlightsAdapter?.setFocus(null)
}

async function createApiUpdateTask(args: {
  description: string
  desired_change: string
  rationale?: string
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const item = selectedItem.value
  if (!item || item.kind !== 'data-source') {
    return { ok: false, error: 'No data source selected' }
  }
  const link = selectedSchemaLink.value
  if (!link || !link.schema_in_repo) {
    return { ok: false, error: 'Selected source is not backed by an in-repo schema' }
  }
  const context: Record<string, unknown> = {
    data_source_name: item.name,
    data_source_kind: item.dataKind,
    schema_location: link.schema.location,
    schema_kind: link.schema.kind,
    desired_change: args.desired_change,
  }
  if (item.endpoint) context.endpoint = item.endpoint
  if (link.operation) {
    context.operation = { method: link.operation.method, path: link.operation.path }
  }
  if (args.rationale) context.rationale = args.rationale
  try {
    const res = await fetch('/__annotask/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'api_update',
        description: args.description,
        file: item.file,
        line: item.line ?? 1,
        context,
      }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { ok: false, error: data?.error?.message ?? `HTTP ${res.status}` }
    }
    const created = await res.json()
    return { ok: true, id: created.id }
  } catch (err) {
    return { ok: false, error: (err as Error).message ?? 'Network error' }
  }
}

let initialized = false

/**
 * App.vue calls this once with the useDataHighlights instance so selection and
 * catalog loads can drive the overlay without a cyclic import.
 */
export function attachDataHighlights(adapter: DataHighlightsAdapter): void {
  highlightsAdapter = adapter
  // If the catalog is already loaded, push sources now.
  if (catalog.value) rebuildHighlightSources()
}

export function useDataSources() {
  if (!initialized) {
    initialized = true
    loadAll()
  }
  return {
    catalog,
    schemas,
    isLoading,
    loadError,
    listItems,
    filteredItems,
    dataSourceItems,
    apiSchemaItems,
    libraries,
    filteredDataSources,
    filteredApiSchemas,
    filteredLibraries,
    filterText,
    selectedId,
    selectedItem,
    selectedSchemaLink,
    details,
    isDetailsLoading,
    detailsError,
    libraryUsages,
    isLibraryUsagesLoading,
    consumerFilesByName,
    operationsOnPage,
    setHighlightTab,
    select,
    clearSelection,
    reload: loadAll,
    createApiUpdateTask,
  }
}
