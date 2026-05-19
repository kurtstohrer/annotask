# Annotask Demo — From AI Draft to Polished Page

**Duration:** ~4:25
**Resolution:** 1920x1080, 60fps
**Agent on camera:** In-shell embedded (Claude local provider)
**Recording tool:** OBS or native screen recorder

---

## Pre-recording setup

```bash
pnpm demo:reset          # Restore to "before" state
pnpm dev:marketing       # Start dev server on port 5181
```

- Chrome clean profile, no extensions, no bookmarks bar
- Terminal: JetBrains Mono 14px, minimal prompt
- Annotask shell open at `http://localhost:5181/__annotask/`
- Agent mode set to "manual" (switch to "auto" in segment 10)
- Claude CLI installed and authenticated

---

## Segment 1 — Cold Open (0:00 – 0:15)

**Voiceover:**
> An AI generated this landing page. The structure is right — the details aren't. Wrong tagline. A pricing section for a free tool. Purple instead of blue. Annotask fixes all of it — without leaving the browser.

**Screen:**
1. [0:00] Split-screen wipe: left = "before" page scrolling slowly, right = "after" page scrolling
2. [0:10] Hold on the side-by-side for 3 seconds
3. [0:13] Transition to full-screen "before" page in the annotask shell

**Cut notes:**
- Record "before" and "after" scrolls separately, composite in post
- Use a clean diagonal or morph wipe, not a fade
- Match scroll speed on both sides

**Features shown:** —

---

## Segment 2 — Setup (0:15 – 0:30)

**Voiceover:**
> Three lines in your Vite config. Start the dev server. Open annotask.

**Screen:**
1. [0:15] Editor showing `vite.config.js` — highlight the `annotask()` plugin line
2. [0:20] Terminal: `pnpm dev:marketing` — server starts, URL visible
3. [0:25] Browser: navigate to `localhost:5181/__annotask/`
4. [0:28] Annotask shell loads — toolbar on left, marketing page in iframe

**Features shown:** Vite plugin, `/__annotask/` shell entry point

---

## Segment 3 — Pin: Bad Copy (0:30 – 0:55)

**Voiceover:**
> The tagline says "ships the code." That's not what annotask does — the agent *applies* the change. Pin it, describe the fix, and the task captures the element, its source file, and the surrounding code.

**Screen:**
1. [0:30] Click "Annotate" tab if not already active
2. [0:32] Click the hero h1 element to drop a pin
3. [0:35] Task panel slides open — type: `"This says 'ships the code' — should be 'Agent applies the change'"`
4. [0:42] Show the captured element context (source file, line number) in the task detail
5. [0:45] Click the "Star on GitHub" CTA button to drop a second pin
6. [0:48] Type: `"Asking to star is presumptuous — change to 'View on GitHub'"`
7. [0:53] Both pins visible on the page with numbered dots

**Features shown:** Pin tool, task creation, element context, source file capture

---

## Segment 4 — Pin: Remove Pricing (0:55 – 1:15)

**Voiceover:**
> Annotask is open-source and free. This pricing section doesn't belong. One pin to remove it.

**Screen:**
1. [0:55] Scroll down to the pricing section
2. [0:58] Pin the "Pricing" heading
3. [1:00] Type: `"Annotask is MIT-licensed and free — remove the entire pricing section"`
4. [1:07] Scroll to the "Trusted by" logo bar
5. [1:09] Pin it: `"We don't have users yet — remove this fake social proof"`
6. [1:13] Brief view of growing task list in sidebar

**Features shown:** Pin tool, contextual feedback, task sidebar

---

## Segment 5 — Arrow: Lifecycle Diagram (1:15 – 1:30)

**Voiceover:**
> The lifecycle diagram is plain text. It should be styled pill badges — like the ones we already have in the design spec.

**Screen:**
1. [1:15] Switch to arrow tool (toolbar)
2. [1:18] Click the plain-text lifecycle line `pending → in_progress → review`
3. [1:21] Draw arrow to the agent integration section above
4. [1:24] Task panel: `"Replace plain text with styled pill badges — see the status colors in the design spec"`
5. [1:28] Arrow visible on page connecting the two elements

**Features shown:** Arrow tool, multi-element context, design spec reference

---

## Segment 6 — Style Editor (1:30 – 2:00)

**Voiceover:**
> The cards have four-pixel corners. Twelve feels right. Select the card, bump the border-radius live, and commit the change as a task.

**Screen:**
1. [1:30] Click "Design" tab → "Inspector" sub-tab
2. [1:33] Click a feature card in the iframe
3. [1:35] Inspector panel shows computed styles — find `border-radius: 4px`
4. [1:38] Edit it to `12px` — card updates live in the iframe
5. [1:42] Show the visual difference (sharper → rounder)
6. [1:45] Scroll to a section with inconsistent padding
7. [1:48] Select the section, change `padding: 48px 0` to `72px 0`
8. [1:52] Click "Commit changes" — style_update task created
9. [1:55] Task shows `context.changes` with `property`, `before`, `after`

**Features shown:** Live style inspector, CSS editing, style_update task, change diff

---

## Segment 7 — A11y Scan (2:00 – 2:30)

**Voiceover:**
> The accessibility scanner catches what the eye misses. Low contrast, empty alt text, a missing landmark. One click to create a fix task for each.

**Screen:**
1. [2:00] Click "Audit" tab → "A11y" sub-tab
2. [2:03] Click "Scan" button — axe-core runs, spinner
3. [2:06] Results appear: violations list with impact severity
4. [2:08] Expand "Color contrast is insufficient" — shows `.section-lede` elements with `#777` on `#0a0a0a`
5. [2:12] Click "Create task" on the contrast violation — a11y_fix task appears
6. [2:15] Expand "Images must have alternate text" — shows the hero `<img>` with empty alt
7. [2:18] Click "Create task" — another a11y_fix task
8. [2:21] Expand "Page must contain a level-one heading" or "Document must have a main landmark"
9. [2:24] Click "Create task"
10. [2:27] Show task sidebar — 3 new a11y_fix tasks with rule, impact, elements

**Features shown:** axe-core scan, violation detail, one-click fix task, impact severity

---

## Segment 8 — Section: Missing Video (2:30 – 2:50)

**Voiceover:**
> There should be a demo video here, not a static screenshot. Draw a section and describe what you want.

**Screen:**
1. [2:30] Switch to section tool (toolbar)
2. [2:33] Draw a rectangle over the demo area (where the static screenshot is)
3. [2:36] Markdown editor opens — type: `"Replace the static screenshot with a video placeholder — 16:9 frame, play button overlay, caption underneath"`
4. [2:44] Click "Add Task" — section_request task created
5. [2:47] Section outline visible on page with the description

**Features shown:** Section tool, markdown editor, section_request task

---

## Segment 9 — Token Editor (2:50 – 3:10)

**Voiceover:**
> Purple is generic. Blue is annotask. Open the token inspector, change the accent color, and watch the entire page recolor.

**Screen:**
1. [2:50] Click "Design" tab → "Tokens" sub-tab
2. [2:53] Scroll to "Colors" → find `--accent: #8b5cf6` (purple)
3. [2:56] Click to edit → change to `#3b82f6` (blue)
4. [2:59] Page updates live — all purple elements turn blue (buttons, pills, links, step badges)
5. [3:03] Show the ripple effect across the page (quick scroll down and up)
6. [3:07] Commit the token change as a theme_update task

**Features shown:** Token inspector, accent color editing, live recolor, theme_update task

---

## Segment 10 — Agent Applies (3:10 – 3:50)

**Voiceover:**
> Auto mode. The agent picks up every task and starts applying. Watch the first one — it reads the source, makes the edit, and the page hot-reloads.

*[After first task completes:]*

> The rest follow. Each fix lands and the page updates in real time.

**Screen:**
1. [3:10] Open Settings → Agent → toggle mode from "Manual" to "Auto"
2. [3:14] First task starts — Conversation tab opens, show the agent's thinking and tool calls
3. [3:18] Agent calls `annotask_get_task` — task detail loads
4. [3:22] Agent reads the source file
5. [3:26] Agent writes the fix — code streaming visible
6. [3:30] HMR fires — page updates in the iframe (show the tagline change: "ships" → "applies")
7. [3:34] Task status flips to "review" ✓
8. [3:36] **Speed ramp begins** — 2-3x speed
9. [3:36-3:48] Remaining tasks stream through: pricing section disappears, cards round out, colors shift to blue, a11y fixes land, lifecycle badges appear
10. [3:48] Speed ramp ends — all tasks in "review" status

**Cut notes:**
- First task (tagline fix): show tool calls in full, real speed
- Remaining tasks: 2-3x speed with subtle progress indicator
- Keep HMR updates visible — each fix should cause a visible page change

**Features shown:** Auto mode, agent conversation, tool calls, task lifecycle, HMR

---

## Segment 11 — Accept / Deny (3:50 – 4:10)

**Voiceover:**
> Accept the fixes that look right. Deny with feedback, and the agent re-applies.

**Screen:**
1. [3:50] Open task sidebar — all tasks in "review" status
2. [3:53] Click into an a11y fix task — show the resolution note from the agent
3. [3:56] Click "Accept" — task removed from list ✓
4. [3:58] Accept two more tasks (style fix, pricing removal) in quick succession
5. [4:02] Click into the tagline task — read the agent's resolution
6. [4:04] Click "Deny" — feedback field appears
7. [4:06] Type: `"Keep the line break, just change the second line to 'Agent applies the change'"`
8. [4:09] Agent picks up the denied task, re-applies with feedback

**Features shown:** Review workflow, accept, deny with feedback, re-apply

---

## Segment 12 — Result (4:10 – 4:25)

**Voiceover:**
> From AI draft to finished page. Annotate the UI. Agent applies the change.

**Screen:**
1. [4:10] Full viewport — hide annotask shell, show just the polished page
2. [4:12] Slow, smooth scroll from top to bottom of the finished page
3. [4:18] Hold on the hero: "Annotate the UI. Agent applies the change."
4. [4:21] Fade to Annotask logo + tagline
5. [4:23] "github.com/kurtstohrer/annotask" below

**Cut notes:**
- Use the actual "after" state (run `pnpm demo:restore` if needed)
- Smooth scroll at constant speed, ~6 seconds top to bottom
- End card: logo centered, dark background, repo URL below

**Features shown:** —

---

## Recording order (not final edit order)

1. **Segments 3-9** — Annotation and editing (the meat, may need retakes)
2. **Segment 10** — Agent applies (live, may need a few takes for timing)
3. **Segment 11** — Accept/deny (depends on segment 10 completing)
4. **Segment 2** — Setup (straightforward, do after annotations so task list is empty)
5. **Segment 1** — Cold open (needs both states, record last)
6. **Segment 12** — Result (final polished page, last recording)

---

## Post-production checklist

- [ ] Select best take per segment
- [ ] Generate voiceover audio per segment (ElevenLabs or similar)
- [ ] Assemble in DaVinci Resolve / CapCut
- [ ] Lay voiceover track first, trim screen recordings to match
- [ ] Speed-ramp segment 10 (agent applies) — real speed for first task, 2-3x for rest
- [ ] Add subtle transitions between segments (cuts, not fades)
- [ ] Add end card (logo + repo URL)
- [ ] Export: `demo/annotask-hero-demo.mp4` (1080p, H.264)
