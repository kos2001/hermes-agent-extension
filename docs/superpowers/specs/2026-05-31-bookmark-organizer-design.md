# Bookmark Organizer — Design

Date: 2026-05-31
Status: Approved (design)

## Goal

Add a Chrome bookmarks tidy-up feature to the Hermes Agent side panel. It lets
the user clean up their bookmarks via four operations, always behind a
preview-then-confirm gate so no bookmark is moved or deleted without explicit
approval.

Operations:

1. **AI auto-categorize** — the LLM reads bookmark titles/URLs and proposes
   moving them into topic folders.
2. **Remove duplicates** — find bookmarks with the same URL and propose removing
   all but the oldest.
3. **Remove dead links** — fetch each bookmark URL and propose removing those
   that 404 / fail to connect.
4. **Sort** — reorder bookmarks within each folder by name or date added.

## Approach (A): single dedicated view, per-operation buttons

A dedicated "Bookmarks" view in the side panel, reached from a bookmark icon
button in the top bar. The view has one button per operation. Running an
operation produces a list of **proposed actions** rendered as a checkbox
preview (all checked by default). The user unchecks anything unwanted and clicks
Apply; only checked actions execute.

Rejected alternatives:

- **Tabbed tools** — extra tab UI is heavy for a narrow side panel (YAGNI).
- **Wizard (run all, one combined report)** — mixes the slow/costly operations
  (dead-link network sweep, LLM categorize) into one long pass with many failure
  points and a complex combined preview model.

Approach A keeps each operation isolated (clean to implement and unit-test) and
lets the user run the slow/costly operations only on demand.

## Architecture & components

### `manifest.config.ts`

Add `"bookmarks"` to `permissions`. (Host permissions for `http/https` are
already granted, which covers dead-link fetches.)

### `src/lib/bookmarks.ts` — pure logic + `chrome.bookmarks` wrappers

- `loadBookmarks(): Promise<BookmarkNode[]>` — `chrome.bookmarks.getTree()`
  flattened to a list, carrying `id, title, url, parentId, parentTitle,
  dateAdded, index`. Folders (no `url`) are tracked for path building but are
  not themselves removable targets.
- `normalizeUrl(url): string` — pure. Lowercase host, strip trailing slash,
  drop fragment, drop a trailing `?`. Used by dedup.
- `findDuplicates(nodes): Action[]` — pure. Group by `normalizeUrl`; keep the
  oldest (`dateAdded`); emit `remove` actions (`reason: "duplicate"`) for the
  rest.
- `planSort(nodes, key: "name" | "date"): Action[]` — pure. Per folder, compute
  the sorted order; emit a `reorder` action only for folders whose order
  actually changes. Stable sort.
- `buildCategorizePrompt(nodes): ChatMessage[]` — pure. Builds the LLM request:
  a system instruction + a JSON list of `{id, title, url}`, asking for a JSON
  object mapping bookmark id → folder path. Caps the number of bookmarks sent
  (see Open decisions) and instructs a bounded folder vocabulary.
- `parseCategorization(text, nodes): Action[]` — pure. Robustly extract the JSON
  object from the model text (handles code fences / surrounding prose), validate
  ids against `nodes`, emit `move` actions for entries whose target folder
  differs from the current one. Invalid/garbage → returns `[]` (caller shows an
  error).
- `checkDeadLinks(nodes, opts): Promise<Action[]>` — network. Fetch each URL
  with concurrency cap (6) and per-URL timeout (8s) via `AbortController`;
  classify network error / status ≥ 400 as dead; emit `remove` actions
  (`reason: "dead"`). `opts`: `{ concurrency, signal, onProgress(done,total) }`.
  Individual failures never abort the run.
- `applyActions(actions): Promise<{ applied: number; failed: number }>` —
  execute approved actions via `chrome.bookmarks.move` / `remove` /
  `create` (folder creation for `move` targets that don't exist yet). Per-action
  try/catch so one failure (e.g. a bookmark already deleted) doesn't stop the
  rest.

### Action model (shared by preview + apply)

Discriminated union with a unique `id` per action (drives the checkbox list):

```ts
type Action =
  | { id: string; kind: "remove";  bmId: string; title: string; url: string; reason: "duplicate" | "dead" }
  | { id: string; kind: "move";    bmId: string; title: string; url: string; toFolderPath: string }
  | { id: string; kind: "reorder"; folderId: string; folderTitle: string; orderedIds: string[]; count: number };
```

### `src/lib/hermes-client.ts`

Add `collectChat(req): Promise<string>` — wraps `streamChat`, accumulates
`onChunk` into a string, resolves on `onDone`, rejects on `onError`. Used by AI
categorize (non-streaming consumption). Reuses the existing
`responseFormat: { type: "json_object" }` support.

### `src/sidepanel/BookmarksView.tsx`

The dedicated view. State: loaded `nodes`, current `actions`, per-action checked
set, running/progress state, result/error message. Renders the four operation
buttons (Sort has a name/date sub-choice), the preview list, and Apply.

### `src/sidepanel/App.tsx`

Add `view: "chat" | "bookmarks"` state. A bookmark icon button (🔖) in the top
bar toggles it. When `bookmarks`, render `<BookmarksView config={config}
lang={lang} />` in place of the messages list + input row. The top bar and the
two control rows stay visible.

## Data flow

1. View mounts → `loadBookmarks()` once → `nodes` in state.
2. Operation button:
   - **Duplicates / Sort** — synchronous; produce actions immediately.
   - **Dead links** — async with a progress bar and a Stop button (concurrency
     6, 8s/URL timeout, abortable).
   - **AI categorize** — requires `config`; `collectChat` (json_object) →
     `parseCategorization` → `move` actions; shows a working state.
3. Actions populate the preview (replacing any previous result). Each row has a
   checkbox, checked by default.
4. **Apply** → if any `remove` actions are checked, a confirm dialog shows the
   removal count → `applyActions(checked)` runs sequentially → summary
   ("N applied, M failed") → reload tree, clear actions.

## Error handling

- **AI categorize**: missing `config` → show "configure in settings" message
  (same pattern as chat). JSON parse failure → error message, zero actions.
- **Dead links**: per-URL timeout/network error/status ≥ 400 → dead; individual
  failures don't abort; run is abortable.
- **Apply**: per-action try/catch; a bookmark deleted externally is skipped and
  counted as failed; summary reported.
- **Destructive guard**: confirm dialog before applying when removals are
  selected.

## Testing

- **node unit tests** (`src/lib/bookmarks.test.ts`): `normalizeUrl`,
  `findDuplicates` (normalization, keep-oldest), `planSort` (name/date, stable,
  only-changed folders), `parseCategorization` (valid JSON, fenced JSON,
  garbage, unknown ids).
- `chrome.bookmarks` wrappers, `checkDeadLinks` network code, and the view
  component are verified manually by loading the unpacked extension — matching
  the existing convention (lib logic is unit-tested; chrome/DOM code is not).

## i18n

Add ko/en/zh strings for: bookmarks button + title, view title, the four
operation labels + tooltips, sort-key labels (name/date), preview header,
apply/confirm, progress, result summary, empty state, and error messages.

## Open decisions (sensible defaults chosen; adjust if desired)

- **AI categorize input cap**: send at most 300 bookmarks per request to bound
  token cost; if more exist, categorize the first 300 and note the rest were
  skipped. (Surfaced in the UI, not silently truncated.)
- **Folder depth**: AI proposes a single level of topic folders (no nested
  hierarchy) to keep the preview and apply logic simple.
- **Dead-link method**: a normal `fetch` (GET) relying on the granted host
  permissions to read real status codes; `opaqueredirect`/network failure
  counts as dead.

## Out of scope (YAGNI)

- Undo after apply (the confirm gate + preview is the safety mechanism).
- Nested folder restructuring beyond one level.
- Syncing/merging across Chrome profiles.
- Scheduled/automatic cleanup.
