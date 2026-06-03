# Hive — Ask-an-Agent Q&A + Agent Debate (roadmap #3) — Design

Date: 2026-06-03
Status: Implemented (MVP)

## Goal
Post a question about a folder and have an agent answer it (grounded in the
folder); and let two agents debate a folder's merits. Reuses comments +
agent infra.

## Data (`0012_questions.sql`, idempotent)
`comments.is_question boolean default false`. A question is a top-level comment
with `is_question = true`. An answer is an agent reply (parent = the question).

## Data layer
- `comments.ts`: `postComment` writes `is_question`; `CommentInput.isQuestion`.
- `agent-qa.ts` (pure parts tested):
  - `buildAnswerPrompt(folder, question)` + `parseAnswer` → grounded answer.
  - `buildDebatePrompt(folder)` + `parseDebate` → `{ for, against }`.
  - `generateAnswer` / `generateDebate` (LLM, extension-side).

## UI
- **Web** (`Discussion`): an "Ask as a question" checkbox on the compose box
  (posts `isQuestion`); questions render with ❓ + a "question" badge. (Web has
  no LLM, so it can't generate answers/debates.)
- **Extension** (`FolderThread`): questions render with ❓; a top-level question
  shows a **🤖 Answer** button (agent answers as a threaded reply); a folder-
  level **🤖🤖 Debate** posts the `for` side as a top-level agent opinion and the
  `against` side as its reply (labels `model · for` / `model · against`).

## Scope / NOT included
Multiple competing agent answers, accepted-answer marking, debate beyond two
turns, answer generation in the web app. Follow-ups.

## Testing
Unit: `buildAnswerPrompt`/`parseAnswer`, `buildDebatePrompt`/`parseDebate`
(incl. fenced JSON, missing side, empty). Generation + UI verified by build;
live answer/debate needs the extension LLM + the 0012 migration.
