/**
 * Find in-repo usages of a component by name. Gives an agent real examples of
 * prop combinations, wrapper patterns, and import paths already in use — much
 * higher signal for "use it the way the repo uses it" than the prop catalog
 * alone. Best-effort regex scan; no AST.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import nodePath from 'node:path'
import { resolveWorkspace } from './workspace.js'

export interface ComponentExample {
  file: string
  line: number
  snippet: string
  import_path?: string
}

export interface ComponentExamplesResult {
  name: string
  total_found: number
  examples: ComponentExample[]
  /** Most common import sources (module specifier), in descending order. */
  import_paths: Array<{ path: string; count: number }>
  truncated: boolean
}

const SCAN_EXTS = new Set(['.vue', '.tsx', '.jsx', '.ts', '.js', '.svelte', '.astro', '.html', '.mjs'])
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.annotask', '.next', '.nuxt', 'coverage', '.vite', '.turbo'])
const MAX_FILES_SCANNED = 2000
const SNIPPET_CONTEXT = 5

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Count attribute-like tokens in the opening tag so an example showing more
 *  props outranks a bare `<Button />` — a stronger "how is this really used"
 *  signal than file-walk order. Window-capped so a giant minified line can't
 *  blow up the scan; stops at the first unescaped `>` when found sooner. */
function computeRichness(content: string, matchIndex: number): number {
  const window = content.slice(matchIndex, matchIndex + 500)
  const closeIdx = window.indexOf('>')
  const tagText = closeIdx === -1 ? window : window.slice(0, closeIdx)
  const attrs = tagText.match(/[A-Za-z_:][\w:.-]*\s*=/g)
  return attrs ? attrs.length : 0
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
      const ext = nodePath.extname(entry.name)
      if (SCAN_EXTS.has(ext)) acc.push(full)
    }
  }
}

/** True when a file's import specifier belongs to a given library. Matches
 *  exact package name or as a subpath prefix — same rule the shell uses in
 *  `fromMatchesLibrary()` for highlight attribution, so the examples pane
 *  never disagrees with the overlay on which library a file belongs to. */
function importPathMatchesLibrary(from: string, library: string): boolean {
  return from === library || from.startsWith(library + '/')
}

export async function getComponentExamples(
  projectRoot: string,
  name: string,
  limit = 3,
  library?: string,
): Promise<ComponentExamplesResult> {
  const esc = escapeRegex(name)
  // Matches <Name ...>, <Name/>, <Name>, <Name\n and <Name.Child ...> for
  // compound components (e.g. <Callout.Root>, <Select.Trigger>). Refuses
  // <NameSuffix (no lookahead hit).
  const usageRe = new RegExp(`<${esc}(?:\\.[A-Z][A-Za-z0-9_$]*)?(?=[\\s/>])`, 'g')
  // Matches: import X from 'path' / import { X } from 'path' / import { X as Y } from 'path' /
  // import X, { type Y } from 'path' (name is the default import, possibly
  // combined with a named — optionally `type`-qualified — import group).
  const importRe = new RegExp(
    `import\\s+(?:${esc}(?:\\s*,\\s*\\{[^}]*\\})?|\\{[^}]*\\b${esc}\\b[^}]*\\}|\\w+\\s*,\\s*\\{[^}]*\\b${esc}\\b[^}]*\\})\\s+from\\s+['"]([^'"]+)['"]`,
    'g',
  )

  const files: string[] = []
  const srcDir = nodePath.join(projectRoot, 'src')
  const scanRoot = fs.existsSync(srcDir) ? srcDir : projectRoot
  await walk(scanRoot, files)

  // Path base matches the other catalogs (component-usage, resolve-fingerprint):
  // workspace root when the project is part of a monorepo, else projectRoot
  // itself. Using projectRoot unconditionally here produced paths that didn't
  // line up with the usage index in monorepos.
  const ws = await resolveWorkspace(projectRoot)
  const relRoot = ws.root

  interface Candidate extends ComponentExample {
    richness: number
  }
  const candidates: Candidate[] = []
  const importCounts = new Map<string, number>()
  let totalFound = 0

  for (const filePath of files) {
    let content: string
    try { content = await fsp.readFile(filePath, 'utf-8') } catch { continue }

    // Imports in this file — track so we can attribute to examples below.
    // When `library` is set, we only keep examples from files that imported
    // `name` from a matching module; otherwise same-name components from two
    // libraries (Mantine Button vs Radix Button) bleed into each other.
    let fileImportPath: string | undefined
    let fileMatchesLibrary = !library
    importRe.lastIndex = 0
    let imp: RegExpExecArray | null
    while ((imp = importRe.exec(content)) !== null) {
      const path = imp[1]
      if (library && importPathMatchesLibrary(path, library)) {
        fileMatchesLibrary = true
        // Prefer a library-matching path as the representative import —
        // falling through to first-seen would hide the library attribution
        // when a file happens to import from an unrelated module earlier.
        fileImportPath = path
      } else if (!fileImportPath) {
        fileImportPath = path
      }
    }

    // Skip this file entirely when a library filter is active and no import
    // came from that library — keeps `total_found` and `import_paths`
    // honest so the count shown in the UI matches the library scope.
    if (!fileMatchesLibrary) continue

    // Only record the file's imports in the global histogram after the
    // library gate, otherwise `import_paths` would leak other-library
    // candidates into the ranking.
    importRe.lastIndex = 0
    while ((imp = importRe.exec(content)) !== null) {
      const path = imp[1]
      importCounts.set(path, (importCounts.get(path) ?? 0) + 1)
    }

    usageRe.lastIndex = 0
    let m: RegExpExecArray | null
    let lines: string[] | null = null
    while ((m = usageRe.exec(content)) !== null) {
      totalFound++
      // Gather every raw hit first — ranking/dedup happens once across the
      // whole scan, below, instead of taking the first N in readdir order.
      if (!lines) lines = content.split(/\r?\n/)
      const before = content.slice(0, m.index)
      const line = before.split('\n').length
      const startIdx = Math.max(0, line - 1 - SNIPPET_CONTEXT)
      const endIdx = Math.min(lines.length - 1, line - 1 + SNIPPET_CONTEXT)
      const snippet = lines.slice(startIdx, endIdx + 1).join('\n')
      const rel = nodePath.relative(relRoot, filePath).replace(/\\/g, '/')
      candidates.push({
        file: rel,
        line,
        snippet,
        import_path: fileImportPath,
        richness: computeRichness(content, m.index),
      })
    }
  }

  const import_paths = [...importCounts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  // Rank by richness (more props shown = a more useful example) and dedup
  // snippets that overlap — several usages close together in the same file
  // produce near-identical `SNIPPET_CONTEXT`-wide windows, which used to show
  // up as 2-3 copies of essentially the same lines.
  candidates.sort((a, b) => b.richness - a.richness || a.file.localeCompare(b.file) || a.line - b.line)

  const examples: ComponentExample[] = []
  const acceptedLines = new Map<string, number[]>()
  let truncated = false
  for (const c of candidates) {
    const taken = acceptedLines.get(c.file) ?? []
    if (taken.some(l => Math.abs(l - c.line) <= SNIPPET_CONTEXT * 2)) continue
    if (examples.length >= limit) { truncated = true; continue }
    examples.push({ file: c.file, line: c.line, snippet: c.snippet, import_path: c.import_path })
    taken.push(c.line)
    acceptedLines.set(c.file, taken)
  }

  return {
    name,
    total_found: totalFound,
    examples,
    import_paths,
    truncated,
  }
}
