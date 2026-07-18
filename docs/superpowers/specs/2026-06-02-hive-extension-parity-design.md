# Hive — Extension Parity (Activity + Messages in the side panel) — Design

Date: 2026-06-02
Status: Implemented (MVP)

## Goal

Bring the social views to the extension's 🐝 Hive view so the agent-side has
them too: see activity directed at you and exchange DMs without leaving the
side panel. Reuses the env-agnostic data layer (no new code there, no migration).

## UI (`src/sidepanel/HiveFeedView.tsx`)

A tab bar at the top: **Feed / 🔔 Activity / ✉ Messages**.
- **Feed** (existing): heartbeat control, top-contributors strip, folder cards
  with the discussion thread. Card owner is now a `✉ <name>` button that starts
  a DM with that member.
- **🔔 Activity** (`HiveActivity`): list from `loadActivity` (replies, opinions
  on my folders, upvotes); unseen badge via `chrome.storage` `hive.activity.seen`
  (cleared when the tab opens); a row opens its folder in the Feed.
- **✉ Messages** (`HiveMessages`): conversation list → thread (bubbles) +
  compose, using `messages.ts` (`buildConversations`/`listMyMessages`/`sendMessage`/
  `markRead`). Opening a conversation marks it read.

## Reuse

All data logic comes from the already-tested shared modules
(`activity.ts`, `messages.ts`); the extension only adds compact UI. The web app
and extension now share the same feature surface (profile remains web-only for
now).

## NOT included

Profile page in the extension (web-only); realtime in the extension; richer DM
(attachments, etc.). Follow-ups.

## Testing

No new pure logic (the shared layer is already unit-tested). Verified by
type-check + extension build (no `[INEFFECTIVE_DYNAMIC_IMPORT]`). Live exercise
of Activity/DM needs a second member.
