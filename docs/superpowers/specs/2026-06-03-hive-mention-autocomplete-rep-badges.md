# Hive — Mention Autocomplete + Inline Reputation Badges — Design

Date: 2026-06-03
Status: Implemented (MVP, web). No migration.

## Mention autocomplete
Typing `@` in the opinion compose box shows a dropdown of thread participants;
selecting inserts `@Name`.
- `mentions.ts` (pure, tested): `activeMention(text, caret)` (the partial token
  before the caret), `applyMention(text, caret, name)` (replace it with `@name `),
  `matchCandidates(query, candidates)` (prefix/substring, capped).
- Web `Discussion`: a caret-aware menu above the compose box; `onMouseDown`
  insertion preserves focus + caret.

## Inline reputation badges
Opinion author lines show `▲N` (upvotes received) so reputation is visible in
context.
- `leaderboard.ts`: `getReputations(sb, ids)` — batch votes-received by user.
- Web `Discussion`: loads reputations for comment authors; renders the badge.

## Scope / NOT included
Autocomplete in the reply box and extension; reputation badges on feed cards /
DM. Easy follow-ups (reuse the same helpers).

## Testing
Unit: `activeMention`, `applyMention`, `matchCandidates`. `getReputations` is a
thin batch query (verified by build). 210 tests pass.
