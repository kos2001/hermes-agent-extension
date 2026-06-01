# Hermes Agent — Chrome Extension

Chrome MV3 client for the [Hermes Agent](https://github.com/NousResearch/hermes-agent)
and any OpenAI-compatible chat-completions endpoint. Provides a side-panel chat,
a drag-to-select AI toolbar on any web page, and in-place full-page translation.

Talks to the target's HTTP API over `fetch` + SSE — no CLI spawn, no native
messaging host. When pointed at a Hermes server the server-side agent (with its
skills/tools) runs automatically; against cloud providers it's a plain
chat-completions client.

## Features

- **Side-panel chat** — streaming responses rendered as **Markdown** (headings,
  bold/italic, code blocks, links, **tables**, nested lists), **dark / light**
  theme toggle, and the current page's text auto-included as context.
- **Drag-to-select toolbar** — select text on any page to get a floating toolbar
  (**번역 / 요약 / 설명 / 의역**, adapted from
  [page-assist](https://github.com/n4ze3m/page-assist)). Translate opens a target-
  language picker; the result streams back **inline as Markdown**, beside the
  selection, with a one-line progress row.
- **Full-page translation** — translate the active tab's visible text in place
  (Stop button + per-chunk timeout; JSON-mode requests with fallback).
- **Provider registry** — pick from the providers the Hermes CLI knows about
  (OpenRouter, OpenAI, Nous, DeepSeek, Gemini, Z.AI/GLM, Kimi, NVIDIA, Novita,
  GMI, HuggingFace, Alibaba, Groq-style gateways, local LM Studio / Hermes, …).
  Non-OpenAI providers (Anthropic, Bedrock, OAuth/Codex) are listed but flagged
  as **CLI-only**.
- **Progress display** — Hermes agent/skill tool activity (`hermes.tool.progress`)
  is shown as a single live line in both the side panel and the selection popup.
- **Hermes session continuity** — a per-conversation `X-Hermes-Session-Id` is sent
  to Hermes endpoints so memory / stateful skills persist across turns.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│ Chrome Extension (MV3)                                    │
│                                                           │
│  ┌────────────┐   ┌─────────────────────────────────┐    │
│  │ Side panel │   │ background service worker        │    │
│  │ (React UI) │◄─►│ • health probe                   │    │
│  └─────┬──────┘   │ • side-panel opener              │    │
│        │          │ • selection-action port (stream) │    │
│  ┌─────┴──────┐   └──────────────▲──────────────────┘    │
│  │ content    │  port            │                        │
│  │ script:    │──────────────────┘                        │
│  │ selection  │   (drag-to-select toolbar on every page)  │
│  │ toolbar    │                                           │
│  └────────────┘                                           │
│        │  fetch + SSE (lib/hermes-client.ts)              │
│        ▼   joinApi() → {base}/chat/completions, /models   │
└────────┬──────────────────────────────────────────────────┘
         │ HTTP
         ▼
  Hermes server (127.0.0.1:8642) or any OpenAI-compatible API
```

The side panel makes the streaming chat call directly from its own window
context (no SW relay for SSE). The content-script toolbar cannot reach the LLM
directly (host permissions live on the extension, not the page), so it opens a
long-lived port to the SW, which runs the model and streams chunks/progress back.

### Lineage

- **`src/lib/sse-parser.ts`** — port of `hermes-desktop`'s SSE parser; keeps the
  contract against Hermes' stream shape (incl. `hermes.tool.progress`).
- **`src/lib/hermes-client.ts`** — the OpenAI-compatible HTTP surface
  (`/v1/chat/completions`, `/v1/models`), trimmed to what a browser can do.
  `joinApi()` builds endpoints from a provider base URL (with or without a
  version segment); header values are validated to Latin-1 before `fetch`.
- **`src/lib/providers.ts`** — ported from the Hermes CLI provider profiles.
- **Selection toolbar** — the action set + prompts are adapted from page-assist's
  "copilot" context-menu actions, reworked as an on-selection floating toolbar.
- **`src/lib/markdown.ts`** — small dependency-free, XSS-safe Markdown renderer
  (escapes first, re-introduces only known tags; link hrefs scheme-validated).

## Develop

```sh
npm install          # or: pnpm install
npm run dev          # vite dev — produces dist/ with HMR
npm run build        # type-check (tsc --noEmit) + production build
npm test             # vitest (sse-parser, hermes-client, markdown)
```

Then in Chrome:

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** and choose this repo's `dist/` directory
   (Chrome 137+ ignores the `--load-extension` CLI flag — load it via this UI)
4. Pin the toolbar icon → click → the side panel opens
5. Click the **⚙ gear** in the side-panel bar to open Options and pick a provider

## Configuration

Saved in `chrome.storage.local` under `hermes.config`:

| Field      | Default                          | Notes                                                        |
|------------|----------------------------------|--------------------------------------------------------------|
| `baseUrl`  | `https://openrouter.ai/api/v1`   | Full OpenAI base URL incl. version path; `/chat/completions` is appended |
| `apiKey`   | _empty_                          | Sent as `Authorization: Bearer <key>`; trimmed + Latin-1 validated on save |
| `model`    | `openrouter/auto`                | Set from the provider preset or the "Test connection" model list |
| `headers`  | OpenRouter attribution headers   | Extra JSON headers (e.g. gateway auth)                       |

Other keys: `hermes.theme` (`dark`/`light`), `hermes.translateTarget` (page +
selection translate language), `hermes.selectionTranslateEnabled`.

The manifest requests broad host access (`host_permissions: http://*/*`,
`https://*/*`) at install so the side panel can read page content and translate
on any site without a separate runtime grant.

## Hive (cloud) — operator setup (one time)

"Hive" is the collaborative layer: members sign in and publish summarized
bookmark folders to a shared feed. Auth is **email one-time codes** — no Google
Cloud, no OAuth client, no redirect URLs. **Members set up nothing**: they
install the operator-built extension / open the site and sign in with their
email. The steps below are done **once by the operator** who runs the backend.

1. **Create a Supabase project** (https://supabase.com).
2. **Run the schema:** SQL Editor → run `supabase/migrations/0001_init.sql`
   then `supabase/migrations/0003_comments.sql` (tables, RLS, profile trigger,
   the agent-discussion `comments` table). Both are idempotent. If a pre-existing
   `profiles` table causes a "Database error saving new user" on first login,
   run `supabase/migrations/0002_reset.sql` once (safe before any real data).
3. **Email codes:** the Email provider is on by default. So that the email
   contains a **6-digit code** (not just a magic link), set
   Authentication → Emails → **Magic Link** template to include the token, e.g.:
   ```
   <h2>Your Hive code</h2>
   <p>{{ .Token }}</p>
   ```
   (For real volume, configure SMTP under Authentication → Emails → SMTP; the
   built-in sender is rate-limited and fine for testing.)
4. **Add credentials:** copy `.env.example` to `.env` and fill
   `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (Settings → API → Project URL +
   the **Publishable**/`anon` key). The anon/publishable key is browser-safe —
   RLS protects the data.
5. **Build & distribute:**
   ```sh
   npm run build        # extension → dist/  (creds baked in at build time)
   npm run package      # → hermes-agent-extension.zip for distribution
   npm run build:web    # feed site → dist-web/  (deploy as a static site)
   ```
   The `.env` is gitignored and only needs to exist on the operator's build
   machine; the published artifacts carry the (public) anon key. Members just
   load the extension / open the site and sign in — no env, no Supabase account.

### The feed site (sub-project C)

The shared feed is a separate web app under `web/` (its own Vite config), using
the same Supabase project + env:

```sh
npm run dev:web      # vite dev server (http://localhost:5180)
npm run build:web    # production build → dist-web/  (deploy to any static host)
```

No redirect-URL registration is needed (email codes don't redirect).

Design + plan docs live under `docs/superpowers/`
(`specs/2026-05-31-collective-bookmarks-platform-design.md`,
`plans/2026-05-31-hive-platform-foundation.md`). Sub-projects B (share folder),
C (feed web app), and D (collective-intelligence features) build on this layer.

## Tests

`npm test` runs Node/vitest suites: SSE parsing, the HTTP client helpers
(`joinApi`, header validation, Hermes-endpoint detection), and the Markdown
renderer (incl. tables, nested lists, and XSS-escaping). Browser-runtime UI is
verified by loading the unpacked `dist/` extension.
