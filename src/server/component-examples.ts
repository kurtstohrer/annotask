/**
 * Find in-repo usages of a component by name. Gives an agent real examples of
 * prop combinations, wrapper patterns, and import paths already in use — much
 * higher signal for "use it the way the repo uses it" than the prop catalog
 * alone. Best-effort regex scan; no AST.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import nodePath from 'node:path'

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

export async function getComponentExamples(
  projectRoot: string,
  name: string,
  limit = 3,
): Promise<ComponentExamplesResult> {
  const esc = escapeRegex(name)
  // Matches <Name ...>, <Name/>, <Name>, <Name\n and <Name.Child ...> for
  // compound components (e.g. <Callout.Root>, <Select.Trigger>). Refuses
  // <NameSuffix (no lookahead hit).
  const usageRe = new RegExp(`<${esc}(?:\\.[A-Z][A-Za-z0-9_$]*)?(?=[\\s/>])`, 'g')
  // Matches: import X from 'path' / import { X } from 'path' / import { X as Y } from 'path'
  const importRe = new RegExp(
    `import\\s+(?:${esc}|\\{[^}]*\\b${esc}\\b[^}]*\\}|\\w+\\s*,\\s*\\{[^}]*\\b${esc}\\b[^}]*\\})\\s+from\\s+['"]([^'"]+)['"]`,
    'g',
  )

  const files: string[] = []
  const srcDir = nodePath.join(projectRoot, 'src')
  const scanRoot = fs.existsSync(srcDir) ? srcDir : projectRoot
  await walk(scanRoot, files)

  const examples: ComponentExample[] = []
  const importCounts = new Map<string, number>()
  let totalFound = 0
  let truncated = false

  for (const filePath of files) {
    let content: string
    try { content = await fsp.readFile(filePath, 'utf-8') } catch { continue }

    // Imports in this file — track so we can attribute to examples below.
    let fileImportPath: string | undefined
    importRe.lastIndex = 0
    let imp: RegExpExecArray | null
    while ((imp = importRe.exec(content)) !== null) {
      const path = imp[1]
      importCounts.set(path, (importCounts.get(path) ?? 0) + 1)
      if (!fileImportPath) fileImportPath = path
    }

    usageRe.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = usageRe.exec(content)) !== null) {
      totalFound++
      if (examples.length >= limit) { truncated = true; continue }
      // Compute 1-based line of the match and build a context snippet.
      const before = content.slice(0, m.index)
      const line = before.split('\n').length
      const lines = content.split(/\r?\n/)
      const startIdx = Math.max(0, line - 1 - SNIPPET_CONTEXT)
      const endIdx = Math.min(lines.length - 1, line - 1 + SNIPPET_CONTEXT)
      const snippet = lines.slice(startIdx, endIdx + 1).join('\n')
      const rel = nodePath.relative(projectRoot, filePath).replace(/\\/g, '/')
      examples.push({
        file: rel,
        line,
        snippet,
        import_path: fileImportPath,
      })
    }
  }

  const import_paths = [...importCounts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return {
    name,
    total_found: totalFound,
    examples,
    import_paths,
    truncated,
  }
}
