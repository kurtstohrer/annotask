#!/usr/bin/env bash
# Assemble the init wizard demo: video + voiceover + title/end cards.
#
# Workflow:
#   1. Run record-init-demo.ts first to produce the raw video
#   2. Review the video and note segment timestamps
#   3. Update the voiceover scripts in generate-voiceover.sh to match
#   4. Re-run generate-voiceover.sh
#   5. Edit the timestamps below to match your recording
#   6. Run this script
#
# Usage:
#   bash demo/assemble-init-demo.sh [video-file]
#   e.g. bash demo/assemble-init-demo.sh demo/segments/init-wizard.webm

set -euo pipefail

VIDEO="${1:-demo/segments/init-wizard.webm}"
VO_DIR="demo/voiceover"
OUT_DIR="demo/final"
TEMP_DIR="$(mktemp -d)"

mkdir -p "$OUT_DIR"

if [ ! -f "$VIDEO" ]; then
  echo "Error: Video file not found: $VIDEO"
  echo "Run 'pnpm exec tsx demo/record-init-demo.ts' first."
  exit 1
fi

echo "=== Assembling init wizard demo ==="
echo "    Video: $VIDEO"
echo ""

# ─── Step 1: Generate title + end cards ─────────────────────────────
echo "[1/4] Generating title and end cards..."

# Title card: 3 seconds, dark background with white text
ffmpeg -y -f lavfi -i "color=c=0x0a0a0a:s=1920x1080:d=3" \
  -vf "drawtext=text='Annotask':fontsize=72:fontcolor=white:x=(w-tw)/2:y=(h-th)/2-40:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf, \
       drawtext=text='Init Wizard':fontsize=36:fontcolor=0xaaaaaa:x=(w-tw)/2:y=(h-th)/2+40:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf" \
  -c:v libx264 -pix_fmt yuv420p -r 30 "$TEMP_DIR/title-card.mp4" 2>/dev/null

# End card: 4 seconds
ffmpeg -y -f lavfi -i "color=c=0x0a0a0a:s=1920x1080:d=4" \
  -vf "drawtext=text='github.com/kurtstohrer/annotask':fontsize=36:fontcolor=white:x=(w-tw)/2:y=(h-th)/2:fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf" \
  -c:v libx264 -pix_fmt yuv420p -r 30 "$TEMP_DIR/end-card.mp4" 2>/dev/null

# ─── Step 2: Convert video to mp4 if needed ─────────────────────────
echo "[2/4] Converting video to mp4..."

if [[ "$VIDEO" == *.webm ]]; then
  ffmpeg -y -i "$VIDEO" -c:v libx264 -pix_fmt yuv420p -r 30 \
    -c:a aac "$TEMP_DIR/main.mp4" 2>/dev/null
else
  cp "$VIDEO" "$TEMP_DIR/main.mp4"
fi

# ─── Step 3: Concatenate voiceover with silence gaps ─────────────────
echo "[3/4] Building voiceover track..."

# Voiceover timing: each segment starts at its approximate video timestamp.
# Adjust these after reviewing the recording.
#
# Format: start_seconds:file
# The script inserts silence between segments to align with the video.
SEGMENTS=(
  "0:$VO_DIR/segment-01-opening.mp3"
  "8:$VO_DIR/segment-02-agent.mp3"
  "25:$VO_DIR/segment-03-scan.mp3"
  "85:$VO_DIR/segment-04-framework.mp3"
  "90:$VO_DIR/segment-05-tokens.mp3"
  "100:$VO_DIR/segment-06-components.mp3"
  "103:$VO_DIR/segment-07-apis.mp3"
  "107:$VO_DIR/segment-08-styleguide.mp3"
  "115:$VO_DIR/segment-09-agents.mp3"
  "123:$VO_DIR/segment-10-save.mp3"
)

# Get the total video duration (in seconds)
VIDEO_DURATION=$(ffprobe -v error -show_entries format=duration \
  -of default=noprint_wrappers=1:nokey=1 "$TEMP_DIR/main.mp4" | cut -d. -f1)
# Add title + end card durations
TOTAL_DURATION=$((VIDEO_DURATION + 7))

# Build a complex filter that places each voiceover at its timestamp
# (offset by 3s for the title card)
INPUTS=""
FILTER=""
N=0
for entry in "${SEGMENTS[@]}"; do
  START="${entry%%:*}"
  FILE="${entry#*:}"
  if [ ! -f "$FILE" ]; then
    echo "  Warning: $FILE not found, skipping"
    continue
  fi
  OFFSET=$((START + 3))  # +3s for title card
  INPUTS="$INPUTS -i $FILE"
  FILTER="$FILTER[$((N+1)):a]adelay=${OFFSET}000|${OFFSET}000[a$N];"
  N=$((N+1))
done

# Mix all voiceover segments together
if [ "$N" -gt 0 ]; then
  MIX_INPUTS=""
  for i in $(seq 0 $((N-1))); do
    MIX_INPUTS="${MIX_INPUTS}[a$i]"
  done
  FILTER="${FILTER}${MIX_INPUTS}amix=inputs=$N:duration=longest[voiceover]"

  # Generate a silent base track at the total duration
  ffmpeg -y -f lavfi -i "anullsrc=r=44100:cl=stereo" -t "$TOTAL_DURATION" \
    $INPUTS -filter_complex "$FILTER" -map '[voiceover]' \
    -c:a aac -b:a 192k "$TEMP_DIR/voiceover.m4a" 2>/dev/null
else
  echo "  No voiceover segments found — creating silent track"
  ffmpeg -y -f lavfi -i "anullsrc=r=44100:cl=stereo" -t "$TOTAL_DURATION" \
    -c:a aac "$TEMP_DIR/voiceover.m4a" 2>/dev/null
fi

# ─── Step 4: Concatenate video parts + merge audio ───────────────────
echo "[4/4] Assembling final video..."

# Create concat list
cat > "$TEMP_DIR/concat.txt" <<EOF
file 'title-card.mp4'
file 'main.mp4'
file 'end-card.mp4'
EOF

# Concatenate video segments
ffmpeg -y -f concat -safe 0 -i "$TEMP_DIR/concat.txt" \
  -c:v libx264 -pix_fmt yuv420p "$TEMP_DIR/concat.mp4" 2>/dev/null

# Merge video + voiceover
ffmpeg -y -i "$TEMP_DIR/concat.mp4" -i "$TEMP_DIR/voiceover.m4a" \
  -c:v copy -c:a aac -shortest \
  "$OUT_DIR/annotask-init-demo.mp4" 2>/dev/null

# ─── Cleanup ─────────────────────────────────────────────────────────
rm -rf "$TEMP_DIR"

FILESIZE=$(du -h "$OUT_DIR/annotask-init-demo.mp4" | cut -f1)
echo ""
echo "✓ Final video: $OUT_DIR/annotask-init-demo.mp4 ($FILESIZE)"
echo ""
echo "Next steps:"
echo "  1. Watch the video and note actual segment timestamps"
echo "  2. Update voiceover scripts in generate-voiceover.sh"
echo "  3. Update SEGMENTS timestamps in this script"
echo "  4. Re-run: bash demo/assemble-init-demo.sh"
