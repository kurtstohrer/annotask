# Hero Demo — Recording Prompt ("Freeze. Sketch. Real.")

Use this prompt to start a **new Claude Code session** that records the Annotask
hero video and the first-wave deep-dive clips, using **testreel** (scripted
Playwright recording with animated cursor) + **edge-tts** (voiceover) + **ffmpeg**
(assembly). The story, segments, and VO are already written — **read these first
and follow them, do not reinvent them:**

1. `demo_plan.md` — the suite design: hero segments, the four directions,
   clip specs C1–C8.
2. `demo/transcript-hero.md` — per-segment voiceover + on-screen directions
   (the source of truth for what to say and show).
3. `demo/record-init-demo.ts` — the proven testreel pattern (chromium headed →
   `recordVideo` context → `recordPage()` cursor config → `tryAction()` wrapper).
4. `node_modules/testreel/AGENTS.md` + `node_modules/testreel/dist/docs/` —
   read the bundled testreel docs before writing recording code.
5. `e2e/vue-vite.wireframe.test.ts` + `e2e/helpers/design-tool.ts` — the proven
   drive mechanics for every wireframe interaction (selectors below were
   verified against the shell source; the e2e suite shows the working offsets
   and wait budgets).

---

## Stage & state

```bash
pnpm demo:reset:hero   # HEAD sources + clean sketch/session/task/conversation state
just marketing         # page on :5181, auto-starts the FastAPI on :8888
```

- Shell: `http://localhost:5181/__annotask/`. The app renders in `.app-iframe`.
- The hero's "before" state is HEAD — the polished page WITH the live stats strip
  (`src/api.js` exists; `fetchChangelog()` is deliberately unused — it is the
  binding target).
- `pnpm demo:reset` (without `:hero`) is a DIFFERENT reset — it restores the
  *degraded* `demo/marketing-before` tag, used only for clips C3/C8.
- The page captures into **13 section-level blocks** anchored to
  `index.html:<line>` (verified 2026-06-11; all PNGs decode, no shadow-DOM
  problems — the page uses no Shoelace components in markup).

## Recording architecture

One script per deliverable, plus a shared helper lib:

| File | Output |
|------|--------|
| `demo/lib/record-helpers.ts` | ports of `bootDesignShell` / `enterWireframeMode` / poll gates from `e2e/helpers/design-tool.ts`, plus the cursor glue below |
| `demo/record-hero.ts` | `demo/segments/hero.webm` — ONE continuous take of segments 3–9 |
| `demo/record-clip-wireframe-canvas.ts` | C1 |
| `demo/record-clip-data-binding.ts` | C2 |
| `demo/record-clip-agents.ts` | C3 |
| `demo/record-clip-design-session.ts` | C4 |
| `demo/generate-voiceover-hero.sh` | `demo/voiceover/hero-*.mp3` from `transcript-hero.md` |
| `demo/assemble-hero.sh` | `demo/final/annotask-hero.mp4` (extends `assemble-init-demo.sh` with the speed-ramp step) |

- **Headed always** (`chromium.launch({ headless: false })` under WSLg, as
  `record-init-demo.ts` did) — also sidesteps the known headless-WSL synthetic
  drag flake.
- 1920×1080, `colorScheme: 'dark'`, `recordVideo` 1920×1080; reuse the init
  demo's cursor config verbatim.
- The hero take writes segment markers (elapsed seconds) to
  `demo/segments/hero-markers.json` at each segment boundary — the assemble
  script and the speed-ramp window read them.
- Every script honors `DEMO_SMOKE=1`: skip `recorder.wait()` padding, run every
  selector/gate at full speed, and **skip the Implement click** (no agent burn).
  Run the smoke after every `pnpm build:shell`.

## Determinism strategy (per risky step)

**Cursor glue.** testreel's animated cursor only follows `recorder.*` actions —
raw `page.mouse.*` is invisible to the overlay. testreel exports
`moveCursorToPoint(page, x, y)`. Every real-mouse drag must interleave
`page.mouse.move(p)` with `moveCursorToPoint(page, p.x, p.y)` per step, or blocks
visibly move by themselves on camera.

**(a) Capture.** Exactly `enterWireframeMode()` from the e2e helpers: click
`[data-testid="tool-wireframe"]` → `[data-testid="wireframe-canvas"]` visible
(10s) → first `.wf-block` visible (30s — sequential html2canvas) → 500ms settle.
Then gate before narrating: `GET /__annotask/api/wireframe` route `/` has
`canvas.blocks.length >= 10` and `canvas.fullImage` ending `.png`; first
`.wf-block img` has `naturalWidth > 0`.

**(b) Drag / resize / select.** Real `page.mouse` with the e2e suite's exact
mechanics: select with `click({ position: { x: 8, y: 8 } })` (dodges the +16/+16
duplicate offset); resize via `[data-testid="wf-resize-se"]` after selecting;
`mouse.move → down → move({ steps: 6–10 }) → up`. Do toolbar-block interactions
BEFORE dragging another block over them; duplicate BEFORE note. To guarantee a
snap guide (`.wf-guide-v`/`.wf-guide-h`) on camera, drag slowly (`steps: 20`)
toward another block's edge. **After every manipulation, poll the wireframe API**
for the persisted effect (rect moved/grew, note text present) — these polls are
both correctness gates and pacing.

**(c) Drawn section + binding (hero segment 5).** The exact e2e sequence:
`[data-testid="wf-draw-placeholder"]` (draw tool) → draw on `.wf-stage` — try a
real-mouse drag first for camera; the e2e suite's synthetic PointerEvent
dispatch is the deterministic fallback → `[data-testid="wf-placeholder-label"]`
fill + Enter → select the block →
`[data-testid="wf-md-btn"]` / `wf-md-input` / `wf-md-save` for the markdown
spec → select again → `[data-testid="wf-data-btn"]` →
`[data-testid="binding-picker"]` (10s) →
`[data-testid="binding-row-apiMarketingChangelog"]` (the row name derives from
the catalog source name; display "GET /api/marketing/changelog" — confirm at
rehearsal) → `[data-testid="binding-shape-tree"]` (15s) → assert `.bp-shape-tag`
has class `api-schema` — narrate the badge → drill `.bp-tree-row .bp-twisty` →
check `[data-testid="binding-field-version"]`, `-date`, `-headline` →
`[data-testid="binding-confirm"]` → the block shows its binding chip.

**(d) Palette drop (C2 only).** Never real HTML5 drag. Use the e2e suite's
synthetic DragEvent triple (`dragstart` on
`.components-list-item[data-component-name="…"]` → `dragover` + `drop` on
`.wf-scroll`, one shared `DataTransfer`), choreographed under a cursor flight so
viewers see a drag. Prefer the gear-entry variant
(`[data-testid="wf-configure-btn"]` reopens `[data-testid="gen-panel"]` on a
placed block) for the deep-dive. Generate flow waits:
`[data-testid="gen-generate"]` → `[data-testid="gen-preview-img"]` visible (20s)
+ `naturalWidth > 0` → `[data-testid="gen-place-drop"]`.

**(e) The agent climax.** `claude-local`, default model/effort.
- **Seed `annotask:ai:providerSettings` in `addInitScript`** with
  `embeddedAgentEnabled: true` and `activeProvider: 'claude-local'` (shape per
  `src/embedded/provider-config.ts`). A fresh Playwright context has it EMPTY and
  `useAutoRunDriver.drain()` silently never spawns — the task would mint and
  nothing would run. Show the provider picker on camera for the narrative beat;
  never toggle live.
- Trigger: `[data-testid="wf-implement"]` → `[data-testid="wf-building"]`
  visible (30s — directions diff + composite build).
- Wait chain, in order: 1) poll `/__annotask/api/tasks` for ONE
  `type === 'wireframe_apply'` task with a `.png` screenshot; 2) open the task's
  conversation tab and let the stream fill the frame (scroll every ~15s);
  3) poll task `status === 'review'` — **timeout 300s, hard-fail** (never
  `tryAction` the climax; reset and re-take); 4) design-session entries show
  `written` (`.session-chip.written`); 5) HMR proof:
  `page.frameLocator('.app-iframe')` locator for the new "What's new" content
  (60s); 6) Accept on the task card → the canvas auto-exits → end on a slow
  scroll.
- Record once at real time; speed-ramp in post (1× / 8× captioned / 1×) using
  the run-window markers.

**(f) Undo beat (segment 9).** Design-session panel → `.session-undo` → poll the
iframe for the reverted content. Then STOP — post-production cuts back to the
applied state for the end card (do not re-apply on camera).

## Pre-flight checklist

1. `pnpm build` (or at minimum `pnpm build:shell`) — playgrounds serve the
   **built** shell from dist; stale dist puts old UI on camera.
2. `curl -s localhost:8888/api/stats` OK (auto-starts via `just marketing`).
3. `curl -s localhost:5181/__annotask/api/status` OK; page shows the live stats
   strip (numbers, not "—").
4. `curl -s "localhost:5181/__annotask/api/data-source-shape?name=apiMarketingChangelog&kind=fetch&file=playgrounds/simple/marketing/src/api.js"`
   returns `shape_source: "api-schema"`. If `none`: the schema scanner's negative
   probe cache is poisoned — fully restart the dev-server process (an in-process
   Vite restart is NOT enough; the cache is module-level).
5. `bash scripts/demo-reset-hero.sh`; `git status` clean for the playground;
   `/__annotask/` loads with NO InitWizard.
6. `claude` CLI on PATH and authenticated (`claude -p "say ok"`).
7. WSLg alive (`echo $WAYLAND_DISPLAY`), display scale 100%, other GUI apps closed.
8. `edge-tts --list-voices | grep AndrewNeural` succeeds.
9. ffmpeg + DejaVu fonts present (`/usr/share/fonts/truetype/dejavu/`).
10. ~1 GB free for raw WebM; no leftover `claude --print` processes.

## Verification (per produced clip)

- `ffprobe`: duration in band (hero 240–310s; clips 60–180s), one video + one
  audio stream, 1920×1080@30.
- `freezedetect=n=-60dB:d=8` — no freeze >8s outside the captioned ramp window.
- Audio-sync spot check at each VO segment start (markers json); first and last
  segments are the canaries.
- `blackdetect` at the title/end-card joins.
- A take that completes without throwing is structurally sound (the gates assert
  content); the human pass is for aesthetics.
- Keep raw WebM until the final MP4 is approved.

## Risk register

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Agent run fails/stalls on camera | claude-local only; 300s hard timeout on `review`; hard-fail, reset (`demo:reset:hero` is ~5s), re-take; ramp absorbs duration variance; rehearse the exact sketch once off-camera to confirm the agent can satisfy it |
| 2 | Auto-run silently never spawns | seed `annotask:ai:providerSettings` via `addInitScript`; assert the conversation stream has its first event within 20s of Implement, else abort loudly |
| 3 | HMR doesn't repaint / page errors after the write | gate on the iframe locator before the Accept beat — failure aborts pre-Accept so footage stays salvageable; `demo:reset:hero` reverts the bad write |
| 4 | Capture stalls / broken PNGs | 30s first-block budget + `naturalWidth` gates before narrating; reset wipes `wireframe-snapshots/` |
| 5 | WSLg artifacts/dropped frames | `recordVideo` captures from Chromium (not the screen); `--force-device-scale-factor=1`; review the first 10s of each take; if banding, try `--disable-gpu-compositing` after a rehearsal |
| 6 | edge-tts rate limits | retry 3× with backoff per segment; VO regenerates offline any time — never blocks recording day |

## Deliverables

- [ ] `demo/lib/record-helpers.ts`
- [ ] `demo/record-hero.ts` → best take + `hero-markers.json`
- [ ] `demo/generate-voiceover-hero.sh` + `demo/voiceover/hero-*.mp3`
- [ ] `demo/assemble-hero.sh` → **`demo/final/annotask-hero.mp4`**
- [ ] C1–C4 clip scripts + `demo/final/annotask-clip-*.mp4` (specs in `demo_plan.md`)
