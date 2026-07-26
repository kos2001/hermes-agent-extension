#!/usr/bin/env bash
# Print the live Cloudflare quick-tunnel URL for the local Hive server.
#
# `cloudflared tunnel --url ...` mints a NEW random *.trycloudflare.com hostname
# every time it restarts, so any address written down earlier silently rots —
# the page still loads from wherever it was served, but its API calls hit a
# hostname that no longer resolves and the UI reports a generic failure. This
# asks the running cloudflared what its hostname is right now, and proves the
# tunnel actually reaches PocketBase before printing it.
set -euo pipefail

pid=$(pgrep -f 'cloudflared tunnel' | head -1 || true)
if [ -z "$pid" ]; then
  echo "no cloudflared tunnel is running" >&2
  echo "start one with: cloudflared tunnel --url http://127.0.0.1:8090" >&2
  exit 1
fi

# The metrics listener answers /quicktunnel; its port is assigned at startup
# unless --metrics pinned it, so discover it from the process itself.
# -a is required: without it lsof ORs -p against -i and returns every process's
# listeners, so the first hit is some unrelated port.
port=$(lsof -a -nP -p "$pid" -iTCP -sTCP:LISTEN -Fn 2>/dev/null |
  sed -n 's/^n.*:\([0-9]\{1,5\}\)$/\1/p' | head -1 || true)
if [ -z "$port" ]; then
  echo "cloudflared (pid $pid) exposes no metrics listener — cannot read its hostname" >&2
  echo "restart it with: cloudflared tunnel --url http://127.0.0.1:8090 --metrics 127.0.0.1:20241" >&2
  exit 1
fi

host=$(curl -fsS -m 5 "http://127.0.0.1:$port/quicktunnel" |
  sed -n 's/.*"hostname":"\([^"]*\)".*/\1/p')
if [ -z "$host" ]; then
  echo "cloudflared (pid $pid) reported no quick-tunnel hostname on port $port" >&2
  exit 1
fi

url="https://$host"
# Distinguish the three ways this fails, because they need different fixes and
# a wrong diagnosis here sends you to the wrong place entirely.
if ! curl -fsS -m 15 "$url/api/health" | grep -q '"code":200'; then
  if ! dig +short "$host" | grep -q .; then
    echo "$url is not in DNS yet — a just-started quick tunnel takes a moment to propagate." >&2
  elif ! getent hosts "$host" >/dev/null 2>&1 && ! dscacheutil -q host -a name "$host" 2>/dev/null | grep -q ip_address; then
    echo "$url resolves publicly but not through this machine's resolver (negative DNS cache)." >&2
    echo "The tunnel is fine for everyone else; locally, flush with:" >&2
    echo "  sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder" >&2
  else
    echo "$url resolves but /api/health did not answer — is PocketBase up on 127.0.0.1:8090?" >&2
  fi
  exit 1
fi

echo "$url"
