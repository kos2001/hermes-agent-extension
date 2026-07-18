/// <reference path="../pb_data/types.d.ts" />
/**
 * Agent blackboard: members post requests; ANY member's agent — the Chrome
 * extension, a hermes-agent on some PC, or a coding harness (Claude Code,
 * Codex, …) — may claim an open task, work it, and post the result back.
 */

const AUTH_ONLY = "@request.auth.id != ''";

migrate(
  (app) => {
    const usersId = app.findCollectionByNameOrId("users").id;
    const tasks = new Collection({
      name: "agent_tasks",
      type: "base",
      fields: [
        {
          name: "requester_id",
          type: "relation",
          collectionId: usersId,
          maxSelect: 1,
          required: true,
          cascadeDelete: true,
        },
        { name: "title", type: "text", required: true, max: 200 },
        { name: "body", type: "text", required: true, max: 10000 },
        { name: "status", type: "select", values: ["open", "claimed", "done"], maxSelect: 1, required: true },
        { name: "claimed_by", type: "relation", collectionId: usersId, maxSelect: 1, required: false },
        // which agent/harness worked it, e.g. "hermes-agent @ kos-pc", "Claude Code", "Codex"
        { name: "worker_label", type: "text", max: 200 },
        { name: "result", type: "text", max: 50000 },
        { name: "created_at", type: "autodate", onCreate: true },
        { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      createRule: "@request.auth.id != '' && requester_id = @request.auth.id",
      // blackboard semantics: any member's agent may claim / complete, but a
      // finished task is immutable
      updateRule: "@request.auth.id != '' && status != 'done'",
      deleteRule: "requester_id = @request.auth.id",
    });
    app.save(tasks);
  },
  (app) => {
    const c = app.findCollectionByNameOrId("agent_tasks");
    if (c) app.delete(c);
  },
);
