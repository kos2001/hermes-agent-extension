---
name: verify
description: Use when a change to this extension needs runtime verification — side-panel/options React UI, content script, charts, Hive gating, or the chat/LLM path — before claiming it works or committing. Chrome 137+ ignores --load-extension, so naive browser automation fails.
---

# Verify extension changes at runtime

Two tiers. Pick the cheapest that exercises the change; `npm run build && npm test` first is assumed (tsc is the only static gate).

| Change touches | Tier |
|---|---|
| React views, CSS, storage-driven gating (i18n, theme, Hive on/off) | **1 — stubbed-chrome harness** (no real extension) |
| manifest, service worker, content script injection, real LLM/SSE path | **2 — Chrome for Testing E2E** |

## Tier 1 — stubbed-chrome harness

Copy the templates (do NOT rewrite them — they encode fixed bugs):

```sh
mkdir -p harness && cp .claude/skills/verify/assets/harness/* harness/
npx vite --config harness/vite.harness.config.ts   # background; port 5181
```

Run vite with `run_in_background`; stop it with TaskStop before cleanup.
Drive `http://localhost:5181/` with Playwright MCP. Seed state through
`chrome.storage.local.set(...)` inside `browser_evaluate` — the stub dispatches
`onChanged` so storage-gated UI flips live (e.g. `hive.serverUrl`, `hermes.theme`).

**Hive gating contract:** there is no compile-time flag — `hive.serverUrl`
present ⇒ Hive UI on (sign-in button, feed); absent ⇒ 🐝 tab shows the
onboarding card. Seed exactly `https://hive.test.example` — that origin's
`/api/health` is the stub's built-in success fake (extend the fetch shim for
other fakes; that's seeding, not rewriting).

**Tier 1 passes when:** the page mounts with zero uncaught console errors AND
the changed behavior is exercised in both directions (state set → asserted,
state cleared/reverted → asserted), reading real effects back (DOM via
snapshot, writes via `chrome.storage.local.get`), not just absence of crashes.

**Gotchas already paid for:**
- The stub fires `onChanged` **after** the write commits, like real Chrome.
  Keep that order or listeners that re-read storage see stale values.
- `styles.css` must be imported by the harness entry — the extension page gets
  it from index.html, the harness doesn't.
- Set input values via the native setter + `dispatchEvent(new Event("input", {bubbles:true}))`;
  plain `.value=` doesn't reach React.
- Playwright `browser_evaluate` is plain JS — no TypeScript casts (`as`).

**`harness/` is NOT gitignored — delete it when done, before any commit**
(`rm -rf harness && git status` to confirm).

## Tier 2 — Chrome for Testing E2E

Branded Chrome ≥137 silently ignores `--load-extension`; **Chrome for Testing
keeps it**. Playwright's cache has one:
`~/Library/Caches/ms-playwright/chromium-*/chrome-mac-arm64/Google Chrome for Testing.app/...`

```sh
cd <scratchpad> && npm i playwright-core
cp <repo>/.claude/skills/verify/assets/ext-e2e.mjs . && node ext-e2e.mjs
```

The script loads `dist/`, asserts the pinned extension id
(`pdfafjabbbgidnmkcdmjpoapmdpemkil`), configures the connection from
`~/.hermes/config.yaml`, waits for the health badge to go online, and runs a
real streaming chat ("ping" → expects "pong"). Requires a local hermes
api_server on 8642 — check `curl -s 127.0.0.1:8642/health` first, or see the
diagnose-hermes skill.

## After verifying

Rebuilding `dist/` breaks any loaded unpacked copy until the user hits ⟳ on
`chrome://extensions` — say so in your summary whenever you rebuilt.
