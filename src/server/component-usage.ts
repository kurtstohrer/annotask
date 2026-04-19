/**
 * Per-component-name usage scanner. Walks `src/` once and returns a map of
 * `componentName → files[]` for every JSX/Vue/Svelte/Astro component tag
 * seen in the source. Used by the Components view to label which catalog
 * components are actually referenced in this project.
 *
 * Detection strategy — regex-driven, same bar as the data-source scanner:
 *   - `<Foo` / `<Foo ` / `<Foo/>` / `<Foo>` in `.vue` / `.tsx` / `.jsx` /
 *     `.svelte` / `.astro` / `.html` files.
 *   - Named imports: `import { Foo } from '...'` — treats `Foo` as used in
 *     that file even if JSX scanning miscategorizes.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import nodePath from 'node:path'

const CACHE_TTL_MS = 60_000
const MAX_FILES_SCANNED = 2000
const SCAN_EXTS = new Set(['.vue', '.tsx', '.jsx', '.ts', '.js', '.svelte', '.astro', '.html', '.mjs'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.annotask', '.next', '.nuxt', 'coverage', '.vite', '.turbo', '.svelte-kit', '.output'])

export interface ComponentUsageMap {
  /** Map of component name → project-relative file list referencing it. */
  usage: Record<string, string[]>
  scannedAt: number
}

let cached: ComponentUsageMap | null = null
let cachedAt = 0
let inflight: Promise<ComponentUsageMap> | null = null

export function clearComponentUsageCache(): void {
  cached = null
  cachedAt = 0
  inflight = null
}

export async function scanComponentUsage(projectRoot: string): Promise<ComponentUsageMap> {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached
  if (inflight) return inflight
  inflight = scanUncached(projectRoot).finally(() => { inflight = null })
  const result = await inflight
  cached = result
  cachedAt = Date.now()
  return result
}

async function scanUncached(projectRoot: string): Promise<ComponentUsageMap> {
  const srcDir = nodePath.join(projectRoot, 'src')
  const scanRoot = fs.existsSync(srcDir) ? srcDir : projectRoot
  const files: string[] = []
  await walk(scanRoot, files)

  const usage: Record<string, Set<string>> = {}
  const push = (name: string, relFile: string) => {
    if (!usage[name]) usage[name] = new Set()
    usage[name].add(relFile)
  }

  // JSX / Vue / Svelte / Astro tag usage: `<Foo` followed by space, `>`,
  // `/`, or `\n`. PascalCase only. Also records `<Foo.Bar>` as a Foo usage
  // so compound components (Callout.Root, Select.Trigger, etc.) show up.
  const TAG_RE = /<([A-Z][A-Za-z0-9_$]*)(?:\.[A-Z][A-Za-z0-9_$]*)?(?=[\s/>])/g
  // ESM named import: `import { Foo, Bar as Baz } from 'x'` — collects Foo
  // and Baz. Misses default imports (caller imports a component under any
  // name), which is fine for catalog usage detection.
  const IMPORT_RE = /import\s*\{([^}]+)\}\s*from/g

  for (const abs of files) {
    let content: string
    try { content = await fsp.readFile(abs, 'utf-8') }
    catch { continue }
    const rel = nodePath.relative(projectRoot, abs).replace(/\\/g, '/')

    let m: RegExpExecArray | null
    TAG_RE.lastIndex = 0
    while ((m = TAG_RE.exec(content)) !== null) {
      push(m[1], rel)
    }
    IMPORT_RE.lastIndex = 0
    while ((m = IMPORT_RE.exec(content)) !== null) {
      for (const part of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
        // `Foo` or `Foo as Bar` — both `Foo` and `Bar` count as imported
        const pair = part.split(/\s+as\s+/).map(s => s.trim())
        for (const id of pair) {
          if (/^[A-Z]/.test(id)) push(id, rel)
        }
      }
    }
  }

  const out: Record<string, string[]> = {}
  for (const name of Object.keys(usage)) out[name] = [...usage[name]]
  return { usage: out, scannedAt: Date.now() }
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
    if (entry.isDirectory()) await walk(full, acc)
    else if (entry.isFile() && SCAN_EXTS.has(nodePath.extname(entry.name))) acc.push(full)
  }
}
