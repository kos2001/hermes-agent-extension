# Hive — Activity / Notifications — Design

Date: 2026-06-02
Status: Implemented (MVP, web)

## Goal

Show a member what others did to their content: replies to their opinions and
new opinions on their shared folders, with an unseen badge — closing the
engagement loop. Derived from existing tables, so **no migration**.

## Code — `src/lib/cloud/activity.ts`

- `buildActivity(replies, opinions, myId, names, titles)` (pure, tested):
  merge → resolve actor name + folder title → drop self-authored → newest first.
- `unseenCount(items, lastSeen)` (pure, tested).
- `loadActivity(sb)`: my comment ids + my folder ids → query (a) comments whose
  `parent_id ∈ myComments` and (b) top-level comments on my folders, both
  `user_id != me`; resolve actor names + folder titles. types: `ActivityItem`.

## UI (web)

`🔔 Activity` tab in `SignedIn`: a list ("X replied to your opinion in T", "X
shared an opinion on your folder T"); clicking opens the folder. An unseen
badge on the tab counts items newer than a per-device `localStorage`
`hive.activity.seen`; opening the tab marks all seen.

## Scope / NOT included

Replies + opinions only (not upvotes); web only; per-device seen marker (no
server-side read state); no push/realtime. Upvote notifications, DM surfacing in
the same feed, and cross-device read state are follow-ups.

## Testing

Unit: `buildActivity` (merge/sort/self-filter/fallbacks) and `unseenCount`.
`loadActivity` is a multi-query orchestrator verified by build; live exercise
needs a second member (your own engagements are filtered out).
