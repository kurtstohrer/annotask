#!/usr/bin/env bash
set -euo pipefail

# Reset the marketing playground for the wireframe hero demo
# ("Freeze. Sketch. Real." — see demo_plan.md).
#
# Unlike scripts/demo-reset.sh (which restores the DEGRADED `demo/marketing-before`
# tag for the AI-first-draft clips), the hero's "before" state is simply HEAD:
# the polished page with the live stats strip. This script undoes agent writes
# and clears wireframe/design-session/conversation state, but keeps the
# playground *initialized* (design-spec.json, agents.json, server.json) so the
# InitWizard does not hijack the take.

REPO_ROOT="$(git rev-parse --show-toplevel)"
MARKETING_REL="playgrounds/simple/marketing"
MARKETING="$REPO_ROOT/$MARKETING_REL"
STATE="$MARKETING/.annotask"

echo "[demo-reset-hero] Restoring marketing sources to HEAD..."
git -C "$REPO_ROOT" checkout HEAD -- \
  "$MARKETING_REL/index.html" \
  "$MARKETING_REL/src" \
  "$MARKETING_REL/vite.config.js"
# Agent-CREATED files under src/ are not reverted by checkout — drop them.
# (-fd without -x leaves ignored files like node_modules alone.)
git -C "$REPO_ROOT" clean -fdq -- "$MARKETING_REL/src" || true

if [ -d "$STATE" ]; then
  echo "[demo-reset-hero] Clearing wireframe / session / task state..."
  echo '{"version":"1.0","tasks":[]}' > "$STATE/tasks.json"
  rm -f "$STATE/wireframe.json" \
        "$STATE/design-session.json" \
        "$STATE/file-snapshots.json" \
        "$STATE/usage.jsonl"
  rm -rf "$STATE/conversations" \
         "$STATE/wireframe-snapshots" \
         "$STATE/screenshots" \
         "$STATE/interaction-history" \
         "$STATE/rendered-html"
  # KEEP: server.json, design-spec.json, agents.json, runtime-endpoints.json,
  # cache/ — the playground must stay initialized (no InitWizard on camera).
fi

# Best-effort: reap an embedded-agent CLI orphaned by an aborted take.
pkill -f -- 'claude --print --output-format stream-json' 2>/dev/null || true

echo "[demo-reset-hero] Done. Stage is clean — sketch state, tasks, and agent writes are gone."
echo "[demo-reset-hero] Start the stage: just marketing   (auto-starts the API on :8888)"
