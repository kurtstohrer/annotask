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

### Demo outline — Init Wizard Deep Dive (~2:30)

The init wizard has 3 main steps with 6 review sub-steps. Record each as a continuous flow.

**Segment 1: Opening (0:00–0:10)**
- Shell loads at `http://localhost:5173/__annotask/`
- Init wizard modal appears automatically ("Set up Annotask")
- Pause to show the wizard title and stepper: "1 Pick init agent | 2 Scan project | 3 Review & Save"

**Voiceover:** "Annotask's init wizard sets up your project in one pass. It scans your codebase, extracts design tokens, and writes project-specific directions for every agent."

**Segment 2: Pick init agent (0:10–0:30)**
- Show the agent selection page — the 4 bullet points explaining what init does (detect framework, extract tokens, write style guide, configure agents)
- Show the AgentQuickSetup component with Claude selected, model dropdown, Auto mode
- Hover over the "Continue →" button, then click it

**Voiceover:** "Pick an agent to run the scan. Claude, Codex, OpenCode, or Copilot — whichever CLI you have installed. The init agent reads your project once and writes the config files that per-task agents will use."

**Segment 3: Scan progress (0:30–1:10)**
- Scan starts automatically after Continue
- Show the progress list with steps appearing:
  - "Detect framework and styling" → ✓ (green checkmark)
  - "Detect theme variants" → ✓
  - "Extract design tokens with your agent" → ✓ (note: "Claude wrote design-spec.json + STYLE_GUIDE.md")
  - "Write agent directions" → ✓ or spinning
  - "Scan component library" → ✓
  - "Scan data sources" → ✓
  - "Scan API schemas" → ✓
- Show the "Agent output" section at bottom with the detection results
- When "Review →" button appears, pause briefly, then click it

**Voiceover:** "The scanner detects your framework, walks your CSS for design tokens, and writes a style guide. Each step shows live progress — framework detected, theme variants found, tokens extracted."

**Segment 4: Review — Framework (1:10–1:20)**
- Review sub-step 0: Framework panel
- Shows detected framework name, version, styling approach
- Click "Next →"

**Voiceover:** "Review what was detected. Framework, version, styling approach — all editable before saving."

**Segment 5: Review — Themes & Tokens (1:20–1:40)**
- Review sub-step 1: Themes & Tokens panel
- Shows the DesignTokenEditor embedded in the wizard
- Dark/Light theme toggle at top
- Colors, Type, Spacing, Borders tabs
- Scroll through some color tokens to show the extracted palette
- Click "Next →"

**Voiceover:** "The token editor — the same one you get in the Design tab. Every color, font, spacing value, and border radius extracted from your CSS. Dark and light theme variants side by side."

**Segment 6: Review — Components (1:40–1:50)**
- Review sub-step 2: Component library panel
- Shows detected library (if any) or "No component library matched"
- Click "Next →"

**Voiceover:** "Component library detection — Annotask finds your UI library and tracks which components your pages actually use."

**Segment 7: Review — APIs & Data (1:50–2:00)**
- Review sub-step 3: APIs & Data panel
- Shows API schemas tab and Data sources tab
- Detected OpenAPI schema, data source composables
- Click "Next →"

**Voiceover:** "API schemas and data sources. The scanner finds your OpenAPI specs, GraphQL endpoints, and data-fetching hooks so agents know where your data comes from."

**Segment 8: Review — Style Guide (2:00–2:10)**
- Review sub-step 4: Style guide panel
- Shows the rendered markdown preview of STYLE_GUIDE.md
- Toggle to Edit mode briefly to show the markdown editor
- Click "Next →"

**Voiceover:** "The style guide — a markdown document the agent writes from your code conventions. Every task agent reads this before making changes."

**Segment 9: Review — Agent Directions (2:10–2:20)**
- Review sub-step 5: Agent directions panel
- Shows the permission mode dropdown
- Shows the AgentDirectionsPanel with per-persona directions
- Click on one agent persona to expand its directions

**Voiceover:** "Per-task agent directions. Each task type — styling, a11y, errors, performance — gets its own project-specific context. The init agent writes these from what it learned about your codebase."

**Segment 10: Save (2:20–2:30)**
- Click "Accept & Save" button
- Wizard closes
- Shell loads with the app in the iframe (Solar System Explorer with planets)
- Brief pause showing the working shell

**Voiceover:** "Accept and save. Three files written — design-spec.json, STYLE_GUIDE.md, agents.json. The shell is ready. Every annotation you make from now on carries your project's full design context."

### Voiceover generation

Generate each segment's voiceover as a separate MP3:
```bash
mkdir -p demo/voiceover
edge-tts --text "VOICEOVER TEXT" --voice en-US-AndrewNeural --rate="-5%" --write-media demo/voiceover/segment-01.mp3
```

Use `--rate="-5%"` for a slightly slower, more deliberate pace.

### Assembly

After recording the video and generating voiceover audio:

1. Use **ffmpeg** to merge video + audio tracks
2. Trim video segments to match voiceover timing
3. Add a title card at the start ("Annotask — Init Wizard") and end card ("github.com/kurtstohrer/annotask")

```bash
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
