/**
 * Workspace catalog — one line up from the raw workspace resolver. Enriches
 * each discovered package with its `package.json` name and (when known) the
 * MFE id configured via `annotask({ mfe: ... })` in that package's vite
 * config. Drives the shell's MFE filter dropdown on Components / Data.
 *
 * MFE id resolution, in order:
 *   1. `.annotask/server.json` → `mfe` — populated by the annotask plugin
 *      the first time that MFE's dev server boots.
 *   2. Regex match of `annotask({ mfe: '...' })` in the package's
 *      `vite.config.{ts,js,mjs}` — catches MFEs whose dev server hasn't run
 *      yet (e.g. right after `git clone`).
 *   3. Unset (the package is a plain library / shared deps bucket).
 *
 * This is a read-only derivation — no state is persisted back to disk.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { resolveWorkspace } from './workspace.js'

const CACHE_TTL_MS = 30_000

export interface WorkspacePackage {
  /** `package.json` name, falls back to directory basename. */
  name: string
  /** Workspace-relative directory of this package. */
  dir: string
  /** Absolute directory. */
  absDir: string
  /** MFE id when the package configures the annotask plugin as an MFE. */
  mfe?: string
}

export interface WorkspaceCatalog {
  root: string
  isWorkspace: boolean
  packages: WorkspacePackage[]
}

interface Cached {
  at: number
  value: WorkspaceCatalog
}
const cache = new Map<string, Cached>()

export function clearWorkspaceCatalogCache(): void {
  cache.clear()
}

export async function getWorkspaceCatalog(projectRoot: string): Promise<WorkspaceCatalog> {
  const hit = cache.get(projectRoot)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  const value = await build(projectRoot)
  cache.set(projectRoot, { at: Date.now(), value })
  return value
}

async function build(projectRoot: string): Promise<WorkspaceCatalog> {
  const ws = await resolveWorkspace(projectRoot)
  const packages: WorkspacePackage[] = []
  for (const absDir of ws.packages) {
    const name = await readPackageName(absDir)
    const mfe = await resolveMfeId(absDir)
    packages.push({
      name: name ?? path.basename(absDir),
      dir: path.relative(ws.root, absDir).replace(/\\/g, '/') || path.basename(absDir),
      absDir,
      ...(mfe ? { mfe } : {}),
    })
  }
  // Stable ordering: packages that configure an MFE come first, then
  // directory alphabetical so the dropdown reads deterministically.
  packages.sort((a, b) => {
    if (!!a.mfe !== !!b.mfe) return a.mfe ? -1 : 1
    return a.dir.localeCompare(b.dir)
  })
  return { root: ws.root, isWorkspace: ws.isWorkspace, packages }
}

async function readPackageName(absDir: string): Promise<string | null> {
  try {
    const pkg = JSON.parse(await fsp.readFile(path.join(absDir, 'package.json'), 'utf-8'))
    return typeof pkg.name === 'string' ? pkg.name : null
  } catch { return null }
}

async function resolveMfeId(absDir: string): Promise<string | undefined> {
  // 1. server.json populated on dev-server boot
  try {
    const raw = await fsp.readFile(path.join(absDir, '.annotask', 'server.json'), 'utf-8')
    const info = JSON.parse(raw)
    if (typeof info?.mfe === 'string' && info.mfe.length > 0) return info.mfe
  } catch { /* server.json not present */ }

  // 2. vite.config source sniff — catches MFEs whose dev server hasn't run yet
  for (const name of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']) {
    const full = path.join(absDir, name)
    if (!fs.existsSync(full)) continue
    try {
      const src = await fsp.readFile(full, 'utf-8')
      const m = src.match(/annotask\s*\(\s*\{[^}]*?\bmfe\s*:\s*['"`]([^'"`]+)['"`]/s)
      if (m) return m[1]
    } catch { /* unreadable — skip */ }
  }
  return undefined
}
