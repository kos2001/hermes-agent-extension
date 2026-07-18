# Hive — "Communication Channel" Roadmap + Sub-project 1 (Mentions + Notifications)

Date: 2026-06-03
Status: Roadmap proposed; sub-project 1 designed (awaiting approval)

## Goal

Deepen Hive from a knowledge feed into a true communication channel. From a
brainstorm, four directions were chosen; they are independent subsystems, so
they are sequenced as sub-projects (each: spec → TDD build → live verify → PR).

## Roadmap

1. **@mentions + notifications** — foundational; the mention/notification infra
   is reused by chat, Q&A, and follows. Builds on `comments` + the activity feed.
2. **Follow people/topics + personalized feed** — social graph; `listFeed`
   gains a "following" scope.
3. **Ask-an-Agent Q&A / agent debate** — the differentiator; reuses `comments`
   + `agent-opinion` (a question kind + agent answers).
4. **Community group chat (realtime)** — largest; a messages-in-community table
   + realtime chat UI.

---

## Sub-project 1 — @mentions + notifications

### Goal
Let a member mention another member (or their agent) in an opinion/reply, which
notifies the mentioned member via the existing 🔔 Activity feed.

### Data (`0010_mentions.sql`, idempotent)
`mentions(id, comment_id → comments on delete cascade, mentioned_user →
profiles, by_user → profiles, created_at)`. RLS: members read all; insert only
where `by_user = auth.uid()`; delete own. Index on `mentioned_user`.

### Data layer — `src/lib/cloud/mentions.ts`
- `extractMentionTokens(body)` (pure, tested): find `@token` spans in text.
- `resolveMentions(tokens, candidates)` (pure, tested): map tokens to known
  members (by display name, case-insensitive) → mentioned user ids.
- `postMentions(sb, commentId, userIds)`: insert mention rows for the author.
- `mentionsForMe(sb)`: rows where `mentioned_user = me` (joined with the comment
  for context) — feeds the activity loader.

### Compose UX
The opinion/reply box detects `@` and shows a small autocomplete of candidate
members (drawn from the folder's thread participants + feed owners + leaderboard,
already loaded client-side). Selecting inserts `@Name`. On submit, the chosen
user ids are written to `mentions` alongside the comment.

### Rendering
`@Name` in opinion/reply bodies is highlighted (accent color). A lightweight
linkifier splits text on known mentions.

### Notifications
`activity.ts` `loadActivity` also pulls `mentionsForMe` → `type: "mention"`
items ("X mentioned you in T"). They flow into the existing 🔔 Activity tab and
unseen badge (web + extension). Email/push deferred.

### NOT in sub-project 1
Email/push delivery, mentions in DMs, @everyone, agent auto-reply to mentions.

### Testing
Unit: `extractMentionTokens`, `resolveMentions`, activity merge of mention
items. UI verified by build + live (post an opinion mentioning a member).
