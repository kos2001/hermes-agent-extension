---
name: self-improve
description: Use at the end of a work session, after a batch of PRs merges, or on a recurring /loop — when mistakes were fixed, steps were repeated by hand, or debugging took multiple rounds, and none of it has been folded back into the repo's knowledge artifacts yet.
---

# Self-improvement loop

One pass = harvest what this session paid for, store each lesson where the
next session will actually find it, ship, report. The session transcript is
primary evidence; git only shows what survived.

## 1. Collect evidence

- `git log --oneline origin/main -15` and `gh pr list --state merged --limit 10 --json title,number`
- From the session itself: which commands FAILED before succeeding? which
  sequence was typed manually 2+ times? which diagnosis took >2 rounds?
  which bug escaped to main (look for `fix(...)`/revert commits)?
- Read the CURRENT `CLAUDE.md`, `.claude/skills/*/SKILL.md` names, and the
  project memory index before writing — most "new" lessons are updates.

## 2. Route each lesson to its ONE destination

| Lesson shape | Destination |
|---|---|
| "always/never X before Y" repo rule | `CLAUDE.md` (one line, in Conventions) |
| Reusable technique that needs tools/steps | `.claude/skills/<name>/` — new or edited via superpowers:writing-skills (failing test first, no exceptions) |
| Machine/environment fact (versions, paths, quirks) | project memory (`~/.claude/projects/<slug>/memory/`), update `MEMORY.md` index |
| Product defect or missing feature | fix PR now, or `gh issue create` if out of scope |
| Already recorded, one-off, or derivable from code/git | drop it |

Tiebreakers: a lesson that only bites inside an existing skill's workflow is
an edit to THAT skill; `CLAUDE.md` is for rules that apply to any session.
If evidence contradicts or duplicates an existing artifact, reconcile that
artifact (update or prune) instead of adding a second copy.

## 3. Apply and verify

- Smallest durable edit per lesson; skill edits follow RED→GREEN (fresh
  subagent must produce the right plan from the file alone). Proportionate:
  a one-line reference addition needs one retrieval spot-check; full
  pressure testing is for discipline rules.
- Run repo gates (`npm run build && npm test`) if any product file changed.

## 4. Ship

Commit → push → PR → wait CI → merge, per repo convention. Before committing
any MERGE commit: `grep -rn "^<<<<<<< \|^>>>>>>> " src web docs *.ts *.md`
(markers inside block comments pass tsc; one reached main that way).

## 5. Report (this closes the loop)

- Lessons harvested → artifact touched, one line each
- Lessons dropped and why (silent dropping hides misrouting)
- One candidate to watch for next session

## Recurrence

- Session-end: invoke `/self-improve` once before wrapping up.
- Continuous: `/loop /self-improve` (self-paced) — the loop should END a
  pass by reporting "nothing new to harvest" when a pass finds nothing;
  two consecutive empty passes means stop the loop.

## Guard rails

- No harvest without evidence: every lesson must cite the concrete failure
  or repetition it came from.
- One destination per lesson — the same text in CLAUDE.md AND a skill will
  drift apart.
- Don't turn this into a diary: narrative session summaries belong nowhere;
  only reusable, forward-looking artifacts.
