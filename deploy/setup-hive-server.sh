#!/usr/bin/env bash
# One-shot, idempotent setup of a Hive PocketBase server on a fresh
# Ubuntu/Debian host (run as root). Installs the pinned PocketBase binary,
# this repo's migrations/hooks, a hardened systemd unit, and (optionally)
# built-in Let's Encrypt TLS.
#
#   sudo ./setup-hive-server.sh --domain hive.example.com   # public, auto-TLS on :80/:443
#   sudo ./setup-hive-server.sh                             # 127.0.0.1:8090, put your own proxy in front
#   sudo ./setup-hive-server.sh --dry-run [...]             # print actions only
#
# Re-running upgrades migrations/hooks/unit in place and restarts the service;
# pb_data (the database) is never touched.
set -euo pipefail

PB_VERSION="0.30.4" # keep in sync with .github/workflows/ci.yml and .claude/skills/running-hive-stack
HIVE_HOME=/opt/hive
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DOMAIN=""
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:?--domain needs a value}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

run() {
  if [ "$DRY_RUN" = 1 ]; then echo "DRY: $*"; else "$@"; fi
}

case "$(uname -m)" in
  x86_64) PB_ARCH=amd64 ;;
  aarch64 | arm64) PB_ARCH=arm64 ;;
  *) echo "unsupported arch: $(uname -m)" >&2; exit 1 ;;
esac

# --- user + layout -----------------------------------------------------------
if ! id hive > /dev/null 2>&1; then
  run useradd --system --home-dir "$HIVE_HOME" --shell /usr/sbin/nologin hive
fi
run mkdir -p "$HIVE_HOME/pb_data" "$HIVE_HOME/pb_public"

# --- pinned PocketBase binary ------------------------------------------------
CURRENT=""
[ -x "$HIVE_HOME/pocketbase" ] && CURRENT="$("$HIVE_HOME/pocketbase" --version 2>/dev/null | awk '{print $NF}')" || true
if [ "$CURRENT" != "$PB_VERSION" ]; then
  ZIP_URL="https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip"
  echo "installing PocketBase v${PB_VERSION} (${PB_ARCH})"
  run curl -fsSL -o /tmp/pb.zip "$ZIP_URL"
  run unzip -oq /tmp/pb.zip -d /tmp/pb-unzip
  run install -m 755 /tmp/pb-unzip/pocketbase "$HIVE_HOME/pocketbase"
  run rm -rf /tmp/pb.zip /tmp/pb-unzip
fi

# --- repo migrations + hooks (rsync-style replace, DB untouched) -------------
run rm -rf "$HIVE_HOME/pb_migrations" "$HIVE_HOME/pb_hooks"
run cp -R "$REPO_DIR/pocketbase/pb_migrations" "$HIVE_HOME/pb_migrations"
run cp -R "$REPO_DIR/pocketbase/pb_hooks" "$HIVE_HOME/pb_hooks"
run chown -R hive:hive "$HIVE_HOME"

# --- systemd unit --------------------------------------------------------------
if [ -n "$DOMAIN" ]; then
  EXEC_ARGS="$DOMAIN" # `pocketbase serve <domain>`: binds :80/:443, auto Let's Encrypt
else
  EXEC_ARGS="--http=127.0.0.1:8090" # front it with your own reverse proxy / tunnel
fi
if [ "$DRY_RUN" = 1 ]; then
  echo "DRY: install unit with EXEC_ARGS='$EXEC_ARGS' -> /etc/systemd/system/hive.service"
else
  sed "s|__EXEC_ARGS__|$EXEC_ARGS|" "$REPO_DIR/deploy/hive.service" > /etc/systemd/system/hive.service
fi
run systemctl daemon-reload
run systemctl enable --now hive
run systemctl restart hive

echo
echo "done. next steps:"
echo "  1. create the admin account:"
echo "     sudo -u hive $HIVE_HOME/pocketbase superuser upsert you@example.com <password> --dir=$HIVE_HOME/pb_data"
echo "  2. open the admin UI (/_/) and enable Settings → Backups (S3 or local cron)"
echo "     and Settings → Mail (SMTP) for verification/password-reset emails."
echo "  3. deploy the web feed into $HIVE_HOME/pb_public (see .github/workflows/deploy.yml):"
echo "     VITE_POCKETBASE_URL=https://${DOMAIN:-<your-host>} npm run build:web && rsync dist-web/ -> pb_public/"
echo "  status: systemctl status hive   logs: journalctl -u hive -f"
