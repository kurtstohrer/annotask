#!/usr/bin/env bash
# Assemble the hero demo: speed-ramped take + voiceover + title/end cards.
#
# Everything is timed from demo/segments/hero-markers.json (written by
# record-hero.mjs): the agent-run window [s7-ramp-start+8 … s7-review-2] is
# compressed RAMP_X× with an on-screen caption; voiceover segments land at
# their marker's REMAPPED timestamp.
#
# Usage: bash demo/assemble-hero.sh [video] [markers]

set -euo pipefail

VIDEO="${1:-demo/segments/hero.webm}"
MARKERS="${2:-demo/segments/hero-markers.json}"
VO_DIR="demo/voiceover"
OUT="demo/final/annotask-hero.mp4"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

RAMP_X=8
TITLE_S=3
FONT_B=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
FONT_R=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf

[ -f "$VIDEO" ] || { echo "video not found: $VIDEO (run node demo/record-hero.mjs)"; exit 1; }
[ -f "$MARKERS" ] || { echo "markers not found: $MARKERS"; exit 1; }
mkdir -p demo/final

# ─── Marker math (ramp remapping) ────────────────────────────────────
# f(t) = t                          for t <= R0
#        R0 + (t-R0)/X              for R0 < t <= R1
#        t - (R1-R0)*(1-1/X)        for t > R1
eval "$(python3 - "$MARKERS" "$RAMP_X" "$TITLE_S" <<'PY'
import json, sys
markers = {m["name"]: m["t"] for m in json.load(open(sys.argv[1]))}
X, TITLE = float(sys.argv[2]), float(sys.argv[3])
r0 = markers["s7-ramp-start"] + 8.0           # let the first tool calls play 1×
r1 = markers["s7-review"] - 2.0               # back to 1× just before review lands
if r1 <= r0: r0, r1 = markers["s7-ramp-start"], markers["s7-review"]
def remap(t):
    if t <= r0: return t
    if t <= r1: return r0 + (t - r0) / X
    return t - (r1 - r0) * (1 - 1 / X)
print(f"R0={r0:.2f}; R1={r1:.2f}")
vo = {  # marker → voiceover file
    "s2-setup": "hero-01-open", "s3-freeze": "hero-02-freeze",
    "s4-rearrange": "hero-03-rearrange", "s5-add": "hero-04-add",
    "s6-implement": "hero-05-implement", "s7-agent": "hero-06-agent",
    "s9-safety": "hero-08-safety", "s8-reveal": "hero-07-reveal",
}
import subprocess
def dur(name):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", f"demo/voiceover/{name}.mp3"],
        capture_output=True, text=True).stdout.strip()
    return float(out or 0)
# Sequence-resolve: a line never starts before the previous line ends
# (+0.4s breath) — markers can land closer together than the narration runs.
placed, prev_end = [], 0.0
entries = sorted(((remap(markers[m]) + TITLE, f) for m, f in vo.items() if m in markers))
entries.append((remap(markers["end"]) + TITLE - 2.0, "hero-09-end"))
for at, f in entries:
    start = max(at, prev_end + 0.4)
    placed.append(f"{start:.1f}:{f}")
    prev_end = start + dur(f)
print(f'VO_SEGMENTS="{ " ".join(placed) }"')
PY
)"
echo "ramp window: ${R0}s → ${R1}s at ${RAMP_X}×"

# ─── Cards ───────────────────────────────────────────────────────────
echo "[1/5] title/end cards"
ffmpeg -y -f lavfi -i "color=c=0x0a0a0a:s=1920x1080:d=$TITLE_S" \
  -vf "drawtext=text='Annotask':fontsize=72:fontcolor=white:x=(w-tw)/2:y=(h-th)/2-44:fontfile=$FONT_B, \
       drawtext=text='Freeze. Sketch. Real.':fontsize=38:fontcolor=0x3b82f6:x=(w-tw)/2:y=(h-th)/2+42:fontfile=$FONT_R" \
  -c:v libx264 -pix_fmt yuv420p -r 30 "$TEMP_DIR/title.mp4" 2>/dev/null
ffmpeg -y -f lavfi -i "color=c=0x0a0a0a:s=1920x1080:d=4" \
  -vf "drawtext=text='Annotask':fontsize=56:fontcolor=white:x=(w-tw)/2:y=(h-th)/2-50:fontfile=$FONT_B, \
       drawtext=text='github.com/kurtstohrer/annotask':fontsize=32:fontcolor=0xaaaaaa:x=(w-tw)/2:y=(h-th)/2+40:fontfile=$FONT_R" \
  -c:v libx264 -pix_fmt yuv420p -r 30 "$TEMP_DIR/end.mp4" 2>/dev/null

# ─── Speed-ramped main video ─────────────────────────────────────────
# NB: -ss/-to must be INPUT options (before -i). As output options they
# apply post-filter, and setpts=PTS/X compresses the timeline first — the
# trim window would point past the end and produce an empty segment.
echo "[2/5] splitting + ramping the agent window (${RAMP_X}x)"
ffmpeg -y -to "$R0" -i "$VIDEO" -c:v libx264 -pix_fmt yuv420p -r 30 -an "$TEMP_DIR/pre.mp4" 2>/dev/null
ffmpeg -y -ss "$R0" -to "$R1" -i "$VIDEO" \
  -vf "setpts=(PTS-STARTPTS)/${RAMP_X},drawtext=text='agent working — ${RAMP_X}×':fontsize=30:fontcolor=white:box=1:boxcolor=0x0a0a0aB0:boxborderw=14:x=w-tw-48:y=h-th-42:fontfile=$FONT_R" \
  -c:v libx264 -pix_fmt yuv420p -r 30 -an "$TEMP_DIR/ramp.mp4" 2>/dev/null
ffmpeg -y -ss "$R1" -i "$VIDEO" -vf "setpts=PTS-STARTPTS" -c:v libx264 -pix_fmt yuv420p -r 30 -an "$TEMP_DIR/post.mp4" 2>/dev/null
for part in pre ramp post; do
  d=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$TEMP_DIR/$part.mp4" 2>/dev/null | cut -d. -f1)
  echo "    $part: ${d:-0}s"
  [ "${d:-0}" -gt 0 ] || { echo "ERROR: $part segment is empty"; exit 1; }
done

# ─── Concat ──────────────────────────────────────────────────────────
echo "[3/5] concatenating"
printf "file 'title.mp4'\nfile 'pre.mp4'\nfile 'ramp.mp4'\nfile 'post.mp4'\nfile 'end.mp4'\n" > "$TEMP_DIR/concat.txt"
ffmpeg -y -f concat -safe 0 -i "$TEMP_DIR/concat.txt" -c:v libx264 -pix_fmt yuv420p -r 30 "$TEMP_DIR/full.mp4" 2>/dev/null

# ─── Voiceover track at remapped marker times ────────────────────────
echo "[4/5] voiceover track"
TOTAL=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$TEMP_DIR/full.mp4" | cut -d. -f1)
INPUTS=()
FILTER=""
N=0
for entry in $VO_SEGMENTS; do
  AT="${entry%%:*}"; NAME="${entry#*:}"
  FILE="$VO_DIR/$NAME.mp3"
  [ -f "$FILE" ] || { echo "  warning: $FILE missing — skipped"; continue; }
  MS=$(python3 -c "print(int(float('$AT')*1000))")
  INPUTS+=(-i "$FILE")
  FILTER="$FILTER[$((N+1)):a]adelay=${MS}|${MS}[a$N];"
  N=$((N+1))
done
[ "$N" -gt 0 ] || { echo "no voiceover segments found"; exit 1; }
MIX=""
for i in $(seq 0 $((N-1))); do MIX="${MIX}[a$i]"; done
FILTER="${FILTER}${MIX}amix=inputs=$N:duration=longest:normalize=0[vo]"
ffmpeg -y -f lavfi -i "anullsrc=r=44100:cl=stereo" -t "$((TOTAL + 1))" \
  "${INPUTS[@]}" -filter_complex "$FILTER" -map '[vo]' \
  -c:a aac -b:a 192k "$TEMP_DIR/vo.m4a" 2>/dev/null

# ─── Mux ─────────────────────────────────────────────────────────────
echo "[5/5] muxing"
ffmpeg -y -i "$TEMP_DIR/full.mp4" -i "$TEMP_DIR/vo.m4a" \
  -c:v copy -c:a aac -shortest "$OUT" 2>/dev/null

SIZE=$(du -h "$OUT" | cut -f1)
DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUT")
echo ""
echo "✓ $OUT ($SIZE, ${DUR%.*}s)"
