#!/usr/bin/env bash
# Voiceover for the hero demo ("Freeze. Sketch. Real.") — edge-tts.
# Draft lines from demo/transcript-hero.md, trimmed to the single-take beats.
# Rewrite any line that drifts from the actual footage, then re-run.

set -euo pipefail

VOICE="en-US-AndrewNeural"
RATE="-5%"
OUT="demo/voiceover"
mkdir -p "$OUT"

# edge-tts with up to 3 retries (network flake never blocks recording day).
tts() { # tts <outfile> <text>
  local out="$1" text="$2"
  for i in 1 2 3; do
    if edge-tts --text "$text" --voice "$VOICE" --rate="$RATE" --write-media "$out" 2>/dev/null; then
      return 0
    fi
    echo "  retry $i for $out"; sleep $((i * 2))
  done
  echo "FAILED: $out"; return 1
}

echo "Generating hero voiceover segments..."

tts "$OUT/hero-01-open.mp3" "This is a real page, running on a real dev server. One line in your Vite config puts Annotask beside it. Watch what happens when you freeze it." &
tts "$OUT/hero-02-freeze.mp3" "One click freezes the page into a sketch. Every block is a snapshot of your real render — anchored to the file and line that produced it. And the live app is still running underneath." &
tts "$OUT/hero-03-rearrange.mp3" "Drag what you want moved — the demo belongs right up top, and snap guides keep it honest. Stretch what you want bigger. And where words beat pixels, leave the agent a note." &
tts "$OUT/hero-04-add.mp3" "New content starts as a drawn section and a markdown spec. Then bind it to a real endpoint. This shape isn't invented — it's read from your API schema. Version, date, headline. No lorem ipsum, ever." &
tts "$OUT/hero-05-implement.mp3" "Implement this wireframe. Annotask diffs the sketch against the original — into directions anchored to source. The relations are the contract. The pixels are just hints." &
tts "$OUT/hero-06-agent.mp3" "Now an agent runs, right here in the shell — Claude, Codex, OpenCode, or Copilot. It reads the directions, reads the data source, and writes your files. Annotask never writes code. The agent does. Sped up here." &
tts "$OUT/hero-07-reveal.mp3" "Accept — and it's not a mockup anymore. The demo moved up. The section is wider. And what's new is your real changelog, fetched live." &
tts "$OUT/hero-08-safety.mp3" "Before accepting — the safety net. Byte-exact undo sits one click away, from snapshots taken before the agent touched anything. This one's right." &
tts "$OUT/hero-09-end.mp3" "Sketch on your real app. The agent makes it real. Annotask." &

wait

COUNT=$(ls -1 "$OUT"/hero-*.mp3 2>/dev/null | wc -l)
echo ""
echo "✓ Generated $COUNT hero voiceover segments in $OUT/"
[ "$COUNT" -eq 9 ] || { echo "expected 9 segments"; exit 1; }
