import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { Worker } from 'node:worker_threads'

export interface ScannedProp {
  name: string
  type: string | null
  required: boolean
  description: string | null
  default: string | null
}

export interface ScannedSlot {
  name: string                // 'default' for the default slot
  description: string | null
  scoped: boolean             // true if the slot exposes props
}

export interface ScannedEvent {
  name: string
  payloadType: string | null
  description: string | null
}

export interface ScannedComponent {
  name: string
  module: string              // e.g. "primevue/button"
  description: string | null  // component-level JSDoc
  category: string | null     // heuristic: 'form' | 'overlay' | 'layout' | ...
  tags: string[]              // heuristic: ['button', 'input']
  deprecated: boolean
  props: ScannedProp[]
  slots: ScannedSlot[]
  events: ScannedEvent[]
  sourceFile: string | null   // absolute path — only populated for local components
  /** Provider-dependence markers found in source (useContext/inject/useRouter/
   *  useQuery/provide + router/query/store imports). Empty when none or when
   *  source is unavailable (.d.ts-only libs). Lets the palette pre-mark a
   *  component before attempting a throwing mount. */
  providerSignals: string[]
  /** Coarse render-fidelity hint for the palette: 'live' (should mount in
   *  context), 'isolated-preview' (detached, provider-dependent), or 'unknown'
   *  (source unavailable — the live mount itself confirms). */
  fidelityHint: 'live' | 'isolated-preview' | 'placeholder' | 'unknown'
  /** Which strategy actually produced this component's data — lets consumers tell a
   *  verified-propless component apart from one where extraction simply failed.
   *  'cem' = Custom Elements Manifest JSON; 'dts' = exact `<Name>Props` interface match;
   *  'dts-guessed' = first-`*Props`-interface-wins fallback (barrel had no exact name);
   *  'source' = parsed from the component's own source (.vue/.tsx/.svelte/.astro/...);
   *  'name-only' = we only ever confirmed the export name, never its shape. */
  extraction?: 'cem' | 'dts' | 'dts-guessed' | 'source' | 'name-only'
}

export interface ScannedLibrary {
  name: string
  version: string
  components: ScannedComponent[]
}

export interface ComponentCatalog {
  libraries: ScannedLibrary[]
  scannedAt: number
}

export interface ComponentManifestEntry {
  name: string
  module: string
}

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 min — how long a warm in-memory catalog is trusted before we recompute the deps hash to check for churn.
const DISK_CACHE_FILE = 'component-catalog.json'
let cachedCatalog: ComponentCatalog | null = null
let cachedCatalogAt = 0
let cachedCatalogKey: string | null = null
let cachedManifest: ComponentManifestEntry[] | null = null
let cachedManifestAt = 0
// First-call coalescer: used when there is no cached catalog yet and multiple
// consumers race to be the first reader. Only one worker scan runs.
let inflightCatalog: Promise<ComponentCatalog> | null = null
// Background refresh coalescer: used when we already have a cached catalog
// (serving stale-while-revalidate) and need to refresh without blocking
// callers. At most one background refresh is in flight at any time.
let refreshing: Promise<ComponentCatalog> | null = null

type CatalogListener = (catalog: ComponentCatalog) => void
const refreshListeners = new Set<CatalogListener>()

/**
 * Subscribe to "a background refresh produced a new catalog". The main use
 * case is bridging the scanner to the WebSocket broadcast so an open shell
 * picks up fresh data when deps change, without the user reopening the tab.
 * Returns an unsubscribe function.
 */
export function onCatalogRefreshed(fn: CatalogListener): () => void {
  refreshListeners.add(fn)
  return () => { refreshListeners.delete(fn) }
}

declare const __ANNOTASK_VERSION__: string | undefined
const SCHEMA_VERSION = typeof __ANNOTASK_VERSION__ === 'string' ? `1:${__ANNOTASK_VERSION__}` : '1:dev'

interface DiskCacheEnvelope {
  version: string
  key: string
  scannedAt: number
  catalog: ComponentCatalog
}

function diskCachePath(projectRoot: string): string {
  return path.join(projectRoot, '.annotask', 'cache', DISK_CACHE_FILE)
}

/**
 * Fingerprint of the running package's package.json plus its mtime. If any dep
 * is added, removed, or bumped, the key changes and the disk cache is ignored.
 * Cheap (one stat + one read) relative to the 20s+ scan it replaces.
 */
async function computeCacheKey(projectRoot: string): Promise<string | null> {
  try {
    // Scoped to the running package — the scan now reads only this package's
    // deps, so the cache key must track exactly the same set.
    const p = path.join(projectRoot, 'package.json')
    const stat = await fsp.stat(p)
    const content = await fsp.readFile(p, 'utf-8')
    const pkg = JSON.parse(content)
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    const part = `${projectRoot}|${stat.mtimeMs}|${JSON.stringify(deps)}`
    return crypto.createHash('sha1').update(part).digest('hex')
  } catch { return null }
}

async function loadDiskEnvelope(projectRoot: string): Promise<DiskCacheEnvelope | null> {
  try {
    const raw = await fsp.readFile(diskCachePath(projectRoot), 'utf-8')
    const env = JSON.parse(raw) as DiskCacheEnvelope
    if (env.version !== SCHEMA_VERSION || !env.catalog) return null
    return env
  } catch { return null }
}

async function saveDiskCache(projectRoot: string, key: string, catalog: ComponentCatalog): Promise<void> {
  try {
    const file = diskCachePath(projectRoot)
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const env: DiskCacheEnvelope = { version: SCHEMA_VERSION, key, scannedAt: Date.now(), catalog }
    await fsp.writeFile(file, JSON.stringify(env), 'utf-8')
  } catch { /* cache persistence is best-effort */ }
}

/**
 * Generate a flat manifest of all importable components — both library and local.
 * Used by the Vite plugin to generate a bootstrap module that pre-loads everything.
 */
export async function generateComponentManifest(projectRoot: string): Promise<ComponentManifestEntry[]> {
  if (cachedManifest && (Date.now() - cachedManifestAt) < CACHE_TTL_MS) return cachedManifest

  const entries: ComponentManifestEntry[] = []
  const seen = new Set<string>()

  // 1. Library components from node_modules
  const catalog = await scanComponentLibraries(projectRoot)
  for (const lib of catalog.libraries) {
    for (const comp of lib.components) {
      if (!seen.has(comp.name)) {
        entries.push({ name: comp.name, module: comp.module })
        seen.add(comp.name)
      }
    }
  }

  // 2. Local project components from src/
  const srcDir = path.join(projectRoot, 'src')
  try {
    const localFiles = await findLocalComponentFilesRecursive(srcDir)
    for (const filePath of localFiles) {
      const name = extractComponentName(filePath)
      // Only PascalCase names (skip files like main.ts, router.ts, etc.)
      if (name[0] !== name[0].toUpperCase() || name[0] === name[0].toLowerCase()) continue
      if (seen.has(name)) continue
      // Use relative path from project root for Vite resolution
      const relPath = './' + path.relative(projectRoot, filePath).replace(/\\/g, '/')
      entries.push({ name, module: relPath })
      seen.add(name)
    }
  } catch { /* src/ might not exist */ }

  cachedManifest = entries
  cachedManifestAt = Date.now()
  return entries
}

export function clearComponentCache() {
  cachedCatalog = null
  cachedCatalogAt = 0
  cachedCatalogKey = null
  cachedManifest = null
  cachedManifestAt = 0
  inflightCatalog = null
  refreshing = null
  cachedProjectLibrary = null
  cachedProjectLibraryAt = 0
  dtsContentCache.clear()
}

// ── Project components (the user's own src/ components, as a palette group) ──

let cachedProjectLibrary: ScannedLibrary | null = null
let cachedProjectLibraryAt = 0
const PROJECT_CACHE_TTL_MS = 60 * 1000

/**
 * Scan the project's own `src/` components into a `ScannedLibrary` shaped like
 * a node_modules library — the palette renders it as a pinned "Project" group
 * with zero new shell types, and the properties panel reads local components'
 * prop metadata from it. `module` is the `./src/…` project-relative specifier
 * that `ensureComponentLoaded` already resolves through
 * `/__annotask/preview-module` (raw /@fs/ import, reload-free).
 */
export async function scanProjectComponents(projectRoot: string): Promise<ScannedLibrary> {
  if (cachedProjectLibrary && (Date.now() - cachedProjectLibraryAt) < PROJECT_CACHE_TTL_MS) {
    return cachedProjectLibrary
  }
  const components: ScannedComponent[] = []
  const seen = new Set<string>()
  const srcDir = path.join(projectRoot, 'src')
  const bundler = detectBundler(projectRoot)
  try {
    const files = await findLocalComponentFilesRecursive(srcDir)
    for (const filePath of files) {
      const name = extractComponentName(filePath)
      // PascalCase only — same rule as generateComponentManifest.
      if (!name || name[0] !== name[0].toUpperCase() || name[0] === name[0].toLowerCase()) continue
      if (seen.has(name)) continue
      seen.add(name)
      const details = await extractComponentDetails(filePath)
      const relPath = './' + path.relative(projectRoot, filePath).replace(/\\/g, '/')
      components.push(makeComponent({
        name,
        module: relPath,
        props: details.props,
        slots: details.slots,
        events: details.events,
        description: details.description,
        sourceFile: filePath,
        providerSignals: details.providerSignals,
        extraction: detailsExtractionTag(details),
        bundler,
      }))
    }
  } catch { /* src/ may not exist */ }
  components.sort((a, b) => a.name.localeCompare(b.name))
  cachedProjectLibrary = { name: 'Project', version: '', components }
  cachedProjectLibraryAt = Date.now()
  return cachedProjectLibrary
}

/** Build a ScannedComponent with sensible empty defaults for optional enrichment fields. */
// Barrel scanning of some libraries (notably PrimeVue, whose `*Style` modules
// are ~half its exports) picks up internal style/service/directive objects that
// aren't renderable components. Drop them so the catalog shows real components.
const NON_COMPONENT_NAME_RE = /(Style|Service|Directive)$/
function isLikelyComponentName(name: string): boolean {
  return !NON_COMPONENT_NAME_RE.test(name)
}

function makeComponent(fields: {
  name: string
  module: string
  props?: ScannedProp[]
  slots?: ScannedSlot[]
  events?: ScannedEvent[]
  description?: string | null
  category?: string | null
  tags?: string[]
  deprecated?: boolean
  sourceFile?: string | null
  providerSignals?: string[]
  /** Required (not optional) here even though it's optional on the wire type — every
   *  call site in this file knows exactly which strategy produced its data, so we force
   *  that choice at construction time rather than let it default to undefined. */
  extraction: ScannedComponent['extraction']
  bundler?: 'vite' | 'webpack' | 'unknown'
}): ScannedComponent {
  const providerSignals = fields.providerSignals ?? []
  return {
    name: fields.name,
    module: fields.module,
    description: fields.description ?? null,
    category: fields.category ?? categorizeComponent(fields.name, fields.module),
    tags: fields.tags ?? [],
    deprecated: fields.deprecated ?? false,
    props: fields.props ?? [],
    slots: fields.slots ?? [],
    events: fields.events ?? [],
    sourceFile: fields.sourceFile ?? null,
    providerSignals,
    extraction: fields.extraction,
    fidelityHint: deriveFidelityHint(fields.sourceFile ?? null, providerSignals, fields.extraction, fields.bundler ?? 'unknown'),
  }
}

/** Detect the project's active bundler from its own manifest/config. Self-contained
 *  (reads projectRoot directly) rather than threaded in from HTTP/MCP/CLI callers,
 *  since scanComponentLibraries()/scanProjectComponents() are a stable external
 *  contract this fix must not change the signature of. Used only to make
 *  `fidelityHint` honest (see below) — /__annotask/preview-module is Vite-only and
 *  hard-404s under webpack by design. */
function detectBundler(projectRoot: string): 'vite' | 'webpack' | 'unknown' {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if ('webpack' in deps || 'webpack-dev-server' in deps || 'webpack-cli' in deps) return 'webpack'
    if ('vite' in deps) return 'vite'
  } catch { /* fall through to config-file detection */ }
  for (const ext of ['.js', '.ts', '.cjs', '.mjs']) {
    if (fs.existsSync(path.join(projectRoot, `webpack.config${ext}`))) return 'webpack'
  }
  for (const ext of ['.ts', '.js', '.mjs']) {
    if (fs.existsSync(path.join(projectRoot, `vite.config${ext}`))) return 'vite'
  }
  return 'unknown'
}

/** Coarse fidelity hint for the palette. We only assert when we actually read
 *  the component's source (local components). Library components (.d.ts-only,
 *  no recorded sourceFile) stay 'unknown' — the live mount confirms. Vue mounts
 *  share the host app's provides/router/components by reference, so a
 *  provider-dependent Vue component usually still renders in context ('live');
 *  React/Svelte/Solid mount detached with no provider tree, so provider deps
 *  degrade ('isolated-preview').
 *
 *  Two further honesty guards: a 'name-only' extraction means we never actually
 *  parsed source/types at all, so 'live' would assert confidence we don't have; and
 *  under webpack, no component can be live-previewed regardless of extraction
 *  quality (there's no dedicated fidelity value for "can't preview, but source is
 *  known" without widening this union — which other consumers switch on outside
 *  this file — so 'unknown' is the closest honest fit). */
function deriveFidelityHint(
  sourceFile: string | null,
  providerSignals: string[],
  extraction: ScannedComponent['extraction'],
  bundler: 'vite' | 'webpack' | 'unknown',
): ScannedComponent['fidelityHint'] {
  if (!sourceFile) return 'unknown'
  if (extraction === 'name-only') return 'unknown'
  if (bundler === 'webpack') return 'unknown'
  if (providerSignals.length === 0) return 'live'
  return path.extname(sourceFile) === '.vue' ? 'live' : 'isolated-preview'
}

const PROVIDER_SIGNAL_RULES: Array<[RegExp, string]> = [
  // Call sites (provider/context/router/data consumers).
  [/\binject\s*\(/, 'inject'],
  [/\bprovide\s*\(/, 'provide'],
  [/\buseContext\s*\(/, 'useContext'],
  [/\buseRouter\s*\(/, 'useRouter'],
  [/\buseRoute\s*\(/, 'useRoute'],
  [/\buseParams\s*\(/, 'useParams'],
  [/\buseSearchParams\s*\(/, 'useSearchParams'],
  [/\buseStore\s*\(/, 'useStore'],
  [/\buse(Query|Mutation|InfiniteQuery)\s*\(/, 'useQuery'],
  // Provider-bearing imports (router/query/store libs).
  [/from\s+['"]vue-router['"]/, 'vue-router'],
  [/from\s+['"]react-router(?:-dom)?['"]/, 'react-router'],
  [/from\s+['"]@tanstack\/[a-z-]*query[a-z-]*['"]/, '@tanstack/query'],
  [/from\s+['"]pinia['"]/, 'pinia'],
  [/from\s+['"](?:vuex|react-redux|@reduxjs\/toolkit)['"]/, 'store'],
]

/** Scan component source for provider-dependence markers. Heuristic by design:
 *  false positives degrade gracefully (the now-honest 'threw'/'isolated-preview'
 *  path), false negatives are caught by the mount itself. */
function detectProviderSignals(content: string): string[] {
  const found = new Set<string>()
  for (const [re, label] of PROVIDER_SIGNAL_RULES) {
    if (re.test(content)) found.add(label)
  }
  return Array.from(found)
}

/** Heuristic category from component name/module path. Returns null when nothing matches. */
function categorizeComponent(name: string, module: string): string | null {
  const haystack = (name + ' ' + module).toLowerCase()
  const rules: Array<[RegExp, string]> = [
    [/button|btn/, 'button'],
    [/input|textfield|textarea|select|radio|checkbox|switch|slider|form|picker/, 'form'],
    [/dialog|modal|drawer|popover|tooltip|menu|dropdown|overlay|sheet/, 'overlay'],
    [/table|datatable|datagrid|list|tree/, 'data'],
    [/card|panel|tabs?|accordion|collapse|splitter/, 'container'],
    [/nav|breadcrumb|sidebar|menubar|pagination|stepper/, 'navigation'],
    [/alert|toast|banner|notification|message|badge|tag|chip/, 'feedback'],
    [/avatar|icon|image|img|skeleton|spinner|progress|loader/, 'display'],
    [/grid|flex|stack|row|col|column|container|layout|section/, 'layout'],
    [/chart|graph|plot|sparkline/, 'chart'],
  ]
  for (const [re, category] of rules) if (re.test(haystack)) return category
  return null
}

// SFC-style extensions always imply a component when the filename is PascalCase.
const LOCAL_SFC_EXTS = new Set(['.vue', '.tsx', '.jsx', '.svelte', '.astro'])
// Script extensions need a content signal (defineComponent, component registration,
// or a render-style export) before we count them — otherwise every PascalCase
// utility class would get catalogued as a component.
const LOCAL_SCRIPT_EXTS = new Set(['.ts', '.js', '.mjs', '.cjs'])
// customElements.define(...) covers plain native web components — previously invisible
// to project scans (measured: a planted ProbeBadge.js was never catalogued).
const COMPONENT_SIGNAL_RE = /\bdefineComponent\s*\(|\.component\s*\(\s*['"`]|\bcreateComponent\s*\(|\bcustomElements\.define\s*\(|export\s+default\s+\{[^}]*\b(?:template|render|setup|components)\b/

async function findLocalComponentFilesRecursive(dir: string): Promise<string[]> {
  const results: string[] = []
  let entries: fs.Dirent[]
  try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return results }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.annotask') continue
      results.push(...await findLocalComponentFilesRecursive(fullPath))
      continue
    }
    const ext = path.extname(entry.name)
    if (LOCAL_SFC_EXTS.has(ext)) { results.push(fullPath); continue }
    if (!LOCAL_SCRIPT_EXTS.has(ext)) continue
    // Script file — require a PascalCase basename before we even read it, so
    // `router.ts`, `utils.js`, etc. are cheap to skip.
    const base = entry.name.slice(0, entry.name.length - ext.length)
    if (!base || base[0] !== base[0].toUpperCase() || base[0] === base[0].toLowerCase()) continue
    try {
      const contents = await fsp.readFile(fullPath, 'utf-8')
      if (COMPONENT_SIGNAL_RE.test(contents)) results.push(fullPath)
    } catch { /* unreadable file — skip */ }
  }
  return results
}

function extractComponentName(filePath: string): string {
  const fileName = path.basename(filePath)
  return fileName.replace(/\.(vue|svelte|astro|html|[jt]sx?|mjs|cjs)$/, '')
}

export async function scanComponentLibraries(projectRoot: string): Promise<ComponentCatalog> {
  // Fast path: warm in-memory catalog. Even when the TTL expired we still
  // return the memory copy immediately; the staleness check happens in the
  // background so the caller never waits.
  if (cachedCatalog) {
    if (Date.now() - cachedCatalogAt >= CACHE_TTL_MS) {
      void revalidate(projectRoot)
    }
    return cachedCatalog
  }
  // No memory cache — coalesce so the first few callers after a restart
  // share a single disk/worker round-trip.
  if (inflightCatalog) return inflightCatalog
  inflightCatalog = firstLoad(projectRoot).finally(() => { inflightCatalog = null })
  return inflightCatalog
}

/**
 * Hydrate the in-memory cache on the first call of the process. Prefers the
 * on-disk envelope — returned immediately even when the deps hash no longer
 * matches, because the Components tab should paint instantly. A background
 * refresh closes the gap when the cache is stale.
 */
async function firstLoad(projectRoot: string): Promise<ComponentCatalog> {
  const key = await computeCacheKey(projectRoot)
  const disk = await loadDiskEnvelope(projectRoot)
  if (disk) {
    cachedCatalog = disk.catalog
    cachedCatalogAt = Date.now()
    cachedCatalogKey = disk.key
    if (!key || disk.key !== key) void revalidate(projectRoot)
    return disk.catalog
  }
  // No disk cache at all — first-ever scan on this project. The caller does
  // wait here, but exactly once per project lifetime.
  return await runRefresh(projectRoot, key)
}

/**
 * Kick off a fresh scan in the background, update every cache, and notify
 * subscribers (WS broadcast) when the new catalog lands. Deduplicated via
 * {@link refreshing} so repeated calls during the same refresh window share
 * one worker.
 */
export function revalidate(projectRoot: string): Promise<ComponentCatalog> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      const key = await computeCacheKey(projectRoot)
      return await runRefresh(projectRoot, key)
    } finally { refreshing = null }
  })()
  refreshing.catch(err => {
    console.warn('[Annotask] Background component refresh failed:', err)
  })
  return refreshing
}

async function runRefresh(projectRoot: string, key: string | null): Promise<ComponentCatalog> {
  const result = await runScanOffThread(projectRoot)
  cachedCatalog = result
  cachedCatalogAt = Date.now()
  if (key) {
    cachedCatalogKey = key
    void saveDiskCache(projectRoot, key, result)
  }
  for (const fn of refreshListeners) {
    try { fn(result) } catch { /* isolate listener errors — one bad subscriber must not kill the refresh */ }
  }
  return result
}

/**
 * Run the scan in a worker thread so its synchronous I/O bursts and CPU-heavy
 * regex/AST work can't block request handling on the main thread. Falls back
 * to running in-process when the worker file isn't present (e.g. vitest
 * running source without a build) or when the worker fails to spawn.
 */
function runScanOffThread(projectRoot: string): Promise<ComponentCatalog> {
  let workerUrl: URL
  try {
    workerUrl = new URL('./component-scanner-worker.js', import.meta.url)
  } catch {
    return scanComponentLibrariesUncached(projectRoot)
  }
  if (!fs.existsSync(workerUrl)) return scanComponentLibrariesUncached(projectRoot)

  return new Promise<ComponentCatalog>((resolve, reject) => {
    let settled = false
    const worker = new Worker(workerUrl, { workerData: { projectRoot } })
    let timeoutHandle: ReturnType<typeof setTimeout>
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      worker.terminate().catch(() => {})
      fn()
    }
    // Guard against a wedged worker (e.g. a pathological package sending the scan into
    // a runaway loop) — without this, a hung worker never settles the promise and every
    // future request/refresh sharing this scan blocks forever.
    const SCAN_TIMEOUT_MS = 60_000
    timeoutHandle = setTimeout(() => {
      done(() => reject(new Error(`Component scan worker timed out after ${SCAN_TIMEOUT_MS}ms`)))
    }, SCAN_TIMEOUT_MS)
    worker.once('message', (msg: { ok: boolean; result?: ComponentCatalog; error?: string }) => {
      if (msg?.ok && msg.result) done(() => resolve(msg.result!))
      else done(() => reject(new Error(msg?.error ?? 'Component scan worker failed')))
    })
    worker.once('error', (err) => done(() => reject(err)))
    worker.once('exit', (code) => {
      // A clean exit (code 0) reaching this point means the worker exited WITHOUT ever
      // posting a message (the 'message' handler would already have settled us via
      // `done` otherwise, making this a no-op). That's still a failure case — previously
      // nothing rejected here, so the promise (and every caller awaiting it) hung forever.
      done(() => reject(new Error(code === 0
        ? 'Component scan worker exited before producing a result'
        : `Component scan worker exited with code ${code}`)))
    })
  }).catch(err => {
    // Do NOT re-run the identical scan in-process here: for the case that most needs
    // this fallback (a worker OOM/crash on a pathological package — see the lucide-style
    // barrel budget guard in scanBarrelExports), re-running synchronously on the main
    // thread just turns a contained worker crash into a killed dev-server process.
    // Degrade to a safe result instead — the last good catalog if we have one, otherwise
    // empty — and log loudly so the cause is visible instead of silently repeating (and
    // re-crashing) every boot.
    console.warn('[Annotask] Component scan worker failed — not retrying on the main thread. Serving a degraded catalog. Cause:', err)
    return cachedCatalog ?? { libraries: [], scannedAt: Date.now() }
  })
}

/**
 * Uncached scan body. Exported for the worker-thread entry and for tests —
 * production callers should use {@link scanComponentLibraries}, which caches
 * results and dispatches to a worker thread.
 */
export async function scanComponentLibrariesUncached(projectRoot: string): Promise<ComponentCatalog> {
  const libraries: ScannedLibrary[] = []

  // Scope to the RUNNING package's own dependencies. Aggregating every
  // workspace package made a standalone app inherit unrelated sibling apps'
  // UI kits — a plain Vue app showed React's Mantine, Solid's Kobalte, web-
  // component Shoelace, etc.: libraries it can never actually render. Run an
  // MFE/app directly to scan its own libraries.
  const deps: Record<string, { version: string; from: string }> = {}
  try {
    const pkg = JSON.parse(await fsp.readFile(path.join(projectRoot, 'package.json'), 'utf-8'))
    const merged = { ...pkg.dependencies, ...pkg.devDependencies }
    for (const [name, version] of Object.entries(merged)) {
      if (!deps[name]) deps[name] = { version: String(version), from: projectRoot }
    }
  } catch { /* missing or unreadable package.json */ }
  if (Object.keys(deps).length === 0) return { libraries: [], scannedAt: Date.now() }

  const bundler = detectBundler(projectRoot)

  // Scan every dependency in parallel. Each `scanLibrary` is largely async
  // file I/O — serializing them left the scanner idle between `await`s and
  // made first-paint unbearable on large workspaces (~20s+ for a handful of
  // UI kits). Running the worker thread in parallel with the main thread is
  // safe; Node's libuv thread pool handles the fs concurrency internally.
  const SKIP_DEPS = new Set(['vue', 'react', 'react-dom', 'react-router-dom', 'svelte', 'vite', 'typescript', 'annotask', 'vue-router', 'pinia'])
  const scanTasks: Array<Promise<ScannedLibrary | null>> = []
  for (const [depName, { version: depVersion, from }] of Object.entries(deps)) {
    if (depName.startsWith('@types/') || depName.startsWith('@vitejs/')) continue
    if (SKIP_DEPS.has(depName)) continue

    // Resolve from the package that declared the dep so MFE-local deps are
    // found even when the host doesn't hoist them.
    const depDir = resolvePackageDir(from, depName) ?? resolvePackageDir(projectRoot, depName)
    if (!depDir) continue

    // For file: dependencies, resolve the original source directory
    // (pnpm respects "files" field, so node_modules may only have dist/)
    let sourceDir: string | undefined
    if (depVersion.startsWith('file:')) {
      const resolved = path.resolve(from, depVersion.replace('file:', ''))
      if (fs.existsSync(resolved)) sourceDir = resolved
    }

    scanTasks.push((async () => {
      const library = await scanLibrary(depName, depDir, sourceDir, bundler)
      // Admission gate relaxed from "< 3 components" to "empty" — the old threshold
      // hid legitimate small design systems (a package that exports one or two real
      // components is still a real component library, not noise).
      if (!library || library.components.length === 0) return null
      // Require at least one component with props OR a framework peer
      // dependency — bundled libraries don't expose props but are still
      // valid if they declare vue/react/svelte as a peer.
      const hasProps = library.components.some(c => c.props.length > 0)
      if (hasProps) return library
      return isFrameworkLibrary(depDir) ? library : null
    })())
  }

  const settled = await Promise.all(scanTasks)
  for (const lib of settled) if (lib) libraries.push(lib)
  libraries.sort((a, b) => a.name.localeCompare(b.name))

  return { libraries, scannedAt: Date.now() }
}



/** Check if a package has vue/react/svelte as a peer or dependency — signals it's a UI component library */
function isFrameworkLibrary(pkgDir: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'))
    const allDeps = { ...pkg.dependencies, ...pkg.peerDependencies }
    return ['vue', 'react', 'react-dom', 'svelte', 'solid-js', '@angular/core'].some(fw => fw in allDeps)
  } catch { return false }
}

function resolvePackageDir(projectRoot: string, packageName: string): string | null {
  // Walk up from projectRoot looking for node_modules/{packageName}
  let dir = projectRoot
  while (true) {
    const candidate = path.join(dir, 'node_modules', packageName)
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

async function scanLibrary(name: string, pkgDir: string, sourceDir?: string, bundler: 'vite' | 'webpack' | 'unknown' = 'unknown'): Promise<ScannedLibrary | null> {
  // Read package version + optional custom-elements-manifest pointer
  let version = '0.0.0'
  let cemField: string | undefined
  try {
    const pkg = JSON.parse(await fsp.readFile(path.join(pkgDir, 'package.json'), 'utf-8'))
    version = pkg.version || version
    cemField = typeof pkg.customElements === 'string' ? pkg.customElements : undefined
  } catch { return null }

  // Strategy 0 — Custom Elements Manifest (CEM) for web component libraries
  // (Shoelace, Fluent UI, Lit-based libs). Standardized JSON: no regex, no AST. Very reliable.
  {
    const cemComponents = await scanFromCem(name, pkgDir, cemField, bundler)
    if (cemComponents.length > 0) {
      return { name, version, components: cemComponents.sort((a, b) => a.name.localeCompare(b.name)) }
    }
  }

  // Strategy: scan subdirectories for component modules
  const components: ScannedComponent[] = []

  let entries: string[]
  try {
    entries = await fsp.readdir(pkgDir)
  } catch { return null }

  for (const entry of entries) {
    // Skip non-component directories
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'style' || entry === 'styles') continue
    if (['config', 'utils', 'helpers', 'types', 'core', 'icons', 'themes', 'locale',
         'passthrough', 'src', 'dist', 'es', 'lib', 'cjs', 'esm',
         'examples', 'tests', 'test', 'docs', 'stories', 'storybook-static', '__tests__', '__mocks__'].includes(entry)) continue

    const subdir = path.join(pkgDir, entry)
    let stat: fs.Stats
    try { stat = await fsp.stat(subdir) } catch { continue }
    if (!stat.isDirectory()) continue

    // Check if this subdir has component indicators
    const hasVue = await fileExists(subdir, `${pascalCase(entry)}.vue`) || await hasVueFile(subdir)
    const hasDts = await fileExists(subdir, 'index.d.ts')
    const hasIndex = await fileExists(subdir, 'index.mjs') || await fileExists(subdir, 'index.js')

    // Must have an importable module (not type-only)
    if (!hasIndex && !hasVue) continue

    // Skip directories that are clearly not components (services, directives, composables, etc.)
    if (entry.endsWith('service') || entry.endsWith('directive') || entry.endsWith('options') ||
        entry.endsWith('eventbus') || entry.endsWith('icon') ||
        entry.startsWith('use')) continue

    // Read the index file for further checks
    let indexContent: string | null = null
    if (hasIndex) {
      try {
        const indexName = fs.existsSync(path.join(subdir, 'index.mjs')) ? 'index.mjs' : 'index.js'
        indexContent = await fsp.readFile(path.join(subdir, indexName), 'utf-8')
      } catch { /* proceed */ }
    }

    // Skip Vue directives (they extend BaseDirective, not components)
    if (indexContent && indexContent.includes('BaseDirective') && !indexContent.includes('defineComponent') && !indexContent.includes('.vue')) continue

    // Skip components with unresolvable optional peer deps (e.g. chart.js, quill)
    if (indexContent) {
      const dynamicImports = [...indexContent.matchAll(/import\(['"]([^'"]+)['"]\)/g)].map(m => m[1])
      const externalDeps = dynamicImports.filter(d => !d.startsWith('.') && !d.startsWith('/') && !d.startsWith(name) && !d.startsWith('@primevue') && !d.startsWith('@primeuix'))
      if (externalDeps.length > 0) {
        // Check if these deps are installed
        let hasMissingDep = false
        for (const dep of externalDeps) {
          const depPkg = dep.split('/')[0].startsWith('@') ? dep.split('/').slice(0, 2).join('/') : dep.split('/')[0]
          // Check from the package's own node_modules or parent
          const pkgRoot = pkgDir.replace(/\/node_modules\/.*$/, '')
          if (!resolvePackageDir(pkgRoot, depPkg)) { hasMissingDep = true; break }
        }
        if (hasMissingDep) continue
      }
    }

    let componentName = pascalCase(entry)
    let props: ScannedProp[] = []
    let slots: ScannedSlot[] = []
    let events: ScannedEvent[] = []
    let description: string | null = null
    let providerSignals: string[] = []
    let extraction: ScannedComponent['extraction'] = 'name-only'

    // Try to extract props from .d.ts first (most reliable)
    let dtsDescription: string | null = null
    if (hasDts) {
      const dtsPath = path.join(subdir, 'index.d.ts')
      const dtsResult = await extractPropsFromDts(dtsPath, componentName)
      props = dtsResult.props
      if (dtsResult.resolvedName) { componentName = dtsResult.resolvedName; extraction = 'dts-guessed' }
      else if (props.length > 0) extraction = 'dts'
      try {
        dtsDescription = extractComponentJsDoc(await fsp.readFile(dtsPath, 'utf-8'))
      } catch { /* ignore */ }
    }

    // Always look for a .vue file (for slots/events) even when .d.ts gave us props
    if (hasVue) {
      const vueFile = await findVueFile(subdir, componentName)
      if (vueFile) {
        const vueDetails = await extractComponentDetails(vueFile)
        // Whichever source's props end up populated is what determined the final
        // answer for this component — tag extraction accordingly.
        if (props.length === 0) { props = vueDetails.props; extraction = 'source' }
        slots = vueDetails.slots
        events = vueDetails.events
        description = vueDetails.description ?? dtsDescription
        providerSignals = vueDetails.providerSignals
      }
    }
    if (!description) description = dtsDescription

    components.push(makeComponent({
      name: componentName,
      module: `${name}/${entry}`,
      props,
      slots,
      events,
      description,
      providerSignals,
      extraction,
      bundler,
    }))
  }

  // Strategies 2 + 3 always run and merge results deduped by name. This
  // covers libraries (like naive-ui) where Strategy 1 incidentally matches
  // a top-level utility directory (e.g. `generic/`) and would otherwise
  // short-circuit the deeper scans that find the real component catalog.
  const seenNames = new Set(components.map(c => c.name))

  // Strategy 2: Barrel-exported packages (e.g. @radix-ui/themes, @mantine/core)
  const barrelComponents = await scanBarrelExports(name, pkgDir, bundler)
  for (const c of barrelComponents) {
    if (!seenNames.has(c.name)) { components.push(c); seenNames.add(c.name) }
  }

  // Strategy 3: Follow package entry point — handles any library structure
  if (components.length < 3 || barrelComponents.length === 0) {
    const entryComponents = await scanFromEntryPoint(name, pkgDir, sourceDir, bundler)
    for (const c of entryComponents) {
      if (!seenNames.has(c.name)) { components.push(c); seenNames.add(c.name) }
    }
  }

  if (components.length === 0) return null

  // Drop internal *Style/*Service/*Directive exports (keep the originals only if
  // filtering would somehow remove everything, so we never hide a whole lib).
  const real = components.filter(c => isLikelyComponentName(c.name))
  const finalComponents = real.length > 0 ? real : components
  finalComponents.sort((a, b) => a.name.localeCompare(b.name))
  return { name, version, components: finalComponents }
}

/**
 * Scan a package that exports all components from a barrel (index.d.ts).
 * Parses re-export lines like: export { Button, type ButtonProps } from './button.js'
 * Then reads per-component .d.ts and .props.d.ts files for prop metadata.
 */
/**
 * Strategy 0: Custom Elements Manifest (CEM) — web component libraries.
 *
 * Reads `<pkgDir>/custom-elements.json` (or the path in package.json `customElements`) and
 * extracts each class declaration that registers a custom element. CEM is the standardized
 * schema produced by @custom-elements-manifest/analyzer; used by Shoelace, Fluent UI, Ionic,
 * and most Lit-based libraries. No regex or AST needed — just JSON.
 */
async function scanFromCem(pkgName: string, pkgDir: string, cemField?: string, bundler: 'vite' | 'webpack' | 'unknown' = 'unknown'): Promise<ScannedComponent[]> {
  const candidates = [
    cemField ? path.resolve(pkgDir, cemField) : null,
    path.join(pkgDir, 'custom-elements.json'),
    path.join(pkgDir, 'dist', 'custom-elements.json'),
  ].filter((p): p is string => !!p)

  let cemPath: string | null = null
  for (const p of candidates) {
    if (fs.existsSync(p)) { cemPath = p; break }
  }
  if (!cemPath) return []

  let manifest: unknown
  try { manifest = JSON.parse(await fsp.readFile(cemPath, 'utf-8')) } catch { return [] }
  if (!manifest || typeof manifest !== 'object') return []

  const modules = (manifest as { modules?: unknown }).modules
  if (!Array.isArray(modules)) return []

  const components: ScannedComponent[] = []
  const seen = new Set<string>()

  for (const mod of modules) {
    if (!mod || typeof mod !== 'object') continue
    const declarations = (mod as { declarations?: unknown[] }).declarations
    const modulePath = (mod as { path?: string }).path
    if (!Array.isArray(declarations)) continue

    for (const decl of declarations) {
      if (!decl || typeof decl !== 'object') continue
      const d = decl as {
        kind?: string
        name?: string
        tagName?: string
        description?: string
        summary?: string
        deprecated?: unknown
        attributes?: Array<{ name?: string; type?: { text?: string }; description?: string; default?: string; required?: boolean; fieldName?: string }>
        members?: Array<{ kind?: string; name?: string; type?: { text?: string }; description?: string; default?: string; privacy?: string; static?: boolean; readonly?: boolean; reactive?: boolean }>
        slots?: Array<{ name?: string; description?: string }>
        events?: Array<{ name?: string; type?: { text?: string }; description?: string }>
      }
      if (d.kind !== 'class') continue
      if (!d.tagName && !d.name) continue // CEM may list plain classes — skip non-elements

      // Prefer the class name; fall back to PascalCasing the tag name.
      const name = d.name || pascalCase(d.tagName || '')
      if (!name || seen.has(name)) continue
      seen.add(name)

      // Build props: merge attributes + reactive/public fields. De-dupe by name — attributes
      // and fields often mirror each other (field `variant` ↔ attribute `variant`).
      const propMap = new Map<string, ScannedProp>()
      for (const a of d.attributes ?? []) {
        if (!a.name) continue
        propMap.set(a.name, {
          name: a.name,
          type: simplifyCemType(a.type?.text ?? null),
          required: a.required === true,
          description: a.description ?? null,
          default: a.default ?? null,
        })
      }
      for (const m of d.members ?? []) {
        if (m.kind !== 'field') continue
        if (!m.name || m.privacy === 'private' || m.privacy === 'protected') continue
        if (m.static) continue
        if (propMap.has(m.name)) continue
        propMap.set(m.name, {
          name: m.name,
          type: simplifyCemType(m.type?.text ?? null),
          required: false,
          description: m.description ?? null,
          default: m.default ?? null,
        })
      }

      const slots: ScannedSlot[] = (d.slots ?? [])
        .filter(s => s && typeof s === 'object')
        .map(s => ({ name: s.name || 'default', description: s.description ?? null, scoped: false }))

      const events: ScannedEvent[] = (d.events ?? [])
        .filter(e => e && e.name)
        .map(e => ({ name: e.name!, payloadType: simplifyCemType(e.type?.text ?? null), description: e.description ?? null }))

      components.push(makeComponent({
        name,
        // For web components, the package root is the import path — loading it side-effect
        // registers the custom element. Per-component sub-paths exist but are library-specific.
        module: pkgName,
        props: [...propMap.values()],
        slots,
        events,
        description: d.description ?? d.summary ?? null,
        deprecated: !!d.deprecated,
        sourceFile: modulePath ? path.resolve(pkgDir, modulePath) : null,
        extraction: 'cem',
        bundler,
      }))
    }
  }

  return components
}

/** CEM `type.text` fields are usually already reasonable TS strings; just truncate long ones. */
function simplifyCemType(raw: string | null): string | null {
  if (!raw) return null
  let t = raw.trim()
  if (t.length > 400) t = t.slice(0, 397) + '...'
  return t || null
}

async function scanBarrelExports(name: string, pkgDir: string, bundler: 'vite' | 'webpack' | 'unknown' = 'unknown'): Promise<ScannedComponent[]> {
  // Find the component index — try common paths
  const candidatePaths = [
    path.join(pkgDir, 'dist', 'esm', 'components', 'index.d.ts'),
    path.join(pkgDir, 'dist', 'components', 'index.d.ts'),
    path.join(pkgDir, 'src', 'components', 'index.d.ts'),
    path.join(pkgDir, 'components', 'index.d.ts'),
  ]

  // Also check the `types` field from package.json as a fallback
  // (handles single-barrel packages like @va-bip/bip-ui-components)
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'))
    const typesField: string | undefined =
      pkg.exports?.['.']?.types ?? pkg.types ?? pkg.typings
    if (typeof typesField === 'string' && typesField.endsWith('.d.ts')) {
      candidatePaths.push(path.join(pkgDir, typesField))
    }
  } catch { /* no package.json */ }

  let indexPath: string | null = null
  let componentsDir: string | null = null
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      indexPath = p
      componentsDir = path.dirname(p)
      break
    }
  }
  if (!indexPath || !componentsDir) return []

  let indexContent: string
  try { indexContent = await fsp.readFile(indexPath, 'utf-8') } catch { return [] }

  const components: ScannedComponent[] = []

  // Parse export blocks: export { Name1, Name2, type NameProps, default as N3 } from './file.js'
  // First match the whole block, then split the inner list to capture ALL names.
  const exportBlockRegex = /export\s+\{([^}]+)\}\s+from\s+['"]\.\/([^'"]+)['"]/g
  const namespaceExportRegex = /export\s+\*\s+as\s+(\w+)\s+from\s+['"]\.\/([^'"]+)['"]/g

  const seen = new Set<string>()

  const recordExport = async (rawName: string, fileStem: string) => {
    // "default as Button" → Button; "type ButtonProps" → skip; "Button as Btn" → Btn
    let componentName = rawName.trim()
    if (!componentName || /^type\s/.test(componentName)) return
    componentName = componentName.replace(/^default\s+as\s+/, '')
    const asMatch = componentName.match(/^(?:\w+)\s+as\s+(\w+)$/)
    if (asMatch) componentName = asMatch[1]
    if (!/^\w+$/.test(componentName)) return

    // Skip internal helpers, icons, non-PascalCase
    if (componentName[0] !== componentName[0].toUpperCase() || componentName[0] === componentName[0].toLowerCase()) return
    if (componentName.endsWith('Props') || componentName.endsWith('Emits') || componentName.endsWith('Icon')) return
    if (componentName === 'Portal' || componentName === 'Reset') return
    if (seen.has(componentName)) return
    seen.add(componentName)

    let props: ScannedProp[] = []
    let extraction: ScannedComponent['extraction'] = 'name-only'

    // Try .props.d.ts file first (Radix pattern: badge.props.d.ts)
    const propDefsPath = path.join(componentsDir!, `${fileStem}.props.d.ts`)
    if (fs.existsSync(propDefsPath)) {
      props = await extractPropsFromPropDefs(propDefsPath)
      if (props.length > 0) extraction = 'dts'
    }

    // Fallback: try the component .d.ts for *Props interface — following one-hop
    // re-export forwarders (e.g. an `index.d.ts` that just does
    // `export * from './Button'`), the common shape in Mantine/naive-ui/bits-ui
    // where the barrel's per-component .d.ts sits one file away from the interface
    // itself, which previously made these land name-only despite real props on disk.
    if (props.length === 0) {
      const compDtsPath = path.join(componentsDir!, `${fileStem}.d.ts`)
      if (fs.existsSync(compDtsPath)) {
        const dtsResult = await extractPropsFromDtsFollowingReExports(compDtsPath, componentName)
        props = dtsResult.props
        if (props.length > 0) extraction = dtsResult.resolvedName ? 'dts-guessed' : 'dts'
      }
    }

    components.push(makeComponent({ name: componentName, module: name, props, extraction, bundler }))
  }

  let blockMatch: RegExpExecArray | null
  exportBlockRegex.lastIndex = 0
  while ((blockMatch = exportBlockRegex.exec(indexContent)) !== null) {
    const fileStem = blockMatch[2].replace(/\.m?js$/, '')
    for (const token of blockMatch[1].split(',')) {
      await recordExport(token, fileStem)
    }
  }

  let nsMatch: RegExpExecArray | null
  namespaceExportRegex.lastIndex = 0
  while ((nsMatch = namespaceExportRegex.exec(indexContent)) !== null) {
    const fileStem = nsMatch[2].replace(/\.m?js$/, '')
    await recordExport(nsMatch[1], fileStem)
  }

  // Fallback: single-barrel .d.ts with inline declarations (no per-file re-exports).
  // Parse `export { Name1, Name2, ... };` lines and match to `interface NameProps` in the same file.
  //
  // This is the exact shape that OOM-crashed the dev server on a stock `lucide-vue-next`
  // dependency: a flat multi-MB .d.ts with thousands of exports and zero per-file
  // re-exports, each one calling extractPropsFromDts → re-reading + re-scanning the WHOLE
  // file (measured: 3,895 exports × a 2.14 MB read ≈ 8.3 GB, fatal at Node's default heap).
  // Three defenses, in order: (1) exactMatchOnly so a barrel with hundreds of `*Props`
  // interfaces never falls back to "first one wins" garbage; (2) extractPropsFromDts now
  // shares one cached read of the file across every export (see readDtsCached) instead of
  // re-reading per export; (3) a size/export budget below that skips prop extraction
  // altogether (name-only) for barrels this large — no read, no parse, no AST fallback.
  if (components.length === 0) {
    const inlineExportRe = /export\s*\{([^}]+)\}\s*;/g
    const candidateNames: string[] = []
    let m: RegExpExecArray | null
    while ((m = inlineExportRe.exec(indexContent)) !== null) {
      for (const token of m[1].split(',')) {
        const trimmed = token.trim().replace(/^type\s+/, '')
        if (!trimmed) continue
        const exportName = trimmed.split(/\s+as\s+/).pop()!.trim()
        // Only PascalCase component names
        if (exportName[0] !== exportName[0].toUpperCase() || exportName[0] === exportName[0].toLowerCase()) continue
        if (exportName.endsWith('Props') || exportName.endsWith('Emits') || exportName.endsWith('Icon')) continue
        if (exportName === exportName.toUpperCase()) continue
        if (/^(use|create|get|set|is|has|with|to|from)[A-Z]/.test(exportName)) continue
        if (seen.has(exportName)) continue
        seen.add(exportName)
        candidateNames.push(exportName)
      }
    }

    const DTS_SIZE_BUDGET = 500_000   // bytes
    const DTS_EXPORT_BUDGET = 300     // exports
    let dtsSize = 0
    try { dtsSize = (await fsp.stat(indexPath)).size } catch { /* proceed as if small */ }
    const overBudget = dtsSize > DTS_SIZE_BUDGET || candidateNames.length > DTS_EXPORT_BUDGET

    for (const exportName of candidateNames) {
      if (overBudget) {
        components.push(makeComponent({ name: exportName, module: name, props: [], extraction: 'name-only', bundler }))
        continue
      }
      // Extract props from inline interface in the same file. exactMatchOnly: true —
      // a flat barrel .d.ts has many *Props interfaces; falling back to "first one wins"
      // would give every component the same wrong props.
      const dtsResult = await extractPropsFromDts(indexPath, exportName, { exactMatchOnly: true })
      components.push(makeComponent({
        name: exportName,
        module: name,
        props: dtsResult.props,
        extraction: dtsResult.props.length > 0 ? 'dts' : 'name-only',
        bundler,
      }))
    }
  }

  return components
}

// ── Strategy 3: Entry-point-driven scanner ───────────
// Follows the package's entry point, resolves re-export chains,
// and discovers component files of any type (.vue, .tsx, .jsx, .svelte).

const COMPONENT_EXTS = new Set(['.vue', '.tsx', '.jsx', '.svelte'])

/** Resolve a bare module specifier to an actual file path */
function resolveModulePath(baseDir: string, specifier: string): string | null {
  const base = path.resolve(baseDir, specifier)

  // Direct file
  if (fs.existsSync(base) && !fs.statSync(base).isDirectory()) return base

  // Try extensions
  for (const ext of ['.vue', '.tsx', '.jsx', '.ts', '.js', '.mjs', '.svelte']) {
    const candidate = base + ext
    if (fs.existsSync(candidate)) return candidate
  }

  // Directory — try index files and same-name convention (Button/Button.vue)
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const ext of ['.vue', '.tsx', '.jsx', '.ts', '.js', '.svelte']) {
      const index = path.join(base, 'index' + ext)
      if (fs.existsSync(index)) return index
    }
    const dirName = path.basename(base)
    for (const ext of ['.vue', '.tsx', '.jsx', '.svelte']) {
      const convention = path.join(base, dirName + ext)
      if (fs.existsSync(convention)) return convention
    }
  }

  return null
}

function isComponentFile(filePath: string): boolean {
  return COMPONENT_EXTS.has(path.extname(filePath))
}

/** Find the best source entry point for a package */
function findPackageEntry(pkgDir: string): string | null {
  let pkg: any
  try { pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8')) } catch { return null }

  // Prefer explicit source field
  if (pkg.source) {
    const resolved = resolveModulePath(pkgDir, pkg.source)
    if (resolved) return resolved
  }

  // Try to find source equivalent of the dist entry
  const rootExport = pkg.exports?.['.']
  const distEntry: string | undefined =
    (typeof rootExport === 'string' ? rootExport : null) ??
    (typeof rootExport?.import === 'string' ? rootExport.import : null) ??
    (typeof rootExport?.default === 'string' ? rootExport.default : null) ??
    pkg.module ??
    pkg.main

  if (typeof distEntry === 'string') {
    // Map dist path back to source (dist/index.js → src/index.ts, etc.)
    const normalized = distEntry.replace(/^\.\//, '')
    const stem = normalized.replace(/\.(m?js|cjs)$/, '')

    for (const prefix of ['src', 'lib']) {
      const mapped = normalized.startsWith('dist/')
        ? stem.replace(/^dist\//, `${prefix}/`)
        : `${prefix}/${stem}`

      const resolved = resolveModulePath(pkgDir, mapped)
      if (resolved) return resolved
    }

    // Prefer the package-declared entry (module/main) over heuristic fallbacks.
    // Skips CJS when an ESM entry exists: ESM's `export { ... } from` is what
    // our parser understands; CJS uses `Object.defineProperty` and can't be
    // walked the same way.
    const declaredResolved = resolveModulePath(pkgDir, distEntry)
    if (declaredResolved) return declaredResolved
  }

  // Fallback: scan common source locations (for packages without module/main)
  for (const candidate of [
    'src/components/index', 'src/lib/index', 'src/index',
    'components/index', 'lib/index', 'index',
  ]) {
    const resolved = resolveModulePath(pkgDir, candidate)
    if (resolved) return resolved
  }

  return null
}

interface ModuleRef {
  exportName: string   // Name as exported (or original name for default imports)
  filePath: string     // Resolved specifier relative to the file's directory
  isReExport: boolean  // true if it comes from export {...} from or export * from
}

/** Parse all local module references from a JS/TS file */
function parseModuleRefs(content: string, dir: string): ModuleRef[] {
  const refs: ModuleRef[] = []

  // 1. import X from './path'
  const defaultImportRe = /import\s+(\w+)\s+from\s+['"](\.[^'"]+)['"]/g
  const importMap = new Map<string, string>() // localName → specifier
  let m: RegExpExecArray | null
  while ((m = defaultImportRe.exec(content)) !== null) {
    importMap.set(m[1], m[2])
  }

  // 2. export { default as X } from './path'  and  export { X, Y } from './path'
  const reExportRe = /export\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g
  while ((m = reExportRe.exec(content)) !== null) {
    const specifier = m[2]
    for (const token of m[1].split(',')) {
      const trimmed = token.trim()
      if (!trimmed || trimmed.startsWith('type ')) continue
      // "default as Button" or just "Button"
      const asMatch = trimmed.match(/(?:default\s+as\s+)?(\w+)/)
      if (asMatch) {
        refs.push({ exportName: asMatch[1], filePath: specifier, isReExport: true })
      }
    }
  }

  // 3. export * from './path'
  const starExportRe = /export\s*\*\s*from\s*['"](\.[^'"]+)['"]/g
  while ((m = starExportRe.exec(content)) !== null) {
    refs.push({ exportName: '*', filePath: m[1], isReExport: true })
  }

  // 4. export { X, Y } (local — match with imports above)
  const localExportRe = /export\s*\{([^}]+)\}(?!\s*from)/g
  const exported = new Set<string>()
  while ((m = localExportRe.exec(content)) !== null) {
    for (const token of m[1].split(',')) {
      const name = token.trim()
      if (name && !name.startsWith('type ')) exported.add(name)
    }
  }
  // Link locally exported names back to their import source
  for (const [localName, specifier] of importMap) {
    if (exported.has(localName)) {
      refs.push({ exportName: localName, filePath: specifier, isReExport: false })
    }
  }

  return refs
}

/**
 * Recursively collect component exports starting from an entry file.
 * Follows re-export chains up to `maxDepth` levels deep.
 */
async function collectComponentExports(
  filePath: string,
  pkgName: string,
  components: ScannedComponent[],
  visited: Set<string>,
  maxDepth: number,
  bundler: 'vite' | 'webpack' | 'unknown' = 'unknown',
): Promise<void> {
  if (maxDepth <= 0 || visited.has(filePath)) return
  visited.add(filePath)

  let content: string
  try { content = await fsp.readFile(filePath, 'utf-8') } catch { return }

  const dir = path.dirname(filePath)
  const refs = parseModuleRefs(content, dir)

  for (const ref of refs) {
    const resolved = resolveModulePath(dir, ref.filePath)
    if (!resolved) continue

    if (isComponentFile(resolved)) {
      const name = ref.exportName !== '*'
        ? pascalCase(ref.exportName)
        : pascalCase(extractComponentName(resolved))
      const details = await extractComponentDetails(resolved)
      components.push(makeComponent({
        name,
        module: pkgName,
        props: details.props,
        slots: details.slots,
        events: details.events,
        description: details.description,
        sourceFile: resolved,
        providerSignals: details.providerSignals,
        extraction: detailsExtractionTag(details),
        bundler,
      }))
    } else {
      // JS/TS file — follow the chain. If the chain produces nothing AND the
      // ref is a PascalCase named re-export (e.g. `export { default as NButton }
      // from "./src/Button.mjs"` in compiled Vue/React libs), record it as a
      // name-only component so consumers still see it in the catalog.
      const before = components.length
      await collectComponentExports(resolved, pkgName, components, visited, maxDepth - 1, bundler)
      if (components.length === before &&
          ref.exportName !== '*' &&
          /^[A-Z]/.test(ref.exportName) &&
          !ref.exportName.endsWith('Props') &&
          !ref.exportName.endsWith('Emits') &&
          !ref.exportName.endsWith('Icon') &&
          await looksLikeComponentModule(resolved)) {
        // Compiled ESM/CJS component modules (.mjs/.js/.cjs) often ship a sibling .d.ts
        // with the real Props interface even though the compiled output itself carries
        // no types — try that before giving up to name-only.
        let props: ScannedProp[] = []
        let extraction: ScannedComponent['extraction'] = 'name-only'
        const siblingDts = resolved.replace(/\.(mjs|cjs|js)$/, '.d.ts')
        if (siblingDts !== resolved && fs.existsSync(siblingDts)) {
          const dtsResult = await extractPropsFromDts(siblingDts, pascalCase(ref.exportName))
          if (dtsResult.props.length > 0) {
            props = dtsResult.props
            extraction = dtsResult.resolvedName ? 'dts-guessed' : 'dts'
          }
        }
        components.push(makeComponent({
          name: pascalCase(ref.exportName),
          module: pkgName,
          props,
          sourceFile: resolved,
          extraction,
          bundler,
        }))
      }
    }
  }
}

/** Heuristic: does this leaf JS/TS file look like a compiled component module? */
async function looksLikeComponentModule(filePath: string): Promise<boolean> {
  try {
    const content = await fsp.readFile(filePath, 'utf-8')
    // JSX runtime imports (React, Preact, Solid) — strongest signal for a compiled component
    if (/from\s+['"][^'"]*\/jsx-(?:runtime|dev-runtime)['"]/.test(content)) return true
    // Vue compiled SFCs: defineComponent + setup + render
    if (/\b(defineComponent|_createVNode|_openBlock|_createElementBlock)\b/.test(content)) return true
    // React component factories (Mantine, Chakra, etc.) and class components
    if (/\b(forwardRef|polymorphicFactory|[Ff]actory\s*\()|extends\s+(React\.)?(Pure)?Component\b/.test(content)) return true
    // Svelte compiled output
    if (/\b(SvelteComponent|create_ssr_component|\$\$_payload)\b/.test(content)) return true
    // Solid: createComponent / template$ / hyperscript-style
    if (/\b(createComponent|template\$|_\$template\()/.test(content)) return true
    // Generic: the file exports a default that's called with JSX-like args
    if (/\bexport\s+default\s+\w+\(/.test(content) && /\bjsx\w*\s*\(/.test(content)) return true
    return false
  } catch { return false }
}

/** Entry-point-driven component scanner */
async function scanFromEntryPoint(name: string, pkgDir: string, sourceDir?: string, bundler: 'vite' | 'webpack' | 'unknown' = 'unknown'): Promise<ScannedComponent[]> {
  // Prefer source directory (for file: deps where node_modules only has dist/)
  const scanDir = sourceDir || pkgDir
  const entryPath = findPackageEntry(scanDir)

  if (entryPath) {
    let isBundled = false
    try {
      const stat = await fsp.stat(entryPath)
      isBundled = stat.size > 500_000
    } catch { /* proceed */ }

    if (!isBundled) {
      const components: ScannedComponent[] = []
      await collectComponentExports(entryPath, name, components, new Set(), 4, bundler)
      if (components.length > 0) return components
    }
  }

  // Fallback: parse named exports from the dist entry in the installed package.
  // Bundled ESM files end with export{internalName as exportName, ...}.
  // We can extract component names (no props) from this.
  const distEntry = findPackageEntry(pkgDir)
  if (distEntry) {
    const nameOnly = await extractExportNames(distEntry, name, bundler)
    // Try to hydrate props from the types .d.ts file
    if (nameOnly.length > 0) {
      let typesPath: string | null = null
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'))
        const typesField: string | undefined = pkg.exports?.['.']?.types ?? pkg.types ?? pkg.typings
        if (typeof typesField === 'string' && typesField.endsWith('.d.ts')) {
          const candidate = path.join(pkgDir, typesField)
          if (fs.existsSync(candidate)) typesPath = candidate
        }
      } catch { /* no package.json */ }
      if (typesPath) {
        // Exact-match only: a flat barrel .d.ts has many *Props interfaces — falling back
        // to "first *Props wins" would give every component the same wrong props.
        for (const comp of nameOnly) {
          if (comp.props.length === 0) {
            const dtsResult = await extractPropsFromDts(typesPath, comp.name, { exactMatchOnly: true })
            if (dtsResult.props.length > 0) {
              comp.props = dtsResult.props
              comp.extraction = dtsResult.resolvedName ? 'dts-guessed' : 'dts'
            }
          }
        }
      }
    }
    return nameOnly
  }

  return []
}

/** Extract component names from a bundled ESM file's export statement */
async function extractExportNames(filePath: string, pkgName: string, bundler: 'vite' | 'webpack' | 'unknown' = 'unknown'): Promise<ScannedComponent[]> {
  let content: string
  try { content = await fsp.readFile(filePath, 'utf-8') } catch { return [] }

  const components: ScannedComponent[] = []
  const seen = new Set<string>()

  // Match: export{X as name, Y as name2, ...} — handles minified bundles
  const exportBlockRe = /export\s*\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = exportBlockRe.exec(content)) !== null) {
    for (const token of m[1].split(',')) {
      const trimmed = token.trim()
      if (!trimmed) continue
      // "internalName as exportName" or just "exportName"
      const asMatch = trimmed.match(/(?:\w+\s+as\s+)?(\w+)$/)
      if (!asMatch) continue
      const exportName = asMatch[1]

      // Skip non-component exports: default, type names, camelCase utils, ALL_CAPS constants
      if (exportName === 'default' || exportName === 'install') continue
      if (exportName.endsWith('Props') || exportName.endsWith('Emits')) continue
      if (exportName === exportName.toUpperCase()) continue // CONSTANTS
      // Require the ORIGINAL export name to already be PascalCase. Without this, any
      // lowercase/camelCase utility not matching the use/create/... prefix list below
      // (e.g. @mantine/hooks' `clamp`, `randomId`) gets pascalCased into a fake
      // "component" (measured: 12 fabricated entries from @mantine/hooks alone).
      if (!exportName[0] || exportName[0] !== exportName[0].toUpperCase() || exportName[0] === exportName[0].toLowerCase()) continue
      if (/^(use|create|get|set|is|has|with|to|from)[A-Z]/.test(exportName)) continue // utility functions
      if (seen.has(exportName)) continue
      seen.add(exportName)

      components.push(makeComponent({ name: pascalCase(exportName), module: pkgName, props: [], extraction: 'name-only', bundler }))
    }
  }

  return components
}

/**
 * Extract props from a Radix-style propDefs declaration file.
 * Format: const fooBarPropDefs = { propName: { type: "enum"|"boolean", values?: [...], default?: ... } }
 */
async function extractPropsFromPropDefs(filePath: string): Promise<ScannedProp[]> {
  let content: string
  try { content = await fsp.readFile(filePath, 'utf-8') } catch { return [] }

  const props: ScannedProp[] = []

  // Find the propDefs object body — skip the variable declaration. Tolerates both
  // `declare const xxxPropDefs: { ... }` (type annotation) and `export const
  // xxxPropDefs = { ... }` (value assignment) — the previous `indexOf('PropDefs:')`
  // search only matched the first form and silently returned nothing for the second
  // (measured: Radix Button 0 props).
  const declMatch = content.match(/\w*PropDefs\s*[:=]/)
  if (!declMatch) return []
  const braceStart = content.indexOf('{', declMatch.index!)
  if (braceStart === -1) return []

  // Extract the top-level properties (depth 1 inside the outer braces)
  let depth = 0
  let i = braceStart
  let propStart = -1
  let currentPropName = ''

  while (i < content.length) {
    if (content[i] === '{') {
      depth++
      if (depth === 2) propStart = i // Start of a property's value object
    } else if (content[i] === '}') {
      if (depth === 2 && propStart >= 0 && currentPropName) {
        // Extract this property's body
        const body = content.slice(propStart + 1, i)
        const typeMatch = body.match(/type:\s*"(\w+)"/)
        const valuesMatch = body.match(/values:\s*readonly\s*\[([^\]]+)\]/)
        const defaultMatch = body.match(/default:\s*([^;}\n]+)/)

        let type: string | null = null
        if (typeMatch) {
          if (typeMatch[1] === 'enum' && valuesMatch) {
            type = valuesMatch[1].split(',').map(v => v.trim()).filter(v => v.startsWith('"'))
              .map(v => v.replace(/"/g, "'")).join(' | ')
            if (type.length > 400) type = type.slice(0, 397) + '...'
          } else {
            type = typeMatch[1]
          }
        }

        let defaultVal: string | null = null
        if (defaultMatch) {
          const raw = defaultMatch[1].trim().replace(/[;,\s]+$/, '')
          // Skip complex union defaults like "gray" | "gold" | ...
          if (!raw.includes(' | ') && raw !== 'undefined') defaultVal = raw.replace(/"/g, '')
        }

        props.push({ name: currentPropName, type, required: false, description: null, default: defaultVal })
        currentPropName = ''
        propStart = -1
      }
      depth--
      if (depth === 0) break // End of the outer object
    } else if (depth === 1 && content[i] !== ' ' && content[i] !== '\n' && content[i] !== '\r' && content[i] !== '\t' && content[i] !== ';') {
      // At depth 1, look for property names (identifier followed by :)
      const rest = content.slice(i)
      const nameMatch = rest.match(/^(\w+)\s*:/)
      if (nameMatch) {
        currentPropName = nameMatch[1]
        i += nameMatch[0].length - 1 // Skip past the name and colon
      }
    }
    i++
  }

  return props
}

// Per-.d.ts-file content memo. extractPropsFromDts/extractPropsFromDtsViaTs are called once
// PER EXPORT from a shared barrel file — for a normal per-component barrel that's a handful
// of calls against small files, but for a flat single-barrel .d.ts (see the lucide-vue-next
// case in scanBarrelExports) it can be hundreds to thousands of calls against the SAME
// multi-MB file. Without this cache each call re-read the whole file from disk.
const dtsContentCache = new Map<string, Promise<string | null>>()
function readDtsCached(dtsPath: string): Promise<string | null> {
  let cached = dtsContentCache.get(dtsPath)
  if (!cached) {
    cached = fsp.readFile(dtsPath, 'utf-8').catch(() => null)
    dtsContentCache.set(dtsPath, cached)
  }
  return cached
}

/** Force a fresh, unshared string copy. V8 represents the result of `.slice()`/`.substring()`
 *  on a sufficiently long string as a SlicedString that keeps the ENTIRE parent string alive —
 *  for a multi-MB `.d.ts` read once (via {@link readDtsCached}) and sliced into hundreds of
 *  small prop-type strings, that would otherwise pin the whole file in memory for as long as
 *  any single prop string survives, which for `cachedCatalog` is the process lifetime.
 *  Round-tripping through Buffer forces a real, independent copy. */
function unslice(str: string): string
function unslice(str: string | null): string | null
function unslice(str: string | null): string | null {
  if (str === null) return null
  return Buffer.from(str, 'utf-8').toString('utf-8')
}

/**
 * extractPropsFromDts, but when the target .d.ts is itself just a thin re-export forwarder
 * (`export * from './Button'` / `export { ButtonProps } from './Button'`) — common in
 * Mantine/naive-ui/bits-ui-style per-component folders, where the barrel's per-component
 * .d.ts sits one hop away from the file that actually declares `FooProps` — follow the
 * re-export chain a few levels before giving up.
 */
async function extractPropsFromDtsFollowingReExports(
  dtsPath: string,
  componentName: string,
  options: { exactMatchOnly?: boolean } = {},
  depth = 3,
): Promise<{ props: ScannedProp[]; resolvedName: string | null }> {
  const direct = await extractPropsFromDts(dtsPath, componentName, options)
  if (direct.props.length > 0 || depth <= 0) return direct

  const content = await readDtsCached(dtsPath)
  if (content === null) return direct

  const dir = path.dirname(dtsPath)
  const reExportRe = /export\s*(?:\*|\{[^}]*\})\s*from\s*['"](\.[^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = reExportRe.exec(content)) !== null) {
    const specifier = m[1]
    const candidates = [
      path.resolve(dir, specifier.endsWith('.d.ts') ? specifier : `${specifier}.d.ts`),
      path.join(path.resolve(dir, specifier), 'index.d.ts'),
    ]
    for (const candidate of candidates) {
      if (candidate === dtsPath || !fs.existsSync(candidate)) continue
      const nested = await extractPropsFromDtsFollowingReExports(candidate, componentName, options, depth - 1)
      if (nested.props.length > 0) return nested
    }
  }
  return direct
}

/**
 * AST-based fallback for .d.ts prop extraction. Parses the file with the TypeScript compiler
 * (parser only — no type checker) and walks InterfaceDeclaration members. Handles multi-line
 * types, complex generics, and follows `extends` chains within the same file.
 *
 * Requires `typescript` to be resolvable. Returns empty when it isn't — the caller falls back
 * to regex-based extraction.
 */
async function extractPropsFromDtsViaTs(
  dtsPath: string,
  componentName: string,
  options: { exactMatchOnly?: boolean } = {},
): Promise<{ props: ScannedProp[]; resolvedName: string | null }> {
  let ts: typeof import('typescript')
  try {
    ts = (await import('typescript')).default ?? await import('typescript') as any
  } catch {
    return { props: [], resolvedName: null }
  }

  const content = await readDtsCached(dtsPath)
  if (content === null) return { props: [], resolvedName: null }

  const sf = ts.createSourceFile(dtsPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const interfaces = new Map<string, import('typescript').InterfaceDeclaration>()
  const typeAliases = new Map<string, import('typescript').TypeAliasDeclaration>()
  const collect = (node: import('typescript').Node) => {
    if (ts.isInterfaceDeclaration(node) && node.name) interfaces.set(node.name.text, node)
    else if (ts.isTypeAliasDeclaration(node) && node.name) typeAliases.set(node.name.text, node)
    ts.forEachChild(node, collect)
  }
  collect(sf)

  let target = interfaces.get(`${componentName}Props`)
  let resolvedName: string | null = null
  if (!target && !options.exactMatchOnly) {
    for (const [name, iface] of interfaces) {
      if (!name.endsWith('Props')) continue
      if (name.includes('PassThrough') || name.includes('MethodOptions')) continue
      target = iface
      resolvedName = name.replace(/Props$/, '')
      break
    }
  }
  if (!target) return { props: [], resolvedName: null }

  const props: ScannedProp[] = []
  const seen = new Set<string>()
  const fullText = sf.getFullText()

  const simplifyType = (raw: string): string | null => {
    let type = raw.replace(/\s+/g, ' ').trim()
    type = type.replace(/\s*\|\s*undefined/g, '').replace(/undefined\s*\|\s*/g, '')
    type = type.replace(/HintedString<([^>]+)>/g, '$1')
    if (type.length > 400) type = type.slice(0, 397) + '...'
    return type || null
  }

  const readJsDoc = (node: import('typescript').Node): { description: string | null; default: string | null } => {
    const ranges = ts.getLeadingCommentRanges(fullText, node.pos) || []
    for (const range of ranges) {
      const comment = fullText.slice(range.pos, range.end)
      if (!comment.startsWith('/**')) continue
      const defaultMatch = comment.match(/@defaultValue\s+(.+?)(?:\n|\*\/|$)/)
      const def = defaultMatch ? defaultMatch[1].trim().replace(/\s*\*\/$/, '').trim() : null
      const descLine = comment
        .split('\n')
        .map(l => l.replace(/^\s*\/?\*+\/?\s?/, '').trim())
        .filter(l => l && !l.startsWith('@'))[0] ?? null
      return { description: descLine, default: def }
    }
    return { description: null, default: null }
  }

  const visited = new Set<string>()
  const collectMembers = (iface: import('typescript').InterfaceDeclaration) => {
    if (iface.name && visited.has(iface.name.text)) return
    if (iface.name) visited.add(iface.name.text)

    for (const member of iface.members) {
      if (!ts.isPropertySignature(member) || !member.name) continue
      const nameNode = member.name
      const name = ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode)
        ? nameNode.text
        : null
      if (!name || seen.has(name)) continue
      if (['pt', 'ptOptions', 'unstyled', 'dt'].includes(name)) continue

      const optional = member.questionToken !== undefined
      const typeText = member.type ? simplifyType(member.type.getText(sf)) : null
      const { description, default: def } = readJsDoc(member)
      seen.add(name)
      props.push({ name, type: unslice(typeText), required: !optional, description: unslice(description), default: unslice(def) })
    }

    if (iface.heritageClauses) {
      for (const clause of iface.heritageClauses) {
        if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue
        for (const t of clause.types) {
          const expr = t.expression
          if (!ts.isIdentifier(expr)) continue
          const parentName = expr.text
          if (parentName.includes('PassThrough') || parentName.includes('MethodOptions')) continue
          const parent = interfaces.get(parentName)
          if (parent) collectMembers(parent)
        }
      }
    }
  }
  collectMembers(target)

  return { props, resolvedName }
}

async function extractPropsFromDts(
  dtsPath: string,
  componentName: string,
  options: { exactMatchOnly?: boolean } = {},
): Promise<{ props: ScannedProp[]; resolvedName: string | null }> {
  const content = await readDtsCached(dtsPath)
  if (content === null) return { props: [], resolvedName: null }

  // `export` is optional — bundler outputs (tsup/rollup) often emit `interface FooProps {…}`
  // without `export`, relying on a single `export { … }` block at the bottom of the file.
  let propsInterfaceName = `${componentName}Props`
  let interfaceRegex = new RegExp(`(?:export\\s+)?(?:declare\\s+)?interface\\s+${propsInterfaceName}(?:<[^>]*>)?\\s*(?:extends\\s+[^{]*)?\\{`)
  let match = interfaceRegex.exec(content)

  let resolvedName: string | null = null
  if (!match && !options.exactMatchOnly) {
    // Find any *Props interface (e.g., AutoCompleteProps when dir is "autocomplete").
    // Skipped under exactMatchOnly — a flat barrel .d.ts has many *Props; picking the first is wrong.
    const genericRegex = /(?:export\s+)?(?:declare\s+)?interface\s+(\w+Props)(?:<[^>]*>)?\s*(?:extends\s+[^{]*)?\{/g
    let candidate: RegExpExecArray | null
    while ((candidate = genericRegex.exec(content)) !== null) {
      const name = candidate[1]
      // Skip PassThrough and internal props
      if (name.includes('PassThrough') || name.includes('MethodOptions')) continue
      match = candidate
      propsInterfaceName = name
      resolvedName = name.replace(/Props$/, '')
      break
    }
  }
  if (!match) {
    // Regex found nothing — AST parser is the last resort (handles exotic declarations the regex misses).
    return extractPropsFromDtsViaTs(dtsPath, componentName, options)
  }

  // Extract the interface body (track brace depth)
  const start = match.index + match[0].length
  let depth = 1
  let end = start
  while (end < content.length && depth > 0) {
    if (content[end] === '{') depth++
    else if (content[end] === '}') depth--
    end++
  }

  const body = content.slice(start, end - 1)

  // Parse properties — each starts with a JSDoc comment (optional) then name?: type
  const props: ScannedProp[] = []
  // Match: optional JSDoc + property name + optional ? + : + type
  const propRegex = /(?:\/\*\*\s*([\s\S]*?)\s*\*\/\s*)?(\w+)(\??):\s*([^;]+);/g
  let propMatch: RegExpExecArray | null

  while ((propMatch = propRegex.exec(body)) !== null) {
    const [, jsdoc, propName, optional, rawType] = propMatch

    // Skip internal/passthrough props
    if (['pt', 'ptOptions', 'unstyled', 'dt'].includes(propName)) continue

    // Extract @defaultValue from JSDoc
    let defaultValue: string | null = null
    let description: string | null = null
    if (jsdoc) {
      const defaultMatch = jsdoc.match(/@defaultValue\s+(.+?)(?:\n|$)/)
      if (defaultMatch) defaultValue = defaultMatch[1].trim()
      // First line of JSDoc is the description
      const descLine = jsdoc.split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim()).filter(l => l && !l.startsWith('@'))[0]
      if (descLine) description = descLine
    }

    // Simplify complex types for display
    let type = rawType.trim()
    // Remove undefined from union
    type = type.replace(/\s*\|\s*undefined/g, '').replace(/undefined\s*\|\s*/g, '')
    // Simplify HintedString<'a' | 'b'> to 'a' | 'b'
    type = type.replace(/HintedString<([^>]+)>/g, '$1')
    // Truncate very long types
    if (type.length > 400) type = type.slice(0, 397) + '...'

    props.push({
      name: propName,
      type: unslice(type || null),
      required: optional !== '?',
      description: unslice(description),
      default: unslice(defaultValue),
    })
  }

  // Prefer the AST fallback outright when the regex path is structurally incomplete,
  // rather than only trying it when regex found NOTHING. The regex here never follows
  // `extends` heritage chains (the AST path does, via collectMembers' recursion), and its
  // prop-name pattern doesn't match quoted names (`'aria-label': string`) — either one
  // means a "successful" partial match (props.length > 0) was previously silently
  // dropping real props by short-circuiting past the strictly-better AST result.
  const regexIsIncomplete =
    /\bextends\b/.test(match[0]) ||
    /^\s*(?:\/\*\*[\s\S]*?\*\/\s*)?['"][\w$-]+['"]\s*\??:/m.test(body)
  if (props.length === 0 || regexIsIncomplete) {
    const astResult = await extractPropsFromDtsViaTs(dtsPath, componentName, options)
    if (astResult.props.length > props.length) return astResult
  }

  return { props, resolvedName }
}

/** Route props extraction to the right parser based on file extension */
async function extractComponentProps(filePath: string): Promise<ScannedProp[]> {
  const ext = path.extname(filePath)
  if (ext === '.vue') return extractPropsFromVue(filePath)
  if (ext === '.tsx' || ext === '.jsx') return extractPropsFromTsx(filePath)
  if (ext === '.svelte') return extractPropsFromSvelte(filePath)
  return []
}

export interface ExtractedComponentDetails {
  props: ScannedProp[]
  slots: ScannedSlot[]
  events: ScannedEvent[]
  description: string | null
  providerSignals: string[]
}

/** Extract full component metadata (props + slots + events + description +
 *  provider signals) from a source file. */
async function extractComponentDetails(filePath: string): Promise<ExtractedComponentDetails> {
  const ext = path.extname(filePath)
  const empty: ExtractedComponentDetails = { props: [], slots: [], events: [], description: null, providerSignals: [] }

  let content: string
  try { content = await fsp.readFile(filePath, 'utf-8') } catch { return empty }

  const providerSignals = detectProviderSignals(content)

  if (ext === '.vue') {
    return {
      props: await extractPropsFromVue(filePath),
      slots: extractSlotsFromVueContent(content),
      events: extractEventsFromVueContent(content),
      description: extractComponentJsDoc(content),
      providerSignals,
    }
  }
  if (ext === '.tsx' || ext === '.jsx') {
    return {
      props: await extractPropsFromTsx(filePath),
      slots: [],
      events: [],
      description: extractComponentJsDoc(content),
      providerSignals,
    }
  }
  if (ext === '.svelte') {
    return {
      props: await extractPropsFromSvelte(filePath),
      slots: extractSlotsFromSvelteContent(content),
      events: [],
      description: extractComponentJsDoc(content),
      providerSignals,
    }
  }
  if (ext === '.astro') {
    return {
      props: extractPropsFromAstroFrontmatter(content),
      slots: extractSlotsFromAstroContent(content),
      events: [],
      description: extractComponentJsDoc(content),
      providerSignals,
    }
  }
  if (ext === '.js' || ext === '.ts' || ext === '.mjs' || ext === '.cjs') {
    // Script-only components (notably native web components registered via
    // customElements.define — see COMPONENT_SIGNAL_RE) have no reliable prop source
    // without a manifest, but description/providerSignals are still worth surfacing
    // rather than discarding them via the generic `empty` fallback below.
    return { props: [], slots: [], events: [], description: extractComponentJsDoc(content), providerSignals }
  }
  return empty
}

/** Extract the Astro frontmatter block (the `---\n...\n---` fenced region at the top of
 *  the file) as plain TS so the existing interface/type-literal parsers can be reused. */
function extractAstroFrontmatter(content: string): string | null {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  return m ? m[1] : null
}

/** Astro components declare props via a frontmatter `interface Props { ... }` (or
 *  `type Props = { ... }`), destructured from `Astro.props`. There's no `defineProps<X>()`-
 *  style call to auto-detect a custom name from, so we look for the conventional `Props`
 *  name directly — previously there was no `.astro` branch at all (0/9 props measured). */
function extractPropsFromAstroFrontmatter(content: string): ScannedProp[] {
  const frontmatter = extractAstroFrontmatter(content)
  if (!frontmatter) return []
  return extractPropsFromTsInterface(frontmatter, 'Props')
}

/** Parse `<slot>` tags from an Astro component's template body. Astro has no `<template>`
 *  wrapper like Vue — everything after the frontmatter fence is markup. */
function extractSlotsFromAstroContent(content: string): ScannedSlot[] {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '')
  const slots: ScannedSlot[] = []
  const seen = new Set<string>()
  const slotRe = /<slot\b([^>]*?)\/?>/g
  let m: RegExpExecArray | null
  while ((m = slotRe.exec(body)) !== null) {
    const attrs = m[1]
    const nameMatch = attrs.match(/\bname\s*=\s*["']([^"']+)["']/)
    const name = nameMatch ? nameMatch[1] : 'default'
    if (seen.has(name)) continue
    seen.add(name)
    const scoped = /\s[:v-]|\s[a-z-]+\s*=/i.test(attrs.replace(/\bname\s*=\s*["'][^"']+["']/, ''))
    slots.push({ name, description: null, scoped })
  }
  return slots
}

/** Tag the extraction strategy for an ExtractedComponentDetails result: 'source' when we
 *  genuinely parsed the file and got SOMETHING back (even a verified-empty props list is
 *  still a real result if slots/events/description/provider-signals came through), otherwise
 *  'name-only' — e.g. an unsupported extension or an unreadable file. */
function detailsExtractionTag(details: ExtractedComponentDetails): ScannedComponent['extraction'] {
  if (details.props.length > 0 || details.slots.length > 0 || details.events.length > 0 ||
      details.description || details.providerSignals.length > 0) return 'source'
  return 'name-only'
}

/** Parse `<slot>` tags from a Vue SFC template. Handles named and scoped slots. */
function extractSlotsFromVueContent(content: string): ScannedSlot[] {
  const template = extractVueTemplate(content)
  if (!template) return []
  const slots: ScannedSlot[] = []
  const seen = new Set<string>()
  const slotRe = /<slot\b([^>]*?)\/?>/g
  let m: RegExpExecArray | null
  while ((m = slotRe.exec(template)) !== null) {
    const attrs = m[1]
    const nameMatch = attrs.match(/\bname\s*=\s*["']([^"']+)["']/)
    const name = nameMatch ? nameMatch[1] : 'default'
    if (seen.has(name)) continue
    seen.add(name)
    // Scoped if there's any attr beyond `name` (e.g. :row, :item, v-bind)
    const scoped = /\s[:v-]|\s[a-z-]+\s*=/i.test(attrs.replace(/\bname\s*=\s*["'][^"']+["']/, ''))
    slots.push({ name, description: null, scoped })
  }
  return slots
}

/** Extract the <template>…</template> block from a Vue SFC. */
function extractVueTemplate(content: string): string | null {
  const m = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)
  return m ? m[1] : null
}

/** Parse emitted events from a Vue SFC — defineEmits<T>(), defineEmits(['x']), Options API emits. */
function extractEventsFromVueContent(content: string): ScannedEvent[] {
  const events: ScannedEvent[] = []
  const seen = new Set<string>()
  const push = (name: string, payloadType: string | null = null, description: string | null = null) => {
    if (!name || seen.has(name)) return
    seen.add(name)
    events.push({ name, payloadType, description })
  }

  // defineEmits<{ 'name': [payload: T] }>() OR defineEmits<{ (e: 'name', payload: T): void }>()
  const genericMatch = content.match(/defineEmits\s*<\s*([\s\S]*?)\s*>\s*\(/)
  if (genericMatch) {
    const body = genericMatch[1]
    // Array-tuple form: 'name' OR bare-identifier name followed by `: [arg1: T, …]`
    const tupleRe = /(?:['"]([\w:-]+)['"]|(\w+))\s*:\s*\[([^\]]*)\]/g
    let m: RegExpExecArray | null
    while ((m = tupleRe.exec(body)) !== null) {
      const name = m[1] ?? m[2]
      push(name, (m[3] || '').trim() || null)
    }
    // Call-signature form: (e: 'name', payload: T): void
    const callRe = /\(\s*\w+\s*:\s*['"]([\w:-]+)['"]\s*(?:,\s*([^)]*))?\)\s*(?:=>|:)\s*(?:void|any)/g
    while ((m = callRe.exec(body)) !== null) push(m[1], (m[2] || '').trim() || null)
  }

  // defineEmits(['name', 'other']) — array literal
  const arrayMatch = content.match(/defineEmits\s*\(\s*\[([\s\S]*?)\]\s*\)/)
  if (arrayMatch) {
    const listRe = /['"]([\w:-]+)['"]/g
    let m: RegExpExecArray | null
    while ((m = listRe.exec(arrayMatch[1])) !== null) push(m[1])
  }

  // Options API: emits: ['name', ...] or emits: { name: null | validator }
  const optsArray = content.match(/\bemits\s*:\s*\[([\s\S]*?)\]/)
  if (optsArray) {
    const listRe = /['"]([\w:-]+)['"]/g
    let m: RegExpExecArray | null
    while ((m = listRe.exec(optsArray[1])) !== null) push(m[1])
  }
  const optsObj = content.match(/\bemits\s*:\s*\{([\s\S]*?)\n\s*\}/)
  if (optsObj) {
    const keyRe = /^\s*['"]?([\w:-]+)['"]?\s*:/gm
    let m: RegExpExecArray | null
    while ((m = keyRe.exec(optsObj[1])) !== null) push(m[1])
  }

  // Fallback: emit('name') / this.$emit('name') calls
  const emitCallRe = /(?:this\.\$emit|\bemit)\s*\(\s*['"]([\w:-]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = emitCallRe.exec(content)) !== null) push(m[1])

  return events
}

/** Extract slot names from a Svelte file — `<slot name="..."></slot>` */
function extractSlotsFromSvelteContent(content: string): ScannedSlot[] {
  const slots: ScannedSlot[] = []
  const seen = new Set<string>()
  const slotRe = /<slot\b([^>]*?)\/?>/g
  let m: RegExpExecArray | null
  while ((m = slotRe.exec(content)) !== null) {
    const attrs = m[1]
    const nameMatch = attrs.match(/\bname\s*=\s*["']([^"']+)["']/)
    const name = nameMatch ? nameMatch[1] : 'default'
    if (seen.has(name)) continue
    seen.add(name)
    const scoped = /\s[a-z-]+\s*=\s*["']?\{/i.test(attrs)
    slots.push({ name, description: null, scoped })
  }
  return slots
}

/** Extract a component-level JSDoc description from the first JSDoc block in the source. */
function extractComponentJsDoc(content: string): string | null {
  const m = content.match(/\/\*\*\s*\n([\s\S]*?)\*\//)
  if (!m) return null
  const first = m[1]
    .split('\n')
    .map(l => l.replace(/^\s*\*\s?/, '').trim())
    .filter(l => l && !l.startsWith('@'))[0]
  return first ?? null
}

async function extractPropsFromVue(vuePath: string): Promise<ScannedProp[]> {
  let content: string
  try { content = await fsp.readFile(vuePath, 'utf-8') } catch { return [] }

  let props: ScannedProp[] = []

  // Strategy A: defineProps<InterfaceName>() with TypeScript interface
  props = extractPropsFromTsInterface(content)

  // Strategy A2: inline type literal — defineProps<{ planet: Planet; active?: boolean }>()
  if (props.length === 0) {
    const inline = content.match(/defineProps\s*<\s*\{([\s\S]*?)\}\s*>\s*\(/)
    if (inline) props = parseTypeLiteralProps(inline[1])
  }

  // Strategy B: defineProps({ prop: { type: String, ... } }) — object literal
  if (props.length === 0) {
    const definePropsObj = content.match(/defineProps\s*\(\s*\{([\s\S]*?)\}\s*\)/)
    if (definePropsObj) {
      props = parseObjectProps(definePropsObj[1])
    }
  }

  // Strategy C: Options API props: { ... }
  if (props.length === 0) {
    const propsMatch = content.match(/props:\s*\{([\s\S]*?)\n\s*\}/)
    if (propsMatch) {
      props = parseObjectProps(propsMatch[1])
    }
  }

  return props
}

/** Extract props from a React/Solid .tsx/.jsx component file. Tries, in order:
 *  `React.FC<X>`/`FunctionComponent<X>` binding annotations, `forwardRef<Ref, X>` generics,
 *  forwardRef's inline `(props: X, ref)` signature, then any typed first parameter of a
 *  function/arrow head — regardless of the parameter's own name, so Solid's `mergeProps`
 *  rename idiom (`(rawProps: FooProps) => { const props = mergeProps(...) }`) is covered
 *  alongside the conventional `props` name. Previously only the last of these matched, and
 *  only when the parameter was literally named `props` — arrow components, forwardRef, and
 *  renamed params all fell through to an empty result (measured 0 props on all three). */
async function extractPropsFromTsx(filePath: string): Promise<ScannedProp[]> {
  let content: string
  try { content = await fsp.readFile(filePath, 'utf-8') } catch { return [] }

  let props: ScannedProp[] = []

  // const Foo: React.FC<FooProps> = (props) => ... — the type is on the binding, not
  // the parameter, so it must be tried before the parameter-based patterns below.
  const fcAnnotation = content.match(/:\s*(?:React\.)?(?:FC|FunctionComponent)\s*<\s*(\w+)\s*>/)
  if (fcAnnotation) props = extractPropsFromTsInterface(content, fcAnnotation[1])

  // const Foo = forwardRef<HTMLDivElement, FooProps>((props, ref) => ...) — the props
  // type is the SECOND generic argument, not a parameter annotation.
  if (props.length === 0) {
    const forwardRefGeneric = content.match(/forwardRef\s*<\s*[\w.]+\s*,\s*(\w+)\s*>/)
    if (forwardRefGeneric) props = extractPropsFromTsInterface(content, forwardRefGeneric[1])
  }

  // forwardRef((props: FooProps, ref) => ...) — no generics, type inline on the first param.
  if (props.length === 0) {
    const forwardRefInline = content.match(/forwardRef\s*\(\s*\(\s*(?:\{[^}]*\}|\w+)\s*:\s*(\w+)/)
    if (forwardRefInline) props = extractPropsFromTsInterface(content, forwardRefInline[1])
  }

  // Any function/arrow head with a typed first parameter: `function Foo(props: FooProps)`,
  // `const Foo = (props: FooProps) =>`, the destructured `({ a, b }: FooProps)` form, and
  // Solid's renamed-param idiom `const Foo = (rawProps: FooProps) =>` — matched by parameter
  // NAME-AGNOSTIC pattern (`\w+` instead of the literal word `props`).
  if (props.length === 0) {
    const propsTypeMatch = content.match(
      /(?:function\s+\w+|const\s+\w+\s*=)\s*(?:<[^>]*>)?\s*\(\s*(?:\{[^}]*\}|\w+)\s*:\s*(\w+)/
    )
    if (propsTypeMatch) props = extractPropsFromTsInterface(content, propsTypeMatch[1])
  }

  // Fallback: look for any exported Props-like interface
  if (props.length === 0) props = extractPropsFromTsInterface(content)

  // Layer in destructuring defaults the type interface can't carry (React's
  // `function Foo({ count = 3 }: FooProps)` — measured: previously always `default: null`).
  if (props.length > 0) applyParamDestructureDefaults(props, content)

  return props
}

/** Fill in JS default values from a destructured first parameter (`{ count = 3, label }`)
 *  onto already-typed props — the TS interface only carries optionality, not the runtime
 *  default. Handles the rename form (`{ count: renamedCount = 3 }`) by matching on the
 *  PROP key (before the colon), not the local binding name. */
function applyParamDestructureDefaults(props: ScannedProp[], content: string): void {
  const m = content.match(/\(\s*\{([\s\S]*?)\}\s*:\s*\w+/)
  if (!m) return
  for (const entry of splitTopLevel(m[1])) {
    const part = entry.trim()
    if (!part || part.startsWith('...')) continue
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim().split(':')[0].trim()
    const def = part.slice(eq + 1).trim()
    const prop = props.find(p => p.name === name)
    if (prop && prop.default === null && def) prop.default = def
  }
}

/** Extract props from a Svelte component file */
async function extractPropsFromSvelte(filePath: string): Promise<ScannedProp[]> {
  let content: string
  try { content = await fsp.readFile(filePath, 'utf-8') } catch { return [] }

  const props: ScannedProp[] = []

  // Svelte 4: optional JSDoc + export let propName: Type = default
  // The JSDoc lookbehind captures the preceding /** ... */ block so the description attaches
  // to the right prop (one comment per prop is the idiomatic pattern).
  const exportLetRe = /(\/\*\*\s*([\s\S]*?)\s*\*\/\s*)?export\s+let\s+(\w+)\s*(?::\s*([^=;\n]+))?\s*(?:=\s*([^;\n]+))?/g
  let m: RegExpExecArray | null
  while ((m = exportLetRe.exec(content)) !== null) {
    const [, , jsdocBody, propName, rawType, rawDefault] = m
    let type = rawType?.trim() ?? null
    if (type && type.length > 400) type = type.slice(0, 397) + '...'
    let def: string | null = rawDefault?.trim() ?? null
    if (def === 'undefined') def = null

    let description: string | null = null
    if (jsdocBody) {
      const descLine = jsdocBody
        .split('\n')
        .map(l => l.replace(/^\s*\*\s?/, '').trim())
        .filter(l => l && !l.startsWith('@'))[0] ?? null
      description = descLine
    }

    props.push({ name: propName, type, required: !rawDefault, description, default: def })
  }

  // Svelte 5 runes: `$props()` destructuring — the auto-detect regex above only ever
  // matched `export let` (Svelte 4), so every runes component previously extracted 0
  // props (measured 0/8). Handles `let {..}: Props = $props()`, the bare `interface Props`
  // convention, and untyped destructuring-only props.
  if (props.length === 0) {
    const svelte5 = extractPropsFromSvelte5Runes(content)
    if (svelte5.length > 0) return svelte5
    // Last resort: a defineProps-style generic match some Svelte 5 code may still use.
    const generic = extractPropsFromTsInterface(content)
    if (generic.length > 0) return generic
  }

  return props
}

/** Svelte 5 runes: `let { a, b = 1 }: Props = $props()` or the untyped `let { a, b } =
 *  $props()`. Prefers a named/conventional type (`interface Props`/`type Props`) when
 *  present — the real source of truth for types/optionality — and layers destructuring
 *  defaults on top (interface members don't carry runtime defaults); falls back to
 *  building props from the destructuring pattern alone when there's no type at all. */
function extractPropsFromSvelte5Runes(content: string): ScannedProp[] {
  const destructureMatch = content.match(/(?:let|const)\s*\{([\s\S]*?)\}\s*(?::\s*(\w+))?\s*=\s*\$props\s*\(/)
  if (!destructureMatch) return []

  const [, bindingBody, typeName] = destructureMatch

  if (typeName) {
    const typed = extractPropsFromTsInterface(content, typeName)
    if (typed.length > 0) {
      applyDestructureDefaults(typed, bindingBody)
      return typed
    }
  }
  // No named type (or it didn't resolve) — fall back to the conventional bare
  // `interface Props`/`type Props` in the same file.
  const conventional = extractPropsFromTsInterface(content, 'Props')
  if (conventional.length > 0) {
    applyDestructureDefaults(conventional, bindingBody)
    return conventional
  }

  // Nothing typed at all — build props straight from the destructuring pattern.
  return parseDestructureOnlyProps(bindingBody)
}

/** Fill in `default` values on already-typed props from a destructuring pattern like
 *  `name, age = 3, active = true`. Shared shape with applyParamDestructureDefaults
 *  (React), kept separate since Svelte's binding has no rename syntax to handle. */
function applyDestructureDefaults(props: ScannedProp[], bindingBody: string): void {
  for (const entry of splitTopLevel(bindingBody)) {
    const eq = entry.indexOf('=')
    if (eq === -1) continue
    const name = entry.slice(0, eq).trim()
    const def = entry.slice(eq + 1).trim()
    const prop = props.find(p => p.name === name)
    if (prop && prop.default === null && def) prop.default = def
  }
}

/** Build props straight from a destructuring pattern with no type annotation at all —
 *  `let { size = 14, label } = $props()`. Types are unknown (`null`); required is inferred
 *  from the absence of a default. Rest patterns (`...rest`) are skipped. */
function parseDestructureOnlyProps(bindingBody: string): ScannedProp[] {
  const props: ScannedProp[] = []
  for (const entry of splitTopLevel(bindingBody)) {
    const part = entry.trim()
    if (!part || part.startsWith('...')) continue
    const eq = part.indexOf('=')
    const name = (eq === -1 ? part : part.slice(0, eq)).trim()
    if (!/^\w+$/.test(name)) continue
    const def = eq === -1 ? null : part.slice(eq + 1).trim()
    props.push({ name, type: null, required: def === null, description: null, default: def })
  }
  return props
}

/**
 * Extract props from a TypeScript interface in source code.
 * Works for: defineProps<Props>(), React FC<Props>, Svelte 5 $props<Props>().
 * If `interfaceName` is given, look for that specific interface.
 * Otherwise, find the interface referenced by defineProps<X>() or $props<X>().
 */
/** Parse the members of an inline TS type literal (`planet: Planet; active?: boolean`).
 *  Splits on `;`/`,` at nesting depth 0 so object/generic/function member types
 *  survive — single-line literals are the common `defineProps<{ … }>()` form. */
function parseTypeLiteralProps(body: string): ScannedProp[] {
  const members: string[] = []
  let depth = 0
  let current = ''
  for (const ch of body) {
    if (ch === '{' || ch === '(' || ch === '[' || ch === '<') depth++
    else if (ch === '}' || ch === ')' || ch === ']' || ch === '>') depth--
    if ((ch === ';' || ch === ',' || ch === '\n') && depth === 0) {
      members.push(current)
      current = ''
      continue
    }
    current += ch
  }
  members.push(current)

  const props: ScannedProp[] = []
  for (const member of members) {
    const m = /^\s*(\w+)(\??)\s*:\s*([\s\S]+?)\s*$/.exec(member)
    if (!m) continue
    let type = m[3].replace(/\/\/.*$/m, '').trim()
    if (type.length > 400) type = type.slice(0, 397) + '...'
    props.push({ name: m[1], type: type || null, required: m[2] !== '?', description: null, default: null })
  }
  return props
}

/** Split a comma-separated list at bracket/paren/brace depth 0 — shared by default-value
 *  and destructuring-pattern parsing so multi-line object/array/arrow-function values
 *  (`size: () => ({ a: 1 })`) aren't cut in half at their first nested comma. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of body) {
    if (ch === '{' || ch === '(' || ch === '[') depth++
    else if (ch === '}' || ch === ')' || ch === ']') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) parts.push(current)
  return parts
}

function extractPropsFromTsInterface(content: string, interfaceName?: string): ScannedProp[] {
  // Auto-detect interface name from defineProps<X>() or $props<X>()
  if (!interfaceName) {
    const genericMatch = content.match(/(?:defineProps|props)\s*<\s*(\w+)\s*>/)
    if (!genericMatch) return []
    interfaceName = genericMatch[1]
  }

  // Find the interface body. `(?:<[^>]*>)?` tolerates a generic-parameter interface
  // declaration (`interface FooProps<T> { ... }`) — previously unmatched, so any
  // component using a generic Props interface fell through to 0 props.
  const interfaceRegex = new RegExp(
    `(?:interface|type)\\s+${interfaceName}\\s*(?:<[^>]*>)?\\s*(?:=\\s*)?(?:extends\\s+[^{]*)?\\{([\\s\\S]*?)\\n\\s*\\}`
  )
  const interfaceMatch = content.match(interfaceRegex)
  if (!interfaceMatch) return []

  const body = interfaceMatch[1]
  const props: ScannedProp[] = []

  // Match: propName?: Type (one per line)
  const propLineRegex = /^\s*(\w+)(\??):\s*(.+)/gm
  let m: RegExpExecArray | null
  while ((m = propLineRegex.exec(body)) !== null) {
    let type = m[3].replace(/[;,]\s*$/, '').replace(/\/\/.*$/, '').trim()
    if (type.length > 400) type = type.slice(0, 397) + '...'
    props.push({ name: m[1], type: type || null, required: m[2] !== '?', description: null, default: null })
  }

  // Extract defaults from withDefaults(defineProps<X>(), { ... }). Split on top-level
  // commas (splitTopLevel) rather than `^`-anchored lines — real-world usage is often
  // single-line (`{size: 14, strokeWidth: 2}`), and the previous line-anchored regex
  // matched the WHOLE single line as one prop's value, swallowing every subsequent
  // default on that line (measured: this repo's own Icon.vue withDefaults call lost
  // strokeWidth's default entirely this way).
  const defaultsMatch = content.match(/withDefaults\s*\(\s*defineProps\s*<[^>]*>\s*\(\)\s*,\s*\{([\s\S]*?)\}\s*\)/)
  if (defaultsMatch && props.length > 0) {
    for (const entry of splitTopLevel(defaultsMatch[1])) {
      const dm = /^\s*(\w+)\s*:\s*([\s\S]+?)\s*$/.exec(entry)
      if (!dm) continue
      const prop = props.find(p => p.name === dm[1])
      if (prop) {
        const val = dm[2].trim()
        if (!val.startsWith('(') && val !== 'undefined') prop.default = val
      }
    }
  }

  return props
}

/** Parse Options-API-style props: { name: { type: X, required: Y, default: Z } } or shorthand
 *  { name: Type }. The full form walks brace depth explicitly rather than matching `{[^}]+}` —
 *  prop values routinely contain their OWN nested braces (`default: () => ({...})`, `type:
 *  Object as PropType<{...}>`), and a brace-blind regex stops at the first nested `}`,
 *  truncating the value; worse, the truncated leftover text can re-sync mid-object so a
 *  key nested inside that value (most commonly a literal `type:` inside a factory default)
 *  gets mistaken for a new top-level prop, fabricating a bogus entry. */
function parseObjectProps(body: string): ScannedProp[] {
  const props: ScannedProp[] = []

  // Full form: propName: { type: String, required: true, default: 'x' }
  const topLevelPropRe = /(\w+)\s*:\s*\{/g
  let m: RegExpExecArray | null
  while ((m = topLevelPropRe.exec(body)) !== null) {
    const name = m[1]
    const braceStart = m.index + m[0].length - 1 // position of the opening `{`
    let depth = 1
    let i = braceStart + 1
    while (i < body.length && depth > 0) {
      if (body[i] === '{') depth++
      else if (body[i] === '}') depth--
      i++
    }
    const propDef = body.slice(braceStart + 1, i - 1)
    topLevelPropRe.lastIndex = i // resume scanning after this prop's full, balanced object

    const typeMatch = propDef.match(/type:\s*(\w+)/)
    const requiredMatch = propDef.match(/required:\s*(true|false)/)
    const defaultMatch = propDef.match(/default:\s*([\s\S]+?)(?:,\s*(?:required|type|validator)\s*:|\s*$)/)
    props.push({
      name,
      type: typeMatch ? typeMatch[1] : null,
      required: requiredMatch ? requiredMatch[1] === 'true' : false,
      description: null,
      default: defaultMatch ? defaultMatch[1].trim().replace(/,\s*$/, '') : null,
    })
  }

  // Shorthand: propName: String  (no braces)
  if (props.length === 0) {
    const shorthandRe = /(\w+):\s*(String|Number|Boolean|Array|Object|Function|Date|Symbol)/g
    while ((m = shorthandRe.exec(body)) !== null) {
      props.push({ name: m[1], type: m[2], required: false, description: null, default: null })
    }
  }

  return props
}

// ── Utilities ──────────────────────────────────────────

function pascalCase(str: string): string {
  return str.replace(/(^|[-_])([a-z])/g, (_, __, c) => c.toUpperCase())
    .replace(/[-_]/g, '')
}

async function fileExists(dir: string, name: string): Promise<boolean> {
  try {
    await fsp.access(path.join(dir, name))
    return true
  } catch { return false }
}

async function hasVueFile(dir: string): Promise<boolean> {
  try {
    const files = await fsp.readdir(dir)
    return files.some(f => f.endsWith('.vue'))
  } catch { return false }
}

async function findVueFile(dir: string, componentName: string): Promise<string | null> {
  // Try exact match first
  const exact = path.join(dir, `${componentName}.vue`)
  if (fs.existsSync(exact)) return exact
  // Try any .vue file — historically Base*.vue was skipped (assumed abstract), but that's wrong:
  // real component libs use BaseButton.vue etc. as the concrete component file.
  try {
    const files = await fsp.readdir(dir)
    const vue = files.find(f => f.endsWith('.vue'))
    return vue ? path.join(dir, vue) : null
  } catch { return null }
}

/**
 * Test-only surface. Not part of the public API — the `__` prefix signals this.
 * Consumers should use scanComponentLibraries() / generateComponentManifest() only.
 */
export const __testInternals__ = {
  extractPropsFromDts,
  extractPropsFromDtsViaTs,
  extractSlotsFromVueContent,
  extractEventsFromVueContent,
  extractComponentJsDoc,
  scanFromCem,
  categorizeComponent,
  findVueFile,
}
