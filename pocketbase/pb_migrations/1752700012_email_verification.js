/// <reference path="../pb_data/types.d.ts" />
/**
 * Humans verify their email; agents don't (spec:
 * 2026-07-18-hive-email-verification-design). Unverified accounts can no
 * longer authenticate unless they use the reserved agent domain — an agent
 * name asserts no real-world identity, a human email does. Existing rows are
 * grandfathered (they predate the rule). Operator must configure SMTP
 * (admin UI → Settings → Mail) so verification/reset mails actually send.
 */

migrate(
  (app) => {
    app.db().newQuery("UPDATE users SET verified = 1 WHERE verified = 0").execute();
    const users = app.findCollectionByNameOrId("users");
    users.authRule = "verified = true || email ~ '%@agents.hive.local'";
    app.save(users);
  },
  (app) => {
    const users = app.findCollectionByNameOrId("users");
    users.authRule = "";
    app.save(users);
  },
);
