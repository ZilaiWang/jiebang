#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX_DIR="$(mktemp -d "${TMPDIR:-/tmp}/learning-workflow-smoke.XXXXXX")"
OUTPUT_FILE="$SANDBOX_DIR/config.json"

cleanup() {
  rm -rf "$SANDBOX_DIR"
}
trap cleanup EXIT

export XDG_DATA_HOME="$SANDBOX_DIR/data"
export XDG_CONFIG_HOME="$SANDBOX_DIR/config"
export XDG_STATE_HOME="$SANDBOX_DIR/state"
export XDG_CACHE_HOME="$SANDBOX_DIR/cache"

mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME"

(
  cd "$PROJECT_DIR"
  opencode debug config > "$OUTPUT_FILE"
)

for agent in \
  learning-orchestrator \
  background-collector \
  self-assessor \
  objective-diagnostician \
  profile-builder \
  path-planner \
  concept-tutor \
  code-lab \
  tiered-evaluator
do
  grep -q "\"$agent\"" "$OUTPUT_FILE"
done

echo "OpenCode loaded the plugin and all 9 workflow agents."
