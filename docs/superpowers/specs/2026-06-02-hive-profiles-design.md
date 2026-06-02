# Hive — Member Profiles + Reputation — Design

Date: 2026-06-02
Status: Implemented (MVP, web)

## Goal

Give members an identity page: click any name to see their reputation (upvotes
earned, opinions, folders shared) and the folders they've shared, with a way to
message them. Surfaces the social graph already implicit in the data.

## Code (no migration — reuses existing tables/views)

- `feed.ts`: `listOwnerFolders(sb, ownerId)` — a member's shared folders
  (shared `toFeedEntry` mapper extracted).
- `leaderboard.ts`: `getContributor(sb, userId)` — one row from the
  `contributor_reputation` view (votes_received / opinions / folders_shared).

## UI (web)

- `Profile` component: header (name + back), reputation stats, `✉ Message`
  (hidden for your own profile), and the member's shared folders (click → detail).
- Reachable by clicking a name: feed card owner, leaderboard rows. (Opinion
  authors → profile is a possible follow-up.)
- `SignedIn` holds a `profile` route; feed/leaderboard call `onOpenProfile`.
  The feed card owner used to open a DM directly; now it opens the profile, and
  DM is initiated from the profile's Message button (cleaner).

## Scope / NOT included

Web only. No avatars, no editable bio, no follow graph, no activity timeline,
no inline reputation badges next to every name (the profile + leaderboard carry
the numbers). Reputation is read from the existing view.

## Testing

Thin query wrappers (`listOwnerFolders`, `getContributor`) follow the untested-
wrapper pattern of `getFolder`; verified by type-check + build + live click-through.
No new pure logic, so the unit count is unchanged.
