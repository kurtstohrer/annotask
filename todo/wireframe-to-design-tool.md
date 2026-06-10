# Kickoff: Grow the Wireframe Tool into a Full In-Browser Design Tool

> Paste this as the opening prompt for a fresh session. Self-contained handoff.
> Predecessors: `todo/start-wireframe-tool.md` → `todo/improve-wireframe-preview.md` → this.
> Roadmap: `~/.claude/plans/look-through-the-annotask-fluttering-wren.md`.

## North star

Today the wireframe tool is **place → build → an agent applies later**. The goal now is a
**full design tool**: the end user selects, edits, moves, resizes, restyles, and wires up
**real elements on the live running app**, sees every change **instantly (WYSIWYG)**, and the
changes **persist to real source** — with a clean undo/discard safety net. Think
Webflow/Figma fidelity, but operating directly on the user's actual components and routes,
with AI as an assist (and as the clean-commit path), not the only way to land a change.

Two halves to deliver, both for the end user, not just for an agent:
1. **Live edits** — direct manipulation of placed AND existing elements (props, text,
   classes, styles, position, size, structure), recorded as structured changes.
2. **Live previews** — every edit reflected in the iframe immediately, faithfully, across
   Vue/React/Svelte/Solid — never a silent fake.

## Where we are (verify with `git log` / `git diff`; M1 is committed as bf3ee61)

The drag→drop→mount→persist→Build→agent-apply loop is built **and now closes correctly**
(Milestone 1, just shipped):

- **Persisted shape** (`src/shared/wireframe-types.ts`): `WireframeInstance` carries
  `status?: 'placed'|'building'|'applied'`, `taskId?`, `previewProps?` (display samples,
  separate from real `inserted.props`); `WireframeDocument` carries server-managed `rev?`.
  `isWireframeDocument`/`isWireframeInstance` validate to instance depth — one bad instance
  rejects the whole PUT.
- **Lifecycle closure is server-owned** (`src/server/api.ts`): accepting a `wireframe_apply`
  task removes its instances; deleting the task reverts them to `placed`. PUT is
  compare-and-set on `rev` → 409 `conflict` on a stale write (`wireframe-store.ts`,
  `WireframeRevConflictError`). The agent must NOT edit `wireframe.json`
  (`skills/annotask-apply/WIREFRAME_APPLY.md`).
- **Reapply is correct** (`src/shell/composables/useWireframeDoc.ts`): mounts only `placed`
  instances (kills duplicate-during-review), mounts components with
  `previewProps ?? inserted.props`, isolates per-instance failures, and surfaces stale
  anchors via reactive `staleIds`/`failedIds` (no more console-only).
- **Drop pipeline extracted** from App.vue into `src/shell/composables/useWireframeCanvas.ts`
  (drag-over throttle, drop indicator, `onPaletteDrop`, reposition handlers, `buildWireframeRoute`,
  reapply watchers, `deletePlacement`, `placedCount`). App.vue only orchestrates now.
- **Placements panel** (`src/shell/components/ComponentsPage.vue`): per-route list with
  status chips, fidelity, stale/failed badges, and a delete button.
- **Preview fidelity** (`src/plugin/bridge/helpers.ts`): live Vue mount; React provider-walk
  else isolated; Svelte/Solid isolated; placeholder otherwise — honest badges throughout.
  Off-route components load on-demand via `/__annotask/preview-module` raw `/@fs/` import
  (Vite only). Reposition tool moves placements and updates anchors.
- **Render-in-place drafts** (`src/server/draft-edits.ts`): the ONLY source-writing path; now
  path-contained (project-root only) and import-shape-validated; crash-journaled + hash-guarded
  revert. Still **flag-gated OFF** (`ANNOTASK_RENDER_IN_PLACE`) and **dormant — zero shell
  callers**. This is the seed of "live commit" (Milestone 4).

Tests: `pnpm typecheck` clean; `pnpm test` = 775 pass / 12 skipped; `pnpm build` clean.
Live CLI matrices pass 4/4 for claude/codex/opencode/copilot.

## The one architecture decision to make first (don't skip this)

The original plan declared: *"the task → /annotask-apply pipeline stays the codegen source of
truth; the draft edit feeds a task, it is not a second codegen path."* A **full design tool**
with **live edits that persist** is in tension with that — direct manipulation that the user
expects to "stick" pushes toward writing source live. Pick the model before building Milestone 4:

- **Option A — Live-commit (recommended).** Direct manipulation → optimistic preview →
  structured edit → **live source write via the draft engine + HMR**, accumulated in a
  **design session** with a session-wide undo stack and a one-click **"discard session"**
  (`revertAll`). The task/codegen pipeline becomes the *clean-commit / review / share* path
  ("Build this route" snapshots the session into a reviewable task), not the only way to land
  a change. This is what makes it feel like a design tool.
- **Option B — Preview-only, task-as-truth.** Keep source read-only; make the in-browser
  preview perfect enough to feel live; everything lands only through an agent task. Safer, but
  it is a *wireframe* tool, not a design tool — it won't meet the north star.

Recommendation: **A**, with B's discipline as the safety net — every live edit is reversible
(draft journal already supports this), nothing is committed to git by the tool, and the user
can always escalate a messy session to the agent for a clean rewrite. Resolve this with the
user, then proceed.

## Milestones (each ends shippable; acceptance criteria are the contract)

### M2 — Live property & content editing (the "edit" half of WYSIWYG)
Select any element — a dropped placement OR an existing real element — and edit it in a
properties panel, with the iframe updating instantly.
- Properties panel: **props** (typed widgets — seed in `ComponentPreview.vue` typed inference;
  reuse the DesignToken/control components), **text content**, **classes**, **inline styles**
  (the inspector already does CSS via `style_update`; fold it in, don't duplicate).
- Edits apply **optimistically to the live preview** (bridge `style:apply`/`class:set` exist;
  add a `props:set`/`text:set` for mounted components and for source-backed nodes).
- Edits record as **structured changes** — extend the change model with
  `component_prop_update` / `text_update` (alongside `style_update`); placements promote
  `previewProps` → real `inserted.props` when committed.
- **Round-trip honesty (precision over recall):** classify each editable field by reading the
  source at the anchor: *literal* (editable → writes back cleanly), *bound expression*
  (read-only; explain "this value comes from `planet.name` — edit the data or the binding"),
  *loop-rendered* (warn "editing one edits all N"). Refuse to fabricate; never silently edit
  the wrong node.
- **Acceptance:** on `/planets`, select a real `PlanetCard`, change a literal prop and its text
  → preview updates instantly → the change appears in the session/task with the correct source
  anchor; a bound field is shown read-only with the binding named; no edit ever lands on the
  wrong element.

### M3 — Design with your OWN components + container components
A design tool designs with the project's components, not just library ones.
- **Project palette group:** surface `window.__ANNOTASK_COMPONENTS__` (per-route imports) +
  `component-usage.ts` as a "Project" group in `ComponentsPage` (data already exists in
  `generateComponentManifest`, just unsurfaced). These live-mount richly.
- **Container/compound components** (Accordion, TabView, Splitter): mount with a sample child
  structure or slot-retry on a `$slots.default is not a function` error (helpers.ts) instead of
  the honest "needs child content" placeholder.
- **Acceptance:** the user drags a local `PlanetCard` and a PrimeVue `Accordion` (with one
  panel) and both render real content on the canvas, not a placeholder.

### M4 — Live source commit (the "live" half) — productionize the draft engine
Implement the decided model (A). Drafts become the live-write mechanism behind direct
manipulation, gated by a visible "Live edit" mode toggle (not just an env flag).
- Make `draft-edits.ts` **multi-edit-per-file safe** (stacked edits, ordered revert),
  **framework-correct** for Vue/React/Svelte/Solid snippet + import emission, and reconcile it
  with the structured edits from M2 (one edit → one draft → one preview refresh via HMR).
- **Session model:** a design session = the ordered list of live edits with undo/redo and
  `revertAll` ("discard session"); "Build this route" snapshots the session into a
  `wireframe_apply`-style task for clean agent commit/review.
- **Webpack parity:** port the `/__annotask/preview-module` resolver to the webpack standalone
  server so off-route mount + live edit work there too (currently Vite-only).
- **Safety:** never write outside project root (done), never touch git, always reversible,
  loud failure if a draft can't be reverted (hash guard already warns).
- **Acceptance:** with Live edit on, the user moves an element and edits a prop; the real source
  file updates and HMR reflects it within ~1s; undo restores both source and preview; "discard
  session" returns every touched file to its original bytes.

### M5 — Data wiring (a list you drop should show real data)
- Bind data-driven dropped components to discovered data sources with **hard shape evidence**
  only (`ShapeDescriptor` + match index, from the original plan — precision over recall).
- Persist the binding on the instance (`WireframeInserted` needs a `binding?` field) and emit it
  in the task so the agent wires the real query/store, not sample data.
- **Acceptance:** drop a list onto a route with a matching data source → it previews with real
  shaped data and the task describes the exact binding; no binding offered without evidence.

### M6 — Layout & spacing direct manipulation + responsive
- Drag handles for resize / padding / margin / gap; visual flex/grid editing (the
  `useLayoutOverlay`/`useOverlayEngine` infra exists); per-viewport edits keyed to the existing
  viewport presets so the user can design responsively.
- **Acceptance:** drag a container's padding handle → style updates live and records a
  `style_update`; switch to a mobile viewport, change a value → the edit is scoped to that
  breakpoint.

### M7 — Hardening & design-tool polish
- Session-wide undo/redo; multi-tab safety (rev/409 is in place — extend to the session);
  anchor durability (redundancy hash like `code-context`, the old M2 — needed once edits stack
  and shift lines); keyboard shortcuts; make the tool's own UI accessible; accept/discard flows
  with clear status; empty/error states.

## Key files
- Canvas/drop/session: `src/shell/composables/useWireframeCanvas.ts`,
  `useWireframeDoc.ts`, `usePaletteDrag.ts`, `useRepositionMode.ts`, `src/shell/App.vue` (orchestration only).
- Palette + panels: `src/shell/components/ComponentsPage.vue`, `ComponentPreview.vue`;
  style/prop controls reuse the DesignToken editor + `ElementStyleEditor` family.
- Mount/preview/bridge: `src/plugin/bridge/helpers.ts` (`tryMount*`, `ensureComponentLoaded`),
  `src/plugin/bridge/messages.ts` (`preview:component`, `insert:component`, `style:apply`,
  `class:set`, `move:element` — add `props:set`/`text:set` here), `src/shared/bridge-types.ts`,
  `src/shell/composables/useIframeManager.ts`. Resolver: `src/plugin/index.ts`
  (`/__annotask/preview-module`) + webpack equivalent in `src/server/standalone.ts`.
- Live commit: `src/server/draft-edits.ts`, `src/server/api.ts` (`wireframe/draft` routes,
  gated by `ANNOTASK_RENDER_IN_PLACE`).
- Persistence/types/codegen: `src/shared/wireframe-types.ts`, `src/server/wireframe-store.ts`,
  `src/schema.ts` (`TASK_TYPES`; new change types go here + the `z.enum` boundaries),
  `skills/annotask-apply/WIREFRAME_APPLY.md` (+ run `node scripts/sync-skills.mjs` after edits).
- Grounding the agent on a committed session: the new MCP tools `annotask_get_source_excerpt`,
  `annotask_get_playbook`, `annotask_get_agent_directions` already exist — lean on them.

## How to test (hard-won gotchas)
- Dev: `pnpm dev:vue-vite` (picks 5173/5174). Rebuild before browser testing:
  `pnpm build:plugin` + `pnpm build:shell`, then **restart** the dev server. Clear stale scan
  cache: `rm -rf playgrounds/simple/vue-vite/.annotask/cache`.
- Live-edit tests: set `ANNOTASK_RENDER_IN_PLACE=1` and assert source round-trips, then assert
  `revertAll` restores original bytes (extend `src/server/__tests__/draft-edits.test.ts`).
- Playwright headless (WSL has no display): `waitUntil:'domcontentloaded'` + fixed settle —
  `networkidle` never fires (shell holds a WebSocket). Boot a view via `addInitScript`
  localStorage (`annotask:shellView='design'`, `annotask:designSection='components'`,
  `annotask:lastRoute='/planets'`); dismiss InitWizard via `POST /__annotask/api/init/skip`
  (Origin header). Detect unwanted reloads: `page.on('framenavigated', ...)` — on-demand load +
  live edits must keep this at 0.
- App + shell are same-origin → `iframe.contentFrame()` reaches the iframe; component registry:
  `frame.evaluate(()=>Object.keys(window.__ANNOTASK_COMPONENTS__))`. Drive the bridge directly
  for `preview:component`/`insert:component`/`style:apply`.
- Keep `pnpm typecheck` + `pnpm test` green every milestone; add e2e for the new live flows
  (the suite currently has no task-creating/editing e2e — this is the place to add it).

## Decisions already made (don't relitigate)
- Hybrid preview (live Vue / provider-walked React / isolated Svelte-Solid / placeholder) with
  **honest fidelity badges** stays. Preview renders **in the live iframe** (real styles/provider
  context). Off-route load uses raw `/@fs/` import (reload-free), not the optimized dep.
- Sample props remain **display-only** until the user commits an edit; codegen never fabricates
  values, handlers, data bindings, children, or slots — low fidelity is a hint, not a guess.
- Task/codegen pipeline stays the **clean-commit / review** path. Live drafts (Milestone 4) are
  the fast in-session path, reversible and never committed to git by the tool.
- Data wiring is **precision over recall** — no binding without hard shape evidence.

## Definition of done (the full design tool)
On the live `/planets` app, an end user with no agent can: drop a real project component, edit
its props/text/styles, move and resize it, wire a list to a real data source, see every change
**instantly and faithfully**, **undo** any step, **discard** the whole session back to original
source — and, when happy, click **Build this route** to hand a clean, reviewable task to the
agent. Works on Vue and React (Vite), with Svelte/Solid and Webpack at honest, labeled fidelity.
