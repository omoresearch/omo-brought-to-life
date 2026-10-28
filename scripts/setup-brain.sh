#!/usr/bin/env bash
# Create Omo's own Hermes profile (his brain) without touching your main one.
#
#   scripts/setup-brain.sh
#
# Never overwrites an existing file. Generates a random API_SERVER_KEY for the
# loopback API the voice bridge calls, and never prints it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOME_OMO="${OMO_HERMES_HOME:-$HOME/.omo-hermes}"
command -v hermes >/dev/null || { echo "Hermes Agent is not installed: https://hermes-agent.nousresearch.com/docs" >&2; exit 1; }

mkdir -p "$HOME_OMO/skills/omo-body"
chmod 700 "$HOME_OMO"
copy() { if [ -e "$2" ]; then echo "keep   $2"; else cp "$1" "$2"; echo "wrote  $2"; fi; }
copy "$ROOT/brain/config.example.yaml" "$HOME_OMO/config.yaml"
copy "$ROOT/brain/persona.md" "$HOME_OMO/SOUL.md"
copy "$ROOT/brain/skills/omo-body/SKILL.md" "$HOME_OMO/skills/omo-body/SKILL.md"

ENV_FILE="$HOME_OMO/.env"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
if ! grep -q '^API_SERVER_KEY=' "$ENV_FILE"; then
  printf 'API_SERVER_KEY=%s\n' "$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')" >>"$ENV_FILE"
  echo "added  API_SERVER_KEY to $ENV_FILE (not shown)"
fi

cat <<EOF

Next:
  1. Log in with your ChatGPT account (Omo's brain and voice both use it):
       HERMES_HOME=$HOME_OMO hermes auth      # provider: openai-codex
       HERMES_HOME=$HOME_OMO hermes model     # pick a model your plan offers
  2. Start Minecraft with the Omo Space mod and load a world.
  3. scripts/start.sh, then open http://127.0.0.1:\${OMO_LIVE_PORT:-8795}
EOF
