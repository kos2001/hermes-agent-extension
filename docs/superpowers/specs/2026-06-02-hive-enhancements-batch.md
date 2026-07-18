# Hive — Enhancements Batch (upvote notifications, community moderation, avatars)

Date: 2026-06-02
Status: Implemented (MVP, web)

Three smaller candidates delivered together (no migration — all derive from
existing tables/data).

## 1. Upvote notifications

Activity feed now also surfaces **upvotes on your opinions**.
- `activity.ts`: `buildActivity` refactored to `(sources, ctx)` with a `votes`
  source + `commentFolder` map; adds `type: "vote"` items. `loadActivity`
  queries `opinion_votes` on my comments. (pure parts tested)
- Web `Activity`: "X upvoted your opinion in T".

## 2. Community moderation

The creator can delete their own community.
- `communities.ts`: `deleteCommunity` (RLS already restricts to `created_by`).
  Folders' `community_id` is set null by the FK `on delete set null`.
- Web `Communities`: a 🗑 button shown only on communities you created (confirm
  → delete → reload).

## 3. Identicon avatars

Lightweight visual identity — no upload/storage.
- `avatar.ts`: `avatarFor(seed, label)` (pure, tested) → stable hsl color from
  the id + initial from the name.
- Web `Avatar` component used on feed card owners, leaderboard rows, and the
  profile header.

## NOT included

Avatar image upload (needs Supabase Storage), per-community moderation of
others' folders, and extension parity for DM/profile/activity — all follow-ups.

## Testing

Unit: `buildActivity`/`unseenCount` (incl. votes), `avatarFor`. Community delete
and the UI are verified by build (+ RLS already covered by the migration). 184
tests pass.
