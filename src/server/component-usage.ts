/**
 * Per-component-name usage scanner. Walks `src/` once and returns a map of
 * `componentName → files[]` for every JSX/Vue/Svelte/Astro component tag
 * seen in the source. Used by the Components view to label which catalog
 * components are actually referenced in this project.
 *
 * Detection strategy — regex-driven, same bar as the data-source scanner:
 *   - `<Foo` / `<Foo ` / `<Foo/>` / `<Foo>` in `.vue` / `.tsx` / `.jsx` /
 *     `.svelte` / `.astro` / `.html` files. PascalCase-only so HTML tags
 *     (`<div>`, `<span>`) aren't counted as component usage.
 *   - Named imports: `import { foo } from '...'` — records every binding
 *     regardless of case so libraries that expose lowercase components
 *     (e.g. Lucide's `box`, `icon`) still get attributed.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import nodePath from 'node:path'
import { resolveWorkspace } from './workspace.js'

const CACHE_TTL_MS = 60_000
const MAX_FILES_SCANNED = 5000
const SCAN_EXTS = new Set(['.vue', '.tsx', '.jsx', '.ts', '.js', '.svelte', '.astro', '.html', '.mjs'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.annotask', '.next', '.nuxt', 'coverage', '.vite', '.turbo', '.svelte-kit', '.output'])

export interface ComponentUsageMap {
  /** Map of component name → project-relative file list referencing it. */
  usage: Record<string, string[]>
  /** Per-file import map — `imports[file][Name]` lists every module path that
   *  imported `Name` in `file`. Lets the shell attribute a `<Button>` tag
   *  to the specific library it was imported from, so two libraries that
   *  both expose `Button` don't cross-highlight. */
  imports: Record<string, Record<string, string[]>>
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
  // Walk every workspace package so the host's annotask sees imports from
  // sibling MFEs. When not inside a workspace, this collapses to scanning
  // projectRoot alone.
  const ws = await resolveWorkspace(projectRoot)
  const relRoot = ws.root
  const files: string[] = []
  for (const pkgDir of ws.packages) {
    const srcDir = nodePath.join(pkgDir, 'src')
    const scanRoot = fs.existsSync(srcDir) ? srcDir : pkgDir
    await walk(scanRoot, files)
    if (files.length >= MAX_FILES_SCANNED) break
  }

  const usage: Record<string, Set<string>> = {}
  const imports: Record<string, Record<string, Set<string>>> = {}
  const push = (name: string, relFile: string) => {
    if (!usage[name]) usage[name] = new Set()
    usage[name].add(relFile)
  }
  const pushImport = (relFile: string, name: string, from: string) => {
    if (!imports[relFile]) imports[relFile] = {}
    const perFile = imports[relFile]
    if (!perFile[name]) perFile[name] = new Set()
    perFile[name].add(from)
  }

  // JSX / Vue / Svelte / Astro tag usage: `<Foo` followed by space, `>`,
  // `/`, or `\n`. PascalCase only. Also records `<Foo.Bar>` as a Foo usage
  // so compound components (Callout.Root, Select.Trigger, etc.) show up.
  const TAG_RE = /<([A-Z][A-Za-z0-9_$]*)(?:\.[A-Z][A-Za-z0-9_$]*)?(?=[\s/>])/g
  // ESM named import: `import { Foo, Bar as Baz } from 'x'` — collects Foo
  // and Baz plus the source module, which lets the shell map a tag to the
  // specific library it came from. Lowercase bindings are kept too so
  // libraries that expose non-PascalCase components (e.g. `import { box,
  // icon } from 'lucide'`) still show up in the usage map.
  const IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*(['"`])([^'"`]+)\2/g
  // Default import: `import Foo from 'x'` — common in Vue + PrimeVue style
  // ("import Button from 'primevue/button'"). Without this, default-only
  // catalogs (PrimeVue, Naive-UI's `import N... from 'naive-ui/...'`) lose
  // their import-source attribution and get dropped by the library-scoped
  // filter. Skips side-effect imports (`import 'x'`) and namespace/type
  // imports by requiring an identifier binding.
  const DEFAULT_IMPORT_RE = /import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:,\s*\{[^}]*\})?\s*from\s*(['"`])([^'"`]+)\2/g

  for (const abs of files) {
    let content: string
    try { content = await fsp.readFile(abs, 'utf-8') }
    catch { continue }
    const rel = nodePath.relative(relRoot, abs).replace(/\\/g, '/')

    let m: RegExpExecArray | null
    TAG_RE.lastIndex = 0
    while ((m = TAG_RE.exec(content)) !== null) {
      push(m[1], rel)
    }
    IMPORT_RE.lastIndex = 0
    while ((m = IMPORT_RE.exec(content)) !== null) {
      const specifiers = m[1]
      const from = m[3]
      for (const rawPart of specifiers.split(',').map(s => s.trim()).filter(Boolean)) {
        // Strip `type` prefix from inline type imports (`import { type Foo }`)
        const part = rawPart.replace(/^type\s+/, '')
        // `Foo` or `Foo as Bar` — both `Foo` and `Bar` count as imported
        const pair = part.split(/\s+as\s+/).map(s => s.trim())
        for (const id of pair) {
          if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(id)) continue
          if (id === 'default') continue
          push(id, rel)
          pushImport(rel, id, from)
        }
      }
    }
    DEFAULT_IMPORT_RE.lastIndex = 0
    while ((m = DEFAULT_IMPORT_RE.exec(content)) !== null) {
      const id = m[1]
      const from = m[3]
      push(id, rel)
      pushImport(rel, id, from)
    }
  }

  const outUsage: Record<string, string[]> = {}
  for (const name of Object.keys(usage)) outUsage[name] = [...usage[name]]
  const outImports: Record<string, Record<string, string[]>> = {}
  for (const file of Object.keys(imports)) {
    const perFile: Record<string, string[]> = {}
    for (const name of Object.keys(imports[file])) perFile[name] = [...imports[file][name]]
    outImports[file] = perFile
  }
  return { usage: outUsage, imports: outImports, scannedAt: Date.now() }
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
