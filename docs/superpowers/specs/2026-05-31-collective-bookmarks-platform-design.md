# Collective Bookmarks Platform ("Hive") — Design

Date: 2026-05-31
Status: Proposed (design)

## Vision

Grow the Hermes Agent extension from a personal bookmark organizer into a
collaborative knowledge-sharing platform. Each member shares selected bookmark
folders; an agent summarizes each shared folder; the summaries collect on a
social site where signed-in members browse one another's interests, react, and
discover knowledge. The result is organic interest-sharing and an emergent
collective intelligence.

## Current state (constraint)

The extension is **100% client-side**: it calls OpenAI-compatible LLM APIs
directly from the browser with the user's own API key. There is **no backend,
no accounts, no database**. The bookmark organizer (`src/lib/bookmarks.ts`,
`src/sidepanel/BookmarksView.tsx`) already does AI categorize / dedup /
dead-link / cleanup behind a preview-then-confirm gate. The platform reuses this
client-side LLM pipeline rather than adding a server-side model.

## Decisions (locked)

- **Backend:** Supabase — managed Postgres + Auth + Storage + Row-Level
  Security + Edge Functions. Fastest path to a real multi-user app with minimal
  custom infra.
- **Summarization location:** in the extension. Reuse the existing client-side
  LLM pipeline + the user's API key, then publish the finished summary. No
  server LLM cost.
- **Visibility model (MVP):** public to all signed-in members. Maximizes the
  network effect early; private groups / following deferred.
- **Auth:** Google OAuth (one-click; native to Supabase).

## Decomposition (build order A → B → C → D)

This is several subsystems, not one feature. Each gets its own spec → plan →
build cycle.

| # | Sub-project | Scope |
|---|-------------|-------|
| **A** | **Foundation** | Supabase project, schema + RLS, shared `@/lib/cloud` client, Google auth in the extension, a minimal sign-in panel. |
| **B** | **Share folder** | New action in `BookmarksView`: pick a folder → client-side agent summarizes folder + items → publish to Supabase. |
| **C** | **Hive web app** | New React/Vite site: feed of shared folders, folder detail, profile, reactions. |
| **D** | **Collective intelligence** | Topic clustering, recommendations, trending, following/groups, comments. |

**This document specifies sub-project A only.** B/C/D are named for context and
will be brainstormed separately.

---

## Sub-project A — Foundation

### Architecture

```
┌─────────────────────┐         ┌──────────────────────┐
│ Chrome Extension    │         │  Hive Web App        │
│ (existing)          │         │  (future, sub-proj C)│
│  • BookmarksView    │         │                      │
│  • NEW: sign-in     │         │                      │
└─────────┬───────────┘         └──────────┬───────────┘
          │   @/lib/cloud (shared TS client)│
          └──────────────┬──────────────────┘
                         ▼
                   ┌───────────┐
                   │ Supabase  │  Auth (Google) · Postgres + RLS · Storage
                   └───────────┘
```

Both clients (extension now, web app later) import the same `@/lib/cloud`
module, so the data contract lives in exactly one place.

### Data model (Postgres + RLS)

- **`profiles`** — `id uuid` (FK → `auth.users`, PK), `display_name text`,
  `avatar_url text`, `created_at timestamptz default now()`. Row auto-created on
  first sign-in via a trigger on `auth.users`.
- **`shared_folders`** — `id uuid pk`, `owner_id uuid` (FK → profiles),
  `title text`, `source_folder_name text`, `summary text`, `topics text[]`,
  `item_count int`, `created_at timestamptz`, `updated_at timestamptz`.
  Unique `(owner_id, source_folder_name)` so re-publishing upserts.
- **`shared_items`** — `id uuid pk`, `folder_id uuid` (FK → shared_folders, on
  delete cascade), `title text`, `url text`, `item_summary text`, `position int`.
- **`reactions`** — `id uuid pk`, `folder_id uuid` (FK), `user_id uuid` (FK),
  `kind text` (`like` | `save`), unique `(folder_id, user_id, kind)`.

### Row-Level Security

- `profiles`, `shared_folders`, `shared_items`, `reactions`: `SELECT` allowed
  for any authenticated user (public feed).
- `shared_folders` / `shared_items`: `INSERT/UPDATE/DELETE` only where
  `owner_id = auth.uid()` (items checked via their folder's owner).
- `profiles`: `UPDATE` only own row.
- `reactions`: `INSERT/DELETE` only where `user_id = auth.uid()`.

### Auth (extension)

> Revision (2026-06-01): auth switched from Google OAuth to **email one-time
> codes** to remove the Google Cloud Console setup burden. `signInWithOtp` +
> `verifyOtp` work identically in the extension and web app — no
> `chrome.identity`, no redirect URLs, no `identity` permission. The original
> Google/`launchWebAuthFlow` design below is kept for history.

Chrome MV3 extensions cannot use Supabase's default browser redirect. Flow:

1. `supabase.auth.signInWithOAuth({ provider: 'google', options: {
   skipBrowserRedirect: true, redirectTo: chrome.identity.getRedirectURL() }})`
   → returns an authorize URL.
2. `chrome.identity.launchWebAuthFlow({ url, interactive: true })` → user
   completes Google consent → Chrome captures the redirect to
   `https://<ext-id>.chromiumapp.org/`.
3. Parse `access_token` + `refresh_token` from the redirect fragment →
   `supabase.auth.setSession(...)`.
4. Session persists via a `chrome.storage`-backed Supabase storage adapter, so
   it survives service-worker restarts.

Requires: `identity` permission, Supabase host permission, and the
`https://<ext-id>.chromiumapp.org/` redirect URL registered in the Supabase
project's auth settings. The future web app (C) uses Supabase's standard
redirect flow against the same project.

### Deliverables in this repo

1. `supabase/migrations/0001_init.sql` — schema + RLS + profile trigger above.
2. `supabase/config.toml` (or documented project settings) + `README` note on
   registering the redirect URL and Google OAuth credentials.
3. `src/lib/cloud/client.ts` — Supabase client from env, with the
   `chrome.storage` session adapter.
4. `src/lib/cloud/auth.ts` — `signInWithGoogle()`, `signOut()`,
   `getSession()`, `onAuthChange()` using the `launchWebAuthFlow` flow.
5. `src/lib/cloud/folders.ts` / `feed.ts` — typed data access:
   `publishFolder()`, `listFeed()`, `getFolder()`, `react()` / `unreact()`.
   (`publishFolder` lands in A so B has a stable surface to call.)
6. `src/lib/cloud/types.ts` — DB row types (hand-written or generated).
7. Config: `import.meta.env.VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`,
   plus `.env.example`. Documented in README.
8. Manifest: add `identity` to `permissions`; Supabase URL covered by existing
   broad `host_permissions`.
9. A minimal **"Sign in to Hive"** affordance in the side panel: shows signed-in
   profile (name/avatar) or a Google sign-in button. Auth state only — no
   publish/feed UI yet.
10. Vitest coverage for the `@/lib/cloud` data-access layer with a mocked
    Supabase client (`publishFolder` upsert shape, `listFeed` mapping,
    `react`/`unreact`), following the existing `src/lib/*.test.ts` patterns.

### Explicitly NOT in A (deferred)

- Share-folder summarize flow (B)
- Feed web app (C)
- Topic clustering, recommendations, trending, following, groups, comments (D)

### Error handling

- Network / auth failures surface as localized inline messages, matching the
  i18n pattern already used in `BookmarksView` (`@/lib/i18n`).
- Session-expired → silent refresh via the stored refresh token; on failure,
  prompt re-auth.
- `publishFolder` is idempotent on `(owner_id, source_folder_name)` via upsert,
  so re-sharing a folder updates rather than duplicates.

### Testing strategy

- Unit (vitest, mocked Supabase): data-access mapping + upsert/idempotency.
- Auth flow (`launchWebAuthFlow`) is verified manually against a real Supabase
  project (browser-runtime, like the existing extension UI verification).
- RLS verified with a SQL test: a second user cannot write another user's rows.

## Open questions (resolve during planning)

- DB types: hand-write the small set, or wire `supabase gen types`? (Lean
  hand-write for A — the schema is small.)
- Where the sign-in affordance lives in the side panel top bar vs. options page.
