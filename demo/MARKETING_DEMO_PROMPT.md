> **SUPERSEDED (2026-06-11).** The "AI draft → polished page" hero was never
> recorded and has been replaced by the wireframe hero — see `demo_plan.md`,
> `demo/transcript-hero.md`, and `demo/HERO_RECORDING_PROMPT.md`. This file is
> kept because deep-dive clips **C3** (embedded agents, pins on the degraded
> page) and **C8** (a11y scan) still use its stage: the `demo/marketing-before`
> tag via `pnpm demo:reset`, and segments 3–4/7 of `demo/transcript.md`.

# Marketing Hero Demo — Recording Prompt (testreel)

Use this prompt to start a **new Claude Code session** that records Annotask's
headline demo video — **"From AI draft to polished page"** — using **testreel**
(scripted Playwright recording with animated cursor + window chrome) and
**edge-tts** (voiceover). This is the marketing hero demo specced in
`demo_plan.md`; the **init-wizard** demo (a separate, already-built clip) lives in
`demo/DEMO_RECORDING_PROMPT.md` + `demo/record-init-demo.ts` and is your reference
pattern — copy its structure.

---

## Goal

Produce `demo/final/marketing-hero.mp4` (~4 min, 1920×1080): the Annotask
marketing page starts as a flawed "AI first draft", the presenter annotates the
issues in the Annotask shell (pins, arrows, a section, inspector + token edits,
an a11y scan), the **in-shell embedded agent applies the changes to source**, and
the page hot-reloads into the polished version. Voiceover narrates throughout.

The story, segment list (13 segments), the full list of intentional "before"
flaws, and the open creative questions are already written — **read these first
and follow them, do not reinvent them:**

1. `demo_plan.md` — concept, 13-segment table, before/after states, flaw list.
2. `demo/transcript.md` — the **per-segment voiceover script + on-screen
   directions** (the source of truth for what to say and show; ~4:25).
3. `demo/record-init-demo.ts` — the proven testreel `recordPage` pattern
   (chromium launch → recordVideo context → `recordPage()` cursor config →
   `recorder.navigate/click/hover/wait` + raw `page`/`frameLocator` for the rest).
4. `node_modules/testreel/AGENTS.md` and `node_modules/testreel/dist/docs/`
   (`getting-started.md`, `api-reference.md`, `actions.md`, `playwright.md`) —
   **read the bundled testreel docs before writing recording code.**

---

## Setup

testreel `^0.2.0` is already a devDependency. Then:

```bash
pnpm exec playwright install chromium      # one-time
# edge-tts voiceover (already used by the init demo):
pip install edge-tts                       # if missing; voice en-US-AndrewNeural, rate -5%
```

**Reset to the "before" state** (idempotent; safe to re-run between takes):

```bash
pnpm demo:reset        # = scripts/demo-reset.sh: restores marketing index.html +
                       #   src/style.css from the `demo/marketing-before` git tag
                       #   and clears .annotask/tasks.json + sidecars
```

**Start the playground** (the marketing page is plain HTML/CSS + Vite):

```bash
pnpm dev:marketing     # serves the marketing playground (transcript.md assumes :5181;
                       #   confirm the actual port and use it consistently)
```

Then the shell is at `http://localhost:<port>/__annotask/` and the marketing page
renders inside it in an **iframe**.

**Permissions / agent:** the embedded agent apply path now works headlessly for
**all four local CLIs** (claude/codex/opencode/copilot) at the safe **Auto**
default — verified by `src/server/__tests__/apply-cli-matrix.test.ts`. Pick
whichever CLI is installed + logged in (claude is simplest on camera). Set agent
mode to **manual** for the annotate segments, then flip to **auto** for the
"agent applies" segment (segment 11), matching `transcript.md`.

---

## Recording approach (mirror `record-init-demo.ts`)

The shell is at `/__annotask/`; the target app is in `.app-iframe`. Use testreel's
**programmatic `recordPage()` API** (not a JSON definition) so you can mix
animated-cursor actions with Playwright `frameLocator` for iframe interactions:

```ts
import { chromium } from 'playwright'
import { recordPage } from 'testreel'

const browser = await chromium.launch({ headless: false })
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  colorScheme: 'dark',
  recordVideo: { dir: './demo/segments/_raw', size: { width: 1920, height: 1080 } },
})
const page = await context.newPage()
const recorder = await recordPage(page, {
  outputDir: './demo/segments',
  cursor: { style: 'dot', size: 20, color: '#3b82f6', ripple: { enabled: true, color: '#3b82f6' } },
})
await page.goto('http://localhost:<port>/__annotask/', { waitUntil: 'domcontentloaded' })
// Shell-chrome actions: recorder.click('.toolbar-…'), recorder.hover(...)
// App/iframe actions:   page.frameLocator('.app-iframe').locator('h1 .accent')
```

Write the script at **`demo/record-marketing-demo.ts`** (analogous to
`record-init-demo.ts`). Drive it through the 13 segments in `transcript.md`.

**Discover real selectors from the shell source — don't guess.** Key components:
- Toolbar / tools: `src/shell/components/AppToolbar.vue`, the annotate tools in
  `src/shell/composables/useAnnotations.ts` / `useTaskWorkflows.ts` (pin, arrow,
  section, highlight).
- Inspector / style + token edits: `src/shell/components/ElementStyleEditor.vue`,
  `DesignTokenEditor.vue` / the Design → Tokens tab.
- A11y scan: the Audit tab → `a11y` (`src/shell/components/*a11y*`, axe-core).
- Task panel + accept/deny: `TasksPanel.vue`, `TaskCard.vue`, `TaskDetailModal.vue`.
- Conversation / agent run: `ConversationTab.vue` (work-stream timeline streams as
  the agent applies — great B-roll for segment 11).

For determinism on camera you may **pre-seed a couple of tasks** via
`POST /__annotask/api/tasks` (see `apply-cli-matrix.test.ts` for the task shape:
`{ type, description, file, line, context.changes }`) instead of hand-placing
every pin live — `transcript.md` suggests showing 2–3 created live, then the rest
applied. The marketing `.btn` / `--accent` / pricing-section flaws from
`demo_plan.md` are concrete, deterministic edit targets.

---

## Segments needing the LIVE agent (segment 11 "Agent applies")

This is the payoff shot. Flip agent mode to **auto** (or click Run in the
Conversation tab), let the real CLI edit `src/style.css` / `index.html`, and the
Vite HMR repaints the iframe. Wait on the task transitioning to `review`
(`TaskCard` status chip) rather than a fixed sleep — agent runs take 10–60s.
Budget a generous `waitFor` (see `record-init-demo.ts`'s 240s review wait). If a
take is slow/non-deterministic, record the agent run once, then in editing
fast-forward the middle.

---

## Voiceover + assembly (reuse the init-demo pipeline)

1. **Record:** `pnpm exec tsx demo/record-marketing-demo.ts` → raw WebM in
   `demo/segments/`. Review it, note real segment timestamps.
2. **Voiceover:** copy `demo/generate-voiceover.sh` → `demo/generate-marketing-vo.sh`,
   replace each `edge-tts --text "…"` with the segment lines from
   `demo/transcript.md` (voice `en-US-AndrewNeural`, rate `-5%`), output MP3s to
   `demo/voiceover/`. **Rewrite the script lines to match what's actually on
   screen after recording** (the transcript is a draft).
3. **Assemble:** copy `demo/assemble-init-demo.sh` → `demo/assemble-marketing.sh`,
   set the per-segment timestamps to your recording, run it → `demo/final/marketing-hero.mp4`
   (it muxes video + voiceover + title/end cards via ffmpeg).

---

## Gotchas

- **iframe:** annotate/inspect actions target the app inside `.app-iframe` — use
  `page.frameLocator('.app-iframe')`; shell chrome (toolbar, panels) is top-level.
- **Reset between takes:** always `pnpm demo:reset` before re-recording so source
  + tasks start from the flawed baseline. The "after" is the current HEAD page.
- **Port:** confirm the real `dev:marketing` port and use it everywhere
  (`transcript.md` says 5181; verify).
- **Agent readiness:** confirm the chosen CLI is installed + logged in before
  recording the apply segment (the apply matrix proves the flow works per CLI).
- **Don't show secrets:** clean browser profile, no extensions, no token panels.
- **Timing:** prefer `waitFor(selector)` over fixed `wait(ms)` for agent/HMR steps;
  use `recorder.wait(ms)` only for deliberate on-camera pauses.

---

## Deliverables

- [ ] `demo/record-marketing-demo.ts` — the testreel recording script.
- [ ] `demo/generate-marketing-vo.sh` + `demo/voiceover/*.mp3` — narration.
- [ ] `demo/assemble-marketing.sh` — assembly.
- [ ] `demo/final/marketing-hero.mp4` — the finished ~4-min hero video.
- [ ] (optional) the deep-dive clips listed in `demo_plan.md` (tokens, components,
      perf, errors, data/API, MCP+CLI, multi-framework, viewport).
