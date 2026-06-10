#!/usr/bin/env bash
# Generate voiceover segments for the init wizard demo.
# Uses edge-tts with en-US-AndrewNeural at slightly slower pace.
#
# These are DRAFT scripts — rewrite after recording to match what's
# actually on screen, then re-run this script.

set -euo pipefail

VOICE="en-US-AndrewNeural"
RATE="-5%"
OUT="demo/voiceover"

mkdir -p "$OUT"

echo "Generating voiceover segments..."

# Segment 1: Opening (0:00–0:10)
edge-tts --text "When you first open Annotask on a project, the init wizard walks you through a one-time setup. It scans your codebase — your framework, your CSS tokens, your component library — and writes the configuration that every agent will use going forward." \
  --voice "$VOICE" --rate="$RATE" --write-media "$OUT/segment-01-opening.mp3" &

# Segment 2: Pick init agent (0:10–0:40)
edge-tts --text "First, pick which agent runs the scan. Annotask works with whatever coding agent you already have — Claude Code, Codex, OpenCode, or Copilot. Each one brings its own model options. You're not locked in — you can change this later, and each task type can use a different agent. For now, we'll go with Claude on the defaults." \
  --voice "$VOICE" --rate="$RATE" --write-media "$OUT/segment-02-agent.mp3" &

# Segment 3: Scan progress (0:40–1:20)
edge-tts --text "The scan runs through your project step by step. It reads your package.json to identify Vue, checks your CSS for custom properties and theme variants, then hands off to the agent. Claude reads your source files, pulls out the design tokens — colors, typography, spacing — and writes a style guide from your actual code conventions. You can see the agent's output as it works. Once everything's done, we move to review." \
  --voice "$VOICE" --rate="$RATE" --write-media "$OUT/segment-03-scan.mp3" &

# Segment 4: Review — Framework (1:20–1:30)
edge-tts --text "The review step lets you verify and edit everything before saving. Here's what was detected — Vue 3, the version, and the styling approach. If something's wrong, just fix it." \
  --voice "$VOICE" --rate="$RATE" --write-media "$OUT/segment-04-framework.mp3" &

# Segment 5: Review — Themes & Tokens (1:30–1:55)
edge-tts --text "This is the token editor — every color, font, spacing value, and border radius pulled from your CSS. You get dark and light variants side by side. These tokens are what agents reference when they make styling changes — so when you create a task that says fix the contrast, the agent knows your exact color palette, not just generic values." \
  --voice "$VOICE" --rate="$RATE" --write-media "$OUT/segment-05-tokens.mp3" &

# Segment 6: Review — Components (1:55–2:05)
edge-tts --text "Component detection — if you're using a UI library like PrimeVue, Radix, or Shadcn, Annotask finds it and tracks which components your pages import. Agents use this when they need to add or modify components." \
  --voice "$VOICE" --rate="$RATE" --write-media "$OUT/segment-06-components.mp3" &

# Segment 7: Review — APIs & Data (2:05–2:15)
edge-tts --text "APIs and data sources. The scanner found the OpenAPI spec and the Vue composables that fetch data — useSolarSystem, usePlanets. When you create a task that involves data, the agent knows which hooks to use and which endpoints they hit." \
  --voice "$VOICE" --rate="$RATE" --write-media "$OUT/segment-07-apis.mp3" &

# Segment 8: Review — Style Guide (2:15–2:40)
edge-tts --text "The style guide. The init agent read through your code and wrote this — naming conventions, component patterns, how you handle errors, what to avoid. Every task agent reads this before it touches your source files. You can edit it right here, or if you already have a contributing guide or style doc in your repo, just point Annotask at it and it'll use that instead." \
  --voice "$VOICE" --rate="$RATE" --write-media "$OUT/segment-08-styleguide.mp3" &

# Segment 9: Review — Agent Directions (2:40–3:15)
edge-tts --text "This is where it gets interesting. Annotask doesn't use one agent for everything — there are specialized personas for each task type. The Designer handles style and layout changes. The Accessibility agent handles WCAG fixes. The Bug Hunter handles runtime errors and performance issues. Each one has its own project-specific directions that the init agent wrote — and each one can run on a different LLM. So you could run your style tasks on Claude, your accessibility fixes on Codex, and your error analysis on OpenCode. The directions are just text — edit them to add your team's conventions or constraints." \
  --voice "$VOICE" --rate="$RATE" --write-media "$OUT/segment-09-agents.mp3" &

# Segment 10: Save & Done (3:15–3:30)
edge-tts --text "Accept and save. Annotask writes three files to your project — the design spec, the style guide, and the agent configurations. Your project is ready. From here, every annotation you make — every pin, arrow, section, or style change — carries the full context of your design system, your code conventions, and your component library. The agents know your project before they write a single line." \
  --voice "$VOICE" --rate="$RATE" --write-media "$OUT/segment-10-save.mp3" &

# Wait for all background jobs
wait

echo ""
echo "✓ Generated $(ls -1 "$OUT"/segment-*.mp3 2>/dev/null | wc -l) voiceover segments in $OUT/"
ls -la "$OUT"/segment-*.mp3
