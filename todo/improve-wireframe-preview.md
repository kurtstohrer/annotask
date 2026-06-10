# Kickoff: Improve Wireframe Component Preview + Inline Live Drop

> Paste this as the opening prompt for a fresh session. Self-contained handoff.
> Predecessor: `todo/start-wireframe-tool.md`. Roadmap:
> `~/.claude/plans/look-through-the-annotask-fluttering-wren.md`.

## Where we are

The drag-and-drop wireframe loop is built and working end-to-end: drag a component from
the **Design → Components** panel onto the live app → it mounts in place → the placement
persists to `.annotask/wireframe.json` → "Build this route" creates a `wireframe_apply`
task the agent implements via `/annotask-apply`. The Palette was merged into Components,
and the component **detail pane now shows a rendered preview** (offscreen mount →
html2canvas snapshot), including **on-demand loading of off-route library components**.

**Nothing is committed** — verify everything with `git status` / `git diff`.

## What landed this session (verify with git diff)

- **Honest mount + fidelity** (`src/plugin/bridge/helpers.ts`): `tryMount{Vue,React,Svelte,Solid}`
  return `{mounted, reason, fidelity, detail}`; failures render a labeled box, never a silent
  empty div. `data-annotask-fidelity` stamped on the DOM.
- **Palette merged into Components** (`ComponentsPage.vue`): rows are draggable, plus Layout +
  Elements groups, a "Build this route" button, and a live **detail preview** (image or honest
  placeholder). The standalone Palette section was removed.
- **Bridge `preview:component`** (`messages.ts`): offscreen mount + html2canvas snapshot →
  PNG data URL + fidelity. `previewComponent()` in `useIframeManager.ts`.
- **Sample props** (`ComponentsPage.sampleProps`): synthesizes minimum-viable props (label/
  value/title → name, enums → first option, required → typed defaults) so components render
  with content, not empty. Display-only — NOT persisted as the placed component's real props.
- **On-demand component load** (`ensureComponentLoaded` in `helpers.ts` + the
  `/__annotask/preview-module` middleware in `src/plugin/index.ts`): resolves a component's
  **raw module file** (`createRequire`) to an `/@fs/` URL and dynamically imports it. Crucial:
  raw import avoids Vite's dep re-optimization **full-page reload**. Used by preview AND drop.
- **Catalog junk filter** (`component-scanner.ts isLikelyComponentName`): drops
  `*Style`/`*Service`/`*Directive` exports (PrimeVue was ~half `*Style`). 268 → 136 real
  components.
- **Persistence/codegen** (from the prior session, still in place): `wireframe-store.ts`,
  `state.ts` get/setWireframe, GET/PUT `/api/wireframe`, `useWireframeDoc.ts` (load/save/reapply),
  `wireframe_apply` TASK_TYPE + `skills/annotask-apply/WIREFRAME_APPLY.md`, draft-edits.ts (P1.3
  render-in-place HMR, flagged OFF via `ANNOTASK_RENDER_IN_PLACE`).

Tests: `pnpm typecheck` clean, `pnpm test` = 591 pass / 12 skipped (one flaky:
`state.test.ts > accepted task is removed…` — timing, passes on re-run).

## Known issues — improve next (priority order)

1. **[MAIN] Inline live preview on DROP is weak.** Dropping a component inserts it (a Button
   shows up), but the in-place live render is unreliable for many components — often the
   honest placeholder/fidelity box instead of the real component. Investigate the
   `insert:component` mount path in `messages.ts` vs. the (working) `preview:component` path:
   the preview passes **sample props** and loads on-demand, but the **drop** mount may not be
   getting sample props for display (it intentionally persists real/empty props — see
   `App.vue onPaletteDrop`, which mounts with `item.previewProps ?? item.props`). Confirm
   off-route drops actually `ensureComponentLoaded` before mount, and that the in-place mount
   gets renderable props. The drop's mounted node should look like the detail preview.
2. **Container/compound components can't preview** (Accordion, TabView, Splitter, Galleria) —
   they throw `this.$slots.default is not a function` (need child content). Currently show an
   honest "Container component — needs child content" message. Could special-case high-value
   ones by mounting with a sample child structure (e.g. Accordion + one AccordionPanel), or a
   slot-retry: on a slot-error, remount with a placeholder default slot.
3. **Project's own components aren't in the catalog.** Only library (PrimeVue) components are
   listed; the user's local components (Header, PlanetCard, …) — which are the most useful to
   preview/drag and render richly — aren't surfaced. `window.__ANNOTASK_COMPONENTS__` (per-route
   imports) + `component-usage.ts` have this data. Surface a "Project" group.
4. **Webpack parity.** On-demand load + the preview-module resolver are Vite-only
   (`servePlugin.configureServer`). Webpack users fall back to placeholder for off-route
   components.

## Key files

- Mount/bridge: `src/plugin/bridge/helpers.ts` (`tryMount*`, `ensureComponentLoaded`),
  `src/plugin/bridge/messages.ts` (`insert:component`, `preview:component` handlers),
  `src/shared/bridge-types.ts`, `src/shell/composables/useIframeManager.ts`.
- Resolver middleware: `src/plugin/index.ts` (`/__annotask/preview-module`).
- Components UI: `src/shell/components/ComponentsPage.vue` (drag, preview, sampleProps,
  previewPlaceholderText, Build button).
- Drop + reapply: `src/shell/App.vue` (`onPaletteDrop`, drop shield, `buildWireframeRoute`),
  `src/shell/composables/{usePaletteDrag,useWireframeDoc}.ts`.
- Scanner: `src/server/component-scanner.ts` (`isLikelyComponentName`, `sampleProps` lives in
  the shell though).
- Persistence/codegen: `src/server/{wireframe-store,draft-edits}.ts`, `src/server/api.ts`,
  `src/shared/wireframe-types.ts`, `src/schema.ts` (TASK_TYPES), `skills/annotask-apply/`.

## How to test (Playwright headless — hard-won gotchas)

- Dev server: `pnpm dev:vue-vite` (picks 5173/5174). Rebuild before testing: `pnpm build:plugin`
  (bridge/server) + `pnpm build:shell`, then **restart** the dev server. Clear the stale scan
  cache: `rm -rf playgrounds/simple/vue-vite/.annotask/cache`.
- Use `@playwright/test`'s `chromium`, `headless: true` (WSL has no display). Run scripts via the
  playwright-skill runner or `node` from the skill dir so `playwright` resolves.
- `networkidle` NEVER fires (shell holds a WebSocket). Use `waitUntil:'domcontentloaded'` +
  fixed `waitForTimeout(~3500)`.
- Boot the shell via `addInitScript` localStorage: `annotask:shellView='design'`,
  `annotask:designSection='components'`, `annotask:lastRoute='/planets'`. Dismiss the InitWizard:
  `POST /__annotask/api/init/skip` (Origin header).
- Real toolbar testids: top tabs `tab-annotate|tab-design|tab-audit`; sub-section
  `design-components`; route input `input-route`; Build button `palette-build-route`.
- The app + shell are **same-origin** — `page.$('iframe.app-iframe')` → `.contentFrame()` reaches
  the iframe. Component registry: `frame.evaluate(()=>Object.keys(window.__ANNOTASK_COMPONENTS__))`.
- Drive the bridge directly (top-level `/planets`, `window.parent===window`): post
  `{source:'annotask-shell', type, payload, id}`, listen for `{source:'annotask-client', id, payload}`.
  Handy for `preview:component` / `resolve:at-point` / `insert:component`.
- Synthesize HTML5 drag (native dnd over the iframe): dispatch `dragstart` on a
  `.components-list-item` (sets the `usePaletteDrag` ref → shows `.palette-drop-shield`), then
  `dragover`+`drop` on the shield with `clientX/clientY` over the iframe.
- **Detect reloads** with `page.on('framenavigated', f => { if (f===page.mainFrame()) navs++ })` —
  the on-demand load must keep this at 0.
- Component error detail is now in `preview:component` result `.detail` — use it to diagnose
  why a component throws.

## Decisions already made (don't relitigate)

- Preview renders **in the live iframe** (real app styles/provider context) via offscreen mount +
  html2canvas. Off-route components load on-demand via **raw `/@fs/` import** (reload-free) — NOT
  the optimized dep (which triggers a Vite reopt reload), and NOT a giant `optimizeDeps.include`
  (cold-start cost).
- Sample props are **display-only**; the persisted/placed component keeps real (empty) props so
  codegen never fabricates values. `module` is persisted on the instance for re-mount + codegen.
- Container components honestly say they need children rather than faking a render.
