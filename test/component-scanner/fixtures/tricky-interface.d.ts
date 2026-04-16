// Fixture: a `.d.ts` file with cases the regex extractor historically choked on:
//  - multi-line union property types
//  - generic extends + heritage clause
//  - `extends` chain to a separate *Props interface
//  - @defaultValue JSDoc tags
//  - HintedString unwrap
//
// The TypeScript AST fallback in extractPropsFromDtsViaTs must handle all of these.

export interface BaseProps {
  /**
   * Unique element id.
   * @defaultValue null
   */
  id?: string | null
  /** CSS class applied to the root. */
  class?: string
}

/**
 * DataTable — a fancy table.
 */
export declare interface DataTableProps<T = any> extends BaseProps {
  /**
   * Array of rows. Multi-line type body used to break the regex extractor:
   */
  rows?: Array<{
    key: string
    value: T
  }>
  /**
   * Sort direction.
   * @defaultValue 'asc'
   */
  sortDir?: HintedString<'asc' | 'desc'>
  /** Required column count. */
  columns: number
  /** Internal PassThrough — must be skipped. */
  pt?: unknown
}

// Helper type the scanner should keep as `'asc' | 'desc'`.
export type HintedString<T extends string> = T | (string & {})
