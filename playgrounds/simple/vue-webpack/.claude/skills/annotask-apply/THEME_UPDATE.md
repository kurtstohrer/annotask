# Theme Update

Read this file for `theme_update` tasks. If you are applying a batch of theme tasks, read it once for the batch, not once per task.

## Task context

`theme_update` batches every token edit from one Theme-page commit into a single task.

The `context` object contains:

- `edits[]`: token edits
- `styling[]`: project styling methods such as `tailwind` or `scoped-css`
- `specFile`: relative path to `.annotask/design-spec.json`

Each edit contains:

- `category`: `colors` | `typography.families` | `typography.scale` | `spacing` | `borders.radius`
- `role`: semantic token role such as `primary` or `background`
- `cssVar`: CSS variable name when present, otherwise `null`
- `theme_variant`: variant id such as `light` or `dark`
- `theme_selector`: selector metadata describing which declaration block owns the value
- `before`, `after`
- `sourceFile`, `sourceLine`
- `isNew`

## Apply flow

1. Group `context.edits` by `sourceFile`.
2. For each existing source file, open it once and apply every edit in one pass.
3. Use `theme_selector` + `cssVar` to locate the correct block:
   - `{kind:'default'}` -> base `:root`
   - `{kind:'attribute', ...}` -> matching attribute-scoped block such as `:root[data-theme="dark"]`
   - `{kind:'class', ...}` -> matching class-scoped block such as `.dark`
   - `{kind:'media', ...}` -> matching media-query block
4. If `cssVar` is `null` and the file is `tailwind.config.*`, update the matching config key instead of searching CSS.
5. For `isNew: true`, add the token to the correct variant block. Create the block if it does not exist yet.
6. Patch `.annotask/design-spec.json` once at the end:
   - existing token -> update `values[theme_variant]`
   - new token -> append a token entry with `role`, `values`, `cssVar`, `sourceFile`, and `sourceLine`
7. Keep the existing JSON formatting so the file watcher emits a clean update.

## Defaults

- One `theme_update` task may touch multiple files.
- Edit source files before patching `.annotask/design-spec.json`.
- `theme_update` should land before any dependent `style_update` in the same apply run.
