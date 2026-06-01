# Hive — Share a Folder (sub-project B) — Design

Date: 2026-05-31
Status: Proposed (design)

## Goal

Let a signed-in member publish one of their bookmark folders to Hive. The
extension **reads each page's actual content** and shares **insight** — not a
mere link/title description. It fetches every bookmark's page text client-side,
asks the LLM to read it and produce a genuine takeaway per item plus a
folder-level synthesis, then publishes the summary, topics, and per-item
insights via the sub-project A data layer (`publishFolder`).

> Revision (2026-06-01): the first cut summarized from title+URL only (the model
> guessed from metadata). Per the "share insight from reading the page, not just
> a link" goal, B now fetches and reads each page's content before summarizing.

Depends on: sub-project A (Supabase, auth, `publishFolder`).

## Flow

1. In the Bookmarks view, a **"Share to Hive"** button (shown only when Hive is
   configured) opens a folder picker built from `listFolderChoices`.
2. The user picks a folder. The extension collects that folder's bookmarks
   (`nodes` whose `parentId === folderId` and which have a `url`).
3. The LLM is asked for a JSON summary: a short folder-level `summary`, a list of
   `topics` (tags), and a one-line `summary` per item URL.
4. The result maps to `PublishFolderInput` (`title` = folder path, `sourceFolderName`
   = folder path, `summary`, `topics`, `items`) and is sent to `publishFolder`.
5. A success/error line is shown (localized), matching the existing Bookmarks UI.

Re-sharing the same folder updates it (idempotent upsert from A).

## New module: `src/lib/cloud/summarize-folder.ts`

Two pure, unit-tested functions plus one orchestrator:

- `buildFolderSummaryPrompt(folderPath, items)` → `{ messages, sent }`. Caps the
  item count (e.g. 60) to bound token use; `sent` reports how many were included.
  Requests JSON only: `{ "summary": "...", "topics": ["..."], "items":
  [{ "url": "...", "summary": "..." }] }`.
- `parseFolderSummary(text, items)` → `{ summary, topics, items }` shaped as the
  body of `PublishFolderInput` (caller adds `title`/`sourceFolderName`). Tolerant
  of code fences / surrounding prose (same approach as `parseCategorization`).
  Falls back to item title when the model omits an item's summary; dedups/limits
  topics.
- `summarizeFolder(config, folderPath, items, model?)` → calls `collectChat` then
  `parseFolderSummary`. Thin; verified via the two pure functions.

## UI changes: `src/sidepanel/BookmarksView.tsx`

- A "Share to Hive" button (hidden when `!cloudConfigured`).
- A lightweight folder-select state (reuse `listFolderChoices`).
- Busy state extends the existing `Busy` union with `"share"`.
- On click: ensure a session (`getSession`); if none, prompt sign-in message.
  Else summarize → `publishFolder(supabase, input)` → success message.

## i18n

Add: `bm.shareToHive`, `bm.shareTitle`, `bm.sharePick`, `bm.sharing`,
`bm.shareDone`, `bm.shareNeedSignIn`, `bm.shareFailed`.

## NOT in B

The feed/browse UI (sub-project C) and topic clustering/recommendations (D).
B only produces published content; reading it back happens in C.

## Testing

Unit (vitest): `buildFolderSummaryPrompt` (item cap, JSON-only instruction,
folder path included) and `parseFolderSummary` (fenced JSON, missing item
summary fallback, topic dedup/limit, malformed input → throws). The publish call
and UI are verified manually against a live Supabase project.
