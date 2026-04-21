/**
 * Definition-level detail lookup for project data sources. Next layer up from
 * the catalog in data-source-scanner.ts: caller has a name, wants the shape —
 * signature, return type, excerpt, imports, siblings, referenced types.
 *
 * Regex-only in V1 by design. The TypeScript compiler API is not used anywhere
 * else in the server for user-code resolution, and pulling it in for one tool
 * would add ~40MB runtime deps for features most projects do not use today.
 * Confidence is reported honestly so agents can fall back to a follow-up Read
 * when the regex answer looks thin.
 */
import fsp from 'node:fs/promises'
import { resolveProjectFile } from './path-safety.js'
import { scanDataSources } from './data-source-scanner.js'
import type {
  DataSource,
  DataSourceDetails,
  DataSourceDetailsResult,
  ProjectDataEntry,
} from '../schema.js'

const DEFAULT_CONTEXT_LINES = 15
const MAX_CONTEXT_LINES = 40          // matches code-context.ts hard cap at ±40 → 80 lines total
const MAX_SIGNATURE_LINES = 12         // how far forward to look for the signature closer
const MAX_IMPORTS_SCAN_LINES = 80

export interface ResolveArgs {
  projectRoot: string
  name: string
  kind?: DataSource['kind']
  file?: string
  contextLines?: number
  workspaceRoot?: string
}

/**
 * Resolve a data source name to a DataSourceDetails object, or an ambiguity /
 * not-found marker. Callers should test `'error' in result` to disambiguate.
 */
export async function resolveDataSourceDetails(args: ResolveArgs): Promise<DataSourceDetailsResult> {
  const { projectRoot, name, kind, file, workspaceRoot } = args
  const contextLines = clampContext(args.contextLines)

  const catalog = await scanDataSources(projectRoot)
  let candidates = catalog.project_entries.filter(e => e.name === name)
  if (kind) candidates = candidates.filter(e => e.kind === kind)
  if (file) candidates = candidates.filter(e => e.file === file)

  if (candidates.length === 0) {
    return { error: 'not_found', name }
  }

  if (candidates.length > 1) {
    return {
      error: 'ambiguous',
      candidates: candidates.map(c => ({
        name: c.name,
        kind: c.kind,
        file: c.file,
        line: c.line ?? 1,
      })),
    }
  }

  const entry = candidates[0]
  return await buildDetails(projectRoot, entry, catalog.project_entries, contextLines, workspaceRoot)
}

async function buildDetails(
  projectRoot: string,
  entry: ProjectDataEntry,
  allEntries: ProjectDataEntry[],
  contextLines: number,
  workspaceRoot?: string,
): Promise<DataSourceDetails> {
  const line = entry.line ?? 1

  const resolved = resolveProjectFile(projectRoot, entry.file, workspaceRoot)
  const siblings = collectSiblings(entry, allEntries)

  if (!resolved) {
    return minimalDetails(entry, siblings, 'low')
  }

  let content: string
  try {
    content = await fsp.readFile(resolved.absolutePath, 'utf-8')
  } catch {
    return minimalDetails(entry, siblings, 'low')
  }

  const lines = content.split(/\r?\n/)
  const targetIdx = Math.max(0, Math.min(line - 1, lines.length - 1))
  const startIdx = Math.max(0, targetIdx - contextLines)
  const endIdx = Math.min(lines.length - 1, targetIdx + contextLines)
  const body_excerpt = lines.slice(startIdx, endIdx + 1).join('\n')
  const imports = extractImports(lines)

  const { signature, return_type, referenced_types, confidence } = extractSignature(lines, targetIdx)

  return {
    name: entry.name,
    kind: entry.kind,
    file: entry.file,
    line,
    resolved_by: 'regex',
    confidence,
    signature,
    return_type,
    body_excerpt,
    excerpt_start_line: startIdx + 1,
    excerpt_end_line: endIdx + 1,
    imports,
    siblings,
    referenced_types,
  }
}

function minimalDetails(
  entry: ProjectDataEntry,
  siblings: DataSourceDetails['siblings'],
  confidence: DataSourceDetails['confidence'],
): DataSourceDetails {
  return {
    name: entry.name,
    kind: entry.kind,
    file: entry.file,
    line: entry.line ?? 1,
    resolved_by: 'regex',
    confidence,
    body_excerpt: '',
    excerpt_start_line: entry.line ?? 1,
    excerpt_end_line: entry.line ?? 1,
    imports: [],
    siblings,
  }
}

function collectSiblings(entry: ProjectDataEntry, all: ProjectDataEntry[]): DataSourceDetails['siblings'] {
  const out: DataSourceDetails['siblings'] = []
  for (const other of all) {
    if (other.file !== entry.file) continue
    if (other.name === entry.name && other.line === entry.line) continue
    out.push({ name: other.name, kind: other.kind, line: other.line ?? 1 })
  }
  return out
}

/**
 * Walk forward from the definition line collecting the signature until the
 * opener (`{`, `=>`, `;`). Most data-source definitions fit in one line; a few
 * (e.g. generic hooks with many type params) span two or three.
 */
function extractSignature(lines: string[], targetIdx: number): {
  signature?: string
  return_type?: string
  referenced_types?: string[]
  confidence: DataSourceDetails['confidence']
} {
  const pieces: string[] = []
  let closed = false
  for (let i = targetIdx; i < Math.min(lines.length, targetIdx + MAX_SIGNATURE_LINES); i++) {
    pieces.push(lines[i])
    const joined = pieces.join('\n')
    // Stop at the first line that contains a body opener outside nested brackets.
    if (/[{;]\s*$/.test(lines[i]) || /=>\s*$/.test(lines[i]) || /=>\s*[^=]/.test(lines[i])) {
      closed = true
      break
    }
  }

  if (pieces.length === 0) {
    return { confidence: 'low' }
  }

  const raw = pieces.join('\n').trim()
  // Trim trailing `{`, `=>`, or arrow-function body markers for readability.
  const signature = raw
    .replace(/\s*\{\s*$/, '')
    .replace(/\s*=>\s*$/, '')
    .trim()

  const return_type = parseReturnType(raw)
  const referenced_types = collectReferencedTypes(raw)

  let confidence: DataSourceDetails['confidence']
  if (signature && closed && return_type) confidence = 'high'
  else if (signature && closed) confidence = 'medium'
  else confidence = 'low'

  return {
    signature: signature || undefined,
    return_type,
    referenced_types: referenced_types.length > 0 ? referenced_types : undefined,
    confidence,
  }
}

/**
 * Pull the return-type annotation out of a collected signature. Handles the
 * common JS/TS forms:
 *   function useFoo(...): ReturnType { ... }
 *   function useFoo(...): ReturnType
 *   const useFoo = (...): ReturnType => ...
 *   export const fooAtom: Atom<T> = atom(...)
 */
function parseReturnType(signature: string): string | undefined {
  // function-form: `): Foo {` or `): Foo =>` or `): Foo` at end of line
  const fn = signature.match(/\)\s*:\s*([^{=;]+?)\s*(?:=>|\{|$)/)
  if (fn && fn[1]) {
    const cleaned = fn[1].trim()
    if (cleaned && !/^\s*$/.test(cleaned)) return cleaned
  }
  // assignment-form: `const foo: Type =`
  const assign = signature.match(/\bconst\s+[A-Za-z_$][\w$]*\s*:\s*([^=]+?)\s*=/)
  if (assign && assign[1]) {
    const cleaned = assign[1].trim()
    if (cleaned) return cleaned
  }
  return undefined
}

/**
 * Scan the signature for capitalized type identifiers. Biased toward common
 * positions (after `:`, inside `<>`, after `extends`) to avoid picking up
 * local variable names that happen to start with a capital.
 */
function collectReferencedTypes(signature: string): string[] {
  const seen = new Set<string>()
  const regions: string[] = []
  // After a colon: `: Foo`, `: Foo<Bar>`, `: Foo | Bar`
  const colonMatches = signature.matchAll(/:\s*([A-Z][\w$]*(?:\s*[<|&,]\s*[A-Z][\w$]*)*)/g)
  for (const m of colonMatches) regions.push(m[1])
  // Inside <>
  const genericMatches = signature.matchAll(/<([^<>]*)>/g)
  for (const m of genericMatches) regions.push(m[1])
  // extends clauses
  const extendsMatches = signature.matchAll(/\bextends\s+([A-Z][\w$<>,\s|&]*)/g)
  for (const m of extendsMatches) regions.push(m[1])

  for (const region of regions) {
    const ids = region.matchAll(/\b([A-Z][\w$]*)\b/g)
    for (const id of ids) {
      const name = id[1]
      if (PRIMITIVE_TYPES.has(name)) continue
      seen.add(name)
    }
  }
  return [...seen]
}

const PRIMITIVE_TYPES = new Set([
  'Array', 'ReadonlyArray', 'Readonly', 'Partial', 'Record', 'Pick', 'Omit',
  'Promise', 'T', 'U', 'K', 'V', 'R',
])

/**
 * Import block from the file head — same heuristic as code-context.ts.
 * Duplicated rather than exported-from to keep this module standalone while the
 * interface is still churning; a shared util can land once both modules
 * stabilize.
 */
function extractImports(lines: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < Math.min(lines.length, MAX_IMPORTS_SCAN_LINES); i++) {
    const trimmed = lines[i].trim()
    if (trimmed === '') continue
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('*/')) continue
    if (/^import\b/.test(trimmed) || /^export\s+(?:\*|\{)/.test(trimmed) || /^const\s+\w+\s*=\s*require\(/.test(trimmed)) {
      out.push(trimmed)
      continue
    }
    if (/^<script\b/.test(trimmed) || /^<\/script>/.test(trimmed) || /^<template\b/.test(trimmed) || /^<style\b/.test(trimmed)) continue
    break
  }
  return out
}

function clampContext(n: number | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return DEFAULT_CONTEXT_LINES
  return Math.min(Math.floor(n), MAX_CONTEXT_LINES)
}
