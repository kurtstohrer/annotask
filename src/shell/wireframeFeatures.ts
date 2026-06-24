/**
 * Release-scope flags for the wireframe surface.
 *
 * This release ships the REDUCED wireframe surface — capture + sketch + the
 * "implement this wireframe" directions loop — and DEFERS two areas that are
 * built but not yet release-ready:
 *
 *   - Data binding: binding a palette component or drawn section to a real
 *     catalog data source (the picker, shape drill-down, prop→field map, loop
 *     repeat). Deferred while the shape-confidence honesty ladder is reworked.
 *   - Explode-to-children: re-capturing one block a level deeper.
 *
 * The code paths stay in the tree (and existing persisted bindings still render
 * read-only) — only the UI entry points are gated. Flip a flag to `true` to
 * re-enable when the feature is ready for the next release.
 *
 * Explode is ON: it's the deep-dive into nested elements (double-click a
 * captured block to break it into its direct children, repeat to go deeper),
 * and it is MFE-aware — re-resolution filters by the block's owning MFE so a
 * package-local path shared across MFEs (src/App.tsx) lands on the right one.
 */

export const WIREFRAME_DATA_BINDING_ENABLED = false
export const WIREFRAME_EXPLODE_ENABLED = true
