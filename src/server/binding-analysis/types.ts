/**
 * Shared analyzer interface + context used by every per-framework binding
 * analyzer. Analyzers produce sites and prop edges (no file I/O, no
 * filesystem globbing — that lives in the orchestrator).
 */
import type { BindingSite, PropEdge } from '../../schema.js'

/** One extra tainted symbol seeded by prop propagation. */
export interface SeedSymbol {
  /** Identifier name that arrives tainted in this file (e.g. `planet`). */
  name: string
  /** Which source fed this symbol in through props. */
  source_name: string
}

export interface AnalyzeArgs {
  /** Project-relative forward-slash path. */
  file: string
  /** File contents. */
  content: string
  /** Root hook / composable / store name we're tracing, e.g. `usePlanets`. */
  source_name: string
  /** Optional: identifier aliases we've already resolved for this source
   *  (e.g. `[{ name: 'planets', source_name: 'usePlanets' }]`). Empty on the
   *  initial call for a file that directly imports the hook. */
  seeds?: SeedSymbol[]
}

export interface AnalyzeResult {
  sites: BindingSite[]
  prop_edges: PropEdge[]
  /** Identifier tainted by this analysis, ready for propagation. Shared with
   *  the caller so it can seed downstream child files. */
  tainted_symbols?: string[]
  /** Short note emitted in the diagnostic channel. */
  note?: string
}

export interface FrameworkBindingAnalyzer {
  /** Identifier used in diagnostics output. */
  id: string
  /** Quick file-extension gate — analyzer won't be called otherwise. */
  supports(file: string): boolean
  /** Perform the taint pass on one file. */
  analyze(args: AnalyzeArgs): Promise<AnalyzeResult | null>
}
