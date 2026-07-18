---
name: diagnose-hermes
description: Use when the extension can't reach Hermes — chat/translate/selection toolbar fails, status shows offline, 401/CORS errors, "동작 안 함" reports, or requests seem to vanish. Also for hermes-agent (8642) / hermes-gateway (8700) connectivity triage on this machine.
---

# Diagnose extension ↔ Hermes connectivity

Work outside-in; each layer you prove healthy moves the fault toward the
client. curl succeeding while the extension fails is NORMAL — keep going.

## 0. Two questions first (they halve the search space)

1. **Which surface failed?** Side-panel chat fetches directly from the panel;
   the selection toolbar routes through the service-worker port — different
   failure paths.
2. **What Base URL is in Settings (⚙)?** `chrome.storage` isn't readable from
   the shell; `127.0.0.1:8642` = api_server directly, `:8700` = AIFde gateway
   (model `ai-fde`, client key from `GATEWAY_CLIENT_KEYS` in
   `~/gitspace/AIFde/.env`). Probe/reproduce against THAT server.

## 1. Servers up?

```sh
curl -s -m 2 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8642/health   # hermes api_server
curl -s -m 2 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8700/health   # AIFde gateway
lsof -nP -iTCP -sTCP:LISTEN | grep -E ':86[0-9]{2}|:8700'
```

## 2. Reproduce the extension's exact request

```sh
TOK=$(awk '/^api_server:/{f=1} f&&/token:/{print $2; exit}' ~/.hermes/config.yaml)
[ -n "$TOK" ] || echo "empty token — config.yaml layout changed; inspect the api_server block"
curl -s -m 60 -X POST http://127.0.0.1:8642/v1/chat/completions \
  -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" \
  -H "Origin: chrome-extension://pdfafjabbbgidnmkcdmjpoapmdpemkil" \
  -d '{"model":"hermes-agent","messages":[{"role":"user","content":"ping"}],"stream":false}'
```

Gateway variant (Settings points at 8700): same curl against
`http://127.0.0.1:8700/v1/chat/completions` with `"model":"ai-fde"` and
`TOK=$(grep GATEWAY_CLIENT_KEYS ~/gitspace/AIFde/.env | cut -d= -f2 | cut -d, -f1)`
(never print it).

401 here → **key precedence**: env `API_SERVER_KEY` / profile `.env` silently
override the `config.yaml` token the quick-connect reads. Test ONE candidate
at a time — never loop keys against a live service. Streaming-only failures
exist too: if `stream:false` works, retry the curl with `"stream":true` and
confirm SSE chunks actually flow (a buffering proxy passes step 2 but stalls
the UI).

## 3. CORS preflight (browser-only failures)

```sh
curl -s -X OPTIONS http://127.0.0.1:8642/v1/chat/completions \
  -H "Origin: chrome-extension://pdfafjabbbgidnmkcdmjpoapmdpemkil" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization, content-type" -D - -o /dev/null | grep -i access-control
```

No `Access-Control-Allow-Origin` → apply the one-line CORS setup and restart:

```sh
hermes config set platforms.api_server.extra.cors_origins "chrome-extension://pdfafjabbbgidnmkcdmjpoapmdpemkil" && hermes gateway restart
```

## 4. Read the logs — the decisive discriminator

- hermes api_server: `~/.hermes/logs/gateway.log` (rejections log as
  `API server rejected invalid API key` with the Chrome UA)
- AIFde gateway: check `lsof -p <pid>` for its log fd (e.g. `/tmp/hermes-gateway-*.log`)

| Log shows | Meaning |
|---|---|
| Chrome-UA requests + 401 | wrong key in extension config → re-run quick-connect |
| OPTIONS then nothing | CORS preflight failing → step 3 |
| **No Chrome requests at all** | request never left the browser → step 5 |
| Requests arrive with 200 but the UI stalls | SSE/streaming path — retry step 2 with `"stream":true` |

## 5. Client side (requests never arrive)

Most common on this repo: **stale loaded extension** — every `npm run build`
replaces hashed chunks, breaking the loaded copy until ⟳ Reload on
`chrome://extensions` (check the card for a red "오류" button and that its
load path is `…/slsi-chrome/dist`). Then verify Settings: Base URL /
key / model actually point at the server you probed. Health probes
(`GET /v1/models` every 15s while the panel is open) appearing in the log
confirm the fix instantly.

**Not a connectivity bug:** "Cannot read browser/extension pages" — active tab
is `chrome://…`/`chrome-extension://…`, where script injection is forbidden.
Test page-reading features on a normal https:// tab.
