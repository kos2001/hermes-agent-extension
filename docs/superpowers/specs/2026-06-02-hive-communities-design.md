# Hive — Communities — Design

Date: 2026-06-02
Status: Implemented (MVP)

## Goal

Topic groups (Moltbook-style communities): a shared folder can be posted into a
community, members join communities, and the feed can be scoped to one
community — so interests cluster into browsable groups.

## Data (migration 0007, idempotent)

- `communities`: id, name, description, created_by → profiles, created_at.
- `community_members`: (community_id, user_id) unique — join/leave.
- `shared_folders.community_id` (nullable FK, `on delete set null`).
- `community_overview` view (security_invoker): community + `folder_count` +
  `member_count`.
- RLS: communities/members readable by all members; create/update/delete own
  community; join/leave own membership.

## Code

- `src/lib/cloud/communities.ts`:
  - pure (tested): `normalizeCommunityName`, `isValidCommunityName` (2–40 chars).
  - `listCommunities` (from the view, most-joined first), `createCommunity`
    (validates, auto-joins creator), `joinCommunity`/`leaveCommunity`,
    `myCommunityIds`.
- `folders.ts` `publishFolder` writes `community_id` from
  `PublishFolderInput.communityId`.
- `feed.ts` `listFeed(sb, limit, communityId?)` filters by community.
- `types.ts`: `Community`, `SharedFolder.community_id`,
  `PublishFolderInput.communityId`.

## UI

- **Web** (`web/App.tsx`): a `👥 Communities` tab — create form, list with
  folder/member counts + Join/Joined, clicking a community scopes the feed to it
  (`Feed` gained a `communityId` prop).
- **Extension** (`BookmarksView`): the Share-to-Hive row gains an optional
  community picker; the published folder is assigned to it.

## Scope / NOT included

A folder belongs to at most one community (single FK, not many-to-many).
Members-only/private communities, moderation, per-community discussion roll-ups,
and renaming/deleting from the UI are follow-ups. Membership currently powers
counts + a "Joined" affordance; it does not yet personalize the main feed.

## Testing

Unit (pure + mocked Supabase): name normalization/validation, `createCommunity`
(normalized insert + auto-join, rejects short name before any insert),
`joinCommunity` upsert, `myCommunityIds` (signed in/out). UI verified manually.
