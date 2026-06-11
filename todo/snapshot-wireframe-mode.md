# Kickoff: Strip the Live-Edit Design Tool, Build Snapshot-Wireframe Mode

> Paste this as the opening prompt for a fresh session. Self-contained handoff.
> Predecessors: `todo/start-wireframe-tool.md` → `todo/improve-wireframe-preview.md` →
> `todo/wireframe-to-design-tool.md` (implemented, then retired by this pivot).

## The pivot, and why

The live-DOM design tool (M2–M4 of the previous handoff) shipped and works as designed —
and that is exactly why it's being retired. Direct manipulation of the live DOM can't
deliver a design-tool experience:

- The round-trip honesty classifier correctly marks most real props **read-only** (on
  `/planets`, `:planet="planet"` and `:active="selected?.id === planet.id"` are bound —
  only `label="Reset"`-style literals are editable). Honest, but the editable surface is
  too thin to feel like designing.
- Freeform movement/resizing fights live CSS layout — you can't drag a card 200px left
  when flexbox owns its position.
- React rendered roots never carry the usage-site anchor (function components drop
  unknown props, unlike Vue fallthrough), so usage-site editing was Vue-only.

**New direction — snapshot wireframing:** rasterize the live view into per-block images
(html2canvas, already vendored), let the user freely drag / resize / delete / annotate
those images on a canvas plus drop new component *snapshots* from the palette, then
**generate structured directions + before/after screenshots for the agent to implement**.
Images can't lie about fidelity — they ARE the rendered truth at capture time. Freeform
manipulation is trivially possible because nothing is live. And the output format
(anchored spatial directions + visual diff) is ideal input for a vision-capable agent.

This matches the standing product decision (made by Kurt, do not relitigate): **the agent
writes all application source; the tool only snapshots/restores files.** The M4 apply
loop is the unchanged backend for this mode.

## Where we are (verify with `git log`/`git diff` — the M2–M4 work may be committed or still a working-tree change set)

Built and KEPT (the backend this mode plugs into):

- **File-snapshot engine** `src/server/file-snapshots.ts` (+ `file-snapshots.test.ts`):
  per-batch pre-apply bytes, session base, hash-guarded byte-exact `revertBatch`/`revertAll`,
  diverged-file detection + `detachFile`, REHYDRATES across restarts (never auto-reverts;
  Kurt's decision). Journal `.annotask/file-snapshots.json`.
- **Agent-apply orchestration** `src/server/apply-session.ts` + routes
  (`POST /api/design-session/apply|undo-batch|detach-file`, `GET /api/design-session/snapshots`):
  snapshot → mint ONE `wireframe_apply` task → shell auto-runs the embedded agent →
  task→`review` triggers a server verification pass → accept commits, delete releases.
  Proven LIVE: `src/server/__tests__/apply-session-matrix.test.ts` (ANNOTASK_LIVE_CLI=1)
  passed with a real claude CLI — applied edits, verified, undid byte-for-byte.
- **Wireframe placement pipeline** (M1): `wireframe.json` CAS persistence, server-owned
  task lifecycle, palette drag/drop, reapply with stale/failed tracking.
- **Project palette**: `scanProjectComponents` + `GET /api/project-components`, "Project"
  group pinned first; slot-retry mounting with the amber "sample slot" pill.
- **Component snapshots**: `preview:component` bridge message already returns an
  html2canvas **dataUrl snapshot** of a mounted component at a given width
  (`src/plugin/bridge/messages.ts` ~`preview:component`) — this is the palette-drop
  image source for the canvas.
- **Element identity**: every rendered element carries `data-annotask-file/-line/-component`
  (+ `source_tag`); `screenshot:capture` takes per-rect shots; `classify:element` and
  `layout:scan` classify blocks/containers.
- **Honesty classifier** `src/server/binding-classify.ts` + MCP tool
  `annotask_get_binding_classification` + CLI `binding-classify`: keep as **agent tooling**
  (it tells the agent what's safely rewritable) even though its UI consumer goes away.
- **e2e recipe** `e2e/helpers/design-tool.ts` (localStorage boot incl. the non-obvious
  `annotask:mode='select'` and `annotask:activePanel='inspector'` seeds, init/skip with
  Origin header, hermetic `/planets` API interception, reload counter) + the
  react-vite `/planets` page.

## What to STRIP (the live-edit surface — M2's UI and its plumbing)

Remove cleanly; keep the tree green at each step (`pnpm typecheck` + `pnpm test`):

- **Properties panel**: the Content tab in `ElementStyleEditor.vue`, `PropField.vue`,
  `usePropEditor.ts` (+ its test). Keep `src/shell/utils/propWidgets.ts` —
  `ComponentPreview.vue` imports it.
- **Live-edit bridge messages**: `text:set`/`text:undo`/`props:set` handlers in
  `src/plugin/bridge/messages.ts`, the `__annotask_set_props` closures in `helpers.ts`
  (Vue `reactive` wrapper, React `buildElement` re-render), the `setText/undoText/setProps`
  wrappers in `useIframeManager.ts`, and their bridge-types. (If any prove handy for the
  canvas implementation, keeping them is fine — but don't keep dead surface by default.)
- **Element-edit session entries**: `useDesignSession`'s element-edit recording path —
  `recordPropChange`/`recordTextChange` in the `useStyleEditor` façade, the
  `component_prop_update`/`text_update` change emission, `reapplyPreviews`. DECIDE during
  planning whether the journal itself survives (it also carries placement cross-refs and
  the apply-loop status bookkeeping — the apply loop needs *some* entry-like payload to
  verify/track; re-pointing entries at "directions" may be simpler than removing them).
  The `style_update`/`class_update` inspector flow predates this work — do not break it;
  `useStyleEditor.test.ts` stays the frozen contract.
- **HTTP/MCP surface that loses its consumer**: the shell's `binding-classify` fetch
  (server route + MCP/CLI stay, per above).
- Keep the schema change types (`component_prop_update`, `text_update`) — additive,
  harmless, and agents may still receive them from old tasks; just stop emitting them.
- Update `CLAUDE.md`, `skills/annotask-apply/SKILL.md` + `WIREFRAME_APPLY.md`
  (remove/replace the live-edit sections), run `node scripts/sync-skills.mjs`
  (CI-enforced), and delete the obsolete e2e (`vue-vite.design-session.test.ts`'s
  prop/text cases, `react-vite.design-session.test.ts`) — replace with wireframe-mode e2e.

## The new mode (plan in detail, then build)

### Concept

A **Wireframe** toggle freezes the current route into a manipulable image canvas:

1. **Capture**: a new bridge message (e.g. `wireframe:capture`) walks the rendered route
   and rasterizes it into BLOCKS — per-block html2canvas snapshots returned as
   `[{ eid, file, line, component, source_tag, tag, rect, dataUrl }]`. Block granularity
   v1: the direct children of the main content container plus nav/header/footer
   (heuristics exist in `classify:element`/`layout:scan`); double-click a block to
   re-capture it one level deeper ("explode"). html2canvas lazy-loads from
   `/__annotask/vendor/` exactly like `screenshot:capture` does.
2. **Canvas**: the shell swaps the iframe view for a canvas of positioned image boxes
   (same coordinate space as the captured rects). Boxes support drag, resize (corner
   handles), delete, duplicate, and a per-box note ("make this a carousel"). New material:
   (a) palette drops render via the EXISTING `preview:component` dataUrl snapshot;
   (b) drawn placeholder boxes with labels (the section tool already does drawn rects +
   markdown). Reuse the overlay/pointer machinery (`useRepositionMode`, the section tool,
   `useOverlayEngine`) rather than a canvas library — but evaluate honestly; if
   freeform transform UX demands it, a tiny dedicated layer is acceptable.
3. **Persist**: canvas state (boxes: source anchor OR component/module OR placeholder,
   original rect, current transform, note, z-order) per route. Recommend extending the
   `wireframe.json` document (CAS + lifecycle already exist) rather than a new store.
4. **Generate directions**: diff original capture vs current canvas into structured,
   ANCHORED directions — moved (old rect → new rect, plus relational facts: "now above
   the filter bar, full width"), resized (px + %), deleted, added (component name/module
   or placeholder label), notes. Compose: (a) machine-readable JSON in task context,
   (b) a human-readable direction list, (c) **before + after composite screenshots**
   (attach via the existing screenshot upload pipeline — agents already fetch
   `annotask_get_screenshot`). Mint ONE `wireframe_apply` task per route (decision
   stands: extend `wireframe_apply`, no new task type) and hand it to the embedded agent
   via the EXISTING apply loop (snapshot files → spawn → review → undo/discard work
   unchanged). Verification pass: spatial verification is not feasible — scope the
   existing verifier to skip direction-entries (status flips on task review/accept only).
5. **Return to live**: exiting wireframe mode shows the real app; after the agent
   applies + HMR, the user sees the real implementation. "Undo last apply" / "Discard
   session" (file-snapshot engine) remain the safety net.

### Why this is the realistic shape

- Relational + visual directions ("move X above Y", with before/after images) are what
  agents implement well; px-exact spatial diffs are hints, not contracts — say so in the
  playbook so the agent optimizes for intent, not pixel fidelity.
- Every box that came from the live DOM keeps its **source anchor** — directions are
  grounded in file/line/component, not just pictures. That is the part screenshot-markup
  tools can't do and Annotask can.
- Nothing in the mode can silently lie: the canvas is explicitly a sketch, not the app.

### Milestones (each ends shippable)

- **W1 — Capture + static canvas**: Wireframe toggle; block capture with anchors;
  boxes render as images at their true positions; exit restores live view. Accept: on
  `/planets`, toggling shows image blocks for header/filter-bar/grid (each carrying the
  right `file:line`), and toggling back is lossless (no iframe reload).
- **W2 — Manipulation + persistence**: drag/resize/delete/duplicate/notes; palette drop
  as snapshot image; drawn placeholder boxes; per-route persistence with CAS; reload
  restores the canvas. Accept: rearrange `/planets` (move grid above filters, resize a
  card, drop a `PlanetCard` snapshot, add a "pagination here" placeholder), F5, all
  still there.
- **W3 — Directions + agent apply**: "Implement this wireframe" generates the anchored
  direction set + before/after screenshots, mints the task, runs the embedded agent
  through the existing apply loop; undo/discard restore bytes. Accept: the `/planets`
  rearrangement above lands in real source by agent; `Undo last apply` → `git diff`
  clean. Update `WIREFRAME_APPLY.md` with the directions contract + sync skills.
- **W4 — Polish**: explode-to-children granularity, snap/align guides, multi-select,
  keyboard nudging, mobile-viewport wireframing (viewport presets exist).

## How to test (hard-won gotchas — these cost real time, don't rediscover them)

- Rebuild before browser testing: `pnpm build:plugin && pnpm build:shell`, then RESTART
  the dev server (`pnpm dev:vue-vite`); clear `playgrounds/simple/vue-vite/.annotask/cache`.
- Playwright is headless (WSL): `domcontentloaded` + fixed settle — `networkidle` never
  fires (shell WebSocket). Boot via `e2e/helpers/design-tool.ts` (`bootDesignShell` seeds
  `annotask:mode='select'` and `annotask:activePanel='inspector'` — without these,
  clicks pass through and the Tasks panel hides everything). Intercept
  `**/api/solar/planets*` (the FastAPI on :8888 isn't in the playwright webServer list).
  The 2 `networkidle` smoke tests fail without that API — pre-existing, not yours.
- html2canvas quirks: loaded lazily from `/__annotask/vendor/html2canvas.min.js`;
  capture costs ~100-500ms per block — capture sequentially with a progress state, and
  reuse `screenshot:capture`'s rect math (it already handles scroll offsets).
- Vue `template.ast` element locs are file-absolute but the ROOT node's loc lies (says
  line 1) — relevant if you touch `binding-classify.ts`.
- Live agent loop verification: `ANNOTASK_LIVE_CLI=1 ANNOTASK_LIVE_ONLY=claude npx
  vitest run src/server/__tests__/apply-session-matrix.test.ts` (adapt this suite to the
  directions payload — it's the template for proving the W3 loop with a real CLI).
- Keep `pnpm typecheck` + `pnpm test` green every milestone; `useStyleEditor.test.ts`
  must pass UNMODIFIED (Annotate tab / `annotask watch` contract).

## Decisions already made (don't relitigate)

- **The agent writes all application source; the tool only snapshots/restores files.**
- Build/apply stays ONE `wireframe_apply` task per route (`context.wireframe` +
  whatever the directions payload becomes) — no new task type.
- Sessions/journals REHYDRATE across dev-server restarts; files revert only via explicit
  Undo/Discard.
- Never fabricate: placeholder boxes stay visibly placeholders; component drops carry
  real names/modules; directions distinguish "user said" (notes) from "tool measured"
  (spatial diff).
- No Co-Authored-By trailer on commits in this repo.

## Definition of done

On `/planets` (vue-vite), a user can toggle Wireframe mode, freely rearrange the page as
images (move/resize/delete real blocks, drop a real project component's snapshot, sketch
a placeholder, leave notes), persist it across reloads, click "Implement this wireframe",
watch the embedded agent rewrite the real source to match the intent, see the real result
on exiting wireframe mode — and undo the whole thing back to byte-identical source.
React (vite) gets the same capture/canvas/directions flow (anchors come from rendered
host elements, which React DOES stamp — the usage-site limitation that hurt live prop
editing doesn't apply here). Webpack keeps honest labels where capture-only features
differ.
