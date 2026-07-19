---
name: install-extension
description: Use when installing or loading the Hermes Agent Chrome extension for someone — first-time setup, "how do I run/load this", building dist/, loading unpacked in Chrome, or connecting it to a hermes-agent server. Covers build → load → connect → verify.
---

# Install & connect the extension

Four steps: build → load in Chrome → connect → verify. The connect step is
where people get stuck (rotated tokens, wrong tab), so it has its own checks.

## 1. Build `dist/`

```sh
npm install            # or pnpm install
npm run build          # tsc --noEmit + vite → dist/  (the only static gate)
```

`npm run build` is the gate — a green build is required before loading.
For a distributable zip instead: `npm run package` → `hermes-agent-extension.zip`
(build + zip, excludes source maps). Node ≥ 20.

## 2. Load unpacked in Chrome

Chrome 137+ **silently ignores the `--load-extension` CLI flag** — load via
the UI, not the command line:

1. Open `chrome://extensions/`
2. Toggle **Developer mode** (top-right)
3. **Load unpacked** → pick this repo's **`dist/`** directory
4. Pin the toolbar icon; clicking it opens the side panel

The manifest pins a public `key`, so the extension id is stable everywhere:
`pdfafjabbbgidnmkcdmjpoapmdpemkil`. That fixed `chrome-extension://` origin is
what a hermes gateway whitelists in `cors_origins`.

**After any later `npm run build`**, the loaded copy breaks (hashed chunks are
replaced) until you hit **⟳ Reload** on the extension's card. Always say this
when you've rebuilt.

## 3. Connect to a server

Default target is the local hermes-agent api_server (`http://127.0.0.1:8642`,
model `hermes-agent`) — it just needs a key. In the side panel: **⚙ → Gateway
tab**, run the one-liner it shows, paste the output, **Apply**:

```sh
echo "http://127.0.0.1:8642 hermes-agent $(awk '/^api_server:/{f=1} f&&/token:/{print $2; exit}' ~/.hermes/config.yaml)"
```

First run also needs the extension's origin in the server's CORS allow-list
(the Gateway tab shows this line too):

```sh
hermes config set platforms.api_server.extra.cors_origins "chrome-extension://pdfafjabbbgidnmkcdmjpoapmdpemkil" && hermes gateway restart
```

Cloud providers (OpenRouter, …) instead: ⚙ → Connection tab → pick a provider,
paste an API key. See the `hermes-gateway` skill for the :8700 gateway path.

## 4. Verify

Side-panel status should read **● 온라인 (online)**. If it shows **● 키 오류
(key error)**, the stored key no longer matches the server — click it to jump
to quick connect and re-run step 3. For anything else (offline, requests that
vanish, CORS), use the `diagnose-hermes` skill. To exercise the full path
end-to-end (health + a real streaming chat), use the `verify` skill's Tier-2
Chrome-for-Testing script.

**Not a bug:** "이 페이지는 읽을 수 없어요 / Cannot read browser pages" means the
active tab is a `chrome://` or extension page where scripts are forbidden — try
a normal `https://` page.

## Hive (optional)

Hive (the shared feed) is off until a PocketBase server URL is set at runtime:
🐝 tab or ⚙ → Hive → paste the server address → sign in (or ⚡ quick start, no
email). To run the backend locally, see the `running-hive-stack` skill.
