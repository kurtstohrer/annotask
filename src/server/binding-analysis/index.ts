/**
 * Per-source binding graph orchestrator. Produces a SourceBindingGraph for
 * one data source name by:
 *   1. Walking project files.
 *   2. Running the first matching framework analyzer per file, with the
 *      root source name as the only seed.
 *   3. Following every PropEdge one hop: re-run the child file's analyzer
 *      with the prop name added as a tainted seed.
 *
 * Caches the graph per (projectRoot, source_name) using a short TTL and the
 * data-source-scanner's mtime signals (indirectly — we invalidate when the
 * scanner cache turns over).
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import nodePath from 'node:path'
import { resolveWorkspace } from '../workspace.js'
import type { SourceBindingGraph, BindingSite, PropEdge } from '../../schema.js'
import type { FrameworkBindingAnalyzer, SeedSymbol, AnalyzeResult } from './types.js'
import { fallbackAnalyzer } from './fallback.js'
import { vueAnalyzer } from './vue.js'
import { jsxAnalyzer } from './jsx.js'
import { svelteAnalyzer } from './svelte.js'

const CACHE_TTL_MS = 60_000
const MAX_FILES = 2000
const SCAN_EXTS = new Set(['.vue', '.tsx', '.jsx', '.ts', '.js', '.svelte', '.astro', '.html', '.mjs'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.annotask', '.next', '.nuxt', 'coverage', '.vite', '.turbo', '.svelte-kit', '.output'])

/** Analyzers are tried in order; first whose supports() returns true wins. */
const ANALYZERS: FrameworkBindingAnalyzer[] = [
  vueAnalyzer,
  svelteAnalyzer,
  jsxAnalyzer,
  fallbackAnalyzer,
]

interface CacheEntry { at: number; graph: SourceBindingGraph }
const cache = new Map<string, CacheEntry>()

export function clearBindingCache(): void {
  cache.clear()
}

export async function resolveBindingGraph(
  projectRoot: string,
  sourceName: string,
  opts: { hintSymbols?: string[]; scopeFile?: string } = {},
): Promise<SourceBindingGraph> {
  const hintKey = opts.hintSymbols?.length ? opts.hintSymbols.slice().sort().join(',') : ''
  const scopeKey = opts.scopeFile ?? ''
  const key = `${projectRoot}::${sourceName}::${hintKey}::${scopeKey}`
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.graph

  const graph = await buildGraph(projectRoot, sourceName, opts.hintSymbols ?? [], opts.scopeFile)
  cache.set(key, { at: now, graph })
  return graph
}

async function buildGraph(
  projectRoot: string,
  sourceName: string,
  hintSymbols: string[] = [],
  scopeFile?: string,
): Promise<SourceBindingGraph> {
  // Walk every workspace package so the host's binding graph covers hooks /
  // APIs that only sibling MFEs call. Paths are emitted workspace-relative
  // so they line up with the rest of the catalog.
  const ws = await resolveWorkspace(projectRoot)
  const files: string[] = []
  for (const pkgDir of ws.packages) {
    const srcDir = nodePath.join(pkgDir, 'src')
    const scanRoot = fs.existsSync(srcDir) ? srcDir : pkgDir
    await walk(scanRoot, files)
  }

  const fileContents = new Map<string, string>()
  for (const fp of files) {
    try { fileContents.set(fp, await fsp.readFile(fp, 'utf-8')) } catch { /* skip */ }
  }

  const sites: BindingSite[] = []
  const edges: PropEdge[] = []
  const diagnostics: SourceBindingGraph['diagnostics'] = []
  let partial = false

  const rel = (abs: string) => nodePath.relative(ws.root, abs).replace(/\\/g, '/')

  // ── Pass 1: direct-use files. When `scopeFile` is set we restrict to
  //    that file only — inline-fetch entries' hints are short generic names
  //    (`health`, `workflows`) that would otherwise match unrelated state
  //    variables in sibling MFEs. Named composables (no scopeFile) still
  //    walk the whole workspace for the analyzer.
  const seedSymbols: SeedSymbol[] = hintSymbols.map(n => ({ name: n, source_name: sourceName }))
  const passOneRan = new Set<string>()
  for (const [absPath, content] of fileContents) {
    const relFile = rel(absPath)
    if (scopeFile && relFile !== scopeFile) continue
    const mentionsSource = content.includes(sourceName)
    const mentionsHint = hintSymbols.some(h => content.includes(h))
    if (!mentionsSource && !mentionsHint) continue
    const result = await runAnalyzer(relFile, content, sourceName, seedSymbols, diagnostics)
    if (!result) continue
    passOneRan.add(relFile)
    integrate(result, sites, edges, diagnostics, relFile)
    if (result.note?.startsWith('file-level fallback')) partial = true
  }

  // ── Pass 2: one-hop prop propagation. For each prop edge we collected,
  //    find the child's file (via tag → filename heuristic) and re-analyze
  //    it with the prop name seeded as tainted.
  const seen = new Set<string>() // dedupe (childFile, propName) pairs
  for (const edge of [...edges]) {
    const childFile = resolveChildFile(edge.to_hint, fileContents, rel)
    if (!childFile) continue
    const dedupeKey = `${childFile}::${edge.prop_name}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    const absChild = [...fileContents.keys()].find(p => rel(p) === childFile)
    if (!absChild) continue
    const childContent = fileContents.get(absChild)!
    const seeds: SeedSymbol[] = [{ name: edge.prop_name, source_name: sourceName }]
    const result = await runAnalyzer(childFile, childContent, sourceName, seeds, diagnostics)
    if (!result) continue
    integrate(result, sites, edges, diagnostics, childFile)
    if (result.note?.startsWith('file-level fallback')) partial = true
  }

  // ── Dedupe sites on (file, line). Keep the one with the richest symbols.
  const siteMap = new Map<string, BindingSite>()
  for (const s of sites) {
    const key = `${s.file}:${s.line}`
    const existing = siteMap.get(key)
    if (!existing) { siteMap.set(key, s); continue }
    const merged = new Set<string>([...(existing.tainted_symbols ?? []), ...(s.tainted_symbols ?? [])])
    siteMap.set(key, { ...existing, tainted_symbols: [...merged] })
  }

  return {
    source_name: sourceName,
    sites: [...siteMap.values()],
    prop_edges: edges,
    partial,
    diagnostics,
  }
}

async function runAnalyzer(
  relFile: string,
  content: string,
  sourceName: string,
  seeds: SeedSymbol[],
  diagnostics?: NonNullable<SourceBindingGraph['diagnostics']>,
): Promise<(AnalyzeResult & { analyzer: string }) | null> {
  for (const a of ANALYZERS) {
    if (!a.supports(relFile)) continue
    try {
      const r = await a.analyze({ file: relFile, content, source_name: sourceName, seeds })
      if (r) return { ...r, analyzer: a.id }
      // Record that the analyzer ran but declined to match — helps debug
      // cases where Vue silently falls through to file-level fallback.
      if (diagnostics && a.id !== 'file-level-fallback') {
        diagnostics.push({ file: relFile, analyzer: a.id, note: 'returned null (no matches or parser unavailable)' })
      }
    } catch (err: any) {
      if (diagnostics) {
        diagnostics.push({ file: relFile, analyzer: a.id, note: `error: ${err?.message ?? String(err)}` })
      }
      continue
    }
  }
  return null
}

function integrate(
  result: AnalyzeResult & { analyzer: string },
  sites: BindingSite[],
  edges: PropEdge[],
  diagnostics: NonNullable<SourceBindingGraph['diagnostics']>,
  relFile: string,
): void {
  for (const s of result.sites) sites.push(s)
  for (const e of result.prop_edges) edges.push(e)
  if (result.note) diagnostics.push({ file: relFile, analyzer: result.analyzer, note: result.note })
}

/**
 * Resolve a component tag like `PlanetCard` to the child file by filename
 * matching. Import-aware resolution is a follow-up; this covers the common
 * case in the playgrounds where the component filename matches the tag name.
 */
function resolveChildFile(tagName: string, contents: Map<string, string>, rel: (p: string) => string): string | null {
  if (!tagName || !/^[A-Z]/.test(tagName)) return null
  const candidates: Array<[string, string]> = []
  for (const p of contents.keys()) {
    const base = nodePath.basename(p).replace(/\.(vue|tsx|jsx|ts|js|svelte|astro)$/i, '')
    if (base === tagName) candidates.push([p, rel(p)])
  }
  if (candidates.length === 0) return null
  // Prefer the shortest path when multiple files share a name (closer in the
  // tree tends to be the intended one).
  candidates.sort((a, b) => a[1].length - b[1].length)
  return candidates[0][1]
}

async function walk(dir: string, acc: string[]): Promise<void> {
  if (acc.length >= MAX_FILES) return
  let entries: fs.Dirent[]
  try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (acc.length >= MAX_FILES) return
    if (SKIP_DIRS.has(entry.name)) continue
    if (entry.name.startsWith('.')) continue
    const full = nodePath.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, acc)
    else if (entry.isFile() && SCAN_EXTS.has(nodePath.extname(entry.name))) acc.push(full)
  }
}
