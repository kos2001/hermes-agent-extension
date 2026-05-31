# Market-Trends Report Skill — Design

Date: 2026-05-31
Status: Approved-by-directive (user goal: build it)

## Goal

A side-panel feature that, for a user-chosen bookmark folder, summarizes each
site's content individually and then writes a comprehensive market-trends
report. It can run on demand and on a recurring schedule (cron-like) via
`chrome.alarms`, even when the panel is closed, and notifies on completion.

## Chosen defaults (no further approval pending)

- **Schedule mechanism:** `chrome.alarms` + a manual "Run now" button.
- **Schedule granularity:** off / daily / weekly, at a chosen hour-of-day.
- **Content fetch:** `fetch` + HTML→text first; if the text is too thin, fall
  back to opening a background tab and extracting via `chrome.scripting`.
- **Output:** a dedicated side-panel view (latest + history), a chat message on
  manual run, and a `chrome.notifications` toast on scheduled completion.
- **Site cap:** 20 sites per report (service-worker lifetime + token cost). Any
  overflow is surfaced in the UI, never silently dropped.
- **New permissions:** `alarms`, `notifications`.

## Architecture

### `src/lib/market-report.ts` — logic + orchestration

Types:
- `SiteSummary { url; title; summary; error? }`
- `MarketReport { id; folderId; folderTitle; createdAt; sites: SiteSummary[]; synthesis; skipped }`
- `ScheduleFreq = "off" | "daily" | "weekly"`
- `MarketSettings { folderId; freq; hour }`
- `FolderInfo { id; title }`

Pure (unit-tested):
- `listFolders(nodes)` — folders that directly contain ≥1 bookmark, titled, sorted.
- `bookmarksInFolder(nodes, folderId)` — direct url-bearing children.
- `htmlToText(html)` — strip script/style/comments/tags, decode common entities,
  collapse whitespace (DOM-less, service-worker safe).
- `alarmSpec(freq)` — `{ periodInMinutes }` or `null` when off.
- `nextFireTime(now, hour)` — next timestamp at the local hour, strictly after `now`.

Constants: `MAX_SITES = 20`, `MIN_TEXT = 200`.

Network / chrome / LLM (manual verification):
- `fetchSiteText(url, signal)` — fetch (15s timeout) → `htmlToText`; "" on failure.
- `extractViaTab(url)` — create inactive tab, wait for load (15s cap), extract
  `document.body.innerText`, remove tab; "" on failure.
- `summarizeSite(config, title, text, signal)` — `collectChat`; 2–4 bullet summary.
- `synthesizeReport(config, folderTitle, sites, signal)` — `collectChat`; full
  Markdown report (exec summary, cross-source trends, signals/risks, outlook).
- `runMarketReport({nodes, folderId, folderTitle, config, signal, onProgress})` —
  iterate first `MAX_SITES` bookmarks: fetch→(tab fallback if thin)→summarize,
  recording `error` per site without aborting the run; then synthesize. Returns
  a `MarketReport` (with `skipped` count).

Storage / scheduling (manual verification):
- `loadReports()/saveReport()` — `hermes.market.reports`, keep latest 10.
- `loadMarketSettings()/saveMarketSettings()` — `hermes.market.settings`
  (default `{folderId:"", freq:"off", hour:9}`).
- `MARKET_ALARM` name; `scheduleMarketAlarm(settings)` — clear, then create with
  `when: nextFireTime(...)` + `periodInMinutes: alarmSpec(freq)` when on and a
  folder is set.

### `src/background/index.ts` — alarm runner

`chrome.alarms.onAlarm` → if `MARKET_ALARM`: load settings/config/bookmarks,
resolve folder title, `runMarketReport`, `saveReport`, `chrome.notifications`
toast. No-op when freq is off or no folder.

### `src/sidepanel/MarketReportView.tsx` — dedicated view

Folder `<select>` (from `listFolders`), schedule controls (freq select + hour
select) that persist + call `scheduleMarketAlarm`, a "Run now" button with
progress (`done/total` + current site label) and a Stop button, the latest
report rendered as Markdown, and a collapsible history list. On a manual run it
also calls an `onReport(markdown)` prop so `App` can append the report to chat.

### `src/sidepanel/App.tsx` — third view

`view: "chat" | "bookmarks" | "market"`. A 📈 top-bar toggle button. Renders
`<MarketReportView config lang onReport={appendAssistantMessage} />` when
`view === "market"`. `onReport` appends an assistant message to the chat
transcript.

### `manifest.config.ts`

Add `"alarms"`, `"notifications"` to `permissions`.

### i18n

ko/en/zh strings for the view: button/title, folder label, schedule labels
(off/daily/weekly + hour), run/stop, progress, latest/history headers, empty
state, errors, notification text, per-site error tag, skipped note.

## Data flow

1. User picks a folder + schedule in the view → persisted; `scheduleMarketAlarm`.
2. "Run now" (or alarm) → `runMarketReport` with progress → `saveReport` → render;
   manual run also appends to chat; scheduled run fires a notification.
3. View shows latest report + history (read from storage).

## Error handling

- Per-site failures recorded in `SiteSummary.error`; the run continues.
- Missing `config` → guidance message; run disabled until a folder is chosen.
- Background run is bounded (`MAX_SITES`, non-streaming `collectChat`) to fit the
  service-worker lifetime; large folders are truncated with a surfaced `skipped`
  count. This limitation is explicit.

## Testing

- node unit tests (`market-report.test.ts`): `htmlToText`, `listFolders`,
  `bookmarksInFolder`, `alarmSpec`, `nextFireTime`.
- fetch / tab / alarms / notifications / view: manual verification (repo
  convention — chrome/network/React code is not unit-tested).

## Out of scope (YAGNI)

- Offscreen-document DOM parsing (regex `htmlToText` is the fetch-path extractor).
- Multiple folders scheduled simultaneously.
- Emailing / exporting reports outside the extension.
- Sub-daily schedules (daily/weekly only for now).
