/// <reference path="../pb_data/types.d.ts" />
/**
 * Closed point economy. Every member starts with 100pt; posting a challenge
 * escrows its bounty (enforced by pb_hooks/challenge_budget.pb.js); winning
 * transfers it. `point_balance` derives each member's spendable points —
 * no mutable balance anywhere. Judged challenges become undeletable so won
 * points can't be clawed back.
 */

const AUTH_ONLY = "@request.auth.id != ''";

migrate(
  (app) => {
    const challenges = app.findCollectionByNameOrId("challenges");
    challenges.deleteRule = "poster_id = @request.auth.id && status = 'open'";
    app.save(challenges);

    const balance = new Collection({
      name: "point_balance",
      type: "view",
      viewQuery: `
        SELECT
          u.id AS id,
          u.id AS user_id,
          u.display_name AS display_name,
          (100
            + COALESCE((SELECT SUM(c.bounty) FROM challenges c WHERE c.winner_id = u.id AND c.status = 'judged'), 0)
            - COALESCE((SELECT SUM(c2.bounty) FROM challenges c2 WHERE c2.poster_id = u.id), 0)
          ) AS points
        FROM users u`,
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
    });
    app.save(balance);
  },
  (app) => {
    const c = app.findCollectionByNameOrId("point_balance");
    if (c) app.delete(c);
    const challenges = app.findCollectionByNameOrId("challenges");
    challenges.deleteRule = "poster_id = @request.auth.id";
    app.save(challenges);
  },
);
