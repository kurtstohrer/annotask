/**
 * Workspace resolver. Given a Vite projectRoot (the MFE running the dev
 * server), walks UP to find the nearest monorepo config and enumerates every
 * sibling package dir. Powers cross-package component / data / API scans so
 * annotask can edit an entire app from a root and all its MFEs at once.
 *
 * Supports:
 *   - pnpm-workspace.yaml       (`packages:` glob list)
 *   - package.json `workspaces` (npm, yarn, bun; array or { packages: [] })
 *   - lerna.json  `packages`    (fallback when no package.json workspaces)
 *
 * Globs: supports `*`, `**`, and `!` exclusions. Everything else is a literal
 * path segment (no brace expansion — matches the 95% case for monorepos).
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'

const CACHE_TTL_MS = 60_000
const MAX_DIRS_SCANNED = 5000

export interface WorkspaceInfo {
  /** Workspace root (dir of pnpm-workspace.yaml / package.json / lerna.json). */
  root: string
  /** Absolute paths to every workspace package, including the one that
   *  contains projectRoot. Always contains at least `projectRoot`. Sorted. */
  packages: string[]
  /** True when a monorepo config was found; false when fallback to single. */
  isWorkspace: boolean
}

interface Cached {
  at: number
  value: WorkspaceInfo
}

const cache = new Map<string, Cached>()

export function clearWorkspaceCache(): void {
  cache.clear()
}

export async function resolveWorkspace(projectRoot: string): Promise<WorkspaceInfo> {
  const abs = path.resolve(projectRoot)
  const hit = cache.get(abs)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  const value = await resolveUncached(abs)
  cache.set(abs, { at: Date.now(), value })
  return value
}

async function resolveUncached(projectRoot: string): Promise<WorkspaceInfo> {
  const found = await findWorkspaceConfig(projectRoot)
  if (!found) {
    return { root: projectRoot, packages: [projectRoot], isWorkspace: false }
  }
  const pkgs = new Set<string>()
  for (const pattern of found.patterns) {
    const negate = pattern.startsWith('!')
    const glob = negate ? pattern.slice(1) : pattern
    const matched = await expandDirGlob(found.root, glob)
    for (const dir of matched) {
      if (negate) pkgs.delete(dir)
      else if (fs.existsSync(path.join(dir, 'package.json'))) pkgs.add(dir)
    }
  }
  // Always include projectRoot so whoever asked is guaranteed coverage.
  pkgs.add(projectRoot)
  return {
    root: found.root,
    packages: [...pkgs].sort(),
    isWorkspace: true,
  }
}

interface ConfigHit {
  root: string
  patterns: string[]
}

async function findWorkspaceConfig(start: string): Promise<ConfigHit | null> {
  let dir = start
  while (true) {
    const pnpm = path.join(dir, 'pnpm-workspace.yaml')
    if (fs.existsSync(pnpm)) {
      const patterns = readPnpmPatterns(pnpm)
      if (patterns.length) return { root: dir, patterns }
    }
    const pkgJson = path.join(dir, 'package.json')
    if (fs.existsSync(pkgJson)) {
      const patterns = readPackageJsonPatterns(pkgJson)
      if (patterns.length) return { root: dir, patterns }
    }
    const lerna = path.join(dir, 'lerna.json')
    if (fs.existsSync(lerna)) {
      const patterns = readLernaPatterns(lerna)
      if (patterns.length) return { root: dir, patterns }
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function readPnpmPatterns(file: string): string[] {
  try {
    const doc = yaml.load(fs.readFileSync(file, 'utf-8')) as { packages?: unknown } | null
    const list = Array.isArray(doc?.packages) ? (doc!.packages as unknown[]) : []
    return list.filter((s): s is string => typeof s === 'string')
  } catch { return [] }
}

function readPackageJsonPatterns(file: string): string[] {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf-8'))
    const w = doc?.workspaces
    if (Array.isArray(w)) return w.filter((s: unknown): s is string => typeof s === 'string')
    if (w && Array.isArray(w.packages)) return w.packages.filter((s: unknown): s is string => typeof s === 'string')
    return []
  } catch { return [] }
}

function readLernaPatterns(file: string): string[] {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf-8'))
    const list = Array.isArray(doc?.packages) ? doc.packages : []
    return list.filter((s: unknown): s is string => typeof s === 'string')
  } catch { return [] }
}

/**
 * Minimal glob → dir list. Supports `*` (single segment), `**` (any depth),
 * and literal segments. A trailing `/**` is tolerated. Does NOT support brace
 * expansion — those are rare in workspace globs.
 */
async function expandDirGlob(root: string, pattern: string): Promise<string[]> {
  const clean = pattern.replace(/^\.\//, '').replace(/\/$/, '')
  if (!clean) return [root]
  const parts = clean.split('/')
  let frontier: string[] = [root]
  let scanned = 0
  for (let i = 0; i < parts.length; i++) {
    const segment = parts[i]
    const next: string[] = []
    for (const dir of frontier) {
      if (scanned++ > MAX_DIRS_SCANNED) return next
      if (segment === '**') {
        // ** matches zero or more directories. Expand to this dir and all
        // descendants; subsequent segments filter further.
        next.push(dir, ...await listDescendantDirs(dir))
      } else if (segment.includes('*')) {
        const re = globToRegex(segment)
        const children = await listChildDirs(dir)
        for (const c of children) if (re.test(path.basename(c))) next.push(c)
      } else {
        const full = path.join(dir, segment)
        if (await isDir(full)) next.push(full)
      }
    }
    frontier = dedupe(next)
  }
  return frontier
}

function globToRegex(seg: string): RegExp {
  // `*` inside a segment matches any chars except `/`. No other metacharacters.
  const escaped = seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')
  return new RegExp(`^${escaped}$`)
}

async function listChildDirs(dir: string): Promise<string[]> {
  let entries: fs.Dirent[]
  try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return [] }
  const out: string[] = []
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    if (e.isDirectory()) out.push(path.join(dir, e.name))
  }
  return out
}

async function listDescendantDirs(dir: string): Promise<string[]> {
  const out: string[] = []
  const stack = [dir]
  let scanned = 0
  while (stack.length && scanned < MAX_DIRS_SCANNED) {
    const d = stack.pop()!
    const kids = await listChildDirs(d)
    for (const k of kids) { out.push(k); stack.push(k); scanned++ }
  }
  return out
}

async function isDir(p: string): Promise<boolean> {
  try { return (await fsp.stat(p)).isDirectory() } catch { return false }
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)]
}
