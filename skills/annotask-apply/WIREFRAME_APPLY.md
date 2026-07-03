# Wireframe Apply

Read this file for `wireframe_apply` tasks. If you are applying a batch, read it once for the batch, not once per instance.

A `wireframe_apply` task arrives two ways:

1. **"Implement this wireframe"** — the user froze a route into a snapshot sketch (per-block images of the real render), rearranged it freely, and asked you to implement the intent. The task carries **wireframe directions** in `context.session.entries[]` (`change.type === 'wireframe_direction'`) plus a labeled before/after composite screenshot.
2. **"Build this route" / "Apply now"** — palette placements in `context.wireframe.instances[]` and/or design-session edits in `context.session.entries[]` (style/class/move/insert change types).

A task may carry both halves. Handle directions with the rules below; handle placements and other session entries with the later sections.

## Wireframe directions (`change.type: 'wireframe_direction'`)

The user rearranged a SKETCH — images of the rendered page, not the live app. The server diffed the sketch against the original capture into one direction per changed block:

- `op`: `move` | `resize` | `delete` | `add` | `note`.
- `block`: `{ label, component?, tag? }` — the block's identity as captured. Tool-derived, never invented.
- `file`/`line` (top level): the block's captured source anchor — or, for `add`, the nearest anchored NEIGHBOR block (see `added.position`).
- `measured`: TOOL-MEASURED geometry. `before`/`after` rects, `dx`/`dy`, `wPct`/`hPct` (percent of original), and `relations[]` — order-flip / full-width / alignment facts computed from box geometry (e.g. `"now above the filters (was below)"`).
- `added` (op `add` only): `kind` `component` (a real palette component — `componentName`/`library`/`module`/`props` are REAL scanner output) | `placeholder` (a user-drawn labeled box) | `duplicate` (another copy of a captured block's markup). `position` (`before`/`after`/`append`) is relative to the anchored neighbor. May carry `md` (the user's VERBATIM markdown spec for a drawn section), `data` (a binding to a REAL catalog data source — see *Data bindings on adds* below), and `mfe` (op `add` — **import-from**: the micro-frontend package to import the component FROM and to scope `annotask_get_component_examples` to).
- `mfe` (ops `move`/`resize`/`delete`/`note`, top level): **location** — the existing element LIVES in this micro-frontend's package. Distinct from `added.mfe`'s import-from meaning. See *Multi-MFE routes* below.
- `note`: the user's VERBATIM words for that block. `measured` is what the tool measured; `note` is what the user said — never conflate them, and never present a measured relation as a user request.

### Multi-MFE routes

A single-spa / module-federation route is composed of several micro-frontend packages. Capture decomposes each MFE into its own blocks, so one `wireframe_apply` task can span several packages:

- The top-level `file` on every direction is already **host-resolvable**: an element living in a sibling MFE is anchored relative to the host project root (e.g. `../mfe-react-workflows/src/Board.tsx`). Pass it verbatim to `annotask_get_source_excerpt` / `annotask_get_code_context` — they resolve it under the workspace root. Edit that exact file.
- `mfe` (and `added.mfe`) names the owning package. Two MFEs can expose the SAME package-local path (both `src/App.tsx`); the `file` already disambiguates them, and `mfe` tells you which package's conventions/imports to follow. For an `add`, import the component from `added.mfe`'s package and scope example lookups there.
- Group edits by `file` and apply each file independently (see *Defaults*). Undo/discard is byte-exact per MFE because each MFE's file is snapshotted under its own resolved path.

### Intent over pixels

**Pixel geometry is a hint; the relations are the contract.** `"now above the filters (was below)"` IS the instruction; `y 480→180` is evidence. Implement with idiomatic layout — reorder siblings, change flex/grid order, adjust column spans, use design tokens (`annotask_get_design_spec`) for sizes — never absolute positioning to hit coordinates. A resize of `+50% w` on a card grid usually means "fewer, larger columns", not `width: 1200px`.

### Use the visuals

The task screenshot (`annotask_get_screenshot`) is a labeled composite: **left = the captured render (truth at capture time); right = the user's sketch — rearranged images, not real UI.** Numbered badges on the right pane map 1:1 to the numbered directions in the task description. Look at it before writing code: spatial intent (what ended up next to what) is often clearer in the image than in prose.

### Per-op rules

- **move** — relocate the block's anchored markup to satisfy the relations. Apply per-file edits bottom-up (descending line); re-ground drifted anchors with `annotask_get_source_excerpt`. A loop-rendered block moves as the loop, not one iteration. An exploded container appears as both a container block and separate child blocks (each with finer anchors): directions on children mean restructuring INSIDE the container; a direction on the container means moving the whole thing, children included. (Explode-to-children is enabled — `WIREFRAME_EXPLODE_ENABLED=true`, MFE-aware — so tasks routinely carry exploded child blocks. Each child anchors a level DEEPER into the block's own source — never to host glue — so trust the child's finer `file`/`line` over the container's.)
- **resize** — prefer tokens/utility classes/grid-template changes over raw px. Say in the resolution what you chose and why.
- **delete** — remove the anchored markup. Remove now-dead local bindings only when provably unused; never delete shared code. A direction carrying `sharedAnchor: { ordinal, of }` (and a CAUTION in its description) targets loop-rendered markup — N blocks share one anchor, and removing the source element removes ALL of them. Verify with `annotask_get_binding_classification`; if the user meant one item, ask via `needs_info`.
- **add / component** — resolve the real import via `annotask_get_component_examples` (proven specifier + export kind). No in-repo examples → fall back to `library`/`module` and say so. Apply `added.props` primitives only; never fabricate handlers, bindings, or children. When `added.data` is present, wire the REAL source per *Data bindings on adds* below — never sample data.
- **add / placeholder** (bare — no `md`) — emit a *visibly labeled* placeholder element (e.g. `<div class="placeholder">pagination here</div>` styled per project conventions) or the minimal honest scaffold the label names. **Never fabricate data or content.**
- **add / placeholder with `added.md` (a drawn SECTION)** — the markdown is the user's verbatim spec for the region: build what it describes per project conventions (component-library-first — run the SKILL.md step-c lookups before writing custom HTML; design tokens for styling). Use `added.data` for any data the section shows. Data-driven content with NO binding → visible placeholder slots or `needs_info` — **never fabricate data or fields.**
- **add / duplicate** — duplicate the anchored block's markup. If it's loop-rendered, the user probably wants another ITEM or a second instance of the section — read the note/screenshot, ask via `needs_info` when ambiguous.
- **note** — implement the user's verbatim ask. Ambiguous → `needs_info`, never guess silently.

Before rewriting any expression or bound markup you encounter mid-edit, re-classify it against CURRENT source: `annotask_get_binding_classification` (CLI: `annotask binding-classify`). Never rewrite an expression that references variables.

### Anchorless directions (`file` is `''`)

A block from an un-instrumented region (production MFE remote, third-party bundle, geometric explode child) has no source anchor. Its direction instead carries `fingerprint: { selector, textHead, htmlHead }` and its description says so. Resolve it to source BEFORE editing:

1. Call `annotask_resolve_fingerprint` with `classes` = the class tokens in `selector` (if any), `text` = `textHead`, and `tag` = the selector's last segment's tag (or `block.tag`).
2. No tool / no hits? Grep the repo for the `htmlHead`'s distinctive class names or text literals instead.
3. Confirm the winning candidate with `annotask_get_source_excerpt` — the excerpt must actually contain the fingerprinted markup.
4. Candidates with similar scores are AMBIGUOUS — ask via `needs_info`, **never guess between them**. No candidate at all → `blocked_reason` (the source likely isn't in this repo).

A direction whose description says the anchor was **grep-resolved from a DOM fingerprint** carries a `file`/`line` the tool auto-resolved at capture time — treat it as a strong lead, not gospel: verify with `annotask_get_source_excerpt` that the excerpt actually contains the fingerprinted markup before editing (the `fingerprint` still rides the direction for re-resolution if it doesn't). A direction whose description says the markup was **produced by** an endpoint (e.g. `POST /search`) is a server-rendered fragment (htmx/Turbo) — there is no client component to edit, so find the server template behind that endpoint (grep routes/handlers for the path) and apply the change there.

### Data bindings on adds (`added.data`)

> **Gated off this release.** Wireframe data binding is DEFERRED (`WIREFRAME_DATA_BINDING_ENABLED=false` in `src/shell/wireframeFeatures.ts`), so new `wireframe_apply` tasks won't carry `added.data`. This section applies to legacy/older task files that already contain a binding — when one is present, wire it per the rules below.

`added.data` means "wire THIS source" — it is REAL scanner-catalog identity, never invented:

- `kind`/`name`/`module`/`endpoint`: the source as the project defines it (`module` is its defining file). `path` drills into the response shape (`planets[]` = the list; `data.user` = an object); `fields` are the keys the element should display.
- `shape_source` is the honesty tag for where the drill-down shape came from, backed by the verifiable-evidence fields on the binding:
  - `api-schema` — a real API contract matched the source's endpoint; the path/fields were picked off the actual response schema. The binding carries `match_confidence` (≥0.5), `schema_location`, `schema_kind`, `op` (`{method,path}` of the matched operation), `method`, and `resolved_endpoint` — re-ground against the SAME operation via `annotask_get_data_source_shape` (or `annotask_get_api_operation` for the full contract).
  - `source-details` — regex-inferred return-type hints only, with `details_confidence` (high|medium|low). No response tree — re-verify against the real definition before relying on field names.
  - `none` — nothing was resolved; treat any path as blind.
- `path_source` says whether to trust `path` directly: `schema-picked` = drilled from a real schema tree (verified against the contract — trust it); `user-typed` = the user typed it into free text (an UNVERIFIED assertion — re-ground before wiring); `none` = no path.
- **Re-grounding protocol (always):** call `annotask_get_data_source_shape` to re-resolve the shape honesty tier (and disambiguate a name collision with `method`/`line`), `annotask_get_data_source_details` for the definition, and `annotask_get_data_source_examples` for the proven import + call pattern — wire the source the way the project already wires it (same import specifier, same destructuring, loops/`v-for` over the `path` collection, render the `fields`). A `user-typed` path MUST be re-grounded against the definition before you trust it.
- The binding contradicts current source (source renamed, field gone, shape changed)? → `needs_info` with what you found. **Never invent fields**; runtime endpoints carry no response shapes — don't pretend otherwise.

### Verification & status

Directions are spatial — the server does NOT verify them against source. When you set `review`, direction entries flip `written` on trust (bindings included — their wiring rides the trusted resolution); **your resolution is the only record of what actually landed**, so make it specific and honest per direction: which file(s), what structural change, for bindings the imported source + call site + rendered fields, any file you created (name new files explicitly — in git projects the server nets newly-created files into the undo batch, but your resolution is still the human-readable record). `blocked_reason` when a direction is impossible; `needs_info` for ambiguity; denied → read `feedback` and re-apply the same task.

## Placements (`context.wireframe`)

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

### Apply flow for placements

1. Group `context.wireframe.instances` by `anchor.file`. Open each file once and apply all its placements in one pass, **bottom-up** (descending `anchor.line`): every insertion shifts the lines below it, so applying the highest line number first keeps the remaining anchors' line numbers valid without re-counting.
2. Locate the anchor element at `anchor.line` in that file. Insert the new markup relative to it per `anchor.position` (`before`/`after` = sibling; `append`/`prepend` = first/last child of the target). Match the file's framework (read `annotask_get_design_spec` for `framework` once) and the surrounding indentation.
3. Emit markup per `kind`:
   - **html** → the raw element: `<tag class="…">text_content</tag>` using `inserted.classes` / `inserted.text_content`. Omit empty attributes.
   - **layout-preset** → a styled wrapper (`<div class="…">` / `<section class="…">`) with `inserted.classes`. It has **no children** — leave it empty for the user to fill. Never fabricate children.
   - **component** → resolve the real import first, then emit `<ComponentName …props />` (or framework equivalent) at the anchor and add the import if the file does not already import it.
4. For a `component`, call `annotask_get_component_examples` with `inserted.componentName` (and `inserted.library`) to get the **proven** import specifier + export kind (named vs default) from real in-repo usage. Use that exact import path. If there are no in-repo examples, fall back to `inserted.library` / the scanner `module`, and say so in your resolution — do **not** invent an import path.
5. Apply props from `inserted.props`, but only primitives that differ from the component's documented defaults. **Never fabricate** event handlers, data bindings, children, or named slots — if a component clearly needs them, note it in the resolution (or use `needs_info`).
6. After all placements land, set status to `review` with a per-instance resolution (what you inserted, where, and any import you had to guess).

## Other design-session edits (`context.session`)

`context.session` may also carry non-direction entries — the user's design-session edits:

- `session_id`: bookkeeping. The server owns `.annotask/design-session.json`, `.annotask/wireframe.json` (which also carries the canvas sketch), and `.annotask/file-snapshots.json` — **never edit, rewrite, or clean up those files yourself**. Apply through source code only; the server verifies your work and updates the session when you set `review`.
- `entries[]`: each is `{ id, change, anchor, evidence?, instance_id? }`.
  - `change` is one of the structured change types (`style_update`, `class_update`, `component_insert`, legacy `component_prop_update`/`text_update`/`component_move`, …) — apply each per the change-type rules in SKILL.md step d.
  - `anchor` (`{ file, line, targetTag? }`) is where the edit was recorded. Your own earlier edits in the same run shift lines — apply **bottom-up per file** like placements, and re-ground via `annotask_get_source_excerpt` when an anchor doesn't match.
  - `evidence.classification` (legacy `component_prop_update`/`text_update` entries only) is the round-trip-honesty proof from when the user made the edit: `literal` edits rewrite a plain literal in place; `expression-literal` edits keep the binding syntax (`:count="3"` → `:count="4"`); `bound` edits never appear (the UI refused them). If what you find at the anchor contradicts the evidence, the source drifted — re-anchor or ask via `needs_info`, never rewrite an expression.
- Prefer idiomatic placement over literal transcription: if a `style_update` matches a design token (`token_role` present, or an obvious token in `annotask_get_design_spec`), apply the token/class rather than a raw value, and say so in the resolution.
- After you set `review`, the server re-reads the source per entry and marks each `written` or `failed` (directions are trusted — see above) — a `failed` badge in the user's panel means your edit wasn't found where expected, so make resolutions specific about what landed where.

## Lifecycle (do NOT edit .annotask files)

- When the user **accepts** your task, the server removes its instances and the implemented canvas sketch from `wireframe.json` automatically.
- When the user **deletes** the task, the server reverts instances to `placed` and unlocks the sketch (`building` → `sketch`) so the user can tweak and re-implement.
- When the user **denies** the task, everything stays locked to your task — re-apply against the same task after reading `feedback`.

## Edge cases

- If an `anchor.file`/`line` no longer matches the described element (source drifted since the capture/placement), call `annotask_get_code_context` for the task to re-anchor; if you still can't place it, mark that instance/direction and use `needs_info`.
- If a placement or direction requires data/state that doesn't exist yet (e.g. a list component with no data source on the route), use `blocked_reason` to explain what's missing rather than fabricating data.

## Defaults

- One `wireframe_apply` task may touch multiple files and multiple frameworks (MFEs) — handle each file independently.
- The sketch is a wireframe, not a final design: prioritize correct structure, real imports, and the stated relations over pixel-perfect geometry.
