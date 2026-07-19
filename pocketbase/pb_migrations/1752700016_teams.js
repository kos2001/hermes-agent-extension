/// <reference path="../pb_data/types.d.ts" />
/**
 * Teams (spec: 2026-07-19-hive-teams-design): assemble a curated roster of
 * members + agents around a stated problem and work it to an outcome. A team
 * owner creates the team and staffs the roster; anyone signed in reads teams
 * and joins the discussion. Distinct from communities (open topic groups) and
 * meetings (one-off agent discussions).
 */

const AUTH_ONLY = "@request.auth.id != ''";

migrate(
  (app) => {
    const usersId = app.findCollectionByNameOrId("users").id;
    const rel = (name, extra = {}) => ({
      name,
      type: "relation",
      collectionId: usersId,
      maxSelect: 1,
      required: true,
      cascadeDelete: true,
      ...extra,
    });

    const teams = new Collection({
      name: "teams",
      type: "base",
      fields: [
        rel("owner_id"),
        { name: "name", type: "text", required: true, max: 140 },
        { name: "topic", type: "text", max: 140 },
        { name: "problem", type: "text", required: true, max: 10000 },
        { name: "status", type: "select", values: ["open", "solved"], maxSelect: 1, required: true },
        { name: "outcome", type: "text", max: 50000 },
        { name: "created_at", type: "autodate", onCreate: true },
        { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      createRule: `${AUTH_ONLY} && owner_id = @request.auth.id`,
      updateRule: "owner_id = @request.auth.id",
      deleteRule: "owner_id = @request.auth.id",
    });
    app.save(teams);
    const teamsId = app.findCollectionByNameOrId("teams").id;

    const teamRel = { name: "team_id", type: "relation", collectionId: teamsId, maxSelect: 1, required: true, cascadeDelete: true };

    const members = new Collection({
      name: "team_members",
      type: "base",
      fields: [
        teamRel,
        rel("user_id"),
        { name: "role_note", type: "text", max: 200 },
        { name: "created_at", type: "autodate", onCreate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_team_members_unique ON team_members (team_id, user_id)"],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      // the team owner staffs the roster
      createRule: `${AUTH_ONLY} && team_id.owner_id = @request.auth.id`,
      // owner removes anyone; a member may remove themselves (leave)
      deleteRule: "team_id.owner_id = @request.auth.id || user_id = @request.auth.id",
    });
    app.save(members);

    const messages = new Collection({
      name: "team_messages",
      type: "base",
      fields: [
        teamRel,
        rel("user_id"),
        { name: "author_kind", type: "select", values: ["human", "agent"], maxSelect: 1 },
        { name: "author_label", type: "text", max: 200 },
        { name: "body", type: "text", required: true, max: 5000 },
        { name: "created_at", type: "autodate", onCreate: true },
      ],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      createRule: `${AUTH_ONLY} && user_id = @request.auth.id`,
    });
    app.save(messages);
  },
  (app) => {
    for (const name of ["team_messages", "team_members", "teams"]) {
      const c = app.findCollectionByNameOrId(name);
      if (c) app.delete(c);
    }
  },
);
