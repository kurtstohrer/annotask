# Annotask Demo Plan — v2

> Supersedes the original "AI draft → polished page" plan (see git history of this
> file). That hero was specced but never recorded; its strongest material survives
> below as deep-dive clips C3/C8 and the salvage map. The pipeline docs it produced
> (`demo/DEMO_RECORDING_PROMPT.md`, `demo/record-init-demo.ts`,
> `demo/generate-voiceover.sh`, `demo/assemble-init-demo.sh`) remain the production
> reference for everything here.

## Why a new plan

The old plan predates Annotask's three biggest feature waves:

1. **Embedded local-CLI agents** — claude/codex/opencode/copilot run inside the
   shell, with per-task conversation threads, streaming work blocks, and usage
   tracking.
2. **Design session + snapshot-wireframe canvas** — freeze a route into a
   manipulable canvas of real-render, source-anchored snapshot blocks
   (drag/snap/resize/multi-select/explode), with a journal-backed change buffer
   and a file-snapshot engine giving byte-exact undo.
3. **Data binding + generate-component flow** — palette → props → real-catalog
   data binding with schema drill-down (`shape_source` honesty tag) → honest
   preview → place; drawn sections carry markdown specs + bindings; "Implement
   this wireframe" turns the sketch into anchored directions an embedded agent
   applies.

These are the differentiators. The demos should lead with them.

## Suite shape

- **One marketing hero** (~4:15): *"Freeze. Sketch. Real."* — fast cuts, voiceover,
  speed-ramped agent run. For README / landing page / social.
- **Deep-dive clips** (1–3 min each): docs/onboarding pace, honest timing, exact
  UI labels. First wave C1–C4, second wave C5–C8.
- **Keep as-is:** `demo/final/annotask-init-demo.mp4` (init wizard) — still accurate.
- **Pipeline:** testreel (scripted Playwright recording, animated cursor,
  1920×1080, headed) + edge-tts (`en-US-AndrewNeural`, rate −5%) + ffmpeg assembly.
  Recording session runbook: `demo/HERO_RECORDING_PROMPT.md`. Voiceover source of
  truth: `demo/transcript-hero.md`.

---

## Hero — *"Freeze. Sketch. Real."* (~4:15)

**Logline:** "Annotask just shipped wireframe mode — and its own page doesn't show
it yet. So we froze the page into a sketch, rearranged it, bound real data, and
let the agent rewrite the source. With one-click, byte-exact undo."

**Why this framing:** the freeze-to-canvas moment is the most visually arresting,
most differentiated thing Annotask does — no competitor turns a live app into a
manipulable canvas of real-render, source-anchored snapshots. Staging it on
Annotask's *own* marketing page makes the dogfooding self-evident (the page
already carries the "This page is running with Annotask enabled" banner). Data
binding is the proof of honesty that makes the climax land: the agent builds a
"What's new" section showing the real `/api/marketing/changelog` feed, not lorem
ipsum.

**Stage:** marketing playground (`just marketing`, http://localhost:5181 — plain
HTML/CSS + Vite), shared FastAPI on `:8888`. The page captures into **13
section-level blocks**, each anchored to `index.html:<line>` (verified). The
"before" state is simply HEAD — reset between takes with `pnpm demo:reset:hero`.

### Segments

| # | Segment | Dur | Features | On screen | VO beat |
|---|---------|-----|----------|-----------|---------|
| 1 | Cold open | 0:15 | — | Montage from the finished take: live page → shatters into wireframe blocks → a block drags with snap guides → cut to the rebuilt page with the new changelog section | "This is a real running page. Watch what happens when you freeze it." |
| 2 | Setup | 0:15 | Vite plugin, `/__annotask/` | `vite.config.js` one-liner → shell opens with the page in the iframe | "Three lines in your Vite config. Open Annotask next to your app." |
| 3 | Freeze | 0:20 | Wireframe mode, snapshot blocks, source anchors | Toggle wireframe mode — the page becomes 13 snapshot blocks; click one, the anchor chip reads `index.html:<line>`; the live iframe is visibly still beneath | "Every block is a snapshot of your real render — anchored to the file and line that produced it." |
| 4 | Rearrange | 0:40 | Drag + snap/align guides, 8-handle resize, notes | Drag the **Install** section up beside/above the feature grids (snap guides fire); widen the **demo video** block via the SE handle; attach a note to the hero | "Drag what you want moved. Stretch what you want bigger. It's your app — as a sketch." |
| 5 | Add with real data | 0:50 | Drawn section + markdown spec, data catalog, schema drill-down, `shape_source` | Draw a section above the Open-source block; type the markdown spec; open the data catalog → pick **GET /api/marketing/changelog** → the shape tree drills `ChangelogEntry[]` (the `api-schema` badge is visible) → check `version`, `date`, `headline` | "Describe the section in markdown — and bind it to a real endpoint. The shape comes from your actual API schema. No lorem ipsum." |
| 6 | Implement | 0:20 | Sketch-vs-original diff, before/after composite, one `wireframe_apply` task | Click **Implement this wireframe** → the labeled before/after composite appears → ONE task mints | "Annotask diffs the sketch against the original — into anchored directions. The relations are the contract, not the pixels." |
| 7 | Agent builds it | 0:50 | Embedded agent, conversation stream, task lifecycle | The conversation thread streams live work blocks: reads anchors, reads the data source, writes `index.html`/`src/`; status pending → in_progress → review. Speed-ramp after the first tool call | "An agent — Claude, Codex, OpenCode, or Copilot — runs right here and writes your source. Annotask never writes code. The agent does." |
| 8 | Reveal | 0:25 | Lossless exit, HMR, live data | Exit wireframe mode → the real page now matches: Install moved, video wider, hero reworded, and a "What's new" strip showing the live changelog feed | "Exit the sketch — and it's not a mockup anymore. Real markup, real data, running in your page." |
| 9 | Safety net | 0:20 | Design session, file snapshots, undo | Open the design-session panel → **Undo last apply** → the whole change reverts byte-exact (cut back to the applied state in post) | "Don't like it? One click. Byte-exact undo, from snapshots taken before the agent touched anything." |
| 10 | End card | 0:15 | — | Before/after split scroll → logo + tagline + repo URL | "Sketch on your real app. The agent makes it real. Annotask." |

### The four directions (the sketch's content)

Each direction produces an unmistakable visual delta and a reliable,
single-file-dominant agent edit on `playgrounds/simple/marketing/index.html` /
`src/style.css`:

1. **MOVE** — drag the Install section block from its late-page position up to
   sit directly under "How it works". Relation: *"now above the feature
   sections"*. A full-width section reorder — instantly visible in before/after.
2. **RESIZE** — widen the demo `video-frame` block ~+40% via the SE handle.
3. **NOTE** — on the hero block: *"Swap the hero screenshot for the
   wireframe-canvas shot and mention wireframe mode in the lede."* The
   self-referential beat: the page must advertise its own newest feature.
4. **ADD** — draw a full-width section above "Open source". Markdown spec:
   *"What's new — a horizontal strip of compact release cards: version badge,
   date, headline. Match the pill/card styling of the rest of the page."*
   Binding: **GET /api/marketing/changelog** (`src/api.js` already exports
   `fetchChangelog()` — deliberately unused; the agent wires it). Fields:
   `version`, `date`, `headline`. Verified: the binding picker resolves this
   source at `shape_source: 'api-schema'` (`ChangelogEntry[]`, confidence 1).

> Rehearsal note: the catalog row testid derives from the source name —
> `[data-testid="binding-row-apiMarketingChangelog"]` (display name
> "GET /api/marketing/changelog"). Confirm at rehearsal; the same data also
> appears as the `fetchChangelog` helper row.

---

## Deep-dive clips — first wave (docs track)

All staged on the marketing playground unless noted.

| # | Clip | Dur | Beats |
|---|------|-----|-------|
| C1 | **Wireframe canvas mechanics** | 3:00 | 1) freeze + anchor-chip tour 2) drag with snap/align guides, arrow-key nudge (Shift = 10px) 3) marquee multi-select + group move 4) duplicate + soft-delete/undelete 5) double-click explode-to-children (a feature grid explodes into per-card blocks with their own anchors) 6) F5 — the sketch persists per-route; switch a viewport preset; exit losslessly (iframe never reloaded). No agent. |
| C2 | **Generate a component & bind real data** | 3:00 | 1) palette → generate panel 2) set props 3) data catalog → shape drill-down → the `shape_source` honesty tag (`api-schema` vs `source-details` vs `none`) 4) honest preview snapshot on the app's true surface 5) place; reconfigure in place via the gear 6) one-line pointer to the apply loop. No agent. |
| C3 | **Embedded agents & conversations** | 3:00 | 1) provider/model/effort picker (claude/codex/opencode/copilot) + permission ceiling 2) pin two copy fixes on the *degraded* page (`pnpm demo:reset`, the `demo/marketing-before` tag — salvaged from the old plan's segments 3–4) 3) agent picks up — per-task conversation thread, live work blocks 4) post a follow-up message into the thread mid-run 5) usage/token ledger 6) `.annotask/conversations/<id>.jsonl` + `usage.jsonl` on disk. |
| C4 | **Design session: apply, undo, discard** | 2:00 | 1) inspector style/class edits — journal entries appear in the design-session panel 2) "Apply now" mints ONE `wireframe_apply` task 3) the agent writes; verification flips entries to written/failed 4) byte-exact undo-batch on camera 5) discard. State the contract plainly: *the agent is the only writer — Annotask only snapshots and restores.* Drive pattern: `e2e/vue-vite.design-apply.test.ts`, restaged on marketing. |

## Deep-dive clips — second wave

| # | Clip | Dur | Notes |
|---|------|-----|-------|
| C5 | **"Implement this wireframe" — the contract** | 2:30 | The labeled before/after composite, one direction per changed block (op, anchor, measured relations), "relations are the contract, pixels are hints" with `skills/annotask-apply/WIREFRAME_APPLY.md` on screen, `needs_info`/`blocked_reason` honesty paths, accept/deny lifecycle unlocking the sketch. |
| C6 | **MCP + CLI grounding** | 2:30 | `annotask tasks` / `annotask task <id>`, the conversation read/post/subscribe MCP tools, `binding-classify`, source excerpts, runtime-endpoint observation, `/annotask-apply` from Claude Code end-to-end. Upgraded from the old plan's MCP clip. |
| C7 | **Multi-framework montage** | 2:00 | Freeze → one drag → anchor chips per framework: react-vite, svelte-vite (Atlas), solid-vite, html-vite. Quick cuts. |
| C8 | **A11y scan** | 1:30 | Near-verbatim the old transcript's segment 7, on the degraded `demo/marketing-before` state: scan → contrast/alt/landmark findings → one-click fix tasks → the agent applies one. |

**Cut from the old optional list:** design tokens, component catalog, performance
audit, error monitor, data & API view, viewport & responsive — folded into C1–C3
or adequately covered by existing material. The init wizard keeps its existing
video.

---

## Salvage map (old plan → new suite)

| Old asset | Reused where |
|-----------|--------------|
| `demo/transcript.md` seg 1 technique (record both states, composite in post) | Hero S1 + S10 |
| `demo/transcript.md` seg 2 VO ("Three lines in your Vite config…") | Hero S2, near-verbatim |
| `demo/transcript.md` segs 3–4 (pin copy fixes) + `demo/marketing-before|after` tags + `scripts/demo-reset.sh` | C3 stage and script material |
| `demo/transcript.md` seg 7 (a11y) | C8, near-verbatim |
| `demo/transcript.md` seg 10 cut notes (first task real speed, ramp the rest, HMR visible) | Hero S7 post-production spec |
| `demo/transcript.md` seg 12 end card (slow scroll, logo, repo URL) | Hero S10 |
| `demo/final/annotask-init-demo.mp4` | Kept as the canonical setup/init clip |
| `demo/record-init-demo.ts` / `generate-voiceover.sh` / `assemble-init-demo.sh` | Production pipeline for every new video |

## Voiceover tone

**Hero (marketing):** short declaratives, present tense, one idea per sentence,
≤14 words per line so cuts breathe. No hype adjectives ("revolutionary",
"seamless") — *specificity is the wow*: "anchored to the exact file and line",
"byte-exact undo", "your actual API schema". Honesty is a feature: say out loud
that the agent writes the code and Annotask never does. Silence over filler.
End on the tagline, nothing after.

**Deep-dives (docs):** instructional second person ("click", "notice"); name UI
elements exactly as labeled; admit real timing ("this run took about forty
seconds — sped up here"); call the honesty mechanics by name (`shape_source`,
written/failed, `needs_info`); end every clip by showing where the state lives
on disk (`.annotask/*.json*`). Developer trust over pace.

## Open creative questions

1. **Cold-open montage vs single shot** — the montage needs post-production
   compositing; a single freeze shot is cheaper and still strong.
2. **Generate-panel beat in the hero?** Segment 5 optionally shows a palette
   component placement with its honest preview. Only if rehearsal proves it
   stable; the drawn section + binding already carries the data story.
3. **Music** — subtle bed under the hero or VO only? (Deep-dives: VO only.)
4. **The hero screenshot swap** (direction 3) means the repo needs a
   wireframe-canvas screenshot in `public/screenshots/`. Capture one during
   rehearsal, or pre-stage it so the agent's edit lands.

## Production

Everything operational — recording scripts, determinism strategy, wait chains,
speed-ramp, pre-flight checklist, risk register — lives in
`demo/HERO_RECORDING_PROMPT.md`. Reset: `pnpm demo:reset:hero` (hero stage,
HEAD-as-before) vs `pnpm demo:reset` (degraded before-state for C3/C8).
