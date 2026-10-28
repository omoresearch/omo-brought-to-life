#!/usr/bin/env bash
# Start Omo: the voice bridge (which also logs his body into your world and
# serves the omo-body MCP tools), then Omo's Hermes if it is not running yet.
# The bridge must listen first, or Hermes registers omo-body with 0 tools.
#
#   scripts/start.sh            then open http://127.0.0.1:8795 and press "Start talking"
#
# Env: OMO_LIVE_PORT (8795), OMO_HERMES_HOME (~/.omo-hermes),
#      OMO_LIVE_HERMES_URL (http://127.0.0.1:8644/v1), OMO_LIVE_LOG_DIR (./logs)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OMO_HERMES_HOME="${OMO_HERMES_HOME:-$HOME/.omo-hermes}"
export OMO_HERMES_HOME
LOGS="${OMO_LIVE_LOG_DIR:-$ROOT/logs}"
PORT="${OMO_LIVE_PORT:-8795}"
HERMES_URL="${OMO_LIVE_HERMES_URL:-http://127.0.0.1:8644/v1}"
HERMES_BASE="${HERMES_URL%/v1}"
mkdir -p "$LOGS"

[ -d "$ROOT/node_modules" ] || (cd "$ROOT" && npm install --no-audit --no-fund)
cd "$ROOT"
echo "voice bridge → $LOGS/voice-live.log"
# The bridge reads the ChatGPT login through codex_token.py from this Hermes
# home (OMO_LIVE_CODEX_HOME, default: Omo's own profile).
HERMES_HOME="${OMO_LIVE_CODEX_HOME:-$OMO_HERMES_HOME}" node voice/server.mjs >>"$LOGS/voice-live.log" 2>&1 &
BRIDGE=$!
trap 'kill $BRIDGE 2>/dev/null' INT TERM EXIT
for _ in $(seq 1 30); do
  curl -fsS -m 2 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 1
done

if ! curl -fsS -m 2 "$HERMES_BASE/health" >/dev/null 2>&1; then
  if [ -d "$OMO_HERMES_HOME" ]; then
    echo "starting Omo's Hermes (HERMES_HOME=$OMO_HERMES_HOME) → $LOGS/hermes.log"
    (cd "$OMO_HERMES_HOME" && HERMES_HOME="$OMO_HERMES_HOME" nohup hermes gateway >"$LOGS/hermes.log" 2>&1 &)
  else
    echo "no Hermes profile at $OMO_HERMES_HOME: run scripts/setup-brain.sh first" >&2
  fi
fi
echo "open http://127.0.0.1:$PORT and press \"Start talking\""
wait $BRIDGE
