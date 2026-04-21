/**
 * Project-wide data source catalog — the data-library equivalent of
 * component-scanner.ts. Discovers:
 *   (a) data-fetching libraries from package.json (React Query, SWR, Pinia,
 *       svelte/store, solid-js, astro, etc.)
 *   (b) project-specific entries in src/ (user composables, stores, signals,
 *       fetch wrappers, GraphQL operations, tRPC routers)
 *   (c) per-entry usage counts so agents can rank by "load-bearing" vs
 *       "defined-but-unused"
 *
 * Framework-neutral by design — pattern tables below cover Vue, React,
 * Svelte, Solid, Astro, htmx, plus framework-agnostic tools (axios, ofetch,
 * GraphQL). Best-effort regex; no AST. Cache + inflight coalescing mirrors
 * scanComponentLibraries (src/server/component-scanner.ts:178-188).
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import nodePath from 'node:path'
import type { DataSource, DataSourceCatalog, DataSourceLibrary, ProjectDataEntry } from '../schema.js'
import { resolveWorkspace } from './workspace.js'

const CACHE_TTL_MS = 60_000
const MAX_FILES_SCANNED = 5000
const SCAN_EXTS = new Set(['.vue', '.tsx', '.jsx', '.ts', '.js', '.svelte', '.astro', '.html', '.mjs'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.annotask', '.next', '.nuxt', 'coverage', '.vite', '.turbo', '.svelte-kit', '.output'])

/**
 * Known data / state libraries and the identifiers we recognize them by.
 * When a project depends on one of these, any of these identifiers found in
 * src/ is attributed to the library — but only if the library shows up AND
 * at least one identifier is actually used in source.
 *
 * Covers Vue, React, Svelte, Solid, Astro, htmx, plus framework-agnostic
 * tools (axios, ofetch, GraphQL clients).
 */
export const DATA_LIB_PATTERNS: Record<string, string[]> = {
  // React Query / TanStack Query (all framework flavors)
  '@tanstack/react-query':    ['useQuery', 'useMutation', 'useInfiniteQuery', 'useQueryClient', 'useSuspenseQuery'],
  '@tanstack/vue-query':      ['useQuery', 'useMutation', 'useQueryClient'],
  '@tanstack/solid-query':    ['createQuery', 'createMutation', 'createInfiniteQuery'],
  '@tanstack/svelte-query':   ['createQuery', 'createMutation'],
  '@sveltestack/svelte-query':['useQuery', 'useMutation'],
  // SWR family
  'swr':                      ['useSWR', 'useSWRMutation', 'useSWRInfinite'],
  // GraphQL clients
  '@apollo/client':           ['useQuery', 'useMutation', 'useLazyQuery', 'gql'],
  'urql':                     ['useQuery', 'useMutation', 'gql'],
  '@urql/vue':                ['useQuery', 'useMutation'],
  '@urql/svelte':             ['queryStore', 'mutationStore', 'gql'],
  'graphql-request':          ['GraphQLClient', 'gql', 'request'],
  // HTTP clients
  'axios':                    ['axios.get', 'axios.post', 'axios.put', 'axios.delete', 'axios.patch', 'axios.request'],
  'ofetch':                   ['ofetch', '$fetch'],
  // State stores
  'pinia':                    ['defineStore', 'storeToRefs'],
  'vuex':                     ['createStore', 'useStore'],
  'zustand':                  ['create', 'createStore'],
  '@reduxjs/toolkit':         ['createSlice', 'createApi', 'useSelector', 'useDispatch'],
  'react-redux':              ['useSelector', 'useDispatch', 'connect'],
  'jotai':                    ['atom', 'useAtom', 'useAtomValue', 'useSetAtom'],
  'valtio':                   ['proxy', 'useSnapshot'],
  'mobx':                     ['observable', 'computed', 'action'],
  // Solid primitives + ecosystem
  'solid-js':                 ['createSignal', 'createMemo', 'createEffect', 'createResource', 'createStore'],
  '@solidjs/router':          ['useParams', 'useSearchParams', 'useLocation', 'useNavigate', 'useRouteData'],
  // Svelte primitives + ecosystem
  'svelte':                   ['writable', 'readable', 'derived', 'tweened', 'spring'],
  'svelte/store':             ['writable', 'readable', 'derived', 'get'],
  '$app/stores':              ['page', 'navigating', 'updated'],
  // Vue routers
  'vue-router':               ['useRoute', 'useRouter'],
  'pinia-plugin-persistedstate': [],
  // React routers + frameworks
  'react-router-dom':         ['useParams', 'useSearchParams', 'useLoaderData', 'useNavigate', 'useRouteLoaderData'],
  'react-router':             ['useParams', 'useSearchParams', 'useLoaderData', 'useNavigate'],
  '@remix-run/react':         ['useLoaderData', 'useActionData', 'useFetcher', 'useRouteLoaderData'],
  'next':                     ['useRouter', 'useSearchParams', 'useParams', 'usePathname'],
  // tRPC
  '@trpc/client':             ['trpc', 'createTRPCClient'],
  '@trpc/react-query':        ['trpc'],
  '@trpc/next':               ['trpc'],
  // htmx — attribute-driven, detected by HTML attribute scan (see htmx pattern below)
  'htmx.org':                 ['htmx'],
}

/**
 * Library name → canonical kind. First match wins.
 * Patterns that are per-identifier (like `gql`) override via `resolveLibKind`.
 */
export const LIB_NAME_TO_KIND: Array<[RegExp, DataSource['kind']]> = [
  [/^(@tanstack\/(react|vue|solid|svelte)-query|@sveltestack\/svelte-query|swr|@apollo\/client|urql|@urql\/)/, 'composable'],
  [/^(graphql-request|graphql)$/, 'graphql'],
  [/^(pinia|vuex|zustand|@reduxjs\/toolkit|react-redux|jotai|valtio|mobx|svelte\/store|svelte|\$app\/stores)$/, 'store'],
  [/^(axios|ofetch)$/, 'fetch'],
  [/^(vue-router|react-router-dom|react-router|@solidjs\/router|next)$/, 'loader'],
  [/^(@remix-run\/)/, 'loader'],
  [/^(solid-js)$/, 'signal'],
  [/^(@trpc\/)/, 'rpc'],
  [/^htmx\.org$/, 'fetch'],
]

export function libKind(libName: string, patternName: string): DataSource['kind'] {
  if (patternName === 'gql' || patternName === 'graphql') return 'graphql'
  if (patternName === 'trpc' || /^createTRPC/.test(patternName)) return 'rpc'
  if (/^create(Signal|Memo|Effect|Resource|Store)$/.test(patternName)) {
    // createResource is async; keep it as composable-like for agent mental model.
    // createStore is shared state; keep as store.
    if (patternName === 'createResource') return 'composable'
    if (patternName === 'createStore') return 'store'
    return 'signal'
  }
  if (/^(writable|readable|derived|tweened|spring)$/.test(patternName)) return 'store'
  for (const [re, kind] of LIB_NAME_TO_KIND) if (re.test(libName)) return kind
  return 'composable'
}

let cachedCatalog: DataSourceCatalog | null = null
let cachedAt = 0
let inflight: Promise<DataSourceCatalog> | null = null

export function clearDataSourceCache() {
  cachedCatalog = null
  cachedAt = 0
  inflight = null
  viteProxyDirCache.clear()
}

export async function scanDataSources(projectRoot: string): Promise<DataSourceCatalog> {
  if (cachedCatalog && Date.now() - cachedAt < CACHE_TTL_MS) return cachedCatalog
  if (inflight) return inflight
  inflight = scanDataSourcesUncached(projectRoot).finally(() => { inflight = null })
  const result = await inflight
  cachedCatalog = result
  cachedAt = Date.now()
  return result
}

async function scanDataSourcesUncached(projectRoot: string): Promise<DataSourceCatalog> {
  // 1. Read package.json deps across every workspace package
  const ws = await resolveWorkspace(projectRoot)
  const deps: Record<string, string> = {}
  for (const pkgDir of ws.packages) {
    const pkgDeps = await readDeps(pkgDir)
    for (const [name, v] of Object.entries(pkgDeps)) {
      if (!deps[name]) deps[name] = v
    }
  }
  const libraryCandidates: Array<{ name: string; version?: string; patterns: string[] }> = []
  for (const depName of Object.keys(deps)) {
    const patterns = DATA_LIB_PATTERNS[depName]
    if (patterns) libraryCandidates.push({ name: depName, version: deps[depName], patterns })
  }

  // 2. Walk src/ of every workspace package and read every candidate file
  //    into memory once. Paths are relativized against the workspace root so
  //    cross-MFE references resolve unambiguously.
  const relRoot = ws.root
  const files: string[] = []
  for (const pkgDir of ws.packages) {
    const srcDir = nodePath.join(pkgDir, 'src')
    const scanRoot = fs.existsSync(srcDir) ? srcDir : pkgDir
    await walk(scanRoot, files)
    if (files.length >= MAX_FILES_SCANNED) break
  }

  const fileContents = new Map<string, string>()
  for (const fp of files) {
    try { fileContents.set(fp, await fsp.readFile(fp, 'utf-8')) } catch { /* skip */ }
  }

  // 3. Confirm each library candidate is actually used in src/
  const confirmedLibraries: DataSourceLibrary[] = []
  for (const cand of libraryCandidates) {
    const usedPatterns: string[] = []
    for (const pat of cand.patterns) {
      const re = pat.includes('.')
        ? new RegExp(`\\b${escapeRegex(pat.replace(/\./g, '\\.'))}\\s*\\(`)
        : new RegExp(`\\b${escapeRegex(pat)}\\b`)
      for (const content of fileContents.values()) {
        if (re.test(content)) { usedPatterns.push(pat); break }
      }
    }
    // Htmx is attribute-only — look for `hx-get=` / `hx-post=` in any HTML-ish file.
    if (cand.name === 'htmx.org' && usedPatterns.length === 0) {
      const htmxRe = /\shx-(?:get|post|put|patch|delete|swap|target|trigger|vals|include)\s*=/
      for (const content of fileContents.values()) {
        if (htmxRe.test(content)) { usedPatterns.push('hx-*'); break }
      }
    }
    if (usedPatterns.length > 0) {
      confirmedLibraries.push({ name: cand.name, version: cand.version, detected_patterns: usedPatterns })
    }
  }

  // 4. Detect project-specific entries
  const entries: ProjectDataEntry[] = []
  for (const [fp, content] of fileContents) {
    const rel = nodePath.relative(relRoot, fp).replace(/\\/g, '/')
    detectEntries(rel, content, entries)
  }

  // 4b. Resolve path-only endpoints (`/api/health`) against the nearest Vite
  //     config's server.proxy so downstream highlight matching can compare
  //     origins. Without this, every MFE's `/api/*` fetch matches every
  //     schema that exposes `/api/*`.
  await resolveEntryEndpoints(entries, relRoot)

  // 5. used_count — ONE pass per file with a combined alternation regex over
  //    all entry names. Skips the defining line for each entry.
  if (entries.length > 0) {
    const nameIndex = new Map<string, ProjectDataEntry[]>()
    for (const entry of entries) {
      const list = nameIndex.get(entry.name) ?? []
      list.push(entry)
      nameIndex.set(entry.name, list)
    }
    const names = [...nameIndex.keys()]
    const combined = new RegExp(`\\b(${names.map(escapeRegex).join('|')})\\b`, 'g')
    for (const [fp, content] of fileContents) {
      const relFp = nodePath.relative(relRoot, fp).replace(/\\/g, '/')
      combined.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = combined.exec(content)) !== null) {
        const name = m[1]
        const list = nameIndex.get(name)
        if (!list) continue
        // Compute line of the match once
        let matchLine: number | undefined
        for (const entry of list) {
          if (entry.file === relFp) {
            if (matchLine === undefined) matchLine = content.slice(0, m.index).split('\n').length
            if (matchLine === entry.line) continue  // skip the definition line
          }
          entry.used_count++
        }
      }
    }
  }

  entries.sort((a, b) => b.used_count - a.used_count || a.name.localeCompare(b.name))

  return {
    libraries: confirmedLibraries,
    project_entries: entries,
    scannedAt: Date.now(),
  }
}

// ── Helpers ────────────────────────────────────────────

async function readDeps(projectRoot: string): Promise<Record<string, string>> {
  try {
    const pkg = JSON.parse(await fsp.readFile(nodePath.join(projectRoot, 'package.json'), 'utf-8'))
    return { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  } catch { return {} }
}

async function walk(dir: string, acc: string[]): Promise<void> {
  if (acc.length >= MAX_FILES_SCANNED) return
  let entries: fs.Dirent[]
  try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (acc.length >= MAX_FILES_SCANNED) return
    if (SKIP_DIRS.has(entry.name)) continue
    if (entry.name.startsWith('.')) continue
    const full = nodePath.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, acc)
    } else if (entry.isFile()) {
      if (SCAN_EXTS.has(nodePath.extname(entry.name))) acc.push(full)
    }
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ── Vite proxy resolution ─────────────────────────────
// Keyed by absolute directory — caches either the parsed proxy map (possibly
// empty) for a dir containing a vite.config, or `null` when no config was
// found at/above that dir. Lives for the process lifetime; cleared alongside
// the catalog cache.
const viteProxyDirCache = new Map<string, ProxyMap | null>()

/** Ordered list of `{ prefix, target }` entries from `server.proxy`. Longest
 *  prefix wins when multiple rules match a path. */
type ProxyMap = Array<{ prefix: string; target: string }>

/**
 * For every entry with a path-only endpoint, walk up from its file to find
 * the nearest `vite.config.[tj]s` and rewrite `/api/foo` → `<target>/api/foo`
 * using that config's `server.proxy`. The rewritten URL is stored on
 * `resolved_endpoint` so display stays unchanged.
 *
 * Best-effort regex parse — we only handle the common shorthand
 * (`'/api': { target: 'http://localhost:4320', ... }` / `'/api': 'http://...'`)
 * and literal string keys. Function rewriters and regex keys are out of scope;
 * those entries simply keep `endpoint` as-is and fall through to the old
 * path-only matching.
 */
async function resolveEntryEndpoints(entries: ProjectDataEntry[], workspaceRoot: string): Promise<void> {
  for (const entry of entries) {
    const endpoint = entry.endpoint
    if (!endpoint) continue
    if (!endpoint.startsWith('/')) continue  // already absolute or opaque
    const absFile = nodePath.join(workspaceRoot, entry.file)
    const proxies = await loadNearestProxyMap(nodePath.dirname(absFile), workspaceRoot)
    if (!proxies || proxies.length === 0) continue
    // Longest-prefix match — mirrors Vite's own http-proxy resolution order.
    const match = proxies
      .filter(p => endpoint === p.prefix || endpoint.startsWith(p.prefix + '/') || endpoint.startsWith(p.prefix))
      .sort((a, b) => b.prefix.length - a.prefix.length)[0]
    if (!match) continue
    try {
      const base = new URL(match.target)
      entry.resolved_endpoint = new URL(endpoint, base).toString()
    } catch { /* malformed target — skip */ }
  }
}

async function loadNearestProxyMap(startDir: string, stopDir: string): Promise<ProxyMap | null> {
  const stopAbs = nodePath.resolve(stopDir)
  let dir = nodePath.resolve(startDir)
  const visited: string[] = []
  while (true) {
    const cached = viteProxyDirCache.get(dir)
    if (cached !== undefined) {
      for (const v of visited) viteProxyDirCache.set(v, cached)
      return cached
    }
    visited.push(dir)
    const cfg = await readViteProxyAt(dir)
    if (cfg) {
      for (const v of visited) viteProxyDirCache.set(v, cfg)
      return cfg
    }
    if (dir === stopAbs) break
    const parent = nodePath.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  for (const v of visited) viteProxyDirCache.set(v, null)
  return null
}

async function readViteProxyAt(dir: string): Promise<ProxyMap | null> {
  for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs']) {
    const full = nodePath.join(dir, name)
    try {
      const raw = await fsp.readFile(full, 'utf-8')
      return parseViteProxy(raw)
    } catch { /* not present */ }
  }
  return null
}

/**
 * Extract `server.proxy` entries from a vite.config source. Handles:
 *   proxy: {
 *     '/api': { target: 'http://localhost:4320', changeOrigin: true },
 *     '/graphql': 'http://localhost:4321',
 *   }
 * Returns `[]` when the file exists but has no proxy block (so callers can
 * distinguish "no config" from "config, no proxies").
 */
export function parseViteProxy(source: string): ProxyMap {
  const proxyBlock = extractBalancedBlock(source, /\bproxy\s*:\s*\{/)
  if (!proxyBlock) return []
  const out: ProxyMap = []
  // Match `'/api': { ... target: 'url' ... }` and `'/api': 'url'`.
  const objRe = /(['"`])([^'"`]+)\1\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g
  let m: RegExpExecArray | null
  while ((m = objRe.exec(proxyBlock)) !== null) {
    const prefix = m[2]
    const body = m[3]
    const targetMatch = body.match(/\btarget\s*:\s*(['"`])([^'"`]+)\1/)
    if (targetMatch && looksLikeHttpUrl(targetMatch[2])) {
      out.push({ prefix, target: targetMatch[2] })
    }
  }
  const strRe = /(['"`])([^'"`]+)\1\s*:\s*(['"`])([^'"`]+)\3(?=\s*[,}])/g
  let s: RegExpExecArray | null
  while ((s = strRe.exec(proxyBlock)) !== null) {
    const prefix = s[2]
    const target = s[4]
    if (!looksLikeHttpUrl(target)) continue
    if (out.some(p => p.prefix === prefix)) continue
    out.push({ prefix, target })
  }
  return out
}

function looksLikeHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s)
}

function extractBalancedBlock(source: string, startRe: RegExp): string | null {
  const m = startRe.exec(source)
  if (!m) return null
  let i = m.index + m[0].length  // points at char after '{'
  let depth = 1
  const start = i
  while (i < source.length) {
    const c = source[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return source.slice(start, i)
    }
    i++
  }
  return null
}

/**
 * Patterns for project-specific entries. Each returns { kind, name, line, endpoint? }.
 * Ordered roughly by specificity — the first match against a given definition wins
 * inside detectEntries (which walks patterns in declaration order).
 *
 * Framework coverage:
 *   - React / Vue composables (use*)
 *   - Svelte stores (writable / readable / derived)
 *   - Solid primitives (createSignal / createResource / createStore / createQuery)
 *   - Pinia / Zustand / Jotai stores
 *   - GraphQL operations (gql / graphql tags)
 *   - tRPC routers
 *   - Generic fetch wrappers in api-ish directories (gated below by API_DIR_RE)
 */
const ENTRY_PATTERNS: Array<{ re: RegExp; kind: DataSource['kind'] }> = [
  // React hooks / Vue composables: `export function useFoo(...)`
  { re: /\bexport\s+function\s+(use[A-Z][A-Za-z0-9_$]*)\s*\(/g, kind: 'composable' },
  // React hooks / Vue composables: `export const useFoo = (` / `= async (` / `= function`
  { re: /\bexport\s+const\s+(use[A-Z][A-Za-z0-9_$]*)\s*=\s*(?:\(|async\s*\(|function)/g, kind: 'composable' },
  // Pinia stores: `export const useFooStore = defineStore('foo', ...)`
  { re: /\bexport\s+const\s+(use[A-Z][A-Za-z0-9_$]*)\s*=\s*defineStore\s*\(/g, kind: 'store' },
  // Zustand stores: `export const useFooStore = create(...)` (zustand or zustand-like)
  { re: /\bexport\s+const\s+(use[A-Z][A-Za-z0-9_$]*Store)\s*=\s*create(?:Store)?(?:<[^>]+>)?\s*\(/g, kind: 'store' },
  // Jotai atoms: `export const fooAtom = atom(`
  { re: /\bexport\s+const\s+([a-z][A-Za-z0-9_$]*Atom)\s*=\s*atom\s*\(/g, kind: 'store' },
  // Svelte stores: `export const foo = writable(...)` / `readable(...)` / `derived(...)`
  { re: /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:writable|readable|derived|tweened|spring)\s*\(/g, kind: 'store' },
  // Solid signals: `export const [foo, setFoo] = createSignal(...)`
  { re: /\bexport\s+const\s+\[\s*([A-Za-z_$][\w$]*)\s*,[^\]]*\]\s*=\s*createSignal\s*\(/g, kind: 'signal' },
  // Solid resources: `export const [foo] = createResource(...)`  (treat as composable — async data)
  { re: /\bexport\s+const\s+\[\s*([A-Za-z_$][\w$]*)(?:\s*,[^\]]*)?\]\s*=\s*createResource\s*\(/g, kind: 'composable' },
  // Solid stores: `export const [foo, setFoo] = createStore(...)`
  { re: /\bexport\s+const\s+\[\s*([A-Za-z_$][\w$]*)\s*,[^\]]*\]\s*=\s*createStore\s*\(/g, kind: 'store' },
  // GraphQL: `export const FooQuery = gql`...`` / graphql tag variants
  { re: /\bexport\s+const\s+([A-Z][A-Za-z0-9_$]*(?:Query|Mutation|Fragment|Subscription))\s*=\s*(?:gql|graphql)\s*[`(]/g, kind: 'graphql' },
  // tRPC router definitions: `export const fooRouter = createTRPCRouter(`
  { re: /\bexport\s+const\s+([a-z][A-Za-z0-9_$]*Router)\s*=\s*createTRPCRouter\s*\(/g, kind: 'rpc' },
]

// Generic fetch wrappers — broader directory gate so projects that don't use
// the Vite/React `src/api/` convention still get coverage.
const FETCH_WRAPPER_RE = /\bexport\s+(?:async\s+)?function\s+([a-z][A-Za-z0-9_$]*)\s*\(/g
const API_DIR_RE = /(^|\/)(api|queries|services|requests|endpoints|fetchers|repositories|resources)(\/|$)|(^|\/)(lib|shared|utils)\/(api|fetch|http|rpc)\b|(^|\/)(app|pages)\/api\//

function detectEntries(file: string, content: string, acc: ProjectDataEntry[]): void {
  for (const { re, kind } of ENTRY_PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      const name = m[1]
      const line = content.slice(0, m.index).split('\n').length
      const endpoint = extractEndpointNear(content, m.index + m[0].length)
      acc.push({ kind, name, file, line, endpoint, used_count: 0 })
    }
  }

  // Fetch wrappers only in API-ish files or files whose body does real HTTP.
  const apiLike = API_DIR_RE.test(file)
  const bodyDoesHttp = apiLike || /\b(fetch|axios\.(get|post|put|patch|delete)|ofetch|\$fetch)\s*\(/.test(content)
  if (apiLike || bodyDoesHttp) {
    FETCH_WRAPPER_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = FETCH_WRAPPER_RE.exec(content)) !== null) {
      const name = m[1]
      if (/^use[A-Z]/.test(name)) continue                 // caught by composable patterns
      // Only count this as a fetch wrapper if the function body contains a
      // real HTTP call nearby. Avoids cataloging every exported utility.
      const body = content.slice(m.index, m.index + 600)
      if (!/\b(fetch|axios\.(get|post|put|patch|delete)|ofetch|\$fetch|GraphQLClient)\s*\(/.test(body)) continue
      const line = content.slice(0, m.index).split('\n').length
      const endpoint = extractEndpointNear(content, m.index + m[0].length)
      acc.push({ kind: 'fetch', name, file, line, endpoint, used_count: 0 })
    }
  }

  // Inline fetch/axios calls in component files and scripts. Surfaces
  // ad-hoc HTTP usage (e.g. `fetch('/api/health')` inside App.vue) so the
  // data catalog isn't empty for demo apps without explicit data wrappers.
  // One entry per unique endpoint per file — deduped by endpoint.
  const isComponentish = /\.(vue|tsx|jsx|svelte|astro|ts|js|mjs)$/.test(file)
  if (isComponentish) {
    // First collect any file-local base-URL constants (`const API_BASE =
    // 'http://localhost:4320'`). Stress-lab MFEs use this exact pattern so
    // `${API_BASE}/api/health` in the fetch args can be resolved back to a
    // full URL. Without it, /api/health collides across every service that
    // happens to expose the same path.
    const baseUrls = new Map<string, string>()
    const baseUrlRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*['"`](https?:\/\/[^'"`]+)['"`]/g
    let bm: RegExpExecArray | null
    while ((bm = baseUrlRe.exec(content)) !== null) {
      baseUrls.set(bm[1], bm[2].replace(/\/+$/, ''))
    }

    // Also collect URL/path string constants so `fetch(LIST_URL, …)` — where
    // LIST_URL is declared earlier as `const LIST_URL = '/api/items?…'` —
    // still produces a catalog entry. Without this, any fetch whose URL is
    // bound to a named constant is silently dropped (issue #29).
    const urlConstants = new Map<string, string>()
    const urlConstRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+)?=\s*['"`]((?:https?:\/\/|\/)[^'"`]+)['"`]/g
    let uc: RegExpExecArray | null
    while ((uc = urlConstRe.exec(content)) !== null) {
      urlConstants.set(uc[1], uc[2])
    }

    const seenEndpoints = new Set<string>()
    const pushEndpoint = (args: string, index: number) => {
      const endpoint = extractEndpointFromArgs(args, baseUrls, urlConstants)
      if (!endpoint) return
      if (seenEndpoints.has(endpoint)) return
      seenEndpoints.add(endpoint)
      const line = content.slice(0, index).split('\n').length
      const hint_symbols = collectHintSymbols(content, index)
      acc.push({
        kind: 'fetch',
        name: endpointToName(endpoint),
        display_name: endpointToDisplayName(endpoint),
        file,
        line,
        endpoint,
        used_count: 0,
        ...(hint_symbols.length > 0 ? { hint_symbols } : {}),
      })
    }

    // Direct calls: fetch('/x'), axios.get('...'), ofetch(...), $fetch(...).
    const inlineCallRe = /\b(fetch|axios\.(?:get|post|put|patch|delete)|ofetch|\$fetch)\s*\(([\s\S]{0,400}?)\)/g
    let m: RegExpExecArray | null
    while ((m = inlineCallRe.exec(content)) !== null) pushEndpoint(m[2], m.index)

    // Two-step builds: `const url = new URL(`${API_BASE}/x`); fetch(url)`.
    // Common pattern when callers append searchParams before dispatching —
    // without this scan pass those endpoints are invisible, so every service
    // whose main route is constructed this way loses its catalog entry.
    const urlCtorRe = /\bnew\s+URL\s*\(([\s\S]{0,400}?)\)/g
    while ((m = urlCtorRe.exec(content)) !== null) pushEndpoint(m[1], m.index)

    // htmx attributes: `hx-get="/api/foo"`, `hx-post`, etc. Each is
    // effectively a declarative fetch, so surface them in the catalog too.
    // Only scanned in markup-capable files; the attribute value may be a
    // bare path ("/api/health-fragment") or a full URL ("http://host/...").
    const isMarkupish = /\.(vue|svelte|astro|html)$/.test(file)
    if (isMarkupish) {
      const hxAttrRe = /\shx-(?:get|post|put|patch|delete)\s*=\s*['"]([^'"]+)['"]/gi
      while ((m = hxAttrRe.exec(content)) !== null) {
        const raw = m[1]
        // Skip bindings like hx-get="{{ dynamic }}" that aren't concrete.
        if (raw.includes('{') || raw.includes('$')) continue
        pushEndpoint(`"${raw}"`, m.index)
      }
    }
  }
}

/**
 * Identify the local variable(s) that hold an inline fetch's result so the
 * binding analyzer has a real identifier to trace into template / JSX. The
 * endpoint-derived entry name (`apiHealth`) never appears in source, so
 * without these hints the analyzer finds nothing and the Data tab stays
 * silent on the stress-lab's inline-fetch pattern.
 *
 * Strategy:
 *   1. Locate every `await …json()` in the ~300-char window after the
 *      fetch call (that's the expression that actually produces the data).
 *   2. Walk back up to 120 chars to the LHS that stores the result —
 *      Vue's `name.value = `, Svelte/plain `name = `, JSX `setName(`, or
 *      `const name = (await …`.
 *   3. Add a bare `setName(body)` pass to catch React's two-step
 *      extract-then-set idiom where the awaited json was already bound
 *      to a local.
 * A blacklist strips common scratch names (`res`, `data`, `body`, etc.) so
 * the analyzer doesn't chase them through every MFE in the workspace.
 */
const HINT_BLACKLIST = new Set([
  'res', 'response', 'body', 'data', 'json', 'err', 'error',
  'loading', 'isLoading', 'result', 'raw', 'payload', 'out',
])

function collectHintSymbols(content: string, afterIndex: number): string[] {
  const window = content.slice(afterIndex, afterIndex + 500)
  const hints = new Set<string>()
  const add = (raw: string | undefined | null) => {
    if (!raw) return
    const name = raw.trim()
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) return
    if (name.length <= 1) return
    if (HINT_BLACKLIST.has(name)) return
    hints.add(name)
  }

  // Anchor 1: `await …json()` — walk back to whichever LHS actually catches
  // the body (Vue ref, React setter, or `const` local).
  const jsonAwaitRe = /await\s+[\w$.]+\.json\s*\(/g
  let m: RegExpExecArray | null
  while ((m = jsonAwaitRe.exec(window)) !== null) {
    const pre = window.slice(Math.max(0, m.index - 120), m.index)
    let sm: RegExpMatchArray | null
    if ((sm = pre.match(/set([A-Z][A-Za-z0-9_$]*)\s*\(\s*\(?[\s\S]*$/))) {
      add(sm[1][0].toLowerCase() + sm[1].slice(1))
    } else if ((sm = pre.match(/([a-zA-Z_$][\w$]*)\.value\s*=\s*\(?\s*$/))) {
      add(sm[1])
    } else if ((sm = pre.match(/(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*\(?\s*$/))) {
      add(sm[1])
    } else if ((sm = pre.match(/([a-zA-Z_$][\w$]*)\s*=\s*\(?\s*$/))) {
      add(sm[1])
    }
  }

  // Anchor 2: `return X.json()` in an `async function foo() { … }`. Solid's
  // `createResource(_, fetchHealth)` / React Query's `queryFn: fetchHealth`
  // etc. consume the named fn, so the fn name becomes our trace seed.
  const returnJsonRe = /return\s+[\w$.]+\.json\s*\(/g
  while ((m = returnJsonRe.exec(window)) !== null) {
    const preStart = Math.max(0, afterIndex + m.index - 400)
    const pre = content.slice(preStart, afterIndex + m.index)
    const fnMatch = /async\s+function\s+([a-zA-Z_$][\w$]*)/.exec(pre)
    if (fnMatch) add(fnMatch[1])
  }

  // Anchor 3: React two-step idiom — `const body = await res.json(); setX(body)`.
  // Anchor 1 captures `body` (blacklisted), so we also look for `setX(local)`
  // directly and surface `x`.
  const setterOfLocalRe = /\bset([A-Z][A-Za-z0-9_$]*)\s*\(\s*[a-zA-Z_$][\w$]*\s*\)/g
  while ((m = setterOfLocalRe.exec(window)) !== null) {
    add(m[1][0].toLowerCase() + m[1].slice(1))
  }

  // Anchor 4: Vue two-step idiom — `const body = await res.json(); rows.value = body`.
  // Only matches `.value = <local>;` (followed by `;` / newline) so we don't
  // pick up `.value.foo = …` field writes.
  const valueOfLocalRe = /\b([a-zA-Z_$][\w$]*)\.value\s*=\s*[a-zA-Z_$][\w$]*\s*(?=[;\n\r}])/g
  while ((m = valueOfLocalRe.exec(window)) !== null) add(m[1])

  // Anchor 5: Vue one-step-to-object idiom — `status.value = { status: body.x, … }`.
  // Each field is populated from the awaited body, so the ref itself is still
  // the binding seed. Looser than Anchor 4 so structured assignments within
  // the fetch's post-await block also feed the analyzer.
  const valueOfObjectRe = /\b([a-zA-Z_$][\w$]*)\.value\s*=\s*[\{\(]/g
  while ((m = valueOfObjectRe.exec(window)) !== null) add(m[1])

  return [...hints]
}

/**
 * Pull a URL or path out of a fetch() argument list. Handles:
 *   • literal strings:     fetch('/api/health')
 *   • full URLs:           fetch('http://host/api/health')
 *   • template literals:   fetch(`${API_BASE}/api/health`)  ← resolves
 *                          when API_BASE is a known file-local const
 *   • bare identifiers:    fetch(LIST_URL, …)               ← resolves
 *                          when LIST_URL is a known file-local const
 *
 * Returns the most specific endpoint we can reconstruct (absolute URL when
 * possible, otherwise path). Absolute URLs preserve the host/port so the
 * shell can disambiguate two backends that expose the same path.
 */
function extractEndpointFromArgs(args: string, baseUrls: Map<string, string>, urlConstants?: Map<string, string>): string | null {
  // 1. Plain string literal containing a full URL.
  const fullUrlMatch = args.match(/['"](https?:\/\/[^\s'"]+)['"]/)
  if (fullUrlMatch) return fullUrlMatch[1]

  // 2. Template literal that starts with `${VAR}/api/...` where VAR is a
  //    known base-URL constant. Stress-lab MFEs use this pattern to point
  //    the same component at different ports.
  const tplMatch = args.match(/`\$\{([A-Za-z_$][\w$]*)\}(\/[^`]+)`/)
  if (tplMatch) {
    const base = baseUrls.get(tplMatch[1])
    const suffix = tplMatch[2]
    if (base) return base + suffix
    // Fallback: at least keep the path portion.
    if (/^\/(?:api|graphql|rpc|v\d)\//.test(suffix)) return suffix
  }

  // 3. Bare identifier as the first positional arg: `fetch(LIST_URL, …)`.
  //    Resolve against the file-local string-constant table built by the
  //    caller. Only accepts declarations whose value is a URL or a `/…`
  //    path so we don't misinterpret unrelated string consts.
  if (urlConstants && urlConstants.size > 0) {
    const idMatch = args.match(/^\s*([A-Za-z_$][\w$]*)\s*(?:[,)]|$)/)
    if (idMatch) {
      const resolved = urlConstants.get(idMatch[1])
      if (resolved) return resolved
    }
  }

  // 4. Legacy fallback — any string literal with an /api-ish path inside.
  const pathMatch = args.match(/['"`][^'"`]*?(\/(?:api|graphql|rpc|v\d)\/[\w\-/.{}:?=&]*)/)
  if (pathMatch) return pathMatch[1]
  return null
}

/**
 * Readable label for the Data view list — keeps host + port visible so the
 * user can tell same-path-different-host endpoints apart at a glance.
 *
 * Absolute URLs:         `localhost:4320 /api/health`
 * Host-only (rare):      `localhost:4320 /`
 * Relative paths:        `/api/health`
 */
function endpointToDisplayName(endpoint: string): string {
  const cleaned = endpoint.replace(/[?#].*$/, '')
  const hostMatch = cleaned.match(/^https?:\/\/([^/]+)(\/.*)?$/)
  if (hostMatch) {
    const host = hostMatch[1]
    const path = hostMatch[2] || '/'
    return `${host} ${path}`
  }
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`
}

/** Turn `/api/users/:id` or `https://host/api/workflows` into a camelCase identifier. */
function endpointToName(endpoint: string): string {
  // Preserve the port from absolute URLs so same-path endpoints on different
  // services (e.g. /api/health across five localhost ports) don't collapse to
  // a single name — that collision would hash to the same highlight color.
  const host = endpoint.match(/^https?:\/\/[^/]+/)?.[0] ?? ''
  const port = host.match(/:(\d+)/)?.[1]
  // Strip scheme+host, leading/trailing slashes, query/hash
  const path = endpoint
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/[?#].*$/, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\{[^}]+\}/g, '')
    .replace(/:[A-Za-z]\w*/g, '')
  const segments = path.split(/[\/\-_.]+/).filter(Boolean)
  const base = segments.length === 0
    ? 'fetch'
    : segments[0].toLowerCase() +
      segments.slice(1).map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join('')
  return port ? `${base}_${port}` : base
}

/**
 * Scan ~800 chars after a definition opener for the first string literal that
 * looks like an endpoint or query key. Best-effort: extracts things like
 * `fetch('/api/users')`, `defineStore('user', ...)`, `useQuery(['users'], ...)`,
 * `useQuery({ queryKey: ['users'] })`. Returns undefined when nothing looks right.
 */
function extractEndpointNear(content: string, fromIndex: number): string | undefined {
  const slice = content.slice(fromIndex, fromIndex + 800)
  // Object form: `{ queryKey: ['user', ...] }` or `{ queryKey: 'user' }`
  const objKey = slice.match(/queryKey\s*:\s*(?:\[\s*['"`]([^'"`]+)['"`]|['"`]([^'"`]+)['"`])/)
  if (objKey) return objKey[1] ?? objKey[2]
  // Leading path string
  const pathMatch = slice.match(/['"`](\/[\w\-/.:{}?=&]+|https?:\/\/[^'"`]+)['"`]/)
  if (pathMatch) return pathMatch[1]
  // First quoted string inside an array literal (positional useQuery(['users']))
  const arr = slice.match(/^\s*\[\s*['"`]([^'"`]+)['"`]/)
  if (arr) return arr[1]
  // First quoted string anywhere in the slice
  const keyMatch = slice.match(/['"`]([A-Za-z][\w\-/:]*)['"`]/)
  if (keyMatch) return keyMatch[1]
  return undefined
}
