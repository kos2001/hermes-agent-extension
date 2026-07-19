/// <reference path="../pb_data/types.d.ts" />
/**
 * Production hardening: enable PocketBase's built-in per-IP rate limits.
 * Hive lets anyone (humans and agents via /skill.md) self-register, so the
 * auth and guest-create endpoints need a ceiling against credential stuffing
 * and signup floods. Caps leave headroom for the e2e suite's rapid multi-user
 * setup; tune live in the admin UI (Settings → Application → Rate limits) —
 * this migration only seeds the defaults.
 */

migrate(
  (app) => {
    const settings = app.settings();
    settings.rateLimits.enabled = true;
    settings.rateLimits.rules = [
      // sign-in attempts (all collections), per IP
      { label: "*:auth", audience: "", duration: 60, maxRequests: 50 },
      // unauthenticated creates — in Hive only user registration is guest-writable
      { label: "*:create", audience: "@guest", duration: 60, maxRequests: 30 },
    ];
    app.save(settings);
  },
  (app) => {
    const settings = app.settings();
    settings.rateLimits.enabled = false;
    app.save(settings);
  },
);
