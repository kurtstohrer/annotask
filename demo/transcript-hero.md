# Annotask Hero Demo — Freeze. Sketch. Real.

**Duration:** ~4:15
**Resolution:** 1920×1080, 30fps
**Stage:** marketing playground (http://localhost:5181), shared FastAPI on :8888
**Agent on camera:** in-shell embedded agent, `claude-local`, default model/effort
**Recording:** testreel scripted take — see `demo/HERO_RECORDING_PROMPT.md`
**Voiceover:** edge-tts, `en-US-AndrewNeural`, rate −5%

> This file is the source of truth for what is said and shown. After recording,
> rewrite any line that no longer matches the actual footage — the VO must
> describe what is literally on screen.

---

## Pre-recording setup

```bash
pnpm demo:reset:hero     # HEAD sources, clean sketch/session/task state
just marketing           # page on :5181, auto-starts the API on :8888
```

- Shell at `http://localhost:5181/__annotask/`, dark scheme, 1920×1080
- `claude` CLI on PATH and authenticated
- Provider settings seeded by the recording script (`embeddedAgentEnabled: true`)
- The whole take is ONE continuous recording; segment boundaries are markers

---

## Segment 1 — Cold open (0:00 – 0:15)

**Voiceover:**
> This is a real page, running on a real dev server. Watch what happens when you
> freeze it.

**Screen:**
1. [0:00] The live marketing page, slow scroll past the hero and stats strip
2. [0:07] Hard cut: the same page mid-freeze — blocks visible on the canvas
3. [0:11] One block drags, a snap guide flashes
4. [0:13] Hard cut to black, title: "Annotask — Freeze. Sketch. Real."

**Cut notes:** assembled in post from the finished take's footage. No montage
longer than 4 shots; cuts, not fades.

---

## Segment 2 — Setup (0:15 – 0:30)

**Voiceover:**
> Three lines in your Vite config. Open Annotask next to your running app.

**Screen:**
1. [0:15] Editor: `vite.config.js`, the `annotask()` plugin line highlighted
2. [0:20] Browser: `localhost:5181/__annotask/` — shell loads, page in the iframe
3. [0:27] Cursor sweeps past the toolbar (Annotate / Design / Audit)

---

## Segment 3 — Freeze (0:30 – 0:50)

**Voiceover:**
> One click freezes the page into a sketch. Every block is a snapshot of your
> real render — anchored to the file and line that produced it. And the live
> app? Still running, right underneath.

**Screen:**
1. [0:30] Click the wireframe tool — capture sweeps the page into 13 blocks
2. [0:38] Click the hero block — the anchor chip reads `index.html:37`
3. [0:43] Click the install block — `index.html:248` (real line may differ)
4. [0:46] Brief hover over the canvas edge showing the live iframe beneath

---

## Segment 4 — Rearrange (0:50 – 1:30)

**Voiceover:**
> Drag what you want moved. The install section belongs right after "how it
> works" — snap guides keep it honest. Stretch what you want bigger. And where
> words beat pixels, leave a note.

**Screen:**
1. [0:50] Drag the Install block up below "How it works" — snap guides fire
2. [1:05] Select the demo video block, drag the SE handle ~40% wider
3. [1:15] Select the hero block, add note: *"Swap the hero screenshot for the
   wireframe-canvas shot and mention wireframe mode in the lede."*
4. [1:27] Wide shot of the rearranged sketch

---

## Segment 5 — Add with real data (1:30 – 2:20)

**Voiceover:**
> New content starts as a drawn section and a markdown spec. Then bind it to a
> real endpoint. This shape isn't invented — it's read from your API schema.
> Version, date, headline. No lorem ipsum, ever.

**Screen:**
1. [1:30] Draw a full-width section above "Open source"
2. [1:36] Type the spec: *"What's new — a horizontal strip of compact release
   cards: version badge, date, headline. Match the pill/card styling of the
   rest of the page."*
3. [1:50] Open the data picker — the catalog lists `GET /api/marketing/changelog`
4. [1:56] The shape tree expands `ChangelogEntry[]` — the `api-schema` badge
   visible on screen
5. [2:05] Check `version`, `date`, `headline` → confirm
6. [2:13] The section shows its binding chip; wide shot of the finished sketch

---

## Segment 6 — Implement (2:20 – 2:40)

**Voiceover:**
> Implement this wireframe. Annotask diffs your sketch against the original —
> into directions anchored to source. The relations are the contract. The
> pixels are just hints.

**Screen:**
1. [2:20] Click **Implement this wireframe**
2. [2:25] The labeled before/after composite renders — numbered badges on each
   changed block
3. [2:33] The task panel shows ONE `wireframe_apply` task, status `pending`

---

## Segment 7 — Agent builds it (2:40 – 3:30)

**Voiceover:**
> An agent runs right here in the shell — Claude, Codex, OpenCode, or Copilot.
> It reads the directions, reads the data source, and writes your files.
> Annotask never writes code. The agent does.

*[after the first tool call, speed ramp begins]*

> Sped up here — the run took about a minute.

**Screen:**
1. [2:40] The conversation tab streams: task picked up, status `in_progress`
2. [2:48] Tool-call blocks scroll past — reading `index.html`, reading the
   changelog source, writing files
3. [2:55] **Speed ramp 8×** with a small "agent working — 8×" caption
4. [3:20] Ramp ends — status flips to `review`; the design-session entries
   show `written` chips

**Cut notes:** record the run once at real time; ramp the middle in post
(1× / 8× captioned / 1×). Never fake the run.

---

## Segment 9 — Safety net (3:30 – 3:45) — BEFORE accept

> Accepting the task clears the session and its snapshot batches — the undo
> affordance only exists while the task is in review. So the safety beat
> plays before the accept, and the actual undo click is demonstrated in
> deep-dive clip C4 instead.

**Voiceover:**
> Before accepting — the safety net. Byte-exact undo sits one click away,
> from snapshots taken before the agent touched anything. This one's right.

**Screen:**
1. [3:30] Switch to Design → Components — the design-session panel lists the
   written entries and the apply batch
2. [3:36] Hover **Undo last apply** (don't click)
3. [3:42] Switch back to the Tasks panel

---

## Segment 8 — Accept & reveal (3:45 – 4:10)

**Voiceover:**
> Accept — and it's not a mockup anymore. The demo moved up. The section is
> wider. And "what's new" is your real changelog, fetched live.

**Screen:**
1. [3:45] Accept the task → the canvas exits to the live page (zero reloads)
2. [3:50] Scroll: the demo section now sits right under the hero
3. [3:57] The "What's new" strip renders live release cards (version badges,
   dates, headlines from the API)
4. [4:05] Hover a release card

---

## Segment 10 — End card (4:05 – 4:20)

**Voiceover:**
> Sketch on your real app. The agent makes it real. Annotask.

**Screen:**
1. [4:05] Split before/after slow scroll (3s)
2. [4:12] Logo + "Freeze. Sketch. Real." + `github.com/kurtstohrer/annotask`

---

## Recording order (not edit order)

1. Segments 3–9 — the continuous take (the whole arc is stateful; do not split)
2. Segment 2 — setup shots (clean state, after a reset)
3. Segments 1 & 10 — assembled in post from take footage + before/after scrolls

## Post-production checklist

- [ ] Pick the best continuous take; note marker timestamps from
      `demo/segments/hero-markers.json`
- [ ] Regenerate VO lines that drifted from the footage (edge-tts, AndrewNeural, −5%)
- [ ] Speed-ramp segment 7 (1× / 8× captioned / 1×) using the run-window markers
- [ ] Cold open + end card composited from take footage
- [ ] Title card 3s, end card 4s (ffmpeg drawtext, DejaVuSans — as init demo)
- [ ] Export `demo/final/annotask-hero.mp4` (1080p, H.264)
