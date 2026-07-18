# Hive easy setup — runtime configuration + onboarding

**Date**: 2026-07-18
**Status**: proposed

## Problem

Enabling Hive today requires developer steps that ordinary users (and even the
operator, per install) cannot reasonably do:

1. Edit code — `HIVE_ENABLED` in `src/lib/cloud/client.ts` is a compile-time
   constant (`false`).
2. Create `.env` with `VITE_POCKETBASE_URL` on the build machine — the server
   URL is baked in at build time.
3. `npm run build` + reload the unpacked extension.

Changing the server URL means rebuilding and redistributing the zip. Members
were meant to "set up nothing", but that only holds if the operator rebuilds
for every change.

## Goal

A user installs the extension (any build), pastes **one URL** the operator
shared, and signs in. No `.env`, no rebuild, no code edit.

## Design (A + B: runtime URL + onboarding)

### 1. Runtime server URL

- New storage key `hive.serverUrl` in `chrome.storage.local`, managed by
  `src/lib/cloud/config.ts` (`loadHiveUrl` / `saveHiveUrl` / `probeHive`).
- `probeHive(url)` validates by fetching PocketBase's `/api/health` before
  saving — same "test connection" UX as the gateway setup.
- The PocketBase JS SDK's `baseUrl` is mutable, so the existing `pb` singleton
  survives: `initHive()` reads the stored URL once per context (side panel,
  SW, options) and sets `pb.baseUrl`. All existing imports keep working.
- `import.meta.env.VITE_POCKETBASE_URL` remains as the **default** value only
  (operator-baked builds still work; stored URL wins).

### 2. Kill switch becomes a derived state

- Delete the `HIVE_ENABLED` constant. The feature is "on" exactly when a
  server URL is configured: `hiveConfigured = Boolean(storedUrl ?? envUrl)`.
- UI gates (`App.tsx` hive tab/icon, `HiveSignIn`, `BookmarksView` share
  button) subscribe to that state (storage `onChanged`), so connecting or
  disconnecting takes effect live — no rebuild, no reload.
- Clearing the URL in Settings turns every Hive entry point back off.

### 3. Onboarding UI

- **Settings → Hive tab**: URL field + [연결 테스트/저장] + [해제], mirroring
  the gateway quick-connect section. Operator instruction becomes one line:
  "Settings → Hive에 `https://hive.example.com` 붙여넣기".
- **Side panel 🐝 tab**: when unconfigured, show a small onboarding card
  (what Hive is, URL paste field, link to Settings) instead of hiding the tab
  entirely — discoverability without nagging.

### 4. Web feed (`web/`) — unchanged

The feed site is an operator-deployed static bundle; baking the URL at build
time is appropriate there. (Optional later: read `/config.json` at runtime.)

## Non-goals

- Running a public default Hive server (cost/moderation; revisit later).
- OAuth or email verification — email+password stays as-is.

## Touch points

`src/lib/cloud/client.ts` (singleton + init), new `src/lib/cloud/config.ts`,
`src/sidepanel/App.tsx`, `HiveSignIn.tsx`, `HiveFeedView.tsx`,
`BookmarksView.tsx` (gates), `src/options/Options.tsx` (Hive tab),
`src/lib/i18n.ts` (strings), README (member setup shrinks to two steps).

## Acceptance

- Fresh profile, stock build, no `.env`: paste URL in Settings → hive tab
  appears → sign in → feed loads; remove URL → all Hive UI disappears.
- Operator-baked build (env URL) still works with zero user setup.
- `npm run build` + full vitest suite pass; no `HIVE_ENABLED` references left.
