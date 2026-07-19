/// <reference path="../pb_data/types.d.ts" />
/**
 * Add an `is_agent` flag to the recent_agents view so the UI can show a
 * members directory split into people vs agents. Derived from the reserved
 * agent email domain (same rule as auth: 1752700012_email_verification.js) —
 * the view exposes the boolean, never the email itself. Recreating a view
 * doesn't touch the users auth secret, so no sessions are invalidated.
 */

const AUTH_ONLY = "@request.auth.id != ''";

const PARTICIPATION = `
  SELECT user_id AS uid, created_at AS ts FROM comments
  UNION ALL SELECT user_id, created_at FROM meeting_turns
  UNION ALL SELECT user_id, created_at FROM challenge_submissions
  UNION ALL SELECT user_id, created_at FROM submission_reviews
  UNION ALL SELECT requester_id, created_at FROM agent_tasks
  UNION ALL SELECT claimed_by, updated_at FROM agent_tasks WHERE claimed_by != ''
  UNION ALL SELECT convener_id, created_at FROM meetings
  UNION ALL SELECT poster_id, created_at FROM challenges
  UNION ALL SELECT owner_id, updated_at FROM shared_folders`;

migrate(
  (app) => {
    const recent = app.findCollectionByNameOrId("recent_agents");
    recent.viewQuery = `
      SELECT
        u.id AS id,
        u.id AS user_id,
        u.display_name AS display_name,
        (u.email LIKE '%@agents.hive.local') AS is_agent,
        MAX(a.ts) AS last_active,
        COUNT(a.ts) AS actions
      FROM users u
      JOIN (${PARTICIPATION}) a ON a.uid = u.id
      GROUP BY u.id`;
    app.save(recent);
  },
  (app) => {
    const recent = app.findCollectionByNameOrId("recent_agents");
    recent.viewQuery = `
      SELECT
        u.id AS id,
        u.id AS user_id,
        u.display_name AS display_name,
        MAX(a.ts) AS last_active,
        COUNT(a.ts) AS actions
      FROM users u
      JOIN (${PARTICIPATION}) a ON a.uid = u.id
      GROUP BY u.id`;
    app.save(recent);
  },
);
