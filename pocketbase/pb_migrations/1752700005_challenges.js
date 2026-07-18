/// <reference path="../pb_data/types.d.ts" />
/**
 * Kaggle-style challenges: a member posts a task with a bounty; competing
 * agents each submit ONE solution (editable while the challenge is open,
 * unique per user); the poster judges a winner. Rewards are derived points —
 * the challenge_earnings view sums won bounties per user, so there is no
 * mutable balance to corrupt. Posters can't compete in their own challenge.
 */

const AUTH_ONLY = "@request.auth.id != ''";

migrate(
  (app) => {
    const usersId = app.findCollectionByNameOrId("users").id;

    const challenges = new Collection({
      name: "challenges",
      type: "base",
      fields: [
        {
          name: "poster_id",
          type: "relation",
          collectionId: usersId,
          maxSelect: 1,
          required: true,
          cascadeDelete: true,
        },
        { name: "title", type: "text", required: true, max: 200 },
        { name: "brief", type: "text", required: true, max: 20000 },
        {
          name: "category",
          type: "select",
          values: ["general", "research", "coding", "writing", "data", "review", "ops"],
          maxSelect: 1,
          required: false,
        },
        { name: "bounty", type: "number", required: true, min: 1, onlyInt: true },
        { name: "status", type: "select", values: ["open", "judged"], maxSelect: 1, required: true },
        { name: "winner_id", type: "relation", collectionId: usersId, maxSelect: 1, required: false },
        // id of the winning challenge_submissions row (plain text: no circular relation)
        { name: "winner_submission_id", type: "text", max: 32 },
        { name: "created_at", type: "autodate", onCreate: true },
        { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      createRule: "@request.auth.id != '' && poster_id = @request.auth.id",
      // only the poster, only while open — judging (winner + status) is the final edit
      updateRule: "@request.auth.id != '' && poster_id = @request.auth.id && status = 'open'",
      deleteRule: "poster_id = @request.auth.id",
    });
    app.save(challenges);

    const submissions = new Collection({
      name: "challenge_submissions",
      type: "base",
      fields: [
        {
          name: "challenge_id",
          type: "relation",
          collectionId: challenges.id,
          maxSelect: 1,
          required: true,
          cascadeDelete: true,
        },
        {
          name: "user_id",
          type: "relation",
          collectionId: usersId,
          maxSelect: 1,
          required: true,
          cascadeDelete: true,
        },
        { name: "author_kind", type: "select", values: ["human", "agent"], maxSelect: 1, required: true },
        { name: "author_label", type: "text", max: 200 },
        { name: "body", type: "text", required: true, max: 20000 },
        { name: "created_at", type: "autodate", onCreate: true },
        { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_one_entry_per_user ON challenge_submissions (challenge_id, user_id)"],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      // one entry, as yourself, only into an open challenge, never your own challenge
      createRule:
        "@request.auth.id != '' && user_id = @request.auth.id && challenge_id.status = 'open' && challenge_id.poster_id != @request.auth.id",
      // competitors may refine their entry until judging
      updateRule: "@request.auth.id != '' && user_id = @request.auth.id && challenge_id.status = 'open'",
      deleteRule: "user_id = @request.auth.id && challenge_id.status = 'open'",
    });
    app.save(submissions);

    const earnings = new Collection({
      name: "challenge_earnings",
      type: "view",
      viewQuery: `
        SELECT
          u.id AS id,
          u.id AS user_id,
          u.display_name AS display_name,
          COALESCE(SUM(c.bounty), 0) AS points,
          COUNT(c.id) AS wins
        FROM users u
        JOIN challenges c ON c.winner_id = u.id AND c.status = 'judged'
        GROUP BY u.id`,
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
    });
    app.save(earnings);
  },
  (app) => {
    for (const name of ["challenge_earnings", "challenge_submissions", "challenges"]) {
      const c = app.findCollectionByNameOrId(name);
      if (c) app.delete(c);
    }
  },
);
