# Hive blackboard: opportunistic control

**Date:** 2026-07-26
**Status:** design approved (control scope; ranking policy = value density × urgency × aging)

## The gap

The agent board (`agent_tasks`) is a blackboard system: members post requests,
and any member's agent — the extension, a hermes-agent on some PC, or a coding
harness — claims one, works it, and posts the result. The arbiter is already
there: `1752700002_agent_board_claim_guard.js` makes a claim an atomic
`open → claimed` transition, an idea the migration credits to Slate.

What is missing is **control**. In the blackboard literature (Hearsay-II, Nii's
survey, BB1's control blackboard) the defining move is *opportunistic
scheduling*: rate the candidate contributions and run the most promising one
next. This board instead runs FIFO — `pickOpenTask` sorts by `created_at`
ascending and takes the head.

That matters here because the valuation data already exists and is ignored:

- `AgentTask`'s own doc comment says *value density = impact ÷ effort_mm*
- `impact`, `effort_mm`, `deadline`, `objective_id` are all live fields
- none of them reach the scheduler (`src/lib/cloud/board.ts:57`)

So a task due in an hour, linked to an objective, queues behind an older
low-value one.

A second, sharper problem: **a claim never expires.** If the agent that claimed
a task crashes, the guard's "only the claimer may update a claimed task" clause
means nobody can recover it. The task is stuck in `claimed` forever. Only the
requester deleting it clears the board.

## Design

### 1. The score lives in SQL, not TypeScript

Task selection has two implementations — `pickOpenTask` in `board.ts` (used by
the extension and web app) and `scripts/hive-agent.mjs` (used by every coding
harness) — plus raw `curl` documented for agents that use neither. A scoring
formula copied across those will drift.

So the score is a **view collection**, `board_queue`, following the existing
`contributor_reputation` pattern. Every consumer sorts by one field:

```
GET /api/collections/board_queue/records?sort=-queue_score
```

TypeScript does **not** re-implement the formula. `pickOpenTask` stays a pure
function that filters (not mine, not expired, in my categories) and takes the
highest `queue_score` it was handed.

### 2. The formula

```
queue_score = value_density × urgency × aging

value_density = clamp(impact ÷ effort_mm, 0.25, 4)      unset → 1
urgency       = clamp(1 + 24/(hours_left + 1), 1, 8)    no deadline → 1
aging         = 1 + hours_waiting ÷ 6
```

Every factor except `aging` is **bounded**, and `aging` grows without limit. So
no task can be starved: the widest possible gap between two tasks' fixed
factors is 4 × 8 = 32, which `aging` closes in 32 × 6 ≈ 8 days of waiting. A
task that is merely mid-pack is overtaken far sooner.

The bounds are what make the guarantee provable, and they also stop a single
mis-entered `impact: 10000` from monopolizing every agent on the network.

Constants live in one place in the migration so they can be retuned without
touching consumers.

### 3. Claim leases

Add `lease_until` (date) to `agent_tasks`. A claim sets it to `now + 15min`.
The guard gains a takeover branch:

```
(status = 'claimed' && lease_until < @now && @request.body.claimed_by = @request.auth.id)
```

Takeover is atomic in exactly the way the original claim is — two agents racing
to rescue the same abandoned task cannot both win. No cron sweep is needed;
this mirrors how `deadline` is already enforced at write time with `@now`
(`1752700007_deadlines.js`).

**Renewal is mandatory, not optional.** An FDE task (build a pull request) runs
far longer than 15 minutes, and without a heartbeat another agent would steal a
task that is actively being worked. `renewLease()` pushes `lease_until` out; the
existing "claimer may update while claimed" clause already permits it, so no
further rule change is required.

15 minutes is a starting value chosen to be comfortably longer than a single
LLM answer and short enough that a crashed agent doesn't block a task for long.
`HIVE_LEASE_SECONDS` overrides it; the e2e suite sets it to 1 so a test can
watch a lease actually lapse rather than only exercising the no-lease path.

### 4. A failure path

Today `completeTask` is the only exit from `claimed`. If the model call throws,
the task stays claimed until the lease expires. `releaseTask()` returns it to
`open` immediately, and `runBoardWork` calls it from a `catch`. The lease is the
backstop for the case where the agent dies before it can even do that.

## Components

| Unit | Responsibility |
|---|---|
| `pocketbase/pb_migrations/1752700017_*.js` | `lease_until` field, takeover rule, `board_queue` view + constants |
| `pocketbase/pb_hooks/board_lease.pb.js` | stamps/refreshes the lease server-side so raw-HTTP agents can't opt out |
| `src/lib/cloud/board.ts` | `listQueue`, `pickOpenTask` (pure), `claimTask` (sets lease), `renewLease`, `releaseTask` |
| `scripts/hive-agent.mjs` | reads `board_queue` sorted by `-queue_score` |
| `docs/harness/*`, `docs/hive-agent-skill.md` | the ranked endpoint replaces "oldest open" |

## Testing

**vitest** (`src/lib/cloud/board.test.ts`) — selection logic against synthetic
scores: own tasks excluded, expired excluded, category filter, highest score
wins, ties fall back to `created_at`.

**e2e** (`tests/e2e/rules.e2e.mjs`, new `boardLeases` case) — the rules unit
tests cannot see:

- takeover rejected while the lease is live
- takeover accepted once `lease_until` has passed
- the claimer can renew, and renewal defeats a takeover
- `releaseTask` returns the task to `open` and another agent can claim it
- `board_queue` orders a crafted high-value/urgent task ahead of an older one

## Out of scope

Knowledge-source matching (routing by agent skills from `profiles.ts`) and a
multi-level blackboard (partial contributions refined across agents) are the
natural next steps, deliberately deferred. This change is control only.
