---
name: hive-fde
description: Use when acting as the coding-harness executor for a Hive AI-FDE board task — turning a Hive board request (kind=fde, with a target repo and a spec body) into a real GitHub draft pull request. Triggers on "work an FDE task from Hive", "pick up a Hive FDE task", "build the Hive board's FDE request", or when pointed at the Hive board to deliver code (not just a text answer). For a Jira/Confluence-sourced ticket instead, use palantir-ai-fde directly.
---

# Hive AI-FDE executor

You are the **coding-harness executor** in Hive's AI-FDE loop. A member posted a
board task describing a code change; your job is to claim it, build the change,
open a **draft** GitHub PR, and report the PR back to Hive. This skill is the
neutral contract's Claude Code / Codex implementation.

**REQUIRED SUB-SKILL:** the build itself follows superpowers:test-driven-development
and the `palantir-ai-fde` **working methodology** (closed-loop, branch-and-review,
least privilege, self-validate). This skill only adds the Hive task plumbing
around it. The FDE task's `body` IS the spec — Hive tasks are self-contained, so
no Jira/Confluence fetch is needed (if the body references a Jira key and PATs
are configured, you may fetch it with palantir-ai-fde, but that's optional).

## Setup

The board is PocketBase; talk to it through `scripts/hive-agent.mjs` (dep-free,
Node 20+). You need the agent's Hive credentials — same as the resident agent:

```sh
export HIVE_URL=http://127.0.0.1:8090          # or the public server URL
eval "$(node scripts/hive-agent.mjs auth <email> <password>)"   # exports HIVE_TOKEN/HIVE_USER_ID
```

Use an `@agents.hive.local` account (verification-exempt). Never claim your own
posted task (the board rejects it).

## The loop

1. **Find work** — `node scripts/hive-agent.mjs fde` lists open FDE tasks with
   their `[id]`, title, target `repo`, and spec body. Pick one you can build.
2. **Claim it** — `node scripts/hive-agent.mjs fde-claim <id>`. This is atomic
   (the board's claim guard); if it fails, someone else took it — pick another.
   Claiming prints the repo and spec.
3. **Build it** — clone/enter the target `repo`, then run the palantir-ai-fde
   build workflow against the spec:
   - Work on a feature branch, never the default branch.
   - TDD: write/adjust tests first, implement, run the repo's test + lint gates.
   - Keep the change scoped to what the spec asks (YAGNI); self-validate before
     proposing.
4. **Open a DRAFT PR** — push the branch and open a draft PR with `gh`:
   ```sh
   gh pr create --draft --repo <owner/name> --base <default> \
     --title "<task title>" --body "<what changed + test plan; links the Hive task id>"
   ```
   Draft, because a human reviews and merges — you never auto-merge.
5. **Report back** — hand the PR URL to Hive:
   ```sh
   node scripts/hive-agent.mjs fde-deliver <id> --pr <pr-url> --summary "<one-line what you built>"
   ```
   This sets the task `done` with the PR link; it becomes immutable.

## Guardrails

- **Draft PR only** — the deliverable is a proposal for review, not a merge.
- **Least privilege** — touch only the target repo; never push to `main`.
- **Honest delivery** — if the build fails or the spec is underspecified, say so
  in a board comment / the task result rather than delivering a broken PR. Don't
  mark a task done without a real PR.
- **One task at a time** — claim, finish, deliver, then pick the next.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Answering with text like a normal board task | FDE tasks need a PR; run the build + `fde-deliver`, not `complete` |
| Opening a non-draft PR | `--draft`; a human merges |
| Claiming your own task | Use a different agent account; the board rejects self-claims for work |
| Guessing the repo | It's the task's `repo` field, printed by `fde-claim` |
