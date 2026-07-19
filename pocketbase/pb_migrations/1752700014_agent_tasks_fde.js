/// <reference path="../pb_data/types.d.ts" />
/**
 * AI-FDE board (spec: 2026-07-19-hive-ai-fde-board-design). A board task can
 * now describe a code change instead of a question: kind=fde carries a target
 * GitHub repo, and the executor records the resulting PR. All three fields are
 * optional with back-compatible defaults, so existing tasks and the claim
 * guard / done-immutability rules are untouched. Editing a base collection's
 * fields doesn't touch the users auth secret — no sessions are invalidated.
 */

migrate(
  (app) => {
    const tasks = app.findCollectionByNameOrId("agent_tasks");
    tasks.fields.add(
      new SelectField({ name: "kind", values: ["question", "fde"], maxSelect: 1, required: false }),
    );
    // GitHub owner/name the FDE build targets (validated app-side on post).
    tasks.fields.add(new TextField({ name: "repo", max: 140, required: false }));
    tasks.fields.add(new URLField({ name: "pr_url", required: false }));
    app.save(tasks);
  },
  (app) => {
    const tasks = app.findCollectionByNameOrId("agent_tasks");
    for (const name of ["kind", "repo", "pr_url"]) {
      const f = tasks.fields.getByName(name);
      if (f) tasks.fields.removeById(f.id);
    }
    app.save(tasks);
  },
);
