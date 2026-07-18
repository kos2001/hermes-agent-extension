# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The **Hermes Agent Chrome extension** — an MV3 client for the [Hermes Agent](https://github.com/NousResearch/hermes-agent) and any OpenAI-compatible chat-completions endpoint. It bundles three deliverables from one codebase: the **extension** (`src/`), the **Hive feed web app** (`web/`), and a **Supabase backend** (`supabase/`). The `README.md` is the authoritative user/operator guide; this file captures architecture and workflow that span multiple files.

## Commands

```sh
npm install            # or pnpm install
npm run dev            # vite dev for the extension → dist/ with HMR (port 5173)
npm run build          # tsc --noEmit + vite build → dist/  (the gate before loading/packaging)
npm run type-check     # tsc --noEmit only
npm test               # vitest run (node env) — all *.test.ts(x)
npm run test:watch     # vitest watch
npm run package        # build, then zip dist/ → hermes-agent-extension.zip (excludes .map)

# Hive feed web app (sub-project C) — separate Vite config, same Supabase env:
npm run dev:web        # vite dev (port 5180)
npm run build:web      # tsc --noEmit + vite build → dist-web/ (static bundle)
```

**Run one test file / case:** `npx vitest run src/lib/markdown.test.ts` or add `-t "test name"`.

**No linter** is configured — `tsc --strict` (with `noUnusedLocals`/`noUnusedParameters`) is the only static gate. `npm run build` runs it; run it before claiming a change compiles.

**Loading the built extension:** `chrome://extensions/` → Developer mode → **Load unpacked** → pick `dist/`. The `--load-extension` CLI flag is ignored on Chrome 137+; use the UI. The manifest pins a public `key`, so the extension ID is stable (`pdfafjabbbgidnmkcdmjpoapmdpemkil`) across machines — this is what lets a Hermes gateway whitelist one fixed `chrome-extension://` origin in its `cors_origins`.

## Architecture

### Three build targets, one tree
- **Extension** (`vite.config.ts` + `@crxjs/vite-plugin`, `manifest.config.ts`) → `dist/`.
- **Web feed** (`vite.web.config.ts`, root `web/`) → `dist-web/`. Plain React/Vite, **no @crxjs**. It reuses the extension's cloud data layer via the `@` → `src/` alias, so `src/lib/cloud/**` must stay free of `chrome.*` APIs at module-eval time (the `storage-adapter` is the seam — see below).
- **Supabase** (`supabase/migrations/*.sql`) — apply migrations in numeric order; all idempotent. `0002_reset.sql` is a one-time recovery, not part of normal setup.

Both Vite builds read `.env` from the **project root** (`vite.web.config.ts` sets `envDir` explicitly because its `root` is `web/`). `VITE_SUPABASE_*` creds are baked in at build time; the anon key is browser-safe (RLS protects data).

### MV3 message topology (deliberately asymmetric)
- The **side panel** (React, `src/sidepanel/`) makes the streaming chat `fetch`+SSE call **directly from its own window** — there is no SW relay for SSE chunks. This keeps streaming simple.
- The **content script** (`src/content/selection-toolbar.ts`, injected on every page) *cannot* reach the LLM directly because host permissions live on the extension, not the page. So it opens a long-lived `chrome.runtime.Port` (`SELECTION_PORT`) to the service worker, which runs the model and streams chunks/progress back. Disconnecting the port aborts the in-flight request (`AbortController`).
- The **service worker** (`src/background/index.ts`) is intentionally narrow: open the side panel on action click, answer `hermes/health` probes, run the selection-port stream, and fire the scheduled market-report `chrome.alarms` job. Don't grow it into a general request relay.

### `src/lib/` — the portable core (no React, unit-tested)
This is where the logic lives; the UI is a thin shell over it. Several files are explicit ports — preserve their upstream contracts when editing:
- `sse-parser.ts` — port of hermes-desktop's SSE parser; must keep handling Hermes' `hermes.tool.progress` events.
- `hermes-client.ts` — the OpenAI-compatible HTTP surface. Two non-obvious helpers: `joinApi()` only inserts `/v1` for **bare hosts** (URLs that already carry a `/v1`, `/v1beta`, `/api/paas/v4`, … version segment are left alone); `isHermesEndpoint()` gates whether `X-Hermes-Session-Id` is attached (cloud APIs reject it on CORS preflight).
- **Latin-1 header rule:** `fetch` throws if any HTTP header value contains a code point > 0xFF. `findNonLatin1()` validates API keys / custom headers on save — keep this guard on any new header path (Korean text, em-dashes, smart quotes from copy-paste all trip it).
- `providers.ts` — ported from the Hermes CLI provider profiles. `markdown.ts` — dependency-free XSS-safe renderer (escape-first, re-introduce known tags only). `skills.ts` — client-side prompt/local skills that work against any provider (vs. Hermes server-side skills).

### `src/lib/cloud/` — Hive (PocketBase) layer
- `client.ts` exports the singleton `pb` PocketBase client plus `initHive()`, which applies the **runtime server URL** and reports whether Hive is configured. The URL lives in `chrome.storage.local` (`hive.serverUrl`, managed by `config.ts`); a build-time `VITE_POCKETBASE_URL` is only the default. There is no compile-time kill switch — Hive is "on" exactly when a URL is configured, and `useHiveConfigured()` (sidepanel) gates every entry point live (spec: `docs/superpowers/specs/2026-07-18-hive-easy-setup.md`).
- `storage-adapter.ts` is the `chrome.storage.local`-backed PocketBase auth store — it shares the session across SW + side panel and survives SW restarts. `cloud/` files touch `chrome.*` only inside function bodies; the web app (`web/cloud.ts`) is a separate env-configured client.

### State / config
All persisted state lives in `chrome.storage.local`: `hermes.config` (connection — merged over `DEFAULT_CONFIG`), `hermes.sessions` + `hermes.activeSessionId`, `hermes.theme`, plus i18n and market-report settings. There is no background DB; the SW reloads config per-operation.

### i18n
UI is bilingual with Korean (`ko`) as default (`src/lib/i18n.ts`). Selection-toolbar actions and skill labels are Korean (번역/요약/설명/의역). The scheduled market report matches the report language to the stored UI language.

## Conventions
- Path alias `@/` → `src/` (set in all three Vite configs + `tsconfig.json` + `vitest.config.ts`).
- Strict TS, ESM, React 18 (`react-jsx`). Charts are dependency-free inline SVG/CSS (`src/sidepanel/Charts.tsx`).
- Feature design + plans live in `docs/superpowers/specs/` and `docs/superpowers/plans/` (dated). Hive sub-projects build on the platform foundation plan; current work tracks `feature/bookmark-organizer`.
- Tests are `vitest` in **node** environment (no jsdom) — they cover `lib/` logic, not React rendering. For runtime UI verification use the project **`verify` skill** (`.claude/skills/verify/` — stubbed-chrome harness + Chrome-for-Testing E2E); for connectivity triage use **`diagnose-hermes`**.
- **Before committing any merge**: `grep -rn "^<<<<<<< \|^>>>>>>> " src web docs *.ts *.md` — markers inside block comments pass `tsc` and vitest, and one has already reached main that way. Never trust `git merge`'s `| tail` output to list every conflicted file.
- Secrets (`.env`, `extension-key.pem`, `*.pem`) and build artifacts (`dist/`, `dist-web/`, `*.zip`) are gitignored.
