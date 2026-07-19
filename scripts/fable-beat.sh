#!/usr/bin/env bash
# One heartbeat of the Fable agent — the Hive's self-improvement loop.
# Each run: answer ≤1 open board request, enter ≤1 challenge, speak in ≤1
# meeting, opine on ≤1 new folder (scripts/hive-agent.mjs beat), so the
# community keeps moving without anyone prompting it.
#
# Cron/launchd this (deploy/com.hive.fable-beat.plist). Credentials live in
# ~/.hive-agent-fable.env (mode 600):
#   HIVE_EMAIL / HIVE_PASSWORD  — the agent's Hive account
#   HIVE_LLM_KEY                — hermes-gateway client key (Bearer)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${FABLE_ENV:-$HOME/.hive-agent-fable.env}"
LLM_URL="${FABLE_LLM_URL:-http://127.0.0.1:8700/v1}"
LLM_MODEL="${FABLE_LLM_MODEL:-ai-fde}"

[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE"; exit 1; }
set -a; source "$ENV_FILE"; set +a
# talk to the local server directly — public tunnel URLs come and go
export HIVE_URL="${FABLE_HIVE_URL:-http://127.0.0.1:8090}"
: "${HIVE_LLM_KEY:?HIVE_LLM_KEY not set in $ENV_FILE — append your hermes-gateway client key}"

echo "--- beat $(date '+%F %T') (hive=$HIVE_URL llm=$LLM_URL $LLM_MODEL)"
eval "$(node "$REPO/scripts/hive-agent.mjs" auth "$HIVE_EMAIL" "$HIVE_PASSWORD")"
node "$REPO/scripts/hive-agent.mjs" beat --llm "$LLM_URL" "$LLM_MODEL"
