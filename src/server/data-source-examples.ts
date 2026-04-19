/**
 * Find in-repo usages of a data source (hook / store / fetch wrapper / GraphQL
 * operation / RPC client / loader) by name. Twin of component-examples.ts —
 * identical result shape, per-kind match patterns.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import nodePath from 'node:path'
import type { DataSource } from '../schema.js'

export interface DataSourceExample {
  file: string
  line: number
  snippet: string
  import_path?: string
}

export interface DataSourceExamplesResult {
  name: string
  kind?: DataSource['kind']
  total_found: number
  examples: DataSourceExample[]
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
      if (SCAN_EXTS.has(nodePath.extname(entry.name))) acc.push(full)
    }
  }
}

/**
 * Per-kind match regex for a usage site. Definitions (export function, export const)
 * are excluded with a negative lookbehind approximation via a flag on the caller.
 */
function buildUsageRegex(name: string, kind?: DataSource['kind']): RegExp {
  const esc = escapeRegex(name)
  switch (kind) {
    case 'store':
      // Either calling the store hook (`useUserStore(`) or reading off an instance (`userStore.field`).
      return new RegExp(`\\b${esc}(?:\\s*\\(|\\s*\\.)`, 'g')
    case 'signal':
      // Signals are typically called as functions to read: `count()` — but they can also appear bare.
      return new RegExp(`\\b${esc}(?:\\s*\\(|\\b)`, 'g')
    case 'graphql':
      // Any reference outside the definition line — plain word boundary match.
      return new RegExp(`\\b${esc}\\b`, 'g')
    case 'rpc':
    case 'loader':
    case 'fetch':
    case 'composable':
    default:
      // Call-site pattern.
      return new RegExp(`\\b${esc}\\s*\\(`, 'g')
  }
}

function isDefinitionLine(lineContent: string, name: string): boolean {
  // Skip the actual definition so the count isn't contaminated.
  const esc = escapeRegex(name)
  const defRe = new RegExp(`\\b(?:export\\s+)?(?:const|function|async\\s+function|let|var)\\s+${esc}\\b|\\bdefineStore\\s*\\(\\s*['"][^'"]*['"]\\s*,\\s*[^)]*\\)\\s*=>\\s*\\(?\\s*\\{[^}]*${esc}`)
  return defRe.test(lineContent)
}

function buildImportRegex(name: string): RegExp {
  const esc = escapeRegex(name)
  // Matches:
  //   import X from 'path'
  //   import { X } from 'path'
  //   import { X as Y } from 'path'  (match local alias = Y; we still key on the imported X for counting)
  //   import defaultX, { X } from 'path'
  return new RegExp(
    `import\\s+(?:${esc}|\\{[^}]*\\b${esc}\\b[^}]*\\}|\\w+\\s*,\\s*\\{[^}]*\\b${esc}\\b[^}]*\\})\\s+from\\s+['"]([^'"]+)['"]`,
    'g',
  )
}

export async function getDataSourceExamples(
  projectRoot: string,
  name: string,
  limit = 3,
  kind?: DataSource['kind'],
): Promise<DataSourceExamplesResult> {
  const srcDir = nodePath.join(projectRoot, 'src')
  const scanRoot = fs.existsSync(srcDir) ? srcDir : projectRoot
  const files: string[] = []
  await walk(scanRoot, files)

  const usageRe = buildUsageRegex(name, kind)
  const importRe = buildImportRegex(name)

  const examples: DataSourceExample[] = []
  const importCounts = new Map<string, number>()
  let totalFound = 0
  let truncated = false

  for (const filePath of files) {
    let content: string
    try { content = await fsp.readFile(filePath, 'utf-8') } catch { continue }

    importRe.lastIndex = 0
    let fileImportPath: string | undefined
    let imp: RegExpExecArray | null
    while ((imp = importRe.exec(content)) !== null) {
      const path = imp[1]
      importCounts.set(path, (importCounts.get(path) ?? 0) + 1)
      if (!fileImportPath) fileImportPath = path
    }

    usageRe.lastIndex = 0
    const lines = content.split(/\r?\n/)
    let m: RegExpExecArray | null
    while ((m = usageRe.exec(content)) !== null) {
      const beforeMatch = content.slice(0, m.index)
      const lineIdx = beforeMatch.split('\n').length - 1
      if (lineIdx >= 0 && lineIdx < lines.length && isDefinitionLine(lines[lineIdx], name)) continue
      totalFound++
      if (examples.length >= limit) { truncated = true; continue }
      const startIdx = Math.max(0, lineIdx - SNIPPET_CONTEXT)
      const endIdx = Math.min(lines.length - 1, lineIdx + SNIPPET_CONTEXT)
      const snippet = lines.slice(startIdx, endIdx + 1).join('\n')
      const rel = nodePath.relative(projectRoot, filePath).replace(/\\/g, '/')
      examples.push({
        file: rel,
        line: lineIdx + 1,
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
    kind,
    total_found: totalFound,
    examples,
    import_paths,
    truncated,
  }
}
