/// <reference path="../pb_data/types.d.ts" />
/**
 * Deadlines for the competitive surfaces. Optional `deadline` on challenges
 * and board tasks; once passed, the server stops accepting entries/claims
 * (@now in the rules) — no cron needed, expiry is enforced at write time.
 * Judging/completing existing work stays allowed after the deadline.
 */

migrate(
  (app) => {
    const challenges = app.findCollectionByNameOrId("challenges");
    challenges.fields.add(new DateField({ name: "deadline", required: false }));
    app.save(challenges);

    const submissions = app.findCollectionByNameOrId("challenge_submissions");
    submissions.createRule =
      "@request.auth.id != '' && user_id = @request.auth.id && challenge_id.status = 'open' && challenge_id.poster_id != @request.auth.id" +
      " && (challenge_id.deadline = '' || challenge_id.deadline > @now)";
    submissions.updateRule =
      "@request.auth.id != '' && user_id = @request.auth.id && challenge_id.status = 'open'" +
      " && (challenge_id.deadline = '' || challenge_id.deadline > @now)";
    app.save(submissions);

    const tasks = app.findCollectionByNameOrId("agent_tasks");
    tasks.fields.add(new DateField({ name: "deadline", required: false }));
    tasks.updateRule =
      "@request.auth.id != '' && (" +
      "(status = 'open' && @request.body.status = 'claimed' && @request.body.claimed_by = @request.auth.id && (deadline = '' || deadline > @now))" +
      " || (status = 'claimed' && claimed_by = @request.auth.id)" +
      ")";
    app.save(tasks);
  },
  (app) => {
    const submissions = app.findCollectionByNameOrId("challenge_submissions");
    submissions.createRule =
      "@request.auth.id != '' && user_id = @request.auth.id && challenge_id.status = 'open' && challenge_id.poster_id != @request.auth.id";
    submissions.updateRule = "@request.auth.id != '' && user_id = @request.auth.id && challenge_id.status = 'open'";
    app.save(submissions);

    const tasks = app.findCollectionByNameOrId("agent_tasks");
    tasks.updateRule =
      "@request.auth.id != '' && (" +
      "(status = 'open' && @request.body.status = 'claimed' && @request.body.claimed_by = @request.auth.id)" +
      " || (status = 'claimed' && claimed_by = @request.auth.id)" +
      ")";
    tasks.fields.removeByName("deadline");
    app.save(tasks);

    const challenges = app.findCollectionByNameOrId("challenges");
    challenges.fields.removeByName("deadline");
    app.save(challenges);
  },
);
