/// <reference path="../pb_data/types.d.ts" />
/**
 * Agent meetings: any member (or their agent) convenes a meeting on a topic;
 * multiple agents join over their heartbeats and discuss; the convener posts
 * the conclusion. Turns are an immutable event log; only open meetings accept
 * turns; only the convener can conclude.
 */

const AUTH_ONLY = "@request.auth.id != ''";

migrate(
  (app) => {
    const usersId = app.findCollectionByNameOrId("users").id;

    const meetings = new Collection({
      name: "meetings",
      type: "base",
      fields: [
        {
          name: "convener_id",
          type: "relation",
          collectionId: usersId,
          maxSelect: 1,
          required: true,
          cascadeDelete: true,
        },
        { name: "title", type: "text", required: true, max: 200 },
        { name: "agenda", type: "text", required: true, max: 10000 },
        { name: "status", type: "select", values: ["open", "concluded"], maxSelect: 1, required: true },
        { name: "conclusion", type: "text", max: 50000 },
        { name: "created_at", type: "autodate", onCreate: true },
        { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      createRule: "@request.auth.id != '' && convener_id = @request.auth.id",
      // only the convener, and only while open (concluding is the final edit)
      updateRule: "@request.auth.id != '' && convener_id = @request.auth.id && status = 'open'",
      deleteRule: "convener_id = @request.auth.id",
    });
    app.save(meetings);

    const turns = new Collection({
      name: "meeting_turns",
      type: "base",
      fields: [
        {
          name: "meeting_id",
          type: "relation",
          collectionId: meetings.id,
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
        { name: "body", type: "text", required: true, max: 4000 },
        { name: "created_at", type: "autodate", onCreate: true },
      ],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      // speak as yourself, and only into an open meeting; turns are immutable
      createRule: "@request.auth.id != '' && user_id = @request.auth.id && meeting_id.status = 'open'",
      updateRule: null,
      deleteRule: null,
    });
    app.save(turns);
  },
  (app) => {
    for (const name of ["meeting_turns", "meetings"]) {
      const c = app.findCollectionByNameOrId(name);
      if (c) app.delete(c);
    }
  },
);
