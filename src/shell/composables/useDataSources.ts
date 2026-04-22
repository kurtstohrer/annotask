/**
 * State + fetching for the Data view: project data sources, discovered API
 * schemas, and per-source definition details. Creates `api_update` tasks for
 * in-repo data sources; external sources are exposed but non-editable.
 */
import { ref, computed } from 'vue'
import { on as wsOn } from '../services/wsClient'
import type {
  ApiSchema,
  DataSource,
  DataSourceCatalog,
  DataSourceDetailsResult,
  DataSourceLibrary,
  ProjectDataEntry,
  RuntimeEndpoint,
  SourceBindingGraph,
} from '../../schema'
import { buildPositionalPalette, colorForSource } from './useDataHighlights'
import type { DataHighlightSource, DataHighlightSite } from './useDataHighlights'
import { useWorkspace } from './useWorkspace'
import { useLocalStorageEnum } from './useLocalStorageRef'

/** Filter mode for the Data-view list. Search is replaced by a two-mode toggle
 *  for APIs and Hooks:
 *  - `all`: every scanned hook / API schema
 *  - `onPage`: items with at least one highlight rect on the current iframe
 *    route (driven by the caller's `highlightRects`, so the overlay rAF loop
 *    has to be running before this mode picks anything up) */
export type DataFilterMode = 'all' | 'onPage'

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
      method?: string
      used_count: number
      library?: string
      /** 'runtime' for synthetic entries promoted from the runtime endpoint
       *  catalog — these have `file === ''` because they were discovered by
       *  network capture, not source scan. UI should render them with a badge
       *  and skip behaviors that require a code location. */
      discovered_by?: 'static' | 'runtime'
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

/** Runtime-observed endpoint catalog from /api/runtime-endpoints. */
const runtimeEndpoints = ref<RuntimeEndpoint[]>([])
const runtimeUpdatedAt = ref<number>(0)

const filterText = ref('')
const filterMode = useLocalStorageEnum<DataFilterMode>(
  'annotask:dataFilterMode',
  ['all', 'onPage'],
  'all',
)

/** Per-source binding graph, keyed by source name. Populated after loadAll. */
const bindingsByName = ref<Map<string, SourceBindingGraph>>(new Map())
/** Back-compat consumer-file map (used by the match-count chip on rows). */
const consumerFilesByName = ref<Map<string, string[]>>(new Map())
let highlightsAdapter: DataHighlightsAdapter | null = null

/** Which tab the highlights currently represent — 'apis' | 'hooks' | 'network' | 'libraries' | null. */
type HighlightTab = 'apis' | 'hooks' | 'libraries' | 'network' | null
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
    const [cat, schemaRes, runtimeRes] = await Promise.all([
      fetchJson<DataSourceCatalog>('data-sources'),
      fetchJson<{ schemas: ApiSchema[] }>('api-schemas?detail=true'),
      fetchJson<{ endpoints: RuntimeEndpoint[]; updatedAt: number }>('runtime-endpoints?merge_static=true'),
    ])
    catalog.value = cat
    schemas.value = schemaRes?.schemas ?? []
    runtimeEndpoints.value = runtimeRes?.endpoints ?? []
    runtimeUpdatedAt.value = runtimeRes?.updatedAt ?? 0
    await rebuildHighlightSources()
    // Refresh highlights for whatever tab is currently active.
    if (activeHighlightTab) pushHighlightsForTab(activeHighlightTab)
  } catch (err) {
    loadError.value = (err as Error).message ?? 'Failed to load data sources'
  } finally {
    isLoading.value = false
  }
}

/** Refresh only the runtime catalog — cheap enough to call on every 'runtime-endpoints:updated' WS broadcast. */
async function reloadRuntime(): Promise<void> {
  const runtimeRes = await fetchJson<{ endpoints: RuntimeEndpoint[]; updatedAt: number }>('runtime-endpoints?merge_static=true')
  if (!runtimeRes) return
  runtimeEndpoints.value = runtimeRes.endpoints
  runtimeUpdatedAt.value = runtimeRes.updatedAt
  // Re-push highlight sources so new endpoints light up without the user
  // having to leave and return to the Network tab.
  if (activeHighlightTab === 'network') pushHighlightsForTab('network')
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
      // Runtime-only entries have no source file for the binding analyzer
      // to anchor on — skip the fetch and return an empty graph.
      if (entry.discovered_by === 'runtime' || !entry.file) {
        return { entry, graph: null as SourceBindingGraph | null }
      }
      // Pass `file` so the server picks this MFE's entry (same endpoint-
      // derived name exists in every MFE) and threads the right
      // `hint_symbols` — the fetch result variables — into the analyzer.
      const qs = `?file=${encodeURIComponent(entry.file)}`
      const graph = await fetchJson<SourceBindingGraph>(
        `data-source-bindings/${encodeURIComponent(entry.name)}${qs}`,
      )
      return { entry, graph }
    }),
  )

  const graphMap = new Map<string, SourceBindingGraph>()
  const fileMap = new Map<string, string[]>()
  for (const { entry, graph } of results) {
    // Only surface entries the binding analyzer could actually locate in
    // the template / JSX. We used to fall back to the fetch call's JS line
    // when the graph was empty, but that line never matches a data-annotask
    // tag (only markup carries them), and the bridge's old file-level
    // retry ended up highlighting every instrumented element in the file —
    // including hardcoded template content — which is exactly the "painting
    // non-data things" noise the Data tab was producing.
    if (!graph || graph.sites.length === 0) continue
    // Key by (file, name) — multiple MFEs declare the same endpoint-derived
    // name (e.g. `apiHealth` in every MFE), so a name-only key would drop
    // every graph except the last one into the map.
    const entryKey = entryBindingKey(entry)
    graphMap.set(entryKey, graph)
    const files = new Set<string>()
    for (const s of graph.sites) files.add(normalizeFile(s.file))
    fileMap.set(entryKey, [...files])
  }
  bindingsByName.value = graphMap
  consumerFilesByName.value = fileMap
}

/** Composite key so binding graphs for same-named entries across MFEs
 *  (apiHealth in every stress-test MFE) stay distinct in the map. Method is
 *  included so a GET + PATCH pair on the same endpoint keeps two rows rather
 *  than collapsing to one. */
function entryBindingKey(entry: ProjectDataEntry): string {
  return `${entry.file}\u0001${entry.name}\u0002${entry.method ?? ''}`
}

/**
 * Positional color map for project data entries. `entryBindingKey(entry)` is
 * the canonical key (same one the overlay uses), but we also alias by bare
 * `entry.name` so the sidebar row swatches — which only know the display
 * name — render the same color as the overlay. Positional order matches the
 * catalog's `project_entries` order, which is deterministic for a given scan.
 */
const entryColors = computed<Map<string, string>>(() => {
  const out = new Map<string, string>()
  const cat = catalog.value
  if (!cat) return out
  const palette = buildPositionalPalette(cat.project_entries.length)
  cat.project_entries.forEach((entry, i) => {
    const color = palette[i]
    out.set(entryBindingKey(entry), color)
    // First-wins aliasing: two MFEs may share an entry name (`apiHealth`) —
    // the first one's color wins for the name-only lookup. The composite-key
    // lookup still disambiguates for overlays.
    if (!out.has(entry.name)) out.set(entry.name, color)
  })
  return out
})

/**
 * Positional color map for API schemas in catalog order. Keyed by
 * `schema.location` (the same key overlays use).
 */
const schemaColors = computed<Map<string, string>>(() => {
  const out = new Map<string, string>()
  const palette = buildPositionalPalette(schemas.value.length)
  schemas.value.forEach((s, i) => {
    out.set(s.location, palette[i])
  })
  return out
})

/** Look up the positional color for a project entry by composite or bare name. */
function colorForEntry(key: string): string {
  return entryColors.value.get(key) ?? colorForSource(key)
}

/** Look up the positional color for an API schema by `schema.location`. */
function colorForSchema(location: string): string {
  return schemaColors.value.get(location) ?? colorForSource(location)
}

/** Build the hooks tab's highlight source list from the cached binding graphs. */
/** Stable highlight-source key for a runtime endpoint. Matches the same
 *  name the overlay uses, so `highlightsAdapter.setFocus(key)` lines up. */
function networkEndpointKey(ep: RuntimeEndpoint): string {
  return `net:${ep.origin}|${ep.method}|${ep.pattern}`
}

/**
 * Latency-bucket color for a runtime endpoint. Drives the Network tab's row
 * swatch and the iframe overlay so a slow call paints red and a fast call
 * paints green — much higher signal than the previous positional palette.
 *
 * Buckets (using `avgMs` over completed samples; `maxMs` is the worst-case
 * tiebreaker for the slow side so a single jank spike still flags the row):
 *   - no samples yet                             → muted gray
 *   - avg < 200ms                                → success
 *   - avg < 500ms                                → warning
 *   - avg < 1000ms or max ≥ 1000ms               → annotation-orange
 *   - avg ≥ 1000ms                               → danger
 */
export function colorForLatency(avgMs?: number, maxMs?: number): string {
  if (typeof avgMs !== 'number') return 'var(--text-muted)'
  if (avgMs < 200) return 'var(--success)'
  if (avgMs < 500) return 'var(--warning)'
  if (avgMs >= 1000) return 'var(--danger)'
  if (typeof maxMs === 'number' && maxMs >= 1000) return 'var(--annotation-orange)'
  return 'var(--annotation-orange)'
}

/** Bucket label for tooltips and row badges — paired with `colorForLatency`. */
export function latencyBucketLabel(avgMs?: number): 'no data' | 'fast' | 'ok' | 'slow' | 'very slow' {
  if (typeof avgMs !== 'number') return 'no data'
  if (avgMs < 200) return 'fast'
  if (avgMs < 500) return 'ok'
  if (avgMs < 1000) return 'slow'
  return 'very slow'
}

function colorForEndpoint(ep: RuntimeEndpoint): string {
  return colorForLatency(ep.avgMs, ep.maxMs)
}

/**
 * Build the Network tab's highlight source list. Each runtime endpoint that
 * has at least one matching static `ProjectDataEntry` reuses *that* entry's
 * binding graph — the network tab doesn't run its own binding analysis, it
 * piggybacks on sites already resolved for the hooks tab. Orphan endpoints
 * (no matching static source) yield no highlights; they still show up in the
 * list but without a DOM overlay, which is accurate: the regex scanner never
 * discovered the call site, so we don't know which element it powers.
 */
function buildNetworkHighlightSources(): DataHighlightSource[] {
  const cat = catalog.value
  if (!cat) return []
  const out: DataHighlightSource[] = []
  for (const ep of runtimeEndpoints.value) {
    const matched = ep.matchedSources ?? []
    if (matched.length === 0) continue
    const sites: DataHighlightSite[] = []
    const seen = new Set<string>()
    const label = `${ep.method} ${ep.pattern}`
    for (const name of matched) {
      for (const entry of cat.project_entries) {
        if (entry.name !== name) continue
        const graph = bindingsByName.value.get(entryBindingKey(entry))
        if (!graph) continue
        for (const s of graph.sites) {
          const file = normalizeFile(s.file)
          const key = `${file}::${s.line}`
          if (seen.has(key)) continue
          seen.add(key)
          sites.push({ file, line: s.line, label })
        }
      }
    }
    if (sites.length === 0) continue
    const color = colorForEndpoint(ep)
    // Stamp the latency color on every site too — `useDataHighlights` reads
    // site.color first, then source.color. Without the per-site override the
    // overlay would still pick the source color, but being explicit here
    // means future per-site latency variants (e.g. per-route) won't have to
    // touch this path again.
    for (const s of sites) s.color = color
    out.push({
      name: networkEndpointKey(ep),
      kind: 'fetch',
      sites,
      defaultLabel: label,
      color,
    })
  }
  return out
}

function buildHookHighlightSources(): DataHighlightSource[] {
  const cat = catalog.value
  if (!cat) return []
  const out: DataHighlightSource[] = []
  for (const entry of cat.project_entries) {
    const graph = bindingsByName.value.get(entryBindingKey(entry))
    if (!graph || graph.sites.length === 0) continue
    const sites: DataHighlightSite[] = graph.sites.map(s => ({
      file: normalizeFile(s.file),
      line: s.line,
      // `line === 0` is the file-level fallback contract emitted by
      // `fallbackAnalyzer` when no framework-specific parser matched. Mark
      // those sites as 'fallback' so the overlay can paint them dimmer/
      // dotted — a wildcard match shouldn't look as authoritative as a
      // precise AST binding.
      confidence: s.line === 0 ? 'fallback' : 'precise',
      // Label the site with the hook name by default; the UI can show
      // `tainted_symbols` later if we want to render them.
    }))
    // Source-level confidence: fallback when any file in the graph fell back
    // to wildcard matching, else precise. `partialNote` surfaces the first
    // diagnostic so the tooltip can explain why.
    const sourceConfidence = graph.partial ? 'fallback' : 'precise'
    const partialNote = graph.partial && graph.diagnostics?.[0]
      ? `${graph.diagnostics[0].analyzer}: ${graph.diagnostics[0].note}`
      : undefined
    out.push({
      // Per-entry unique name so two MFEs both calling `apiHealth` stay
      // distinct in the overlay adapter (same dedup logic that needed
      // fixing for cross-library components).
      name: entryBindingKey(entry),
      kind: entry.kind,
      sites,
      defaultLabel: entry.display_name ?? entry.name,
      color: colorForEntry(entryBindingKey(entry)),
      confidence: sourceConfidence,
      partialNote,
    })
  }
  return out
}

/** Does an entry path match an operation path? Exact equality, or with
 *  OpenAPI-style `{id}` / Express-style `:id` placeholder segments treated
 *  as wildcards. Same length is required — no substring fallback. */
function matchesOpPath(opPath: string | undefined, entryPath: string): boolean {
  if (!opPath) return false
  if (opPath === entryPath) return true
  const opParts = opPath.split('/').filter(Boolean)
  const entryParts = entryPath.split('/').filter(Boolean)
  if (opParts.length !== entryParts.length) return false
  for (let i = 0; i < opParts.length; i++) {
    const p = opParts[i]
    if ((p.startsWith('{') && p.endsWith('}')) || p.startsWith(':')) continue
    if (p !== entryParts[i]) return false
  }
  return true
}

/**
 * Build the APIs tab's highlight source list. Each API schema becomes a
 * highlight "source" whose sites are the union of sites from every project
 * data source whose endpoint matches one of the schema's operations.
 * Per-site label = the matched operation's path.
 *
 * Origin matching: entry endpoints are resolved against the MFE's Vite proxy
 * server-side (`entry.resolved_endpoint`), and schemas carry `origin` either
 * from their probe URL or OpenAPI `servers[]`. When both sides have origins,
 * we require an exact match — otherwise `/api/health` on an MFE that proxies
 * to FastAPI ends up painting into the go-api schema's highlights too.
 */
function buildApiHighlightSources(): DataHighlightSource[] {
  const cat = catalog.value
  if (!cat) return []
  const out: DataHighlightSource[] = []
  const originOf = (raw: string | undefined): string | null => {
    if (!raw) return null
    if (!raw.startsWith('http://') && !raw.startsWith('https://')) return null
    try { return new URL(raw).origin } catch { return null }
  }
  const pathOf = (raw: string): string => {
    if (!raw.startsWith('http://') && !raw.startsWith('https://')) return raw
    try { return new URL(raw).pathname } catch { return raw }
  }
  // An entry's origin comes from its resolved_endpoint (proxy-aware) first,
  // falling back to a literal absolute URL in `endpoint`. We also pre-compute
  // the set of origins covered by any schema so we can drop filesystem
  // schemas (no origin) whose operations are already claimed by an HTTP-
  // probed schema at the entry's real origin.
  const schemaOrigins = new Set<string>()
  for (const s of schemas.value) {
    const o = s.origin ?? originOf(s.location)
    if (o) schemaOrigins.add(o)
  }
  for (const schema of schemas.value) {
    const schemaOrigin = schema.origin ?? originOf(schema.location)
    const sites: DataHighlightSite[] = []
    const seen = new Set<string>()
    for (const entry of cat.project_entries) {
      if (!entry.endpoint) continue
      const entryUrl = entry.resolved_endpoint ?? entry.endpoint
      const entryOrigin = originOf(entryUrl)
      // Strict origin match when both sides know their origin.
      if (schemaOrigin && entryOrigin && schemaOrigin !== entryOrigin) continue
      // When the entry has a known origin but this schema doesn't, skip if
      // another schema covers the entry's origin — that's the right owner.
      if (!schemaOrigin && entryOrigin && schemaOrigins.has(entryOrigin)) continue
      const entryPath = pathOf(entryUrl)
      const match = schema.operations.find(op => matchesOpPath(op.path, entryPath))
      if (!match) continue
      const graph = bindingsByName.value.get(entryBindingKey(entry))
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
      color: colorForSchema(schema.location),
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
  } else if (tab === 'network') {
    highlightsAdapter.setSources(buildNetworkHighlightSources())
  } else {
    highlightsAdapter.setSources([])
  }
  // Reset focus when context changes — the previous focused name likely
  // doesn't exist in the new list.
  highlightsAdapter.setFocus(null)
}

/** Focus (or clear focus for) the network endpoint with this key. Drives the
 *  same dim-others behavior Hooks / APIs use when a row is selected. */
function focusNetworkEndpoint(key: string | null): void {
  highlightsAdapter?.setFocus(key)
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
  const originOf = (raw: string): string | null => {
    if (!raw.startsWith('http://') && !raw.startsWith('https://')) return null
    try { return new URL(raw).origin } catch { return null }
  }
  const pathOf = (raw: string): string => {
    if (!raw.startsWith('http://') && !raw.startsWith('https://')) return raw
    try { return new URL(raw).pathname } catch { return raw }
  }
  const entryOrigin = originOf(entry.endpoint)
  const entryPath = pathOf(entry.endpoint)
  const needle = entryPath.toLowerCase()
  for (const schema of all) {
    const schemaOrigin = originOf(schema.location)
    if (schemaOrigin && entryOrigin && schemaOrigin !== entryOrigin) continue
    for (const op of schema.operations) {
      if (op.path && (op.path === entryPath || op.path.toLowerCase().includes(needle) || needle.includes(op.path.toLowerCase()))) {
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
        // Runtime-only entries have `file: ''`, which would collapse all of
        // them into a single id. Use the method+endpoint as the stable
        // identifier for those, matching how the Network tab keys rows.
        // Static entries include `method` so GET + PATCH on the same
        // (file, name) stay two rows — the binding graph keys them
        // distinctly via `entryBindingKey`, so the UI has to agree.
        id: entry.discovered_by === 'runtime'
          ? `source:runtime:${entry.method ?? 'GET'}:${entry.endpoint ?? entry.name}`
          : `source:${entry.file}:${entry.name}:${entry.method ?? ''}`,
        name: entry.name,
        dataKind: entry.kind,
        file: entry.file,
        line: entry.line,
        endpoint: entry.endpoint,
        method: entry.method,
        used_count: entry.used_count,
        discovered_by: entry.discovered_by,
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
  const ws = useWorkspace()
  const selected = ws.selectedMfes.value
  let items = dataSourceItems.value
  if (q) {
    items = items.filter(item =>
      item.name.toLowerCase().includes(q)
      || item.file.toLowerCase().includes(q)
      || (item.endpoint?.toLowerCase().includes(q) ?? false),
    )
  }
  if (selected.size > 0) {
    items = items.filter(item => {
      const id = ws.mfeForFile(item.file)
      return !!id && selected.has(id)
    })
  }
  return items
})

const filteredApiSchemas = computed<ApiSchemaItem[]>(() => {
  const q = filterText.value.trim().toLowerCase()
  const ws = useWorkspace()
  const selected = ws.selectedMfes.value
  let items = apiSchemaItems.value
  if (q) {
    items = items.filter(item =>
      item.schema.location.toLowerCase().includes(q)
      || (item.schema.title?.toLowerCase().includes(q) ?? false)
      || item.schema.kind.includes(q),
    )
  }
  if (selected.size > 0) {
    // A schema belongs to an MFE when either its own location is a file in
    // that MFE, OR any of its operations are consumed by a project-entry
    // file in that MFE (lets an external FastAPI schema show up under the
    // Vue data-lab MFE that actually calls it).
    const cat = catalog.value
    const originOf = (raw: string): string | null => {
      if (!raw.startsWith('http://') && !raw.startsWith('https://')) return null
      try { return new URL(raw).origin } catch { return null }
    }
    const pathOf = (raw: string): string => {
      if (!raw.startsWith('http://') && !raw.startsWith('https://')) return raw
      try { return new URL(raw).pathname } catch { return raw }
    }
    items = items.filter(item => {
      const locId = ws.mfeForFile(item.schema.location)
      if (locId && selected.has(locId)) return true
      if (!cat) return false
      const schemaOrigin = originOf(item.schema.location)
      for (const entry of cat.project_entries) {
        if (!entry.endpoint) continue
        const entryId = ws.mfeForFile(entry.file)
        if (!entryId || !selected.has(entryId)) continue
        const entryOrigin = originOf(entry.endpoint)
        if (schemaOrigin && entryOrigin && schemaOrigin !== entryOrigin) continue
        const entryPath = pathOf(entry.endpoint)
        const match = item.schema.operations.find(op => {
          if (!op.path) return false
          if (op.path === entryPath) return true
          const a = op.path.toLowerCase()
          const b = entryPath.toLowerCase()
          return a.includes(b) || b.includes(a)
        })
        if (match) return true
      }
      return false
    })
  }
  return items
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
  const entry = cat.project_entries.find(e =>
    e.file === item.file
    && e.name === item.name
    && (e.method ?? '') === (item.method ?? ''),
  )
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
    // Composite key matches the source name buildHookHighlightSources uses:
    // `filenamemethod` — method included so GET + PATCH on
    // the same (file, name) don't cross-focus.
    highlightsAdapter?.setFocus(`${item.file}\u0001${item.name}\u0002${item.method ?? ''}`)
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
    // Aggregated runtime-endpoints catalog mutates whenever the iframe pushes
    // a new batch. Reload the runtime slice so the Data view updates live
    // without polling. Throttled on the server via its debounced persist, so
    // this fires at most ~2 Hz even during bursty traffic.
    wsOn('runtime-endpoints:updated', () => { void reloadRuntime() })
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
    runtimeEndpoints,
    runtimeUpdatedAt,
    reloadRuntime,
    filteredDataSources,
    filteredApiSchemas,
    filteredLibraries,
    filterText,
    filterMode,
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
    colorForEndpoint,
    networkEndpointKey,
    focusNetworkEndpoint,
    select,
    clearSelection,
    reload: loadAll,
    createApiUpdateTask,
    colorForEntry,
    colorForSchema,
    bindingConfidenceFor,
  }
}

/** Returns the binding-graph confidence for a data-source row, or `null` when
 *  the graph hasn't resolved yet. Used by the row-level confidence badge and
 *  tooltip so the shell can say "this match fell back to file-level" without
 *  the caller having to inspect `SourceBindingGraph` directly. */
function bindingConfidenceFor(item: { file: string; name: string; method?: string }): {
  confidence: 'precise' | 'fallback'
  note?: string
} | null {
  const key = `${item.file}${item.name}${item.method ?? ''}`
  const graph = bindingsByName.value.get(key)
  if (!graph) return null
  if (!graph.partial) return { confidence: 'precise' }
  const first = graph.diagnostics?.[0]
  return {
    confidence: 'fallback',
    note: first ? `${first.analyzer}: ${first.note}` : undefined,
  }
}
