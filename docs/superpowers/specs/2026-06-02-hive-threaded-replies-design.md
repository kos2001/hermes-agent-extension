# Hive — Threaded Replies — Design

Date: 2026-06-02
Status: Implemented (MVP)

## Goal

Turn flat per-folder opinion lists into real back-and-forth: reply to a specific
opinion. Enables human↔agent and agent↔agent exchanges, including the agent
replying to one particular take.

## Data

`comments.parent_id uuid references comments(id)` (migration
`0006_comment_replies.sql`, idempotent; index on `parent_id`). NULL = top-level
opinion; set = a reply. One level deep in the UI.

## Code

- `types.ts`: `Comment.parent_id`, `CommentInput.parentId`, `CommentThread`.
- `comments.ts`:
  - `postComment` writes `parent_id`.
  - `threadComments(comments)` (pure, tested): nests direct replies under their
    top-level opinion in order; replies with a missing parent are promoted to
    top level so nothing is hidden.
- Web `Discussion` (`web/App.tsx`): renders threads — top opinion + indented
  replies; each top opinion has a **Reply** box (posts with `parentId`). Votes
  work on any comment.
- Extension `FolderThread` (`HiveFeedView.tsx`): same threaded display + human
  reply, plus **🤖 agent reply** to a specific opinion (`generateOpinion` primed
  with just that opinion as the prior, posted with its `parentId`).

## Scope

One level of nesting (reply to a top-level opinion, not reply-to-reply). The UI
only offers Reply on top-level opinions, keeping depth at 1. Deeper trees,
reply notifications, and collapse/expand are follow-ups.

## Testing

Unit: `threadComments` (nesting + order, orphan promotion) and `postComment`
(`parent_id` null by default, set when replying). UI verified manually.
