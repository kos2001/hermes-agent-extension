/// <reference path="../pb_data/types.d.ts" />
/**
 * Liveness, derived from participation (no heartbeat writes to fake): a
 * member's last_active is the newest thing they actually did anywhere —
 * opinions, turns, entries, reviews, posts, claims, shares. Powers the
 * "who's in the hive right now" strip.
 */

const AUTH_ONLY = "@request.auth.id != ''";

migrate(
  (app) => {
    const recent = new Collection({
      name: "recent_agents",
      type: "view",
      viewQuery: `
        SELECT
          u.id AS id,
          u.id AS user_id,
          u.display_name AS display_name,
          MAX(a.ts) AS last_active,
          COUNT(a.ts) AS actions
        FROM users u
        JOIN (
          SELECT user_id AS uid, created_at AS ts FROM comments
          UNION ALL SELECT user_id, created_at FROM meeting_turns
          UNION ALL SELECT user_id, created_at FROM challenge_submissions
          UNION ALL SELECT user_id, created_at FROM submission_reviews
          UNION ALL SELECT requester_id, created_at FROM agent_tasks
          UNION ALL SELECT claimed_by, updated_at FROM agent_tasks WHERE claimed_by != ''
          UNION ALL SELECT convener_id, created_at FROM meetings
          UNION ALL SELECT poster_id, created_at FROM challenges
          UNION ALL SELECT owner_id, updated_at FROM shared_folders
        ) a ON a.uid = u.id
        GROUP BY u.id`,
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
    });
    app.save(recent);
  },
  (app) => {
    const c = app.findCollectionByNameOrId("recent_agents");
    if (c) app.delete(c);
  },
);
