/**
 * Per-file / per-task data context resolver. Given `task.file` + `task.line`,
 * answers "what data source powers this element?" at two levels of detail:
 *
 *   - `probeDataContext` — cheap boolean + primary signal for selection-change
 *     UX (the "should the include-data-context checkbox render?" gate).
 *     First-match, exits early, results cached by (realpath, mtime).
 *   - `resolveDataContext` — full DataContext for attach-at-submit or MCP
 *     on-demand.
 *
 * Framework-neutral: Vue, React, Svelte, Solid, Astro, htmx, plus plain JS
 * with axios/fetch/ofetch. Best-effort regex; no AST. Reuses DATA_LIB_PATTERNS
 * from data-source-scanner.ts so the probe, the resolver, and the project
 * catalog speak the same language.
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { DataContext, DataSource } from '../schema.js'
import { DATA_LIB_PATTERNS, LIB_NAME_TO_KIND, libKind } from './data-source-scanner.js'
import { resolveProjectFile } from './path-safety.js'
import { scanApiSchemas, type ScanOptions } from './api-schema-scanner.js'
import { resolveEndpoint, derivedSchemaRef } from './api-schema-resolver.js'
import { resolveBindingGraph } from './binding-analysis/index.js'

export interface DataContextProbe {
  hasData: boolean
  primaryKind?: DataSource['kind']
  primaryName?: string
}

/**
 * Honesty tag on a resolved `DataSource` — how the identifier was attributed:
 *   dependency-confirmed  Matched a `DATA_LIB_PATTERNS` identifier AND the
 *                         owning library is an actual dependency in this
 *                         project's package.json.
 *   project-own           Resolves to a local (relative/aliased) import —
 *                         the project's own hook/composable, not a known
 *                         library.
 *   heuristic             Structural pattern match (`axios`/`$fetch` dotted
 *                         calls, tRPC chains) that is not cross-checked
 *                         against package.json — best-effort, not
 *                         dependency-verified.
 *   builtin               Native platform primitive requiring no dependency
 *                         at all (bare `fetch`).
 */
export type DataSourceProvenance = 'dependency-confirmed' | 'project-own' | 'heuristic' | 'builtin'

/** `DataSource` (schema.ts) plus the provenance tag above. */
export interface ResolvedDataSource extends DataSource {
  provenance: DataSourceProvenance
}

/** `DataContext` (schema.ts) plus an explicit scope marker and provenance-tagged sources. */
export interface ScopedDataContext extends DataContext {
  /** 'file' — whole-file resolve; 'element' — narrowed to a bound element via the binding graph. */
  scope: 'file' | 'element'
  sources: ResolvedDataSource[]
}

// ── Pattern tables ──────────────────────────────────────

/** Kind precedence for tie-breaking "which source is primary?". */
const KIND_ORDER: Record<DataSource['kind'], number> = {
  composable: 0, signal: 1, store: 2, fetch: 3, graphql: 4, loader: 5, rpc: 6,
}

/**
 * Reads dependencies for the RUNNING package's package.json (mirrors
 * data-source-scanner.ts's readDeps — not exported there, so reimplemented
 * here rather than editing that file). Cached per projectRoot, invalidated
 * on package.json mtime change.
 */
interface DepsCacheEntry { mtime: number; deps: Record<string, string> }
const depsCache = new Map<string, DepsCacheEntry>()

async function readProjectDeps(projectRoot: string): Promise<Record<string, string>> {
  const pkgPath = path.join(projectRoot, 'package.json')
  let mtime = 0
  try { mtime = (await fsp.stat(pkgPath)).mtimeMs } catch { return {} }
  const cached = depsCache.get(projectRoot)
  if (cached && cached.mtime === mtime) return cached.deps
  try {
    const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf-8'))
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
    depsCache.set(projectRoot, { mtime, deps })
    return deps
  } catch { return {} }
}

/**
 * Flattened identifier → kind map, gated on the identifier's owning library
 * actually being a dependency — fixes fabricated detections (e.g. mobx's
 * `computed`, zustand's `create`) surfacing in any project that merely uses
 * those words, regardless of whether the library is installed.
 */
function buildIdentifierKind(deps: Record<string, string>): Map<string, DataSource['kind']> {
  const map = new Map<string, DataSource['kind']>()
  for (const [libName, patterns] of Object.entries(DATA_LIB_PATTERNS)) {
    if (!(libName in deps)) continue
    for (const p of patterns) {
      // Skip dotted patterns (axios.get) and the bare `fetch` — both are
      // handled by dedicated regexes below.
      if (p.includes('.')) continue
      if (p === 'fetch') continue
      const kind = libKind(libName, p)
      // First write wins; later libraries using the same identifier inherit
      // the first kind unless they override via libKind's pattern-name rules.
      if (!map.has(p)) map.set(p, kind)
    }
  }
  // Nuxt built-in composables — not tied to a DATA_LIB_PATTERNS entry, so
  // gate them on the 'nuxt' dependency itself rather than detecting them
  // unconditionally.
  if ('nuxt' in deps) {
    if (!map.has('useFetch')) map.set('useFetch', 'composable')
    if (!map.has('useAsyncData')) map.set('useAsyncData', 'composable')
  }
  return map
}

/** Per-project cache of the dependency-gated identifier map (deps read is itself cached/mtime-checked). */
async function getIdentifierKind(projectRoot: string): Promise<Map<string, DataSource['kind']>> {
  const deps = await readProjectDeps(projectRoot)
  return buildIdentifierKind(deps)
}

/**
 * Naming-convention regex for project-owned hooks/composables that aren't in
 * any known library's pattern table — `use*` / `create*` calls. Only
 * attributed as a source when the identifier resolves to a local (relative
 * or aliased) import; see the `project-own` provenance branch below.
 */
const PROJECT_HOOK_RE = /\b(use[A-Z]\w*|create[A-Z]\w*)\s*\(/g

function isLocalImportPath(modulePath: string): boolean {
  return modulePath.startsWith('.') || modulePath.startsWith('/') ||
    modulePath.startsWith('@/') || modulePath.startsWith('~/')
}

/** Dotted call sites — HTTP clients exposed as a namespace object. */
const DOTTED_CALL_RE = /\b(axios|\$fetch)\.(get|post|put|patch|delete|request)\s*\(/g
/** Bare fetch() calls — arg can be a string, a template literal, or a variable. */
const BARE_FETCH_RE = /(?<![.\w$])fetch\s*\(\s*(?:(['"])([^'"`]+)\1|(`)([^`]*)`)?/g
/** Route hook calls — covers Vue, React, Solid, Nuxt, SvelteKit composables. */
const ROUTE_HOOK_RE = /\b(useRoute|useRouter|useParams|useSearchParams|useLoaderData|useRouteLoaderData|useNavigate|useLocation|usePathname|useActionData|useFetcher)\s*\(/g
/**
 * tRPC chained call sites — `trpc.users.list.useQuery()`, `trpc.users.add.useMutation()`.
 * Capture the procedure path plus the method (useQuery / useMutation).
 */
const TRPC_CHAIN_RE = /\btrpc((?:\.[A-Za-z_$][\w$]*)+)\.(useQuery|useMutation|useSuspenseQuery|useInfiniteQuery|query|mutate)\s*\(/g

/** Import parse: capture `import { a, b } from 'mod'` and `import a from 'mod'`. */
const IMPORT_RE = /import\s+(?:([A-Za-z_$][\w$]*)(?:\s*,\s*\{([^}]+)\})?|\{([^}]+)\})\s+from\s+['"]([^'"]+)['"]/g

// ── Probe cache ─────────────────────────────────────────

interface ProbeCacheEntry { mtime: number; result: DataContextProbe }
/**
 * Probe cache, capped so it can't grow without bound during a long session of
 * clicking around the app. FIFO eviction is fine — agents don't thrash this.
 */
const PROBE_CACHE_MAX = 500
const probeCache = new Map<string, ProbeCacheEntry>()

function probeCachePut(key: string, value: ProbeCacheEntry): void {
  if (probeCache.has(key)) probeCache.delete(key)  // re-insert to refresh order
  probeCache.set(key, value)
  while (probeCache.size > PROBE_CACHE_MAX) {
    const first = probeCache.keys().next().value
    if (first === undefined) break
    probeCache.delete(first)
  }
}

export function clearDataContextCache() {
  probeCache.clear()
}

// ── Public API ──────────────────────────────────────────

export async function probeDataContext(
  projectRoot: string,
  relFile: string,
  workspaceRoot?: string,
): Promise<DataContextProbe> {
  const resolved = resolveProjectFile(projectRoot, relFile, workspaceRoot)
  if (!resolved) return { hasData: false }
  const absPath = resolved.absolutePath
  // Canonicalize through realpath so symlink aliases share cache entries.
  let canonical = absPath
  try { canonical = await fsp.realpath(absPath) } catch { /* file may not exist yet */ }
  let mtime = 0
  try { mtime = (await fsp.stat(canonical)).mtimeMs } catch {
    return { hasData: false }
  }
  const cached = probeCache.get(canonical)
  if (cached && cached.mtime === mtime) return cached.result

  let content: string
  try { content = await fsp.readFile(canonical, 'utf-8') } catch {
    return { hasData: false }
  }

  const identifierKind = await getIdentifierKind(projectRoot)
  const first = findFirstDataReference(content, identifierKind)
  const result: DataContextProbe = first
    ? { hasData: true, primaryKind: first.kind, primaryName: first.name }
    : { hasData: false }

  probeCachePut(canonical, { mtime, result })
  return result
}

export async function resolveDataContext(
  projectRoot: string,
  relFile: string,
  line: number,
  schemaOpts: ScanOptions = {},
  workspaceRoot?: string,
): Promise<ScopedDataContext> {
  const resolved = resolveProjectFile(projectRoot, relFile, workspaceRoot)
  if (!resolved) return { sources: [], scope: 'file' }
  const absPath = resolved.absolutePath
  let content: string
  try { content = await fsp.readFile(absPath, 'utf-8') } catch {
    return { sources: [], scope: 'file' }
  }

  const identifierKind = await getIdentifierKind(projectRoot)
  const imports = parseImports(content)
  const allSources = findAllDataReferences(content, imports, identifierKind)

  // Drop loader-kind sources without an endpoint — route hooks (useRouter,
  // useParams, etc.) carry no data payload; the useful signal lives in
  // `route_bindings` instead.
  const sources = allSources.filter(s => s.kind !== 'loader' || !!s.endpoint)

  // Cross-reference each source's endpoint against the discovered API
  // schemas. Filesystem-only by default — dev-server probes are opt-in via
  // `schemaOpts.devServerUrl` so we don't fire HTTP requests on every probe
  // path read. The catalog is cached; first call warms, rest are O(1).
  if (sources.some(s => s.endpoint)) {
    try {
      const catalog = await scanApiSchemas(projectRoot, schemaOpts)
      if (catalog.schemas.length > 0) {
        for (const s of sources) {
          if (!s.endpoint) continue
          const match = resolveEndpoint(catalog, s.endpoint, s.method)
          if (match?.response_schema_ref) {
            s.response_schema_ref = match.response_schema_ref
            s.schema_in_repo = match.schema_in_repo
          } else if (match) {
            const ref = derivedSchemaRef(match.operation)
            if (ref) {
              s.response_schema_ref = ref
              s.schema_in_repo = match.schema_in_repo
            }
          }
        }
      }
    } catch {
      // Schema lookup is best-effort; never fail the whole resolve.
    }
  }

  // Sort so the primary source is at index 0: nearest to `line`, ties broken
  // by kind precedence. Stable on remaining ordering.
  sources.sort((a, b) => {
    const da = Math.abs((a.line ?? 0) - line)
    const db = Math.abs((b.line ?? 0) - line)
    if (da !== db) return da - db
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  })

  const rendered_identifiers = extractRenderedIdentifiers(content)
  const route_bindings = extractRouteBindings(content)

  const result: ScopedDataContext = { sources, scope: 'file' }
  if (rendered_identifiers) result.rendered_identifiers = rendered_identifiers
  if (route_bindings) result.route_bindings = route_bindings
  return result
}

/**
 * Element-level data context: only returns sources whose binding graph has
 * a BindingSite at (file, line) within a small tolerance. Answers "does this
 * specific element consume data?" rather than "does this file declare data
 * somewhere?". Returns `{ sources: [] }` when the element isn't bound to
 * anything the analyzer can trace — callers should omit data_context entirely
 * in that case.
 */
export async function resolveElementDataContext(
  projectRoot: string,
  relFile: string,
  line: number,
  schemaOpts: ScanOptions = {},
  workspaceRoot?: string,
): Promise<ScopedDataContext> {
  if (!relFile || !line) return { sources: [], scope: 'element' }
  const full = await resolveDataContext(projectRoot, relFile, line, schemaOpts, workspaceRoot)
  if (full.sources.length === 0) return { sources: [], scope: 'element' }

  const LINE_TOLERANCE = 3
  const bound: ResolvedDataSource[] = []
  for (const source of full.sources) {
    try {
      const graph = await resolveBindingGraph(projectRoot, source.name)
      const hit = graph.sites.find(s => s.file === relFile && Math.abs(s.line - line) <= LINE_TOLERANCE)
      if (hit) bound.push(source)
    } catch { /* binding graph is best-effort */ }
  }
  if (bound.length === 0) return { sources: [], scope: 'element' }

  // `full.sources` is already sorted primary-first; `bound` preserves that order.
  const narrowed: ScopedDataContext = { sources: bound, scope: 'element' }
  if (full.rendered_identifiers) narrowed.rendered_identifiers = full.rendered_identifiers
  if (full.route_bindings) narrowed.route_bindings = full.route_bindings
  return narrowed
}

// ── Internals ───────────────────────────────────────────

interface DataHit { kind: DataSource['kind']; name: string }

function findFirstDataReference(content: string, identifierKind: Map<string, DataSource['kind']>): DataHit | null {
  // Named identifiers — scan once using a single alternation regex for speed.
  const ids = [...identifierKind.keys()]
  if (ids.length > 0) {
    const re = new RegExp(`\\b(${ids.map(escapeRegex).join('|')})\\s*\\(`)
    const m = re.exec(content)
    if (m) return { kind: identifierKind.get(m[1])!, name: m[1] }
  }
  const dot = DOTTED_CALL_RE.exec(content)
  DOTTED_CALL_RE.lastIndex = 0
  if (dot) return { kind: 'fetch', name: `${dot[1]}.${dot[2]}` }
  const fetchMatch = BARE_FETCH_RE.exec(content)
  BARE_FETCH_RE.lastIndex = 0
  if (fetchMatch) return { kind: 'fetch', name: 'fetch' }
  const trpc = TRPC_CHAIN_RE.exec(content)
  TRPC_CHAIN_RE.lastIndex = 0
  if (trpc) return { kind: 'rpc', name: 'trpc' + trpc[1] }
  return null
}

function findAllDataReferences(
  content: string,
  imports: Map<string, string>,
  identifierKind: Map<string, DataSource['kind']>,
): ResolvedDataSource[] {
  const sources: ResolvedDataSource[] = []
  const seen = new Set<string>()   // name+line dedup

  const ids = [...identifierKind.keys()]
  if (ids.length > 0) {
    const re = new RegExp(`\\b(${ids.map(escapeRegex).join('|')})\\s*\\(([^)]*)`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      const name = m[1]
      const line = lineOf(content, m.index)
      const key = `${name}:${line}`
      if (seen.has(key)) continue
      seen.add(key)
      const kind = identifierKind.get(name)!
      // Grab a larger slice for object-form argument scanning (queryKey).
      const argSlice = content.slice(m.index + m[0].length, m.index + m[0].length + 500)
      const firstArg = m[2]
      const ep = extractEndpointArg(firstArg, argSlice)
      const src: ResolvedDataSource = { kind, name, line, provenance: 'dependency-confirmed' }
      if (imports.has(name)) src.module = imports.get(name)
      if (ep) {
        src.endpoint = ep.value
        if (ep.dynamic) src.dynamic_endpoint = true
      }
      sources.push(src)
    }
  }

  // Project's own hooks/composables — identifiers not covered by any
  // dependency-confirmed library pattern, but resolvable to a local
  // (relative/aliased) import. Without this pass, custom project hooks were
  // silently omitted in favor of the (now dep-gated) library detections.
  PROJECT_HOOK_RE.lastIndex = 0
  let ph: RegExpExecArray | null
  while ((ph = PROJECT_HOOK_RE.exec(content)) !== null) {
    const name = ph[1]
    if (identifierKind.has(name)) continue  // already handled above as a confirmed dependency source
    const modulePath = imports.get(name)
    if (!modulePath || !isLocalImportPath(modulePath)) continue  // can't confirm this is project-owned
    const line = lineOf(content, ph.index)
    const key = `${name}:${line}`
    if (seen.has(key)) continue
    seen.add(key)
    const argSlice = content.slice(ph.index + ph[0].length, ph.index + ph[0].length + 500)
    const ep = extractEndpointArg('', argSlice)
    const src: ResolvedDataSource = {
      kind: /^create/.test(name) ? 'signal' : 'composable',
      name,
      module: modulePath,
      line,
      provenance: 'project-own',
    }
    if (ep) {
      src.endpoint = ep.value
      if (ep.dynamic) src.dynamic_endpoint = true
    }
    sources.push(src)
  }

  DOTTED_CALL_RE.lastIndex = 0
  let d: RegExpExecArray | null
  while ((d = DOTTED_CALL_RE.exec(content)) !== null) {
    const line = lineOf(content, d.index)
    const name = `${d[1]}.${d[2]}`
    const src: ResolvedDataSource = { kind: 'fetch', name, method: d[2].toUpperCase(), line, provenance: 'heuristic' }
    if (imports.has(d[1])) src.module = imports.get(d[1])
    const after = content.slice(d.index + d[0].length, d.index + d[0].length + 300)
    const ep = extractEndpointArg('', after)
    if (ep) {
      src.endpoint = ep.value
      if (ep.dynamic) src.dynamic_endpoint = true
    }
    sources.push(src)
  }

  BARE_FETCH_RE.lastIndex = 0
  let f: RegExpExecArray | null
  while ((f = BARE_FETCH_RE.exec(content)) !== null) {
    const line = lineOf(content, f.index)
    const src: ResolvedDataSource = { kind: 'fetch', name: 'fetch', line, provenance: 'builtin' }
    if (f[2]) src.endpoint = f[2]
    else if (f[4] !== undefined) {
      // Template literal — pull the static prefix (up to the first ${) and flag it.
      const tmpl = f[4]
      const staticPrefix = tmpl.split('${')[0]
      if (staticPrefix) src.endpoint = staticPrefix
      if (tmpl.includes('${')) src.dynamic_endpoint = true
    }
    sources.push(src)
  }

  TRPC_CHAIN_RE.lastIndex = 0
  let t: RegExpExecArray | null
  while ((t = TRPC_CHAIN_RE.exec(content)) !== null) {
    const line = lineOf(content, t.index)
    const procedurePath = `trpc${t[1]}`
    const method = t[2]
    const src: ResolvedDataSource = { kind: 'rpc', name: procedurePath, line, endpoint: t[1].replace(/^\./, '').replace(/\./g, '/'), method: method.startsWith('use') ? undefined : method.toUpperCase(), provenance: 'heuristic' }
    sources.push(src)
  }

  return sources
}

function parseImports(content: string): Map<string, string> {
  const map = new Map<string, string>()
  IMPORT_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = IMPORT_RE.exec(content)) !== null) {
    const defaultImport = m[1]
    const namedAfterDefault = m[2]
    const namedOnly = m[3]
    const modulePath = m[4]
    if (defaultImport) map.set(defaultImport, modulePath)
    const namedGroup = namedAfterDefault || namedOnly
    if (namedGroup) {
      for (const raw of namedGroup.split(',')) {
        const part = raw.trim()
        if (!part) continue
        // Handle `foo as bar` — map the local alias.
        const m2 = part.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/)
        if (m2) map.set(m2[2] || m2[1], modulePath)
      }
    }
  }
  return map
}

/**
 * Identifiers read in the rendered output. Framework-neutral:
 *   - Vue mustache:        `{{ name }}`
 *   - JSX expression body: `{name}` between `>` and `<`
 *   - Svelte shorthand:    `{name}` in attribute or children position
 *   - Solid / Astro JSX:   same as JSX
 *   - Vue v-bind / colon:  `:prop="name"`
 *   - JSX attribute:       `prop={name}`
 *   - Svelte shorthand:    `{name}` as attribute (already covered above)
 * Capped at 20 identifiers.
 */
function extractRenderedIdentifiers(content: string): string {
  const found = new Set<string>()
  // Vue mustache
  for (const m of content.matchAll(/\{\{\s*([A-Za-z_$][\w$.]*)\s*\}\}/g)) {
    found.add(m[1].split('.')[0])
  }
  // `>{name}<` / `>{name.x}<` (JSX / Svelte / Solid / Astro children)
  for (const m of content.matchAll(/>\s*\{\s*([A-Za-z_$][\w$.]*)\s*\}\s*</g)) {
    found.add(m[1].split('.')[0])
  }
  // Vue `:prop="name"` / `@click="name"`
  for (const m of content.matchAll(/\s[:@][\w-]+\s*=\s*"([A-Za-z_$][\w$.]*)"/g)) {
    found.add(m[1].split('.')[0])
  }
  // JSX / Solid attribute expression: `prop={name}` or `prop={name.x}` — NOT `prop={{...}}` objects.
  for (const m of content.matchAll(/\s[A-Za-z_$][\w$-]*\s*=\s*\{\s*([A-Za-z_$][\w$.]*)\s*\}/g)) {
    found.add(m[1].split('.')[0])
  }
  return [...found].slice(0, 20).join(',')
}

/**
 * Route params/query bindings. Framework-neutral, covers:
 *   - vue-router:          `route.params.x`, `$route.params.x`
 *   - react-router v6:     `const { x } = useParams()`
 *   - Nuxt / Vue composition: `route.params.x` from `useRoute()`
 *   - Remix / React Router loaders: `const { x } = useLoaderData()` destructure
 *   - SvelteKit:           `$page.params.x`, `page.params.x` (page from $app/stores)
 *   - Astro:               `Astro.params.x`, `Astro.props.x`
 *   - Solid Router:        `useParams()` destructure or `params.x`
 */
function extractRouteBindings(content: string): { params?: string; query?: string } | undefined {
  const params = new Set<string>()
  const query = new Set<string>()

  // Vue / Nuxt composition: useRoute() → route.params.x / route.query.x
  for (const m of content.matchAll(/\broute\.params\.([A-Za-z_$][\w$]*)/g)) params.add(m[1])
  for (const m of content.matchAll(/\$route\.params\.([A-Za-z_$][\w$]*)/g)) params.add(m[1])
  for (const m of content.matchAll(/\broute\.query\.([A-Za-z_$][\w$]*)/g)) query.add(m[1])
  for (const m of content.matchAll(/\$route\.query\.([A-Za-z_$][\w$]*)/g)) query.add(m[1])

  // SvelteKit: `$page.params.x` / `page.params.x`
  for (const m of content.matchAll(/\$page\.params\.([A-Za-z_$][\w$]*)/g)) params.add(m[1])
  for (const m of content.matchAll(/\bpage\.params\.([A-Za-z_$][\w$]*)/g)) params.add(m[1])
  for (const m of content.matchAll(/\$page\.url\.searchParams(?:\.get\(['"]([^'"]+)['"]\)|\.([A-Za-z_$][\w$]*))/g)) query.add(m[1] ?? m[2])

  // Astro
  for (const m of content.matchAll(/\bAstro\.params\.([A-Za-z_$][\w$]*)/g)) params.add(m[1])

  // React Router / Remix / Solid Router useParams() destructure:
  //    const { id } = useParams()  / useLoaderData() / useRouteLoaderData()
  for (const m of content.matchAll(/(?:const|let|var)\s*\{\s*([^}]+)\}\s*=\s*(?:useParams|useLoaderData|useRouteLoaderData|useActionData)\s*(?:<[^>]*>)?\s*\(/g)) {
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/[:\s=]/)[0]
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) params.add(name)
    }
  }
  // useSearchParams() destructure (React Router) — first tuple entry gives the SearchParams object
  for (const m of content.matchAll(/(?:const|let|var)\s*\[\s*([A-Za-z_$][\w$]*)[^\]]*\]\s*=\s*useSearchParams\s*\(/g)) {
    // Track the local name; agents can reason from there.
    query.add(m[1])
  }
  // Solid Router params.x access
  for (const m of content.matchAll(/\bparams\.([A-Za-z_$][\w$]*)/g)) params.add(m[1])

  const result: { params?: string; query?: string } = {}
  if (params.size > 0) result.params = [...params].join(',')
  if (query.size > 0) result.query = [...query].join(',')
  return Object.keys(result).length > 0 ? result : undefined
}

function lineOf(content: string, index: number): number {
  let count = 1
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) count++
  return count
}

interface EndpointExtract { value: string; dynamic: boolean }

/**
 * Endpoint extraction for a call site. Looks at:
 *   - the first positional arg as captured by the caller (`firstArg` — may be
 *     empty string when the caller only has part of the parens)
 *   - a larger follow-up slice (`after`) when the caller handed us the full
 *     argument area — for object-form queries, template literals, etc.
 *
 * Returns { value, dynamic } where `dynamic` is set when the original
 * expression was a template literal with interpolation (so the returned value
 * is only a static prefix, not the full URL).
 */
function extractEndpointArg(firstArg: string, after: string): EndpointExtract | undefined {
  // Object form: `{ queryKey: ['user', id], queryFn: ... }`
  const objKey = after.match(/queryKey\s*:\s*(?:\[\s*(['"`])([^'"`]+)\1|(['"`])([^'"`]+)\3)/)
  if (objKey) {
    const value = objKey[2] ?? objKey[4]
    if (value) return { value, dynamic: false }
  }
  // Combined source text we'll scan from (caller may hand us one or the other)
  const combined = firstArg + after

  // Template literal with interpolation — `\`/api/${id}\``
  const tmpl = combined.match(/^\s*`([^`]*)`/)
  if (tmpl) {
    const body = tmpl[1]
    const prefix = body.split('${')[0]
    if (prefix || body.includes('${')) return { value: prefix, dynamic: body.includes('${') }
  }

  // Positional leading path string
  const pathMatch = combined.match(/^\s*(['"])(\/[\w\-/.:{}?=&]*|https?:\/\/[^'"]+)\1/)
  if (pathMatch) return { value: pathMatch[2], dynamic: false }

  // Array key: useQuery(['users', id])
  const arr = combined.match(/^\s*\[\s*(['"`])([^'"`]+)\1/)
  if (arr) return { value: arr[2], dynamic: false }

  // Any quoted string in the slice (weakest match — use sparingly)
  const keyMatch = combined.match(/(['"])([A-Za-z][\w\-/:]*)\1/)
  if (keyMatch) return { value: keyMatch[2], dynamic: false }

  return undefined
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
