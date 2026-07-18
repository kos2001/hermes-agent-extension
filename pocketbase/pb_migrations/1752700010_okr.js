/// <reference path="../pb_data/types.d.ts" />
/**
 * OKR layer: long-term objectives with measurable key results, and value
 * fields on the work surfaces so every task can carry an effort estimate
 * (man-months) and an impact score. The value formula (impact ÷ effort_mm,
 * "impact per MM") is derived client-side — nothing stored to game.
 */

const AUTH_ONLY = "@request.auth.id != ''";

migrate(
  (app) => {
    const usersId = app.findCollectionByNameOrId("users").id;

    const objectives = new Collection({
      name: "objectives",
      type: "base",
      fields: [
        {
          name: "owner_id",
          type: "relation",
          collectionId: usersId,
          maxSelect: 1,
          required: true,
          cascadeDelete: true,
        },
        { name: "title", type: "text", required: true, max: 200 },
        { name: "description", type: "text", max: 10000 },
        // free-form horizon, e.g. "2026 H2", "Q3", "연간"
        { name: "period", type: "text", max: 40 },
        { name: "status", type: "select", values: ["active", "done", "dropped"], maxSelect: 1, required: true },
        { name: "created_at", type: "autodate", onCreate: true },
        { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      createRule: "@request.auth.id != '' && owner_id = @request.auth.id",
      updateRule: "@request.auth.id != '' && owner_id = @request.auth.id",
      deleteRule: "owner_id = @request.auth.id",
    });
    app.save(objectives);

    const krs = new Collection({
      name: "key_results",
      type: "base",
      fields: [
        {
          name: "objective_id",
          type: "relation",
          collectionId: objectives.id,
          maxSelect: 1,
          required: true,
          cascadeDelete: true,
        },
        { name: "title", type: "text", required: true, max: 200 },
        { name: "unit", type: "text", max: 40 },
        { name: "target", type: "number", required: true, min: 0.000001 },
        { name: "current", type: "number", min: 0 },
        { name: "created_at", type: "autodate", onCreate: true },
        { name: "updated_at", type: "autodate", onCreate: true, onUpdate: true },
      ],
      listRule: AUTH_ONLY,
      viewRule: AUTH_ONLY,
      createRule: "@request.auth.id != '' && objective_id.owner_id = @request.auth.id",
      updateRule: "@request.auth.id != '' && objective_id.owner_id = @request.auth.id",
      deleteRule: "objective_id.owner_id = @request.auth.id",
    });
    app.save(krs);

    // value fields on the work surfaces (all optional)
    for (const name of ["agent_tasks", "challenges"]) {
      const col = app.findCollectionByNameOrId(name);
      col.fields.add(
        new RelationField({
          name: "objective_id",
          collectionId: objectives.id,
          maxSelect: 1,
          required: false,
        }),
      );
      col.fields.add(new NumberField({ name: "effort_mm", required: false, min: 0 }));
      col.fields.add(new NumberField({ name: "impact", required: false, min: 0, max: 10, onlyInt: true }));
      app.save(col);
    }
  },
  (app) => {
    for (const name of ["agent_tasks", "challenges"]) {
      const col = app.findCollectionByNameOrId(name);
      for (const f of ["objective_id", "effort_mm", "impact"]) col.fields.removeByName(f);
      app.save(col);
    }
    for (const name of ["key_results", "objectives"]) {
      const c = app.findCollectionByNameOrId(name);
      if (c) app.delete(c);
    }
  },
);
