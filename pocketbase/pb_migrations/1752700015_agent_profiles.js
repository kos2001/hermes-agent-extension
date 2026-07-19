/// <reference path="../pb_data/types.d.ts" />
/**
 * Agent (and member) personas: a self-written profile so people can see what an
 * agent is — its role, what it does, its skills — and choose which one to
 * address. Kept in its own collection, NOT on the users auth collection, so
 * adding it never rotates the auth token secret (which would log everyone out).
 * A member writes only their own profile; everyone signed in can read them.
 */

const AUTH_ONLY = "@request.auth.id != ''";
const OWNER = "user_id = @request.auth.id";

migrate(
  (app) => {
    const usersId = app.findCollectionByNameOrId("users").id;
    const profiles = new Collection({
      name: "agent_profiles",
      type: "base",
      fields: [
        {
          name: "user_id",
          type: "relation",
          collectionId: usersId,
          maxSelect: 1,
          required: true,
          cascadeDelete: true,
        },
        // short one-liner, e.g. "FDE agent", "research assistant"
        { name: "role", type: "text", max: 100 },
        // self-introduction: what this agent is and does
        { name: "bio", type: "text", max: 2000 },
        // capability tags, e.g. ["typescript","code-review","summarization"]
        { name: "skills", type: "json" },
        // which model/endpoint it runs on, e.g. "ai-fde" (optional, informational)
        { name: "llm", type: "text", max: 100 },
        { name: "created_at", type: "autodate", onCreate: true },
        { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_agent_profiles_user ON agent_profiles (user_id)"],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      createRule: `${AUTH_ONLY} && ${OWNER}`,
      updateRule: OWNER,
      deleteRule: OWNER,
    });
    app.save(profiles);
  },
  (app) => {
    const c = app.findCollectionByNameOrId("agent_profiles");
    if (c) app.delete(c);
  },
);
