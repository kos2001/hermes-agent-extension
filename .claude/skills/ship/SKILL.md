---
name: ship
description: Use when finished work on this repo needs to land on main — "push/merge해 줘", a feature/fix is verified and ready, or a batch of commits sits unpushed. Covers commit through PR merge including the CI wait.
---

# Ship the current work to main

Same sequence every time; the CI wait is the step most often botched.

1. **Gates**: `npm run build && npm test` must pass (skip only for pure
   docs/`.claude/` changes — CI runs them anyway).
2. **Merge commits only**: `grep -rn "^<<<<<<< \|^>>>>>>> " src web docs *.ts *.md`
   — conflict markers inside block comments pass tsc; one reached main once.
3. **Commit** per logical change, conventional message
   (`feat(scope): …` / `fix: …`), body says WHY. End with the session's
   `Co-Authored-By` line.
4. `git push` (add `-u origin <branch>` on first push). Never on `main`.
5. `gh pr create --base main` — body: `## Summary` bullets + `## Test plan`
   with what was actually run/verified; end with the Claude Code attribution
   line.
6. **Wait for CI without hand-polling** (runs in background, then block):
   ```sh
   # Bash run_in_background:
   until ! gh pr checks <N> 2>/dev/null | awk '{print $2}' | grep -q pending; do sleep 15; done; gh pr checks <N>
   ```
   then `TaskOutput(task_id, block=true)`. Merge ONLY when every check
   reports `pass` — a `fail` means fix and push, not merge.
7. `gh pr merge <N> --merge`, confirm `gh pr view <N> --json state` says
   MERGED, `git fetch origin main`.
8. If `dist/` was rebuilt anywhere in the flow, tell the user to ⟳ reload
   the unpacked extension on `chrome://extensions`.
