#!/usr/bin/env bash
set -euo pipefail

echo "[demo-restore] Restoring marketing page to polished state..."

git checkout HEAD -- \
  playgrounds/simple/marketing/index.html \
  playgrounds/simple/marketing/src/style.css

echo "[demo-restore] Done. Marketing page is back to polished state."
