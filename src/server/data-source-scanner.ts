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

const CACHE_TTL_MS = 60_000
const MAX_FILES_SCANNED = 2000
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
  // 1. Read package.json deps
  const deps = await readDeps(projectRoot)
  const libraryCandidates: Array<{ name: string; version?: string; patterns: string[] }> = []
  for (const depName of Object.keys(deps)) {
    const patterns = DATA_LIB_PATTERNS[depName]
    if (patterns) libraryCandidates.push({ name: depName, version: deps[depName], patterns })
  }

  // 2. Walk src/ and read every candidate file into memory once
  const srcDir = nodePath.join(projectRoot, 'src')
  const scanRoot = fs.existsSync(srcDir) ? srcDir : projectRoot
  const files: string[] = []
  await walk(scanRoot, files)

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
    const rel = nodePath.relative(projectRoot, fp).replace(/\\/g, '/')
    detectEntries(rel, content, entries)
  }

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
      const relFp = nodePath.relative(projectRoot, fp).replace(/\\/g, '/')
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
