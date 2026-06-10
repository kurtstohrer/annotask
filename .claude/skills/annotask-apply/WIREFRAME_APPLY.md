# Wireframe Apply

Read this file for `wireframe_apply` tasks. If you are applying a batch, read it once for the batch, not once per instance.

A `wireframe_apply` task is created when the user drags components/elements from the Annotask palette onto the live app and clicks **Build this route**. It batches every placement on one route into a single task. Your job: write the placements into real source so they render the same way the user previewed them.

## Task context

`context.wireframe` contains:

- `route`: the iframe route the placements were made on (e.g. `/planets`).
- `instances[]`: one entry per placement.

Each instance contains:

- `id`: stable placement id.
- `kind`: `component` | `html` | `layout-preset`.
- `anchor`: where it goes — `{ file, line, position, component, targetTag }`.
  - `file`, `line`: the drop target's source location (`data-annotask-file` / `-line`). `line` is the target's **opening-tag** line.
  - `position`: `before` | `after` | `append` | `prepend` — placement relative to the target element.
  - `component`: the target's owning component (context).
- `inserted`: what to add — `{ tag, componentName?, library?, props?, classes?, text_content? }`. `inserted.props` are the REAL props.
- `previewProps` (optional): the display-only sample props the user actually saw rendered on the canvas (e.g. `{ label: "Button" }`). Use them as **hints** for sensible prop values and label text when `inserted.props` is empty or sparse — they show what the user previewed and approved. They are still samples: never lift fabricated event handlers, data bindings, or children from them.
- `fidelity`: how faithfully it previewed — `live` (rendered in real context), `isolated-preview` (rendered detached, no provider tree), `placeholder` (could not render). Lower fidelity is a hint that the component needs context/props you may have to wire by hand; it is not a blocker.
- `mounted`: whether the live preview produced output.
- `status` / `taskId`: lifecycle bookkeeping (`building` + the owning task id while you work). Read-only for you — see the lifecycle section below.

## Placement lifecycle (do NOT edit wireframe.json)

The placements also live in `.annotask/wireframe.json`, but the **server owns that file**:

- When the user **accepts** your task, the server removes its instances from `wireframe.json` automatically.
- When the user **deletes** the task, the server reverts its instances to `placed` so they can be rebuilt.
- When the user **denies** the task, the instances stay `building` — re-apply against the same task after reading `feedback`.

Never edit, rewrite, or "clean up" `wireframe.json` yourself — a manual edit races the server's revision counter and can clobber placements the user made in another tab. The task's `context.wireframe` is your complete, immutable input.

## Apply flow

1. Group `context.wireframe.instances` by `anchor.file`. Open each file once and apply all its placements in one pass, **bottom-up** (descending `anchor.line`): every insertion shifts the lines below it, so applying the highest line number first keeps the remaining anchors' line numbers valid without re-counting.
2. Locate the anchor element at `anchor.line` in that file. Insert the new markup relative to it per `anchor.position` (`before`/`after` = sibling; `append`/`prepend` = first/last child of the target). Match the file's framework (read `annotask_get_design_spec` for `framework` once) and the surrounding indentation.
3. Emit markup per `kind`:
   - **html** → the raw element: `<tag class="…">text_content</tag>` using `inserted.classes` / `inserted.text_content`. Omit empty attributes.
   - **layout-preset** → a styled wrapper (`<div class="…">` / `<section class="…">`) with `inserted.classes`. It has **no children** — leave it empty for the user to fill. Never fabricate children.
   - **component** → resolve the real import first (next step), then emit `<ComponentName …props />` (or framework equivalent) at the anchor and add the import if the file does not already import it.
4. For a `component`, call `annotask_get_component_examples` with `inserted.componentName` (and `inserted.library`) to get the **proven** import specifier + export kind (named vs default) from real in-repo usage. Use that exact import path. If there are no in-repo examples, fall back to `inserted.library` / the scanner `module`, and say so in your resolution — do **not** invent an import path.
5. Apply props from `inserted.props`, but only primitives that differ from the component's documented defaults. **Never fabricate** event handlers, data bindings, children, or named slots — if a component clearly needs them, note it in the resolution (or use `needs_info`).
6. After all placements land, set status to `review` with a per-instance resolution (what you inserted, where, and any import you had to guess).

## Edge cases

- If an `anchor.file`/`line` no longer matches the described element (source drifted since the placement), call `annotask_get_code_context` for the task to re-anchor; if you still can't place it, mark that instance and use `needs_info`.
- If a placement requires data/state that doesn't exist yet (e.g. a list component with no data source on the route), use `blocked_reason` to explain what's missing rather than fabricating data.

## Defaults

- One `wireframe_apply` task may touch multiple files and multiple frameworks (MFEs) — handle each file independently.
- The placements are a wireframe, not a final design: prioritize correct structure + real imports over pixel-perfect props.
