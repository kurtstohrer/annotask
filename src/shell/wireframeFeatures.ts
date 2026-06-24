/**
 * Release-scope flags for the wireframe surface.
 *
 * DATA BINDING is DEFERRED (off): binding a palette component or drawn section
 * to a real catalog data source (the picker, shape drill-down, prop→field map,
 * loop repeat). Deferred while the shape-confidence honesty ladder is reworked.
 * The code paths stay in the tree (and existing persisted bindings still render
 * read-only) — only the UI entry points are gated. Flip the flag to `true` to
 * re-enable when the feature is ready for the next release.
 *
 * EXPLODE is ON: the deep-dive into nested elements (double-click a captured
 * block to break it into its direct children, repeat to go deeper). It is
 * MFE-aware — re-resolution filters by the block's owning MFE so a package-local
 * path shared across MFEs (src/App.tsx) lands on the right one — and it handles
 * ANCHORLESS blocks (un-instrumented MFE/library DOM with no source anchor) by
 * re-resolving the live subtree GEOMETRICALLY, so they still decompose for
 * layout work instead of failing silently (see issue #54).
 */

export const WIREFRAME_DATA_BINDING_ENABLED = false
export const WIREFRAME_EXPLODE_ENABLED = true
