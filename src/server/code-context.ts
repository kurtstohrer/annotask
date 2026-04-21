/**
 * Source-grounded code context for a task. Lets an agent re-anchor to the
 * current code state instead of trusting stale file/line values on older
 * tasks. Regex-based (no AST) because agents care about a readable excerpt
 * and a stable fingerprint, not a precise symbol tree.
 */
import fsp from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolveProjectFile } from './path-safety.js'

export interface CodeContext {
  file: string
  line: number
  /** Nearest enclosing function / component name, if one could be detected. */
  symbol?: string
  /** 1-based start line of the returned excerpt. */
  excerpt_start_line: number
  /** 1-based end line of the returned excerpt. */
  excerpt_end_line: number
  /** Source lines joined with \n. */
  excerpt: string
  /** Leading import statements from the file head. */
  imports: string[]
  /** sha256 over the excerpt — lets retry-aware agents detect drift since the task was created. */
  excerpt_hash: string
  /** Emitted when the file can't be read. */
  error?: string
}

/** Patterns tried in order, walking backward from the task line. First match wins. */
const SYMBOL_PATTERNS: RegExp[] = [
  /\bexport\s+default\s+function\s+([A-Za-z_$][\w$]*)/,
  /\bexport\s+default\s+class\s+([A-Za-z_$][\w$]*)/,
  /\bexport\s+function\s+([A-Za-z_$][\w$]*)/,
  /\bexport\s+class\s+([A-Za-z_$][\w$]*)/,
  /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\(|function|async|React\.forwardRef|React\.memo|forwardRef|memo)/,
  /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/,
  /\bclass\s+([A-Za-z_$][\w$]*)\b/,
  /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\(|function|async|React\.forwardRef|React\.memo|forwardRef|memo)/,
  // Vue / Svelte explicit component definitions
  /\bexport\s+default\s+defineComponent\s*\(/,
  /<script(?:\s+[^>]*)?>/,
]

function findNearestSymbol(lines: string[], targetLineIdx: number): string | undefined {
  const start = Math.min(targetLineIdx, lines.length - 1)
  for (let i = start; i >= 0; i--) {
    const line = lines[i]
    for (const pat of SYMBOL_PATTERNS) {
      const m = pat.exec(line)
      if (m) {
        if (m[1]) return m[1]
        // Patterns with no capture group indicate a script block / defineComponent —
        // return the enclosing file's basename as a weak symbol hint.
        return undefined
      }
    }
  }
  return undefined
}

/**
 * Import block from the file head: contiguous lines matching import-like patterns,
 * allowing comments and blanks between them. Stops at the first line of real code.
 */
function extractImports(lines: string[]): string[] {
  const imports: string[] = []
  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('*/')) continue
    if (/^import\b/.test(trimmed) || /^export\s+(?:\*|\{)/.test(trimmed) || /^const\s+\w+\s*=\s*require\(/.test(trimmed)) {
      imports.push(trimmed)
      continue
    }
    // Vue/Svelte SFC: imports live inside <script> — skip the tag and keep scanning briefly
    if (/^<script\b/.test(trimmed) || /^<\/script>/.test(trimmed) || /^<template\b/.test(trimmed) || /^<style\b/.test(trimmed)) continue
    break
  }
  return imports
}

export async function getCodeContext(
  projectRoot: string,
  relFile: string,
  line: number,
  contextLines = 15,
  workspaceRoot?: string,
): Promise<CodeContext> {
  const resolved = resolveProjectFile(projectRoot, relFile, workspaceRoot)
  if (!resolved) {
    return {
      file: String(relFile),
      line,
      excerpt_start_line: line,
      excerpt_end_line: line,
      excerpt: '',
      imports: [],
      excerpt_hash: '',
      error: 'Invalid or escaping file path',
    }
  }
  const { absolutePath: absPath, relative: safeFile } = resolved
  let content: string
  try {
    content = await fsp.readFile(absPath, 'utf-8')
  } catch (err: any) {
    return {
      file: safeFile,
      line,
      excerpt_start_line: line,
      excerpt_end_line: line,
      excerpt: '',
      imports: [],
      excerpt_hash: '',
      error: `Could not read file: ${err?.message ?? 'unknown'}`,
    }
  }

  const lines = content.split(/\r?\n/)
  const targetIdx = Math.max(0, Math.min(line - 1, lines.length - 1))
  const startIdx = Math.max(0, targetIdx - contextLines)
  const endIdx = Math.min(lines.length - 1, targetIdx + contextLines)
  const excerpt = lines.slice(startIdx, endIdx + 1).join('\n')
  const symbol = findNearestSymbol(lines, targetIdx)
  const imports = extractImports(lines)
  const excerpt_hash = createHash('sha256').update(excerpt).digest('hex').slice(0, 16)

  return {
    file: safeFile,
    line,
    symbol,
    excerpt_start_line: startIdx + 1,
    excerpt_end_line: endIdx + 1,
    excerpt,
    imports,
    excerpt_hash,
  }
}
