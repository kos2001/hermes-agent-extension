---
name: running-hive-stack
description: Use when running, booting, or verifying the Hive stack locally in this repo — starting PocketBase, the web feed UI, the server-rule e2e suite, or driving the UI with Playwright — or when `pocketbase` is not found on PATH, or a port is already in use (8090/5180).
---

# Running the Hive Stack

## Overview

Hive = PocketBase backend (repo migrations + hooks) + Vite web feed UI (`web/`). Boot a **throwaway** stack for any dev/verify work; never write to a server you didn't start.

## ⚠️ Ports — the one hazard

**8090 usually hosts the user's LIVE PocketBase and 5180 their vite.** A health check on 8090 succeeding does NOT mean your server started — `bind: address already in use` in your log means you're talking to the live one. Always:

```bash
lsof -nP -iTCP:8090 -iTCP:5180 -iTCP:8095 -iTCP:5181 -sTCP:LISTEN   # see what's taken
```

Pick free ports (8095/5181 below), then confirm your own PID owns them before writing any data. Never kill listeners you didn't start.

## Get PocketBase (not on PATH)

Pinned v0.30.4 (same as CI). Download to your scratchpad:

```bash
curl -sL -o $SCRATCH/pb.zip https://github.com/pocketbase/pocketbase/releases/download/v0.30.4/pocketbase_0.30.4_darwin_arm64.zip
unzip -q $SCRATCH/pb.zip -d $SCRATCH/pb && PB_BIN=$SCRATCH/pb/pocketbase
```

(Linux CI: `linux_amd64` zip — see `.github/workflows/ci.yml`.)

## Boot (from repo root)

```bash
$PB_BIN serve --http=127.0.0.1:8095 --dir=$SCRATCH/pb_data \
  --migrationsDir=$PWD/pocketbase/pb_migrations --hooksDir=$PWD/pocketbase/pb_hooks &
curl -s http://127.0.0.1:8095/api/health    # {"message":"API is healthy."} — but check YOUR log has no bind error
VITE_POCKETBASE_URL=http://127.0.0.1:8095 ./node_modules/.bin/vite --config vite.web.config.ts --port 5181 &
```

- Backend URL env var: `VITE_POCKETBASE_URL` (read in `web/cloud.ts` and `src/lib/cloud/client.ts`); CLI `--port` overrides config's strictPort 5180.
- curl the UI via `http://localhost:5181/` (vite binds IPv6 `::1`; `127.0.0.1` returns empty).
- Playwright verification: navigate to `http://localhost:5181/`, register/sign in via the UI.

## Users / auth (HTTP API)

```bash
curl -X POST http://127.0.0.1:8095/api/collections/users/records -H 'Content-Type: application/json' \
  -d '{"email":"u@local.test","password":"localpw123","passwordConfirm":"localpw123","display_name":"U"}'
curl -X POST http://127.0.0.1:8095/api/collections/users/auth-with-password -H 'Content-Type: application/json' \
  -d '{"identity":"u@local.test","password":"localpw123"}'   # → {token, record.id}; send as `Authorization: <token>`
```

Full agent-facing API guide: `docs/hive-agent-skill.md`; ready client: `scripts/hive-agent.mjs`.

## Test suites

```bash
npm test                                   # vitest unit tests
PB_BIN=$SCRATCH/pb/pocketbase npm run test:e2e   # server-rule suite; boots its OWN throwaway PB on 8091, self-cleans
npm run type-check
```

## Teardown (required)

Kill only PIDs you started (`lsof -ti :8095 :5181` after confirming ownership), `rm -rf $SCRATCH/pb_data $SCRATCH/pb $SCRATCH/pb.zip` (keep `pb/` only if you'll boot again this session), verify 8090/5180 listeners you found at the start are still running.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Trusting `/api/health` on 8090 | That's the live server; check your log for `bind: address already in use` |
| Hunting for a pocketbase binary | It's never installed; download v0.30.4 as above |
| `curl http://127.0.0.1:5181/` → empty | Use `localhost` (IPv6) |
| Pointing e2e at a running server | Never — the suite writes junk; it boots its own PB from `PB_BIN` |
