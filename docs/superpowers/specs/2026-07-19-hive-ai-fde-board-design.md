# Hive AI-FDE board — Design

**Date**: 2026-07-19
**Status**: approved (user confirmed scope + all forks)

## Problem

Hive's board (`agent_tasks`) lets a member post a request that any member's
agent — the extension, a hermes-agent, or a coding harness (Claude Code, Codex)
— claims, works, and answers with **text**. We want Hive to also coordinate
**AI FDE work**: a request that describes a code change becomes an actual
GitHub pull request built by an agent, with the result tracked back in Hive.

The `AIFde` folder (hermes-gateway + the `palantir-ai-fde` methodology) already
defines *how* an AI FDE builds — fetch requirements, ground them, build
incrementally, open a draft PR for review. This design gives that work a home
**in Hive**, self-contained, without depending on Jira/Confluence.

## Decisions (confirmed with user)

1. **Shape**: the Hive board *is* the FDE work queue. FDE tasks are created in
   Hive; the resident/coding agent delivers a GitHub draft PR; Hive tracks
   status + PR link + deliverable. No Jira dependency.
2. **Requirements source**: **task body + target repo** (self-contained). The
   body is the spec; a `repo` field (`owner/name`) says where to build. No
   Jira/Confluence fetch in v1.
3. **Executor**: a **neutral contract** (claim → build → report PR) any executor
   can drive over HTTP; the **Claude Code / Codex coding harness** running
   `palantir-ai-fde` is the first executor. Chat-only agents can't produce a PR,
   so they don't execute FDE tasks.

## Architecture

```
Member posts an FDE task on the Hive board
  (kind=fde, repo=owner/name, body=spec)
        │  agent_tasks: status=open
        ▼
Coding harness (Claude Code / Codex) runs the hive-fde skill
        │  ① auth to Hive   ② fde-claim  (status=claimed, claim guard)
        │  ③ palantir-ai-fde build workflow against `repo` using `body`
        │  ④ open a DRAFT GitHub PR (gh)
        ▼
  fde-deliver <id> --pr <url> --summary <text>
        │  agent_tasks: status=done, pr_url set, result=summary
        ▼
Hive board UI shows the FDE task: repo · status · PR link
```

The board's existing guarantees carry over unchanged: atomic claim guard (no
double-claim / claim-stealing), done-immutability, deadlines, notifications,
categories, and man-month work valuation.

## Data model — extend `agent_tasks` (no new collection)

Reuses the board's rules and lifecycle; existing tasks and flows are untouched
because every new field is optional with a back-compatible default.

- `kind`: select `["question","fde"]`, **default `question`**. Marks FDE tasks
  for the UI and tells a harness to run the build workflow.
- `repo`: text, GitHub `owner/name`. Required app-side when `kind=fde`
  (not a hard DB rule — keeps the migration and existing writes simple).
- `pr_url`: url, set by the executor on delivery.

Status stays `open → claimed → done`: `claimed` = build in progress, `done`
with `pr_url` = delivered. No separate `building` state (YAGNI). Access rules
unchanged — the claim guard hook and `status != 'done'` update rule already
give exactly the semantics FDE needs, and `done` tasks (with the PR) are
immutable.

## Components

1. **Migration** `1752700014_agent_tasks_fde.js`: add `kind`, `repo`, `pr_url`
   to `agent_tasks`. Down: remove them. Recreating a base collection's fields
   doesn't touch the users auth secret, so no sessions are invalidated.
2. **Data layer** `src/lib/cloud/board.ts`:
   - Extend `AgentTask` with `kind`, `repo`, `pr_url`.
   - `postFdeTask(pb, {repo, title, body, ...})` — creates `kind=fde` task.
   - `deliverFde(pb, taskId, {pr_url, summary})` — sets `pr_url`, `result`,
     `status=done`.
   - `isFdeTask(t)` / filter helper for the UI.
   - `normalizeRepo(raw)` — pure `owner/name` validation (used by post + tests).
3. **Executor contract** `scripts/hive-agent.mjs`:
   - `fde` — list open FDE tasks (title, repo, id).
   - `fde-claim <id>` — claim (reuses the claim guard).
   - `fde-deliver <id> --pr <url> --summary <text>` — report the PR.
4. **Skill** `.claude/skills/hive-fde/SKILL.md`: the neutral-contract executor
   for a coding harness — auth → `fde` → `fde-claim` → run `palantir-ai-fde`
   build workflow against `repo` with `body` as the spec → open a **draft** PR
   → `fde-deliver`. Carries palantir-ai-fde discipline (least privilege,
   draft-PR-for-review, self-validate). References `palantir-ai-fde` rather than
   duplicating it.
5. **Web UI** `web/App.tsx`: on the board page, a "🛠 FDE" filter/section
   showing FDE tasks with repo, status, and a PR link when delivered. Reuses the
   existing board rendering; minimal.

## Testing

- **Unit** (`board.test.ts`): `normalizeRepo` (valid/invalid), `postFdeTask`
  payload, `deliverFde` payload, `isFdeTask` filter. Pure/mock — no network.
- **E2E** (`tests/e2e/rules.e2e.mjs`): post an FDE task → another member's
  agent claims → deliver with `pr_url` → status `done` + `pr_url` set; guard:
  a non-claimant can't deliver, a claimed task can't be re-claimed.
- Full vitest + type-check + both builds + server-rule e2e green.

## Non-goals (v1)

- Jira/Confluence triggers or fetch (the AIFde Jira-triggered service stays in
  that repo; revisit as a second executor later).
- hermes-agent `/v1/runs` executor (the neutral contract leaves room for it).
- A separate `fde_runs` ledger collection (the task row *is* the record; add a
  ledger only when an operator dashboard or dead-letter view is actually needed
  — mirrors the AIFde spec's own G8 deferral).
- Auto-merge — draft PR only; a human reviews and merges.

## Acceptance

- A member posts an FDE task (repo + spec) on the board; it shows in the FDE
  section as `open`.
- A coding harness following the hive-fde skill claims it, opens a draft PR
  against the repo, and reports it back; the task shows `done` with a working
  PR link.
- Existing (`kind=question`) board tasks and the resident chat agent's beat loop
  are unaffected.
- All test suites and builds pass.
