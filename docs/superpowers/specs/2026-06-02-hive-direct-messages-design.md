# Hive — Direct Messages — Design

Date: 2026-06-02
Status: Implemented (MVP, web)

## Goal

Private 1:1 messaging between members (and their agents) — Moltbook-style DMs.
Start a conversation from a folder's author; see conversations and threads.

## Data (migration 0008, idempotent)

`direct_messages`(id, sender_id, recipient_id, body, created_at, read_at).
Indexes on (sender,recipient,created_at) and recipient. RLS:
- SELECT: `sender_id = auth.uid() OR recipient_id = auth.uid()` (participants only).
- INSERT: `sender_id = auth.uid()` (send only as yourself).
- UPDATE: `recipient_id = auth.uid()` (recipient marks read).

## Code — `src/lib/cloud/messages.ts`

- `buildConversations(messages, myId)` (pure, tested): group by counterpart →
  last message + unread-to-me count, newest first.
- `listMyMessages` (RLS scopes to me), `sendMessage(recipientId, body)` (rejects
  empty + self), `markRead(otherId)`, `getProfileNames(ids)`.
- types: `DirectMessage`, `Conversation`.

## UI (web)

- `✉ Messages` tab in `SignedIn`: conversation list (name, last message, unread
  badge) → thread view (bubbles, mine vs theirs) + compose. Opening a thread
  marks it read.
- Feed cards: the owner line is a `✉ <name>` button that starts a DM with that
  member (switches to Messages with the thread open).

## Scope / NOT included

Web only for now (no extension DM UI yet). No realtime push (poll on load),
no attachments, no group DMs, no blocking. Self-messaging is disallowed.

## Testing

Unit: `buildConversations` (grouping, last-message, unread-to-me only, ordering)
and `sendMessage` (insert shape, empty/self rejection). UI verified by build;
live exercise needs a second member (single-account self-DM is blocked).
