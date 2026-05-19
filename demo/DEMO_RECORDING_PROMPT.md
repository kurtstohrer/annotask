# Demo Recording Prompt

Use this prompt to start a new Claude Code session that records the annotask init wizard demo video using testreel + edge-tts.

---

## Prompt

You are going to create a polished demo video of Annotask's init wizard using **testreel** (scripted browser recording with visual polish) and **edge-tts** (text-to-speech voiceover). The demo shows the full init wizard flow on the vue-vite "Solar System Explorer" playground.

### Setup

1. **Install testreel** in the project:
   ```bash
   pnpm add -D testreel
   pnpm exec playwright install chromium
   ```

2. **edge-tts** is already installed (`pip install edge-tts`). Use voice `en-US-AndrewNeural` (warm, confident male). Generate voiceover segments as MP3 files in `demo/voiceover/`.

3. **Start the required servers** before recording:
   ```bash
   # Terminal 1: Vue playground
   pnpm dev:vue-vite
   # Terminal 2: Solar System API (needed for planet data)
   cd playgrounds/simple/api && uvicorn main:app --port 8888
   ```

4. **Clean the annotask config** for a fresh init wizard:
   ```bash
   cd playgrounds/simple/vue-vite/.annotask
   # Keep server.json, delete everything else
   ls | grep -v server.json | xargs rm -rf
   echo '[]' > tasks.json
   ```

### Recording approach

Since the annotask shell uses an **iframe**, use testreel's **programmatic `recordPage` API** (not JSON definitions) so you can use Playwright's `page.frameLocator('.app-iframe')` for iframe interactions.

Write the recording script as a TypeScript file at `demo/record-init-demo.ts`. Use `recordPage()` from testreel to get the animated cursor and visual polish.

Key testreel programmatic API:
```typescript
import { chromium } from 'playwright'
import { recordPage } from 'testreel'

const browser = await chromium.launch({ headless: false })
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  colorScheme: 'dark',
  recordVideo: { dir: './demo/segments/_raw', size: { width: 1920, height: 1080 } },
})
const page = await context.newPage()
const recorder = recordPage(page, {
  cursor: { style: 'dot', size: 20, color: '#3b82f6', ripple: { enabled: true, color: '#3b82f6' } },
})

// Navigate and interact...
await recorder.navigate('http://localhost:5173/__annotask/')
await recorder.click('.some-selector')
await recorder.type('input', 'hello', { speed: 60 })

// For iframe elements, pass Playwright Locator objects:
const frame = page.frameLocator('.app-iframe')
await recorder.click(frame.locator('h1'))

// When done:
const result = await recorder.stop()
// result.videoPath has the recording
```

### Demo outline — Init Wizard Deep Dive (~3:30)

The init wizard has 3 main steps with 6 review sub-steps. Record the video first as a continuous flow, then write the voiceover script to match what actually happens on screen. The voiceover drafts below are starting points — rewrite them after recording to narrate what's actually visible and sound natural, not scripted.

---

**Segment 1: Opening (0:00–0:10)**
- Load `http://localhost:5173/__annotask/`
- Init wizard modal appears automatically ("Set up Annotask")
- Pause to show the wizard title and the 3-step stepper: "Pick init agent → Scan project → Review & Save"

**Voiceover (draft — rewrite after recording):** "When you first open Annotask on a project, the init wizard walks you through a one-time setup. It scans your codebase — your framework, your CSS tokens, your component library — and writes the configuration that every agent will use going forward."

---

**Segment 2: Pick init agent (0:10–0:40)**
- Show the agent selection page with the 4 bullet points (detect framework, extract tokens, write style guide, configure agents)
- **Switch the agent dropdown to Codex** — show its model list briefly
- **Switch to OpenCode** — show its model list
- **Switch back to Claude** — leave it on the default model (Auto / CLI default)
- Show the Mode toggle (Auto/Manual/Off) and Permissions row
- Click "Continue →"

**Voiceover (draft):** "First, pick which agent runs the scan. Annotask works with whatever coding agent you already have — Claude Code, Codex, OpenCode, or Copilot. Each one brings its own model options. You're not locked in — you can change this later, and each task type can use a different agent. For now, we'll go with Claude on the defaults."

---

**Segment 3: Scan progress (0:40–1:20)**
- Scan starts automatically after clicking Continue
- Show the live progress list as steps complete:
  - "Detect framework and styling" → ✓
  - "Detect theme variants" → ✓
  - "Extract design tokens with your agent" → ✓ ("Claude wrote design-spec.json + STYLE_GUIDE.md")
  - "Write agent directions" → spinning → ✓
  - "Scan component library" → ✓
  - "Scan data sources" → ✓
  - "Scan API schemas" → ✓
- Show the "Agent output" panel at the bottom — it shows what Claude detected (framework, token count, theme variants, etc.)
- When "Review →" appears, pause briefly, then click it

**Voiceover (draft — rewrite after recording to narrate what's actually happening on screen):** "The scan runs through your project step by step. It reads your package.json to identify Vue, checks your CSS for custom properties and theme variants, then hands off to the agent. Claude reads your source files, pulls out the design tokens — colors, typography, spacing — and writes a style guide from your actual code conventions. You can see the agent's output as it works. Once everything's done, we move to review."

---

**Segment 4: Review — Framework (1:20–1:30)**
- Shows detected framework name (e.g. "Vue 3"), version, styling approach ("CSS custom properties, scoped CSS")
- Fields are editable — briefly click into the styling field to show it's not locked
- Click "Next →"

**Voiceover (draft):** "The review step lets you verify and edit everything before saving. Here's what was detected — Vue 3, the version, and the styling approach. If something's wrong, just fix it."

---

**Segment 5: Review — Themes & Tokens (1:30–1:55)**
- The full DesignTokenEditor is embedded right in the wizard
- Show the Dark/Light theme toggle at the top
- Click through the tabs: Colors → Type → Spacing → Borders
- Scroll through the color tokens slowly — show the extracted palette with swatches and hex values
- Click "Next →"

**Voiceover (draft):** "This is the token editor — every color, font, spacing value, and border radius pulled from your CSS. You get dark and light variants side by side. These tokens are what agents reference when they make styling changes — so when you create a task that says 'fix the contrast', the agent knows your exact color palette, not just generic values."

---

**Segment 6: Review — Components (1:55–2:05)**
- Shows detected component library (or "No component library matched")
- Brief pause
- Click "Next →"

**Voiceover (draft):** "Component detection — if you're using a UI library like PrimeVue, Radix, or Shadcn, Annotask finds it and tracks which components your pages import. Agents use this when they need to add or modify components."

---

**Segment 7: Review — APIs & Data (2:05–2:15)**
- Show the API schemas tab — detected OpenAPI spec at `/openapi.json`
- Switch to the Data sources tab — show detected composables (useSolarSystem, usePlanets)
- Click "Next →"

**Voiceover (draft):** "APIs and data sources. The scanner found the OpenAPI spec and the Vue composables that fetch data — useSolarSystem, usePlanets. When you create a task that involves data, the agent knows which hooks to use and which endpoints they hit."

---

**Segment 8: Review — Style Guide (2:15–2:40)**
- Shows the rendered markdown preview of STYLE_GUIDE.md
- **Scroll through the style guide slowly** — show the sections (naming conventions, component patterns, accessibility rules, things to avoid)
- Toggle to "Edit" mode briefly to show the raw markdown editor
- Show the "Load from file" input at the top — type a path like `docs/CONTRIBUTING.md` but don't submit
- Toggle back to Preview
- Click "Next →"

**Voiceover (draft):** "The style guide. The init agent read through your code and wrote this — naming conventions, component patterns, how you handle errors, what to avoid. Every task agent reads this before it touches your source files. You can edit it right here, or if you already have a contributing guide or style doc in your repo, just point Annotask at it and it'll use that instead."

---

**Segment 9: Review — Agent Directions (2:40–3:15)**
- Shows the default permission mode dropdown (Default / Play / Bypass)
- Shows the agent directions panel with per-persona cards (general, designer, a11y, bug-hunter)
- **Click on the "designer" agent** to expand its project directions — scroll through them
- **Click on the "a11y" agent** to show its different directions
- **Change one agent's provider** — e.g. switch the "designer" agent to use OpenCode with a different model (like `codex/gpt-5.4` or similar) to demonstrate that each agent can use a different LLM
- Show that the directions are editable text

**Voiceover (draft):** "This is where it gets interesting. Annotask doesn't use one agent for everything — there are specialized agents for each task type. The designer agent handles style and layout changes. The a11y agent handles accessibility fixes. The bug-hunter handles runtime errors and performance issues. Each one has its own project-specific directions that the init agent wrote — and each one can run on a different LLM. So you could run your style tasks on Claude, your a11y fixes on Codex, and your error analysis on OpenCode. The directions are just text — edit them to add your team's conventions or constraints."

---

**Segment 10: Save & Done (3:15–3:30)**
- Click "Accept & Save"
- Wizard closes, Annotask loads with the Solar System Explorer visible
- Brief pause showing the fully configured interface — the toolbar, the app, the task sidebar
- Maybe hover over a UI element to show the selection overlay activating

**Voiceover (draft):** "Accept and save. Annotask writes three files to your project — the design spec, the style guide, and the agent configurations. Your project is ready. From here, every annotation you make — every pin, arrow, section, or style change — carries the full context of your design system, your code conventions, and your component library. The agents know your project before they write a single line."

### Workflow: Video first, voiceover second

1. **Record the video first** using testreel. Get all the interactions looking right.
2. **Watch the recording** and note exact timestamps where each segment starts/ends.
3. **Rewrite the voiceover scripts** to match what's actually on screen. The drafts above are starting points — the final scripts should narrate what the viewer is seeing, not read from a teleprompter. Make it conversational, like you're walking a colleague through the tool.
4. **Generate voiceover audio** for each segment, timed to match the video.
5. **Assemble** video + audio into the final cut.

### Voiceover generation

Generate each segment's voiceover as a separate MP3:
```bash
mkdir -p demo/voiceover

# Example for one segment — repeat for each with the final script text
edge-tts --text "When you first open Annotask on a project, the init wizard walks you through a one-time setup." \
  --voice en-US-AndrewNeural --rate="-5%" --write-media demo/voiceover/segment-01.mp3

# To preview a voice before committing:
edge-tts --text "Testing the voice" --voice en-US-BrianNeural --write-media /tmp/test-voice.mp3
```

Use `--rate="-5%"` for a slightly slower, more deliberate pace. Try these voices and pick whichever sounds best:
- `en-US-AndrewNeural` — warm, confident
- `en-US-BrianNeural` — approachable, casual
- `en-US-GuyNeural` — calm, professional
- `en-GB-RyanNeural` — British, often cited as least robotic

### Assembly

After recording the video and generating voiceover audio:

1. Use **ffmpeg** to merge video + audio tracks
2. Add silence gaps between voiceover segments where the video needs breathing room
3. Add a title card at the start ("Annotask — Init Wizard") and end card ("github.com/kurtstohrer/annotask")

```bash
# Concatenate voiceover segments with gaps (adjust durations to match video)
ffmpeg -i demo/voiceover/segment-01.mp3 -i demo/voiceover/segment-02.mp3 ... \
  -filter_complex "[0][1]concat=n=10:v=0:a=1" demo/voiceover/full-voiceover.mp3

# Merge video + audio
ffmpeg -i demo/segments/init-wizard.webm -i demo/voiceover/full-voiceover.mp3 \
  -c:v libx264 -c:a aac -shortest demo/final/annotask-init-demo.mp4
```

### Important notes

- The init wizard's scan step spawns Claude CLI. Make sure `claude` is installed and authenticated before recording.
- The scan takes 30-90 seconds in real time. For the demo, either let it run at real speed (impressive) or speed-ramp the middle portion.
- Use `colorScheme: 'dark'` in the Playwright context for consistent dark theme.
- The vue-vite playground runs on port 5173, the API on port 8888.
- After recording, restore the config: `cp -r /tmp/annotask-config-backup/* playgrounds/simple/vue-vite/.annotask/`

### Files to create

- `demo/record-init-demo.ts` — testreel recording script
- `demo/voiceover/*.mp3` — edge-tts voiceover segments
- `demo/final/annotask-init-demo.mp4` — final assembled video
