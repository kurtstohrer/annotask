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

/**
 * Scanner-only provenance metadata not yet promoted to the shared schema
 * (`../schema.ts`). Structurally a superset of `ProjectDataEntry`, so arrays
 * of `ScannedEntry` are still assignable to `ProjectDataEntry[]` wherever the
 * catalog is returned — consumers that don't know about these fields simply
 * don't see them.
 */
type ScannedEntry = ProjectDataEntry & {
  /** How `endpoint` (or `query_key`) was derived. Never silently assumed —
   *  'guess' marks the low-confidence "first quoted string" fallbacks so
   *  downstream consumers can discount them. */
  endpoint_source?: 'url' | 'literal-path' | 'query-key' | 'guess'
  /** A TanStack/SWR-style queryKey, when that's all we found. Kept separate
   *  from `endpoint` so a queryKey (an identifier, not a URL) is never
   *  mistaken for a fetchable endpoint. */
  query_key?: string
  /** Whether `method` reflects a real signal (explicit verb / axios.verb /
   *  htmx attribute) as opposed to the HTTP-default ('GET') fallback. */
  method_known?: boolean
}

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
  // Astro Content Collections — the framework's own data-loading API.
  'astro':                    ['getCollection', 'getEntry', 'getEntryBySlug', 'getStaticPaths'],
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
  [/^astro$/, 'loader'],
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
  // 1. Read package.json deps for the RUNNING package only. Aggregating every
  //    workspace package surfaced sibling apps' data libraries + entries (a Vue
  //    app would show another app's hooks and endpoints), polluting the catalog
  //    and the on-page data highlights — the same over-reach fixed in the
  //    component scanner. Run an MFE/app directly to scan its own data sources.
  const ws = await resolveWorkspace(projectRoot)
  const deps: Record<string, string> = await readDeps(projectRoot)
  const libraryCandidates: Array<{ name: string; version?: string; patterns: string[] }> = []
  for (const depName of Object.keys(deps)) {
    const patterns = DATA_LIB_PATTERNS[depName]
    if (patterns) libraryCandidates.push({ name: depName, version: deps[depName], patterns })
  }

  // 2. Walk the running package's src/ once to enumerate files. Paths are
  //    relativized against the workspace root (`ws.root`) so they stay
  //    workspace-relative for the shell's currentDir translation. Content is
  //    read and released per-file below (see step 3) — never all held in
  //    memory simultaneously, since MAX_FILES_SCANNED (5000) full files would
  //    otherwise sit cached at once.
  const relRoot = ws.root
  const files: string[] = []
  const absRoot = nodePath.resolve(projectRoot)
  const srcDir = nodePath.join(absRoot, 'src')
  const scanRoot = fs.existsSync(srcDir) ? srcDir : absRoot
  await walk(scanRoot, files)
  // htmx's canonical Vite location is a root-level index.html. When src/
  // exists, walk() above only sees src/ (scanRoot === srcDir), so the root
  // index.html — and any `<script src="…htmx…">` / hx-* markup in it — was
  // silently excluded from every project that also has a src/ dir. Add it
  // back explicitly.
  if (scanRoot !== absRoot) {
    const rootIndexHtml = nodePath.join(absRoot, 'index.html')
    if (fs.existsSync(rootIndexHtml) && !files.includes(rootIndexHtml)) files.push(rootIndexHtml)
  }

  // 3. Confirm each library candidate is actually used in src/, and detect
  //    project-specific entries — a single streaming pass per file so at
  //    most one file's content is resident at a time.
  const usedPatternsByCandidate = new Map<string, Set<string>>()
  for (const cand of libraryCandidates) usedPatternsByCandidate.set(cand.name, new Set())
  const htmxCandidate = libraryCandidates.find(c => c.name === 'htmx.org')
  let htmxAttrUsageSeen = false
  let htmxCdnScriptSeen = false
  const entries: ScannedEntry[] = []

  for (const fp of files) {
    let content: string
    try { content = await fsp.readFile(fp, 'utf-8') } catch { continue }

    // 3a. Library-identifier confirmation. Comments/strings are stripped
    //     first so a mention of `useQuery` in a comment, or `create` inside
    //     an unrelated string, doesn't false-confirm a library.
    if (libraryCandidates.length > 0) {
      const codeOnly = stripCommentsAndStrings(content)
      for (const cand of libraryCandidates) {
        const used = usedPatternsByCandidate.get(cand.name)!
        for (const pat of cand.patterns) {
          if (used.has(pat)) continue
          if (confirmationRegexFor(pat).test(codeOnly)) used.add(pat)
        }
      }
    }

    // 3b. htmx is attribute-driven (no JS identifier to match) and its
    //     canonical install is often a CDN <script> tag rather than an npm
    //     dependency — track both signals regardless of whether htmx.org
    //     showed up in package.json.
    if (!htmxAttrUsageSeen && HTMX_ATTR_RE.test(content)) htmxAttrUsageSeen = true
    if (!htmxCdnScriptSeen && HTMX_CDN_SCRIPT_RE.test(content)) htmxCdnScriptSeen = true

    // 3c. Project-specific entries.
    const rel = nodePath.relative(relRoot, fp).replace(/\\/g, '/')
    detectEntries(rel, content, entries)
  }

  const confirmedLibraries: DataSourceLibrary[] = []
  for (const cand of libraryCandidates) {
    const usedPatterns = [...usedPatternsByCandidate.get(cand.name)!]
    if (cand.name === 'htmx.org' && usedPatterns.length === 0 && htmxAttrUsageSeen) {
      usedPatterns.push('hx-*')
    }
    if (usedPatterns.length > 0) {
      confirmedLibraries.push({ name: cand.name, version: cand.version, detected_patterns: usedPatterns })
    }
  }
  // htmx via CDN <script> tag — no package.json entry to gate on at all, so
  // synthesize the library entry directly once both signals (the script tag
  // itself, and real hx-* attribute usage) are present.
  if (!htmxCandidate && htmxCdnScriptSeen && htmxAttrUsageSeen && !confirmedLibraries.some(l => l.name === 'htmx.org')) {
    confirmedLibraries.push({ name: 'htmx.org', detected_patterns: ['hx-*'] })
  }

  // 4. Resolve path-only endpoints (`/api/health`) against the nearest Vite
  //    config's server.proxy so downstream highlight matching can compare
  //    origins. Without this, every MFE's `/api/*` fetch matches every
  //    schema that exposes `/api/*`.
  await resolveEntryEndpoints(entries, relRoot)

  // 5. used_count — a second streaming pass per file (still no full-corpus
  //    retention):
  //      - name-keyed entries (composables/stores/…): scoped to same-file-
  //        only when the name is shared by more than one entry, since a
  //        shared name can't be safely attributed project-wide (that's the
  //        "colliding" counts bug — two unrelated `useData` composables were
  //        inflating each other's count).
  //      - fetch-kind entries: `name` is a synthetic, never-appears-in-source
  //        identifier (`apiUsers`), so used_count was permanently 0 for every
  //        one of them. `hint_symbols` are the real local identifiers that
  //        actually hold the fetched data — search for those instead, scoped
  //        to the entry's own file.
  if (entries.length > 0) {
    const nameIndex = new Map<string, ScannedEntry[]>()
    for (const entry of entries) {
      const list = nameIndex.get(entry.name) ?? []
      list.push(entry)
      nameIndex.set(entry.name, list)
    }
    const collidingNames = new Set(
      [...nameIndex.entries()].filter(([, list]) => list.length > 1).map(([n]) => n)
    )
    const names = [...nameIndex.keys()]
    const combined = names.length > 0 ? new RegExp(`\\b(${names.map(escapeRegex).join('|')})\\b`, 'g') : null
    const hintEntries = entries.filter(e => e.hint_symbols && e.hint_symbols.length > 0)

    for (const fp of files) {
      let content: string
      try { content = await fsp.readFile(fp, 'utf-8') } catch { continue }
      const relFp = nodePath.relative(relRoot, fp).replace(/\\/g, '/')

      if (combined) {
        combined.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = combined.exec(content)) !== null) {
          const name = m[1]
          const list = nameIndex.get(name)
          if (!list) continue
          const isColliding = collidingNames.has(name)
          // Compute line of the match once
          let matchLine: number | undefined
          for (const entry of list) {
            if (isColliding && entry.file !== relFp) continue  // can't safely attribute a shared name cross-file
            if (entry.file === relFp) {
              if (matchLine === undefined) matchLine = content.slice(0, m.index).split('\n').length
              if (matchLine === entry.line) continue  // skip the definition line
            }
            entry.used_count++
          }
        }
      }

      for (const entry of hintEntries) {
        if (entry.file !== relFp) continue
        const hintRe = new RegExp(`\\b(${entry.hint_symbols!.map(escapeRegex).join('|')})\\b`, 'g')
        let hm: RegExpExecArray | null
        while ((hm = hintRe.exec(content)) !== null) {
          const line = content.slice(0, hm.index).split('\n').length
          if (line === entry.line) continue  // skip the fetch call's own line
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

// htmx is attribute-driven — no JS identifier to confirm against. Detected
// two ways: real `hx-*` attribute usage, and the canonical CDN <script> tag
// (htmx's documented install path; frequently not an npm dependency at all).
const HTMX_ATTR_RE = /\shx-(?:get|post|put|patch|delete|swap|target|trigger|vals|include)\s*=/
const HTMX_CDN_SCRIPT_RE = /<script\b[^>]*\bsrc\s*=\s*["'][^"']*htmx[^"']*["'][^>]*>/i

// Common-English-word library identifiers that constantly false-confirm
// against comments and unrelated code (`create`, `computed`, `derived` all
// read as ordinary prose/variable names). Require call-shape for these.
const AMBIGUOUS_SINGLE_WORD_PATTERNS = new Set(['create', 'computed', 'derived'])
const confirmationRegexCache = new Map<string, RegExp>()

/**
 * Build (and cache) the identifier-confirmation regex for one library
 * pattern. Fixes three bugs in the previous version:
 *   - Dotted patterns (`axios.get`) were double-escaped: `escapeRegex`
 *     already escapes `.`, so re-escaping the caller's own
 *     `pat.replace(/\./g, '\\.')` turned `\.` into a literal backslash
 *     followed by "any character" — `axios.get(` could never match.
 *   - A leading `\b` before a pattern that starts with a non-word character
 *     (`$fetch`) can never match: `\b` needs a word/non-word transition, and
 *     typical call sites (` $fetch(`, `= $fetch(`, `($fetch`) have a
 *     non-word character on both sides of that position.
 *   - Common-English-word identifiers (see `AMBIGUOUS_SINGLE_WORD_PATTERNS`)
 *     require call-shape (`create(`) instead of a bare word match.
 */
function confirmationRegexFor(pat: string): RegExp {
  const cached = confirmationRegexCache.get(pat)
  if (cached) return cached
  const escaped = escapeRegex(pat)
  const lead = /^\w/.test(pat) ? '\\b' : ''
  const requiresCall = pat.includes('.') || AMBIGUOUS_SINGLE_WORD_PATTERNS.has(pat)
  const re = requiresCall ? new RegExp(`${lead}${escaped}\\s*\\(`) : new RegExp(`${lead}${escaped}\\b`)
  confirmationRegexCache.set(pat, re)
  return re
}

/**
 * Best-effort blank-out of line comments, block comments, and
 * string/template literal contents — length- and line-preserving so
 * downstream line-number math stays correct. Used before testing
 * library-confirmation regexes so a mention of `useQuery` in a comment, or
 * `create` inside an unrelated string, doesn't false-confirm a library.
 * Not a real tokenizer (doesn't know HTML/JSX comments) — cheap single-pass
 * best effort, not exhaustive.
 */
function stripCommentsAndStrings(content: string): string {
  let out = ''
  const n = content.length
  let i = 0
  while (i < n) {
    const c = content[i]
    const c2 = content[i + 1]
    if (c === '/' && c2 === '/') {
      while (i < n && content[i] !== '\n') { out += ' '; i++ }
      continue
    }
    if (c === '/' && c2 === '*') {
      out += '  '
      i += 2
      while (i < n && !(content[i] === '*' && content[i + 1] === '/')) {
        out += content[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < n) { out += '  '; i += 2 }
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out += ' '
      i++
      while (i < n) {
        if (content[i] === '\\') { out += '  '; i += 2; continue }
        if (content[i] === quote) { out += ' '; i++; break }
        out += content[i] === '\n' ? '\n' : ' '
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
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
// the Vite/React `src/api/` convention still get coverage. Two shapes:
// `export function getX(...)` / `export async function getX(...)`, and the
// arrow-const form that dominates modern codebases —
// `export const getX = async (id) => fetch(...)`.
const FETCH_WRAPPER_FN_RE = /\bexport\s+(?:async\s+)?function\s+([a-z][A-Za-z0-9_$]*)\s*\(/g
const FETCH_WRAPPER_ARROW_RE = /\bexport\s+const\s+([a-z][A-Za-z0-9_$]*)\s*(?::\s*[^=\n]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=\n]+)?=>/g
const API_DIR_RE = /(^|\/)(api|queries|services|requests|endpoints|fetchers|repositories|resources)(\/|$)|(^|\/)(lib|shared|utils)\/(api|fetch|http|rpc)\b|(^|\/)(app|pages)\/api\//

// What counts as "this code does real HTTP" for the fetch-wrapper gate.
// Covers direct calls (fetch/ofetch/$fetch/GraphQLClient) and "helper
// indirection" — a pre-configured client object (`apiClient.get(…)`,
// `httpClient.post(…)`) rather than a bare global identifier.
const HTTP_CALL_RE = /\b(?:fetch|ofetch|\$fetch|GraphQLClient)\s*\(|\b[A-Za-z_$]*(?:[Cc]lient|[Aa]pi|[Hh]ttp)[\w$]*\.(?:get|post|put|patch|delete)\s*\(/

function detectEntries(file: string, content: string, acc: ScannedEntry[]): void {
  for (const { re, kind } of ENTRY_PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      const name = m[1]
      const line = content.slice(0, m.index).split('\n').length
      const extracted = extractEndpointNear(content, m.index + m[0].length)
      acc.push({
        kind, name, file, line,
        endpoint: extracted.endpoint,
        ...(extracted.endpoint_source ? { endpoint_source: extracted.endpoint_source } : {}),
        ...(extracted.query_key ? { query_key: extracted.query_key } : {}),
        used_count: 0,
      })
    }
  }

  // Endpoints already claimed by a named fetch-wrapper detected below — the
  // inline-call pass skips these so the same real HTTP call isn't cataloged
  // twice (once under the wrapper's name, once again anonymously when the
  // inline scan finds the very same `fetch(...)` inside the wrapper's body).
  const claimedEndpoints = new Set<string>()

  // Fetch wrappers only in API-ish files or files whose body does real HTTP.
  const apiLike = API_DIR_RE.test(file)
  const bodyDoesHttp = apiLike || HTTP_CALL_RE.test(content)
  if (apiLike || bodyDoesHttp) {
    for (const wrapperRe of [FETCH_WRAPPER_FN_RE, FETCH_WRAPPER_ARROW_RE]) {
      wrapperRe.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = wrapperRe.exec(content)) !== null) {
        const name = m[1]
        if (/^use[A-Z]/.test(name)) continue                 // caught by composable patterns
        // Only count this as a fetch wrapper if the function body contains a
        // real HTTP call nearby. Avoids cataloging every exported utility.
        const body = content.slice(m.index, m.index + 600)
        if (!HTTP_CALL_RE.test(body)) continue
        const line = content.slice(0, m.index).split('\n').length
        const extracted = extractEndpointNear(content, m.index + m[0].length)
        if (extracted.endpoint) claimedEndpoints.add(extracted.endpoint)
        acc.push({
          kind: 'fetch', name, file, line,
          endpoint: extracted.endpoint,
          ...(extracted.endpoint_source ? { endpoint_source: extracted.endpoint_source } : {}),
          ...(extracted.query_key ? { query_key: extracted.query_key } : {}),
          used_count: 0,
        })
      }
    }
  }

  // Inline fetch/axios calls in component files and scripts. Surfaces
  // ad-hoc HTTP usage (e.g. `fetch('/api/health')` inside App.vue) so the
  // data catalog isn't empty for demo apps without explicit data wrappers.
  // One entry per unique endpoint per file — deduped by endpoint.
  const isComponentish = /\.(vue|tsx|jsx|svelte|astro|ts|js|mjs|html)$/.test(file)
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

    // Dedup by `(method, endpoint)` so GET + PATCH on the same path both
    // survive. A plain `endpoint` key silently drops the mutation when a
    // read call to the same URL appears earlier in the same file.
    const seenEndpoints = new Set<string>()
    const pushEndpoint = (args: string, index: number, method?: string, methodKnown?: boolean) => {
      const extracted = extractEndpointFromArgs(args, baseUrls, urlConstants)
      if (!extracted) return
      const { endpoint, source } = extracted
      if (claimedEndpoints.has(endpoint)) return  // already cataloged via a named wrapper above
      const key = `${method ?? ''} ${endpoint}`
      if (seenEndpoints.has(key)) return
      seenEndpoints.add(key)
      const line = content.slice(0, index).split('\n').length
      const hint_symbols = collectHintSymbols(content, index)
      acc.push({
        kind: 'fetch',
        name: endpointToName(endpoint),
        display_name: endpointToDisplayName(endpoint, method),
        file,
        line,
        endpoint,
        endpoint_source: source,
        ...(method ? { method, method_known: methodKnown ?? false } : {}),
        used_count: 0,
        ...(hint_symbols.length > 0 ? { hint_symbols } : {}),
      })
    }

    // Direct calls: fetch('/x'), axios.get('...'), ofetch(...), $fetch(...).
    // `fetch(...)` args often contain nested `()` from `encodeURIComponent`,
    // `JSON.stringify`, template expressions, etc. A non-greedy regex stops
    // at the first inner `)` and misses the options object, so
    // `extractCallArgs` walks forward from `(` balancing parens, strings, and
    // template backticks to capture the full argument list.
    const inlineCallRe = /\b(fetch|axios\.(?:get|post|put|patch|delete)|ofetch|\$fetch)\s*\(/g
    let m: RegExpExecArray | null
    while ((m = inlineCallRe.exec(content)) !== null) {
      const call = m[1]
      const argsStart = m.index + m[0].length
      const args = extractCallArgs(content, argsStart)
      if (args === null) continue
      const { method, method_known } = extractHttpMethod(call, args)
      pushEndpoint(args, m.index, method, method_known)
    }

    // Two-step builds: `const url = new URL(`${API_BASE}/x`); fetch(url)`.
    // Common pattern when callers append searchParams before dispatching —
    // without this scan pass those endpoints are invisible, so every service
    // whose main route is constructed this way loses its catalog entry.
    // No method is knowable from the URL ctor alone, so leave `method`
    // undefined — the accompanying `fetch(url, …)` call (captured by
    // inlineCallRe above) produces the method-bearing entry.
    const urlCtorRe = /\bnew\s+URL\s*\(([\s\S]{0,400}?)\)/g
    while ((m = urlCtorRe.exec(content)) !== null) pushEndpoint(m[1], m.index)

    // htmx attributes: `hx-get="/api/foo"`, `hx-post`, etc. Each is
    // effectively a declarative fetch, so surface them in the catalog too.
    // Only scanned in markup-capable files; the attribute value may be a
    // bare path ("/api/health-fragment") or a full URL ("http://host/...").
    const isMarkupish = /\.(vue|svelte|astro|html)$/.test(file)
    if (isMarkupish) {
      const hxAttrRe = /\shx-(get|post|put|patch|delete)\s*=\s*['"]([^'"]+)['"]/gi
      while ((m = hxAttrRe.exec(content)) !== null) {
        const verb = m[1].toUpperCase()
        const raw = m[2]
        // Skip bindings like hx-get="{{ dynamic }}" that aren't concrete.
        if (raw.includes('{') || raw.includes('$')) continue
        // The htmx attribute name IS the HTTP verb — always a known signal.
        pushEndpoint(`"${raw}"`, m.index, verb, true)
      }
    }
  }
}

/**
 * Walk forward from the `(` of a call expression and return the full argument
 * list (up to but not including the matching `)`). Balances nested parens,
 * brackets, and braces; skips over single/double/backtick strings and
 * template-literal `${…}` expressions so a `)` inside a string doesn't close
 * the call early. Returns `null` if the call is unterminated within
 * `MAX_ARGS_SPAN` chars (malformed / truncated source).
 */
const MAX_ARGS_SPAN = 2000
function extractCallArgs(source: string, start: number): string | null {
  const end = Math.min(source.length, start + MAX_ARGS_SPAN)
  let depth = 1
  let i = start
  while (i < end) {
    const c = source[i]
    if (c === '"' || c === "'") {
      i = skipString(source, i, c, end)
      if (i < 0) return null
      continue
    }
    if (c === '`') {
      i = skipTemplate(source, i, end)
      if (i < 0) return null
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') {
      depth--
      if (depth === 0) return source.slice(start, i)
    }
    i++
  }
  return null
}

function skipString(source: string, i: number, quote: string, end: number): number {
  i++
  while (i < end) {
    const c = source[i]
    if (c === '\\') { i += 2; continue }
    if (c === quote) return i + 1
    if (c === '\n') return i  // unterminated — bail without failing
    i++
  }
  return -1
}

function skipTemplate(source: string, i: number, end: number): number {
  i++
  while (i < end) {
    const c = source[i]
    if (c === '\\') { i += 2; continue }
    if (c === '`') return i + 1
    if (c === '$' && source[i + 1] === '{') {
      let depth = 1
      i += 2
      while (i < end && depth > 0) {
        const cc = source[i]
        if (cc === '{') depth++
        else if (cc === '}') depth--
        else if (cc === '"' || cc === "'") { i = skipString(source, i, cc, end); if (i < 0) return -1; continue }
        else if (cc === '`') { i = skipTemplate(source, i, end); if (i < 0) return -1; continue }
        i++
      }
      continue
    }
    i++
  }
  return -1
}

/**
 * Resolve the HTTP verb for an inline fetch / axios / ofetch / $fetch call.
 *
 *   axios.get(…)                    → GET
 *   axios.patch(url, body)          → PATCH
 *   fetch(url, { method: 'PATCH' }) → PATCH
 *   fetch(url)                      → GET   (HTTP default)
 *   ofetch(url, { method: "POST" }) → POST
 *
 * When the options argument is a variable we can't inspect, default to GET —
 * that matches the browser's behavior when `method` is omitted. Returning
 * `undefined` for `method` would collapse the entry back into the pre-fix
 * dedup bucket, so the GET default is instead flagged via `method_known:
 * false` — a real signal (axios verb / explicit `method:`) always reports
 * `method_known: true`.
 */
function extractHttpMethod(call: string, args: string): { method: string; method_known: boolean } {
  const axiosVerb = call.match(/^axios\.(get|post|put|patch|delete)$/)
  if (axiosVerb) return { method: axiosVerb[1].toUpperCase(), method_known: true }
  const inline = args.match(/\bmethod\s*:\s*['"`]([A-Za-z]+)['"`]/)
  if (inline) return { method: inline[1].toUpperCase(), method_known: true }
  return { method: 'GET', method_known: false }
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

  // Anchor 6: promise-chain idiom — `fetch(url).then(r => r.json()).then(data
  // => setUsers(data))` (the docs' own canonical `.then(r => r.json())`
  // example). Neither `await` nor `return` appears here, so anchors 1-5 miss
  // it entirely. Whatever consumes the parsed body in the following `.then`
  // — its arrow param name, or the target of a `setX(...)` it forwards
  // into — is our trace seed.
  const thenJsonRe = /\.then\s*\(\s*[A-Za-z_$][\w$]*\s*=>\s*[A-Za-z_$][\w$]*\.json\s*\(\s*\)\s*\)/g
  while ((m = thenJsonRe.exec(window)) !== null) {
    const after = window.slice(m.index + m[0].length, m.index + m[0].length + 150)
    let am: RegExpMatchArray | null
    if ((am = after.match(/^\s*\.then\s*\(\s*set([A-Z][A-Za-z0-9_$]*)\s*\)/))) {
      add(am[1][0].toLowerCase() + am[1].slice(1))
    } else if ((am = after.match(/^\s*\.then\s*\(\s*[A-Za-z_$][\w$]*\s*=>\s*set([A-Z][A-Za-z0-9_$]*)\s*\(/))) {
      add(am[1][0].toLowerCase() + am[1].slice(1))
    } else if ((am = after.match(/^\s*\.then\s*\(\s*([A-Za-z_$][\w$]*)\s*=>/))) {
      add(am[1])
    }
  }

  return [...hints]
}

/** How the endpoint literal returned by `extractEndpointFromArgs` /
 *  `extractEndpointNear` was actually derived — never silently assume a
 *  low-confidence fallback (or a queryKey) is a real fetchable URL. */
type EndpointSource = 'url' | 'literal-path' | 'query-key' | 'guess'

/**
 * Replace each `${expr}` interpolation in a template-literal's raw inner text
 * with a stable `:param` placeholder, instead of truncating the string at
 * the `$`. Without this, `` `/api/planets/${id}` `` collapsed to just
 * `/api/planets/` — the param was silently dropped rather than preserved as
 * a recognizable route shape (`/api/planets/:param`), matching this file's
 * existing `:id`-style path-param convention (see `endpointToName`).
 */
function extractTemplatePath(raw: string): string {
  let out = ''
  let i = 0
  while (i < raw.length) {
    if (raw[i] === '$' && raw[i + 1] === '{') {
      let depth = 1
      let j = i + 2
      while (j < raw.length && depth > 0) {
        if (raw[j] === '{') depth++
        else if (raw[j] === '}') depth--
        j++
      }
      out += ':param'
      i = j
      continue
    }
    out += raw[i]
    i++
  }
  return out
}

/**
 * Pull a URL or path out of a fetch() argument list. Handles:
 *   • literal strings:     fetch('/api/health')
 *   • full URLs:           fetch('http://host/api/health')
 *   • template literals:   fetch(`${API_BASE}/api/health`)  ← resolves
 *                          when API_BASE is a known file-local const
 *   • templated params:    fetch(`/api/planets/${id}`)      ← `${id}` becomes
 *                          `:param` rather than truncating the path
 *   • bare identifiers:    fetch(LIST_URL, …)               ← resolves
 *                          when LIST_URL is a known file-local const
 *
 * Returns the most specific endpoint we can reconstruct (absolute URL when
 * possible, otherwise path). Absolute URLs preserve the host/port so the
 * shell can disambiguate two backends that expose the same path.
 */
function extractEndpointFromArgs(
  args: string, baseUrls: Map<string, string>, urlConstants?: Map<string, string>
): { endpoint: string; source: EndpointSource } | null {
  // 1. Plain string literal containing a full URL.
  const fullUrlMatch = args.match(/['"](https?:\/\/[^\s'"]+)['"]/)
  if (fullUrlMatch) return { endpoint: fullUrlMatch[1], source: 'url' }

  // 2. Template literal. A leading `${BASE_VAR}` is resolved against a known
  //    file-local base-URL constant (stress-lab MFEs use this pattern to
  //    point the same component at different ports); any interpolation —
  //    leading or not — is normalized via `extractTemplatePath` rather than
  //    truncating the path at the first `$`.
  const tplRaw = args.match(/`([^`]*)`/)
  if (tplRaw) {
    const inner = tplRaw[1]
    const leadingVarMatch = inner.match(/^\$\{([A-Za-z_$][\w$]*)\}([\s\S]*)$/)
    if (leadingVarMatch) {
      const base = baseUrls.get(leadingVarMatch[1])
      const rest = extractTemplatePath(leadingVarMatch[2])
      if (base) return { endpoint: base + rest, source: 'url' }
      if (/^\/(?:api|graphql|rpc|v\d)\//.test(rest)) return { endpoint: rest, source: 'literal-path' }
    }
    const templated = extractTemplatePath(inner)
    if (/^https?:\/\//.test(templated)) return { endpoint: templated, source: 'url' }
    if (templated.startsWith('/')) return { endpoint: templated, source: 'literal-path' }
  }

  // 3. Bare identifier as the first positional arg: `fetch(LIST_URL, …)`.
  //    Resolve against the file-local string-constant table built by the
  //    caller. Only accepts declarations whose value is a URL or a `/…`
  //    path so we don't misinterpret unrelated string consts.
  if (urlConstants && urlConstants.size > 0) {
    const idMatch = args.match(/^\s*([A-Za-z_$][\w$]*)\s*(?:[,)]|$)/)
    if (idMatch) {
      const resolved = urlConstants.get(idMatch[1])
      if (resolved) return { endpoint: resolved, source: /^https?:\/\//.test(resolved) ? 'url' : 'literal-path' }
    }
  }

  // 4. Any absolute-path string literal in the leading-argument position —
  //    not limited to /api, /graphql, /rpc, /v\d. htmx attributes and plain
  //    REST routes alike use arbitrary path prefixes (`/probe/from-vue`),
  //    and the old /api-ish-only fallback below dropped those entirely.
  const leadingPath = args.match(/^\s*['"`](\/[\w\-/.{}:?=&]*)['"`]/)
  if (leadingPath) return { endpoint: leadingPath[1], source: 'literal-path' }

  // 5. Legacy fallback — any string literal with an /api-ish path fragment
  //    anywhere in the args, for calls where the URL isn't the leading
  //    argument. Lower confidence than the branches above — tagged 'guess'.
  const pathMatch = args.match(/['"`][^'"`]*?(\/(?:api|graphql|rpc|v\d)\/[\w\-/.{}:?=&]*)/)
  if (pathMatch) return { endpoint: pathMatch[1], source: 'guess' }
  return null
}

/**
 * Readable label for the Data view list — keeps host + port visible so the
 * user can tell same-path-different-host endpoints apart at a glance. When a
 * method is known, prefix it so GET/PATCH/etc. pairs on the same path stay
 * distinguishable in the sidebar.
 *
 * Absolute URLs:         `localhost:4320 GET /api/health`
 * Host-only (rare):      `localhost:4320 GET /`
 * Relative paths:        `PATCH /api/tenants/`
 * Method unknown:        `/api/health`
 */
function endpointToDisplayName(endpoint: string, method?: string): string {
  const cleaned = endpoint.replace(/[?#].*$/, '')
  const prefix = method ? `${method} ` : ''
  const hostMatch = cleaned.match(/^https?:\/\/([^/]+)(\/.*)?$/)
  if (hostMatch) {
    const host = hostMatch[1]
    const path = hostMatch[2] || '/'
    return `${host} ${prefix}${path}`
  }
  const path = cleaned.startsWith('/') ? cleaned : `/${cleaned}`
  return `${prefix}${path}`
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

/** Result of `extractEndpointNear`. When the match is a queryKey (not a
 *  path/URL literal), `query_key` is always populated alongside `endpoint`
 *  (kept for backward-compatible display) and `endpoint_source` is tagged
 *  `'query-key'` — callers that care can tell it apart from a real,
 *  fetchable URL instead of silently treating it as one. */
interface NearbyEndpoint {
  endpoint?: string
  endpoint_source?: EndpointSource
  query_key?: string
}

/**
 * Scan ~800 chars after a definition opener for the first string literal that
 * looks like an endpoint or query key. Best-effort: extracts things like
 * `fetch('/api/users')`, `defineStore('user', ...)`, `useQuery(['users'], ...)`,
 * `useQuery({ queryKey: ['users'] })`. Returns `{}` when nothing looks right.
 *
 * Path-shaped literals are preferred over a queryKey (previously the
 * queryKey object-form check ran *before* the path check and returned
 * immediately, so a real path literal later in the slice was never reached).
 * A queryKey that IS found is also mirrored into `query_key` and tagged
 * `endpoint_source: 'query-key'` — a queryKey like `['users']` is an
 * identifier, not a URL, so callers must not treat it as one.
 */
function extractEndpointNear(content: string, fromIndex: number): NearbyEndpoint {
  const slice = content.slice(fromIndex, fromIndex + 800)

  // 1. A genuine path/URL literal wins over a queryKey whenever both exist.
  const pathMatch = slice.match(/['"`](\/[\w\-/.:{}?=&]+|https?:\/\/[^'"`]+)['"`]/)
  if (pathMatch) {
    const value = pathMatch[1]
    return { endpoint: value, endpoint_source: /^https?:\/\//.test(value) ? 'url' : 'literal-path' }
  }

  // 2. Object form: `{ queryKey: ['user', ...] }` or `{ queryKey: 'user' }`.
  //    Recorded in BOTH `endpoint` (backward-compatible display — consumers
  //    that only look at `endpoint` still see something) and the dedicated
  //    `query_key` field, tagged `endpoint_source: 'query-key'` so callers
  //    that care can tell it apart from a real fetchable URL.
  const objKey = slice.match(/queryKey\s*:\s*(?:\[\s*['"`]([^'"`]+)['"`]|['"`]([^'"`]+)['"`])/)
  if (objKey) {
    const key = objKey[1] ?? objKey[2]
    return { endpoint: key, endpoint_source: 'query-key', query_key: key }
  }

  // 3. First quoted string inside an array literal (positional
  //    useQuery(['users'])) — also a queryKey, not a URL.
  const arr = slice.match(/^\s*\[\s*['"`]([^'"`]+)['"`]/)
  if (arr) return { endpoint: arr[1], endpoint_source: 'query-key', query_key: arr[1] }

  // 4. First quoted string anywhere in the slice — a best-effort guess, not
  //    a confirmed endpoint (e.g. `defineStore('user', ...)`'s store id).
  const keyMatch = slice.match(/['"`]([A-Za-z][\w\-/:]*)['"`]/)
  if (keyMatch) return { endpoint: keyMatch[1], endpoint_source: 'guess' }
  return {}
}
