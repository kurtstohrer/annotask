# Kickoff: Build the Annotask Wireframe Tool

> Paste this as the opening prompt for a fresh session. It is a self-contained handoff —
> read the linked plan for full detail, then continue from "Where we are" below.

## The goal

Grow Annotask into a **drag-and-drop wireframe tool**: the user drags components from a
palette onto the **live running app** (the iframe), wires data sources into them, describes the
feature, and an agent implements the new page/feature in real source code. Component discovery
and data discovery already feed this; we are building the placement → wiring → codegen loop on
top of them.

**Full roadmap + rationale:** `~/.claude/plans/look-through-the-annotask-fluttering-wren.md`
(read it — it has the critical review, the verified feasibility study, and the 6-phase plan).

## Decided architecture (don't relitigate)

- **Preview = HYBRID, framework-keyed.** Detached-mount is the *instant default* preview where it
  works; an opt-in "render in place" (edit-driven HMR draft) is the fidelity upgrade for the hard
  frameworks; **honest fidelity badges** (`live` / `isolated preview` / `placeholder`) so the
  canvas is *never a silent fake*; the existing **task → `/annotask-apply` pipeline stays the
  codegen source of truth** (the draft edit feeds a task, it is not a second codegen path).
- **Framework priority: framework-agnostic, Vue + React top two.** Vue gets true in-context render
  almost free (keystone, done). React's detached mount has no provider tree → `isolated preview`
  badge + opt-in render-in-place.
- **Data wiring = HIGH PRECISION over recall.** Only offer a binding with hard shape evidence;
  the `ShapeDescriptor` + match index is part of the wiring feature, not deferred.
- **Wireframe document = MULTI-ROUTE** (`.annotask/wireframe.json`, route-keyed like other tools).

## Where we are (what's already landed this session — verify with git diff)

**✅ Phase 1 KEYSTONE — done & proven.** The Vite plugin now populates
`window.__ANNOTASK_COMPONENTS__` so the bridge can live-mount real project components.
- `injectComponentRegistry()` in `src/plugin/transform.ts` (covers named/aliased/relative +
  PascalCase, `typeof`-guarded), wired into `src/plugin/index.ts` `load()` and shared with
  `src/webpack/loader.ts` (replaced its default-only inline version).
- Verified: on `/planets`, `window.__ANNOTASK_COMPONENTS__` holds `Header, RouterLink,
  PlanetCard, PlanetDetail, Button, Tag`; PrimeVue `Button` and local `PlanetCard` both
  live-mount to real DOM via the existing `tryMountComponent` provider-copy path.

**✅ Supporting fixes (unblock the wireframe + cleaned up discovery):**
- `currentDir` path-translation fix in `useDataHighlights.toBridgeLoc` — data/component highlight
  rects now actually resolve (workspace-relative scanner paths ↔ iframe's package-local
  `data-annotask-file`).
- **Three scanners scoped to the running package** (no more cross-app bleed): components
  (`component-scanner.ts` + `component-usage.ts`), data sources (`data-source-scanner.ts`), API
  schemas (`api-schema-scanner.ts`).
- Overlay engine O1–O6: shared `useOverlayEngine.ts` loop, `OverlayLegend.vue` on-canvas legend,
  confidence/latency encoding, truncation banner, multi-owner badge, ~30fps refresh cap.
- Data view Network/APIs matching fixes (proxy same-origin + query-string path matching).
- **PrimeVue added to the `vue-vite` playground** (`Button`/`Tag` on `/planets`) so component-
  library highlights + live-mount have a real example. (lockfile updated.)

## Next up — finish Phase 1, then Phase 2 (the visible loop)

### Phase 1 remaining (foundational)
1. **Honest mount results + fidelity badge.** `tryMountComponent` (`src/plugin/bridge/helpers.ts`)
   should return `{mounted, reason?: 'not-registered'|'threw'|'rendered-empty'|'no-runtime'|
   'async-pending'}` instead of a bare boolean. Propagate through the `insert:component` handler
   (`src/plugin/bridge/messages.ts:~1181`) → `InsertComponentResult` (`src/shared/bridge-types.ts`)
   → `useIframeManager.insertComponent`. Replace the no-op `errorHandler`/`warnHandler` with a
   capturing one + a post-mount emptiness check (`container.childElementCount`). The canvas must
   render a *visibly different* state per reason — never the silent gray placeholder.
2. **Provider-signal gating.** In `component-scanner.ts`, flag components whose source uses
   `useContext`/`inject`/`useRouter`/`useQuery` as provider-dependent; the palette marks them
   `isolated preview` (or placeholder) rather than attempting a mount that throws.
3. **Opt-in "render in place" (edit-driven HMR draft)** for React/Svelte/Solid — reversible
   server-side draft write at the `data-annotask-file/line` anchor + in-memory undo stack; native
   Vite HMR re-renders in true context; the draft reconciles into the wireframe task.

### Phase 2 — Palette + persisted wireframe document (the first visible loop)
- Render a **Palette panel** over the live `/components` catalog + the *already-defined but
  unrendered* `HTML_CATALOG`/`LAYOUT_PRESETS`/`CatalogItem`/`DropTarget` in `src/shell/types.ts`.
  Drag → drop → `useIframeManager.insertComponent` (real mount now works) → `recordInsert`.
- Persist **multi-route `.annotask/wireframe.json`** (GET/PUT endpoint mirroring the design-spec
  handler in `api.ts`; `useWireframeDoc` composable re-applies instances on reload).

Phases 3–6 (codegen `wireframe_apply` task + playbook, typed prop inspector, high-precision data
wiring with `ShapeDescriptor`, hardening) are detailed in the plan.

## Key files / where things live
- Mount path: `src/plugin/bridge/helpers.ts` (`tryMountComponent`, `tryMountVue/React/Svelte`),
  `src/plugin/bridge/messages.ts` (`insert:component` handler), `src/shell/composables/
  useIframeManager.ts` (`insertComponent`), `src/shared/bridge-types.ts` (`InsertComponentResult`).
- Palette model (unrendered): `src/shell/types.ts` (`CatalogItem`, `DropTarget`, `HTML_CATALOG`,
  `LAYOUT_PRESETS`). Insert record: `src/shell/composables/useStyleEditor.ts` (`recordInsert`).
- Prop inspector seed: `src/shell/components/ComponentPreview.vue` (typed widget inference).
- Reusable canvas/overlay: `useCanvasDrawing.ts`, `useOverlayEngine.ts`, `useLayoutOverlay.ts`,
  `useSelectionModel.ts`, `useTaskWorkflows.ts`.
- Task system source of truth: `TASK_TYPES` in `src/schema.ts`; apply skill in
  `skills/annotask-apply/SKILL.md`; companion playbook routing in `src/skills/loader.ts`.

## How to run + verify (hard-won gotchas)
- Dev server: `pnpm dev:vue-vite` (picks a free port, e.g. 5173). App at `/`, shell at
  `/__annotask/`. Build before testing: `pnpm build:shell` (shell is served from `dist/shell`)
  and `pnpm build:plugin` (server/plugin served from `dist`); **restart the dev server after a
  plugin rebuild**. `pnpm typecheck` and `pnpm test` (578 tests) must stay green.
- Browser checks: the `playwright-skill` works headless. `goto` with `waitUntil:'domcontentloaded'`
  + a fixed settle — **`networkidle` never fires** (the shell holds a WebSocket open). Boot the
  shell straight into a view via `addInitScript` setting localStorage `annotask:shellView`
  (`develop`/`design`) + `annotask:developSection`(`data`)/`designSection`(`components`). Drive the
  iframe route via the toolbar input `[data-testid="input-route"]`.
- The playground shows an **InitWizard** if it has no `.annotask/design-spec.json`; dismiss it for
  tests via `POST /__annotask/api/init/skip` (writes gitignored playground state).
- Overlays/highlights + `window.__ANNOTASK_COMPONENTS__` live in the *iframe app* document.

## Definition of done for the first milestone
Drag a real component from the palette onto the live `/planets` app and see it **render in place
(Vue) or as an explicit labeled isolated-preview/placeholder (React)** — never a silent gray box —
with the placement persisted to `.annotask/wireframe.json` and surfaced as a `wireframe_apply`
task the agent can implement.
