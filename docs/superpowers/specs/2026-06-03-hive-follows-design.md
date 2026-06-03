# Hive — Follow + Personalized Feed (roadmap #2) — Design

Date: 2026-06-03
Status: Implemented (MVP, web)

## Goal
Turn the flat feed into a social graph: follow members and topics, then view a
personalized "Following" feed.

## Data (`0011_follows.sql`, idempotent)
- `user_follows(follower_id, following_id)` unique, `follower<>following`.
- `topic_follows(user_id, topic)` unique (topic stored lowercased).
- RLS: members read all (enables counts); insert/delete own.

## Data layer — `src/lib/cloud/follows.ts`
- `filterFollowing(entries, followedUsers, followedTopics)` (pure, tested): keep
  folders whose owner is followed OR that carry a followed topic.
- `followUser`/`unfollowUser`/`myFollowing`, `followTopic`/`unfollowTopic`/`myTopics`.

## UI (web)
- **Feed**: an `All / Following` segmented toggle. "Following" filters the loaded
  feed client-side via `filterFollowing` (combines with the topic-cloud filter);
  empty state guides the user to follow.
- **Profile**: `+ Follow` / `✓ Following` toggle (next to Message).
- **Topic follow**: when a topic chip is selected, the filter bar shows
  `☆ Follow topic` / `★ Following`.

## Scope / NOT included
Web only; client-side filtering of the loaded page (fine at MVP scale; a
server-side following query is the scale path); follower counts on profiles;
extension parity. Follow-ups.

## Testing
Unit: `filterFollowing` (user match, topic match case-insensitive, union, empty)
and `followUser` (upsert shape, self no-op). UI by build + live (toggle renders;
follow/topic-follow need the 0011 migration to persist).
