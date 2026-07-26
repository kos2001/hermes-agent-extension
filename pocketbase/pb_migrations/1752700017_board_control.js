/// <reference path="../pb_data/types.d.ts" />
/**
 * Blackboard opportunistic control (spec:
 * 2026-07-26-hive-blackboard-control-design). Two changes to the agent board:
 *
 * 1. `board_queue` — a ranked view of the open tasks. The board used to be
 *    worked FIFO, which ignored the valuation data the schema already carries
 *    (`impact`, `effort_mm`, `deadline`). Ranking lives here rather than in
 *    TypeScript because three consumers pick tasks — the extension, the web
 *    app, and `scripts/hive-agent.mjs` for coding harnesses — and a formula
 *    copied across them would drift.
 *
 * 2. `lease_until` + a takeover branch in the claim guard. A claim used to be
 *    permanent: if the agent working a task died, the guard's "only the
 *    claimer may update" clause left the task stuck in `claimed` forever.
 *    A lapsed lease now lets another agent take over, atomically, the same way
 *    the original claim is atomic. Expiry is enforced at write time with
 *    `@now`, as `deadline` already is — no cron sweep.
 *
 * The lease is stamped server-side by pb_hooks/board_lease.pb.js so that an
 * agent claiming over raw HTTP gets the same protection as one going through
 * board.ts.
 */

// Ranking constants, gathered so they can be retuned in one place.
// Every factor except aging is bounded, and aging grows without limit, so no
// task can be starved: the widest possible gap between two tasks' fixed
// factors is DENSITY_MAX * URGENCY_MAX = 32, which aging closes in
// 32 * AGING_HOURS = 8 days of waiting.
const DENSITY_MIN = 0.25;
const DENSITY_MAX = 4.0;
const URGENCY_MAX = 8.0;
// Hours of waiting that add 1.0 to the aging multiplier.
const AGING_HOURS = 6.0;
// Deadline horizon: urgency reaches its cap as the remaining time approaches 0.
const URGENCY_HOURS = 24.0;

// value_density = clamp(impact / effort_mm, DENSITY_MIN, DENSITY_MAX); unset -> 1
const DENSITY = `max(${DENSITY_MIN}, min(${DENSITY_MAX},
  CASE WHEN COALESCE(t.impact, 0) > 0 AND COALESCE(t.effort_mm, 0) > 0
       THEN t.impact * 1.0 / t.effort_mm ELSE 1.0 END))`;

// urgency = clamp(1 + URGENCY_HOURS / (hours_left + 1), 1, URGENCY_MAX); no deadline -> 1
const URGENCY = `max(1.0, min(${URGENCY_MAX},
  CASE WHEN COALESCE(t.deadline, '') = '' THEN 1.0
       ELSE 1.0 + ${URGENCY_HOURS} / (max(0.0, (julianday(t.deadline) - julianday('now')) * 24.0) + 1.0) END))`;

// aging = 1 + hours_waiting / AGING_HOURS
const AGING = `(1.0 + max(0.0, (julianday('now') - julianday(t.created_at)) * 24.0) / ${AGING_HOURS})`;

const QUEUE_VIEW = `
  SELECT
    t.id AS id,
    t.requester_id AS requester_id,
    t.title AS title,
    t.body AS body,
    t.category AS category,
    t.kind AS kind,
    t.repo AS repo,
    t.deadline AS deadline,
    t.objective_id AS objective_id,
    t.effort_mm AS effort_mm,
    t.impact AS impact,
    t.created_at AS created_at,
    ROUND(${DENSITY} * ${URGENCY} * ${AGING}, 4) AS queue_score
  FROM agent_tasks t
  WHERE t.status = 'open'
    AND (COALESCE(t.deadline, '') = '' OR julianday(t.deadline) > julianday('now'))`;

const AUTH_ONLY = "@request.auth.id != ''";

// Taking a task for yourself: the body must claim it in your own name, and the
// task must not already be past its deadline.
const TAKE = "@request.body.status = 'claimed' && @request.body.claimed_by = @request.auth.id" +
  " && (deadline = '' || deadline > @now)";

const GUARDED_UPDATE = [
  AUTH_ONLY,
  "&& (",
  // claim an open task
  `(status = 'open' && ${TAKE})`,
  "||",
  // take over a claim whose lease lapsed — or that never carried one, which is
  // how the tasks stranded before this migration are recovered
  `(status = 'claimed' && (lease_until = '' || lease_until < @now) && ${TAKE})`,
  "||",
  // work / renew / complete / release: the current claimer, lease or not
  "(status = 'claimed' && claimed_by = @request.auth.id)",
  ")",
].join(" ");

const PRIOR_UPDATE =
  "@request.auth.id != '' && (" +
  "(status = 'open' && @request.body.status = 'claimed' && @request.body.claimed_by = @request.auth.id && (deadline = '' || deadline > @now))" +
  " || (status = 'claimed' && claimed_by = @request.auth.id)" +
  ")";

migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId("agent_tasks");
    tasks.fields.add(new DateField({ name: "lease_until", required: false }));
    tasks.updateRule = GUARDED_UPDATE;
    app.save(tasks);

    const queue = new Collection({
      name: "board_queue",
      type: "view",
      viewQuery: QUEUE_VIEW,
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
    });
    app.save(queue);
  },
  (app) => {
    const queue = app.findCollectionByNameOrId("board_queue");
    if (queue) app.delete(queue);

    const tasks = app.findCollectionByNameOrId("agent_tasks");
    tasks.fields.removeByName("lease_until");
    tasks.updateRule = PRIOR_UPDATE;
    app.save(tasks);
  },
);
