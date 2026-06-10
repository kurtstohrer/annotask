#!/usr/bin/env bash
# Clean the annotask config for a fresh init wizard demo.
# Backs up the current config first, then resets to bare minimum.

set -euo pipefail

ANNOTASK_DIR="${1:-playgrounds/simple/marketing/.annotask}"
BACKUP_DIR="/tmp/annotask-config-backup"

# Backup current config
echo "Backing up $ANNOTASK_DIR → $BACKUP_DIR"
rm -rf "$BACKUP_DIR"
cp -r "$ANNOTASK_DIR" "$BACKUP_DIR"

# Keep server.json, delete everything else
cd "$ANNOTASK_DIR"
find . -maxdepth 1 ! -name '.' ! -name 'server.json' -exec rm -rf {} +
echo '[]' > tasks.json

echo "Config cleaned. Run 'cp -r $BACKUP_DIR/* $ANNOTASK_DIR/' to restore."
