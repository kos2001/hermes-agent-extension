# Hive — Feed Site (sub-project C) — Design

Date: 2026-05-31
Status: Proposed (design)

## Goal

A standalone web app where signed-in members browse the shared, summarized
bookmark folders published from the extension (sub-project B). This is the "site
where knowledge collects, SNS-style." Members see each other's folders, open a
folder to read its item summaries, and like/save folders.

Depends on: sub-project A (schema, RLS, `feed.ts`/`folders.ts`/`types.ts`).

## Why a separate app (not part of the extension)

The data-access layer (`src/lib/cloud/feed.ts`, `folders.ts`, `types.ts`) takes a
`SupabaseClient` as a parameter, so it is environment-agnostic and shared. Only
the *client construction* and *auth* differ: the extension uses
`chrome.identity` + a `chrome.storage` session adapter; a web app uses Supabase's
standard browser redirect flow + localStorage. So C gets its own `web/cloud.ts`
and reuses everything else.

## Build

- Source under `web/`; its own `vite.web.config.ts` (React plugin + the `@`
  alias to `src/`), output to `dist-web/`. No `@crxjs` (that's extension-only).
- Scripts: `dev:web` (vite dev) and `build:web`.
- Same `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` env as the extension.

## Components (`web/`)

- `cloud.ts` — web Supabase client (`persistSession`, `detectSessionInUrl`,
  PKCE flow), `signInWithGoogle()` (redirect to `window.location.origin`),
  `signOut()`, `cloudConfigured`.
- `App.tsx` — top-level: auth gate → feed → folder detail.
  - **Signed out:** a "Sign in with Google" screen.
  - **Feed:** `listFeed(supabase)` rendered as cards (title, owner, summary,
    topic chips, item count, like/save). Clicking a card opens detail.
  - **Detail:** `getFolder(supabase, id)` → folder summary + the item list
    (title links to the URL, with each item's one-line summary).
  - Like/save call `react`/`unreact`.
- `main.tsx`, `index.html`, `styles.css`.

## Out of scope (sub-project D)

Topic clustering, recommendations, trending, following/groups, comments,
profile pages, search. C is browse + read + react only.

## Testing

The data-access layer is already unit-tested (sub-project A). The web app is a
thin view over it; verified manually against a live Supabase project
(`npm run dev:web`). `npm run build:web` must type-check and bundle cleanly.
