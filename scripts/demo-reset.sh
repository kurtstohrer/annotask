#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
MARKETING="$REPO_ROOT/playgrounds/simple/marketing"

echo "[demo-reset] Restoring marketing page to 'before' state..."

# Restore marketing files from the tagged before state
git checkout demo/marketing-before -- \
  playgrounds/simple/marketing/index.html \
  playgrounds/simple/marketing/src/style.css

# Unstage so they show as working-tree modifications (HMR picks them up)
git reset HEAD -- playgrounds/simple/marketing/ >/dev/null 2>&1

# Clear tasks and sidecar files so the demo starts clean
if [ -d "$MARKETING/.annotask" ]; then
  echo '[]' > "$MARKETING/.annotask/tasks.json"
  rm -rf "$MARKETING/.annotask/interaction-history" 2>/dev/null || true
  rm -rf "$MARKETING/.annotask/rendered-html" 2>/dev/null || true
  rm -rf "$MARKETING/.annotask/screenshots" 2>/dev/null || true
fi

echo "[demo-reset] Done. Marketing page is in AI first-draft state."
echo "[demo-reset] Start the dev server: pnpm dev:marketing"
echo "[demo-reset] To restore polished state: pnpm demo:restore"
