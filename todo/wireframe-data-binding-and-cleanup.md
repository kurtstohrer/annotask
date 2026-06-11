# Kickoff: Wireframe Data Binding + Tool Consolidation

> Paste this as the opening prompt for a fresh session. Self-contained handoff.
> Predecessor: `todo/snapshot-wireframe-mode.md` (fully implemented — strip + W1–W4 landed
> on `feat/embedded-agents`, commits `153e617`…`1019b60`; the apply loop is proven live
> with a real claude CLI).

## The goal, and why

Wireframe mode works: capture → manipulate → anchored directions → embedded agent →
byte-exact undo. But the sketch's NEW material is still data-blind and the tool surface
has leftovers from earlier eras:

1. **Component drops look wrong and are configured blind.** The palette drop snapshots a
   component on a hardcoded WHITE card (`preview:component` sets
   `background:#ffffff;color:#111111` on the offscreen container and
   `backgroundColor:'#ffffff'` in the html2canvas call — `src/plugin/bridge/messages.ts`
   ~1315/1331), which sticks out badly on dark apps. And the drop is one-shot: no chance
   to set props or say what DATA the component should render before the image exists.
2. **The section tool lives in the wrong tab.** Drawing a region and describing it in
   markdown is a *wireframing* gesture, not an annotation gesture — and today it mints a
   standalone `section_request` task instead of riding the wireframe's single apply task.
3. **The Reposition tool is obsolete.** Live structural moves were the old live-edit
   answer; wireframe mode IS how you move things now. Reposition's shield/bridge/journal
   surface is dead weight.
4. **Data bindings are the missing half of "add a component/section".** Annotask already
   knows the project's data sources (scanner catalog, API schemas, runtime endpoints) —
   the sketch should let the user SAY which source feeds a new component/section, and
   drill into the shape ("the `items[]` of this response, show `name` + `price`"), so the
   agent wires the real hook instead of guessing.

Standing decision (unchanged, do not relitigate): **the agent writes all application
source; the tool only snapshots/restores files.** One `wireframe_apply` task per route.
Never fabricate — bindings reference REAL catalog entries, sections stay visibly sketches.

## Where we are (verify with `git log` — all committed on `feat/embedded-agents`)

The wireframe stack this builds on:

- **Canvas + capture**: `wireframe:capture` bridge message (block discovery, per-block
  html2canvas, full-page "before", shell-backdrop explode via `onclone` child-hiding),
  `useWireframeMode.ts` (enter/exit/recapture/explode/implement/undo, block ops),
  `WireframeCanvas.vue` (drag+snap guides, multi-select/marquee, nudge, notes, soft
  delete, placeholder draw tool, palette drop), PNGs in `.annotask/wireframe-snapshots/`
  (id-addressed upload/serve/delete + boot GC), per-route `canvas` in `wireframe.json`.
- **Directions + apply**: `computeWireframeDirections` (`src/shell/utils/wireframeDirections.ts`)
  diffs sketch vs capture into ONE anchored `wireframe_direction` per block (relations
  are the contract, pixels are hints); `wireframeComposite.ts` builds the labeled
  before/after; directions ride session entries through `applyDesignSession`
  (route-scoped) with trust-verify; canvas locks `building` → task; accept/undo/discard
  ride the file-snapshot engine (which also nets agent-CREATED files in git projects).
  Playbook: `skills/annotask-apply/WIREFRAME_APPLY.md`.
- **Data machinery (read-side, already shipped)**:
  - `src/server/data-source-scanner.ts` → catalog of `DataSource` entries
    (`kind: composable|signal|store|fetch|graphql|loader|rpc`, real `name`/`module`,
    `endpoint`, `response_schema_ref` when an API schema cross-matched) — HTTP
    `/api/data-sources`, MCP `annotask_get_data_sources`.
  - `src/server/data-source-details.ts` → definition-level shape (signature, return
    type, excerpt; regex-V1 with HONEST confidence) — `/api/data-source-details/:name`.
  - `src/server/api-schema-scanner.ts` + `api-schema-resolver.ts` → `ApiOperation` with a
    real `response_schema` (OpenAPI 200/201, GraphQL field type, tRPC output) —
    `/api/api-operation`, `annotask_get_api_operation`. **This is the drill-down's shape
    source.** Runtime endpoints (`runtime-endpoints.ts`) store sample URLs only, NOT
    response bodies — no shape from there without new capture work (out of scope; say so
    in the picker when a source has no shape).
- **Live test template**: `src/server/__tests__/apply-session-matrix.test.ts`
  (`ANNOTASK_LIVE_CLI=1`) — extend its directions fixture for binding payloads.

## Work item 1 — Component generation flow (replaces blind drag-drop)

Kurt's flow (this IS the design, fill in mechanics): **user picks component → user sets
settings → user picks datasource (if applicable) → annotask gens component → annotask
gens image → user places image.**

- Quick fix first (independent, do it early): the white card. `preview:component` should
  capture on the APP's surface, not `#ffffff` — read the iframe's real background
  (`getComputedStyle(document.body).backgroundColor`, fall back through
  `detectColorScheme()`'s luminance probe which already exists in the bridge) for both
  the container style and the h2c `backgroundColor`. Keep a light/dark-safe text color
  the same way. This fixes every existing drop immediately.
- The flow: clicking (or dropping) a palette component opens a **Generate component**
  panel instead of instantly minting a block:
  1. *Settings* — prop widgets (reuse `src/shell/utils/propWidgets.ts` exactly as
     ComponentPreview's sample-prop editor does; real props vs preview samples stay
     separate, as `WireframeInstance` already models with `props` vs `previewProps`).
  2. *Datasource (if applicable)* — the picker from work item 4. "If applicable" =
     offer it when the component has list/object-ish props or the user opts in; never
     require it.
  3. *Generate* — mount via `preview:component` with the chosen preview props on the
     app-true background; show the honest fidelity (live / isolated-preview /
     placeholder render — pills already exist).
  4. *Place* — the generated image rides the cursor (ghost at pointer); click places the
     block. Re-generate stays one click away (settings changed → new snapshot).
- The placed block keeps everything for the direction: `component` ref (REAL
  name/module), `props`, `previewProps`, and the new `data` binding (work item 4) so the
  `add` direction tells the agent exactly what to wire.
- Decide during planning: does plain drag-drop survive as a fast path (drop = open the
  panel pre-placed at the drop point)? Recommended: yes — drop opens the panel with the
  position remembered, so the old gesture still works but never produces a blind block.
- Gotcha that already bit once: anything crossing `postMessage` must be plain JSON — the
  palette drag item is a Vue reactive proxy and threw `DataCloneError` until
  `dropPaletteItem` deep-cloned props. The new flow passes MORE structured config across
  the bridge; clone at the boundary, always.

## Work item 2 — Section tool moves into wireframe mode

The drawn-section tool (markdown region requests) leaves the Annotate tab and becomes
wireframe sketch material: **the user maps out a region of the screen and writes in
markdown what they want there** — plus a datasource mapping when the content is
data-driven.

- Current footprint to migrate/strip: `DrawnSectionOverlay.vue` (the overlay + drag/
  resize/md editor — pattern donor for the canvas version), `useAnnotations.ts`
  (`DrawnSection` state), `useCanvasDrawing.ts` (draw rect plumbing),
  `useTaskWorkflows.ts` (~line 325: section → standalone `section_request` task — THIS
  stops), App.vue wiring, interaction mode `draw` + its ModeToolbar button (editor tab)
  and HelpOverlay entry.
- In wireframe mode, **merge with the existing placeholder tool** — one concept, not
  two. A drawn box gains: `label` (existing), optional markdown body (`md`), optional
  `data` binding (work item 4). The wireframe placeholder draw tool becomes "draw a
  section"; the quick label-only flow must stay as cheap as it is today (label input on
  release; expand to the md editor on demand).
- UX improvements while we're here (Kurt asked for a general improvement; planning
  decides specifics): edit/preview md toggle (DrawnSectionOverlay already has the
  pattern + `safeMd`), a proper editor popover that doesn't fight the canvas drag,
  visible "section" affordance distinct from bare placeholders, and the md body
  surfaced in the block's note channel UI.
- **Sections do NOT create tasks.** They diff into the wireframe's `add` direction
  (`added.kind: 'placeholder'` grows `md`/binding fields — or a new `'section'` kind;
  planning decides, additive either way) and ride the ONE `wireframe_apply` task.
  `section_request` stays in `TASK_TYPES` + SKILL.md as a documented legacy type
  (the component_prop_update/text_update precedent), the Annotate tab just stops
  emitting it. The md body is USER-SAID material — it travels verbatim, never blended
  with tool-measured geometry.

## Work item 3 — Remove the Reposition tool everywhere

Wireframe mode is the only "move things" surface in Design now. Strip Reposition
cleanly (the live-edit strip is the template — tree green at every step, no dead
surface):

- Shell: `useRepositionMode.ts` (delete), `useWireframeCanvas.ts` (the
  `onRepositionPointer*` handlers, `reposition.containerEids`/`registerContainer`
  plumbing — note `reapply`'s `onInstanceMounted` callback feeds it), App.vue
  (`reposition-shield`, handler bindings), `AppToolbar.vue`/`ModeToolbar.vue` buttons,
  `useInteractionMode.ts` (`'reposition'` member), `HelpOverlay.vue` entry.
- Theme surface: `--mode-reposition` in `src/shell/themes/types.ts` + `builtin.ts` +
  `ShellThemeEditor.vue` + `_toolbar.css`/`_canvas.css` — removing a THEME VARIABLE
  touches the 63-var contract documented in CLAUDE.md; update the count + docs, and
  check custom-theme localStorage tolerance (extra keys in saved themes must not break
  `useShellTheme`).
- Bridge: `resolve:move-source` (messages.ts ~222) + `move:element` (~1518) handlers,
  `useIframeManager.resolveMoveSource`/`moveElement`, `ResolveMoveSourceResult` in
  `bridge-types.ts`. Bridge code is a stringified template — typecheck can't catch
  stragglers; gate with `pnpm build:plugin` + a browser smoke.
- Journal: `useStyleEditor.recordMove` is reposition's only emitter — stop emitting,
  keep `MoveChangeRecord`/`component_move` in the schema + SKILL.md as legacy (same
  treatment as prop/text). `useWireframeDoc.updateInstance` stays (generic API).
- Watch for kept code hiding in the footprint (the live-edit strip's lesson):
  `dropPositionFor` + the drop-indicator in `useWireframeCanvas.ts` serve the LIVE
  palette-drop path too — Reposition only shares them.
- Decide during planning: does the live palette-drop-into-iframe path (M1 placements +
  Build) survive this round? It's untouched by these work items, but with wireframe
  drops becoming the primary flow, consider whether Build-from-live-placements should
  be folded into wireframe entirely in a later pass. Out of scope here; leave working.

## Work item 4 — Datasource mapping with shape drill-down

When a wireframe component or section is data-driven, the user picks the source AND
drills into **what data the element shows** (items of a list, keys of an object).

- **Binding payload** (the contract; lives in `src/shared/wireframe-types.ts`, additive):

  ```ts
  interface WireframeDataBinding {
    /** REAL catalog identity — scanner names, never invented. */
    kind: DataSource['kind']            // composable | store | fetch | graphql | …
    name: string                        // e.g. "useUserQuery"
    module?: string
    endpoint?: string
    /** Drill-down into the resolved shape, user-selected.
     *  e.g. "items[]" (the list), "data.user" (an object). */
    path?: string
    /** Keys the element should display, when the user narrowed them.
     *  e.g. ["name", "price"]. */
    fields?: string[]
    /** Where the shape came from — the honesty tag the agent sees.
     *  'api-schema' (real contract) | 'source-details' (regex inference,
     *  confidence attached) | 'none' (user typed the path blind). */
    shape_source: 'api-schema' | 'source-details' | 'none'
  }
  ```

- **Shape sources, in fidelity order** (surface which one the picker is showing):
  1. `ApiOperation.response_schema` via the `DataSource.response_schema_ref`
     cross-match — a real JSON schema; drill-down walks `properties`/`items`.
  2. `DataSourceDetails` return type (regex-V1, honest `confidence`) — offer
     best-effort keys, labeled as inferred.
  3. Nothing — free-text path input, `shape_source: 'none'`, visibly so.
  Runtime endpoints have **no captured response shapes** (sample URLs only) — don't
  pretend otherwise; capturing live response shapes is a separate future feature.
- **Picker UI**: search the catalog (the Data view + `useProjectComponents` list
  patterns exist), pick a source, then an expandable shape tree (arrays expandable into
  their item shape, objects into keys, multi-select leaf keys → `fields`). Keep it
  honest: show `kind`, `module`, the shape-source tag, and the schema ref name.
- **Where bindings attach**: palette blocks (`component` ref) and sections — stored on
  the `WireframeBlock` (`data?: WireframeDataBinding`), persisted in `wireframe.json`
  (validator: additive, optional, reject malformed), carried into the `add` direction
  (`added.data`) by `computeWireframeDirections`.
- **Agent contract** (playbook + schema doc): `added.data` means "wire THIS source" —
  re-ground via `annotask_get_data_source_details` / `annotask_get_data_source_examples`
  for the proven import + call pattern, use `annotask_get_api_operation` when a
  `response_schema_ref` exists, map `path`/`fields` onto the real shape, and
  `needs_info` when the binding contradicts current source (never invent fields).
  Update `WIREFRAME_APPLY.md` + the matrix live test with a binding fixture (a list
  component bound to a catalog fetch source — assert the agent imports/calls the REAL
  source, not a fabricated one).

## Milestones (each ends shippable, `pnpm typecheck` + `pnpm test` green)

- **D1 — Reposition removal** (work item 3). Pure strip, lowest risk, shrinks the
  surface everything else touches. Accept: no reposition affordance anywhere; palette
  live-drop + Build still work; bridge builds + browser smoke pass.
- **D2 — App-true preview background.** The small `preview:component` fix (container +
  h2c background from the live page). Accept: a component dropped on the dark vue-vite
  playground no longer renders a white card.
- **D3 — Binding foundation + picker.** `WireframeDataBinding` schema + validators, a
  shape-resolution endpoint that walks `response_schema`/details for a named source
  (server work; unit-test the walker against an OpenAPI fixture), and the picker
  component with drill-down + honest shape-source labels.
- **D4 — Component generation flow** (work item 1, using D3's picker). Accept: pick →
  settings → (datasource) → generate → place on `/planets`; the placed block carries
  props + binding; regenerate works; drag-drop fast path opens the same panel.
- **D5 — Sections into wireframe** (work item 2, using D3's picker). Accept: draw a
  section in wireframe mode, write md, bind a source, F5-restore intact; the Annotate
  tab no longer offers the section tool; no `section_request` task is created.
- **D6 — Directions + playbook + live proof.** `added` payload extensions, composite
  rendering for md sections, `WIREFRAME_APPLY.md` rewrite of the add rules,
  `apply-session-matrix.test.ts` binding fixture run live
  (`ANNOTASK_LIVE_CLI=1 ANNOTASK_LIVE_ONLY=claude`), e2e extension of
  `e2e/vue-vite.wireframe.test.ts`.

## How to test (hard-won gotchas — do not rediscover)

- Rebuild before browser testing: `pnpm build:plugin && pnpm build:shell`, RESTART the
  dev server, clear `playgrounds/simple/vue-vite/.annotask/cache` +
  `node_modules/.vite`. Bridge code is a stringified template — typecheck cannot catch
  dangling references inside it.
- Anything crossing `postMessage` must be plain JSON — Vue reactive proxies throw
  `DataCloneError` (this silently degraded every palette drop once).
- Playwright runs separate spec FILES in parallel workers: e2e suites sharing one dev
  server's state must live in ONE file (`e2e/vue-vite.wireframe.test.ts` is the
  serialization boundary — extend it, don't add sibling vue-vite wireframe files).
- Headless WSL: `domcontentloaded` + fixed settle, never `networkidle`; boot via
  `e2e/helpers/design-tool.ts` (`bootDesignShell` seeds matter). Intercept
  `**/api/solar/planets*`. The 2 `networkidle` smoke tests fail without the FastAPI on
  :8888 — pre-existing.
- `pkill -f vite` (or any pattern matching your own command line, e.g. "vue-vite")
  kills your own shell — use `pkill -f "playgrounds/simple"` and accept exit 144.
- Visual claims need eyes: screenshot via a throwaway Playwright script and READ the
  PNG (this is how the white-bg and explode-styling bugs were confirmed).
- Live agent loop: adapt `apply-session-matrix.test.ts`, run with
  `ANNOTASK_LIVE_CLI=1 ANNOTASK_LIVE_ONLY=claude npx vitest run src/server/__tests__/apply-session-matrix.test.ts`.

## Decisions already made (don't relitigate)

- The agent writes all application source; the tool only snapshots/restores files.
- ONE `wireframe_apply` task per route; sections/components ride it as directions —
  no standalone tasks from wireframe material.
- The component-add flow is: pick → settings → datasource (if applicable) → generate →
  image → place (Kurt's design).
- The section tool leaves the Annotate tab; Reposition is removed everywhere.
- Bindings reference REAL catalog entries with an honest `shape_source` tag; runtime
  endpoints contribute no shapes until response capture exists (future feature, not
  this round).
- Legacy task/change types (`section_request`, `component_move`) stay documented and
  applicable, just no longer emitted — the established strip pattern.
- No Co-Authored-By trailer on commits in this repo.

## Definition of done

On `/planets` (vue-vite): the Reposition tool is gone everywhere and nothing else
regressed. From the wireframe canvas, the user generates a `PlanetCard`-style component
through the flow — sets props, binds it to a REAL data source picked from the catalog,
drills to "the `planets[]` items, show `name` + `type`", sees an app-true (non-white)
snapshot, places it — then draws a section, writes markdown for it, binds a source the
same way. F5 restores everything. "Implement this wireframe" mints ONE task whose `add`
directions carry the bindings + md; the embedded agent wires the real source (proven in
the live matrix with claude); undo restores byte-identical source. The Annotate tab no
longer has a section tool and creates no `section_request` tasks.
