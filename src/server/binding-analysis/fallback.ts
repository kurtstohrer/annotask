/**
 * File-level fallback analyzer. Emits one (file, line=0) site for the file
 * itself, marked with an empty tainted_symbols list. The iframe handler turns
 * line=0 into "all elements in this file", matching the previous coarse
 * behavior. Used when no framework-specific parser is installed or the
 * framework isn't supported by this analyzer set (e.g. Astro, raw HTML).
 */
import type { FrameworkBindingAnalyzer, AnalyzeArgs, AnalyzeResult } from './types.js'

const EXT_RE = /\.(vue|tsx?|jsx?|svelte|astro|html?|mjs)$/i

export const fallbackAnalyzer: FrameworkBindingAnalyzer = {
  id: 'file-level-fallback',
  supports(file: string) {
    return EXT_RE.test(file)
  },
  async analyze(args: AnalyzeArgs): Promise<AnalyzeResult | null> {
    // Only return a fallback site if the source name or any seed is actually
    // mentioned somewhere in the file — otherwise file-level would match
    // every file we scanned, which is worse than the current behavior.
    const haystack = args.content
    const names = [args.source_name, ...(args.seeds?.map(s => s.name) ?? [])]
    if (!names.some(n => n && haystack.includes(n))) return null
    return {
      sites: [{ file: args.file, line: 0, tainted_symbols: [args.source_name] }],
      prop_edges: [],
      note: 'file-level fallback (no AST parser available)',
    }
  },
}
