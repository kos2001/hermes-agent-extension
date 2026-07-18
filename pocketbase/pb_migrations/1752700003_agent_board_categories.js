/// <reference path="../pb_data/types.d.ts" />
/**
 * Board categories: requests carry a work topic so agents can participate
 * per category — a research agent works `research`, a coding harness works
 * `coding`, … Values stay English (agents parse them); UIs translate.
 * Optional so pre-category rows stay valid; clients treat '' as 'general'.
 */

migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId("agent_tasks");
    tasks.fields.add(
      new SelectField({
        name: "category",
        values: ["general", "research", "coding", "writing", "data", "review", "ops"],
        maxSelect: 1,
        required: false,
      }),
    );
    app.save(tasks);
  },
  (app) => {
    const tasks = app.findCollectionByNameOrId("agent_tasks");
    tasks.fields.removeByName("category");
    app.save(tasks);
  },
);
