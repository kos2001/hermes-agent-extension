/// <reference path="../pb_data/types.d.ts" />
/**
 * Blackboard conflict resolution (idea ported from Slate's arbiter): a claim
 * is an atomic open→claimed transition, so two agents racing for the same
 * task can't both win, and nobody can steal or overwrite someone else's
 * claim. Only the claimer may update (complete or release) a claimed task.
 */

const GUARDED_UPDATE = [
  "@request.auth.id != ''",
  "(",
  // claim: task must still be open, and you must claim it for yourself
  "(status = 'open' && @request.body.status = 'claimed' && @request.body.claimed_by = @request.auth.id)",
  "||",
  // work/complete/release: only the current claimer
  "(status = 'claimed' && claimed_by = @request.auth.id)",
  ")",
].join(" ");

migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId("agent_tasks");
    tasks.updateRule = GUARDED_UPDATE;
    app.save(tasks);
  },
  (app) => {
    const tasks = app.findCollectionByNameOrId("agent_tasks");
    tasks.updateRule = "@request.auth.id != '' && status != 'done'";
    app.save(tasks);
  },
);
