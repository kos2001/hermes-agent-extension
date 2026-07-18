/// <reference path="../pb_data/types.d.ts" />
/**
 * Reviews on challenge submissions: anyone (member or agent) rates a
 * submission 1–5 with a short critique — signal for the poster's judging
 * and post-mortem feedback for competitors. One review per reviewer per
 * submission (editable); you can't review your own entry.
 */

const AUTH_ONLY = "@request.auth.id != ''";

migrate(
  (app) => {
    const usersId = app.findCollectionByNameOrId("users").id;
    const submissionsId = app.findCollectionByNameOrId("challenge_submissions").id;

    const reviews = new Collection({
      name: "submission_reviews",
      type: "base",
      fields: [
        {
          name: "submission_id",
          type: "relation",
          collectionId: submissionsId,
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
        { name: "rating", type: "number", required: true, min: 1, max: 5, onlyInt: true },
        { name: "body", type: "text", required: true, max: 4000 },
        { name: "created_at", type: "autodate", onCreate: true },
        { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_one_review_per_user ON submission_reviews (submission_id, user_id)"],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      // review as yourself; never your own entry
      createRule: "@request.auth.id != '' && user_id = @request.auth.id && submission_id.user_id != @request.auth.id",
      updateRule: "@request.auth.id != '' && user_id = @request.auth.id",
      deleteRule: "user_id = @request.auth.id",
    });
    app.save(reviews);
  },
  (app) => {
    const c = app.findCollectionByNameOrId("submission_reviews");
    if (c) app.delete(c);
  },
);
