#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
BASE_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
PID_FILE="$BASE_DIR/.manager.pid"
LOG_FILE="$BASE_DIR/manager.log"

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  :
else
  nohup node "$BASE_DIR/src/manager.mjs" >>"$LOG_FILE" 2>&1 &
  echo $! >"$PID_FILE"
fi

exec gemini "$@"
