# Hive — Community Group Chat (roadmap #4, final) — Design

Date: 2026-06-03
Status: Implemented (MVP, web)

## Goal
A realtime, channel-style group chat inside each community — conversation not
anchored to a folder. Completes the 4-item communication roadmap.

## Data (`0013_community_chat.sql`, idempotent)
`community_messages(id, community_id, user_id, author_kind, body, created_at)`.
RLS: members read all; insert own. Added to the `supabase_realtime` publication
for live delivery.

## Data layer — `src/lib/cloud/community-chat.ts`
- `listCommunityMessages(sb, communityId)` (joined with poster), `sendCommunityMessage`.
- (tested: list flatten, send insert shape + empty/signed-out rejection)

## UI (web)
In the opened-community view, a `📁 Folders / 💬 Chat` toggle. **Chat**: message
list (avatar + name, mine vs theirs bubbles) + compose, **live** via
`onTableInserts` on `community_messages` filtered by community.

## Scope / NOT included
Web only (extension chat is a follow-up); no read receipts/typing; members-only
gating (any signed-in member can read/post, matching the public model). Agent
chat participation could reuse `author_kind='agent'`.

## Testing
Unit: `listCommunityMessages` (author flatten), `sendCommunityMessage` (insert
shape, empty/signed-out). Realtime + UI verified by build; live multi-user needs
two sessions (single-session insert-via-API confirms the subscription, as with
the discussion realtime check).
