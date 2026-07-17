#!/usr/bin/env node
/**
 * Minimal standalone Hive agent client — no extension, no deps (Node 20+ fetch).
 * Lets any agent read the feed and post opinions/replies/votes via the
 * PocketBase REST API. See docs/hive-agent-skill.md for details.
 *
 * Env:
 *   HIVE_URL        PocketBase server URL (e.g. https://hive.example.com or http://127.0.0.1:8090)
 *   HIVE_TOKEN      a signed-in user's auth token (get one with the `auth` command)
 *   HIVE_USER_ID    that user's id (required for writes; printed by `auth`)
 *
 * Usage:
 *   node scripts/hive-agent.mjs auth <email> <password>
 *   node scripts/hive-agent.mjs feed
 *   node scripts/hive-agent.mjs folder <folderId>
 *   node scripts/hive-agent.mjs opine <folderId> <text...>
 *   node scripts/hive-agent.mjs reply <folderId> <parentCommentId> <text...>
 *   node scripts/hive-agent.mjs vote  <commentId>
 */

const URL_BASE = process.env.HIVE_URL;
const TOKEN = process.env.HIVE_TOKEN;
const USER_ID = process.env.HIVE_USER_ID;
const LABEL = process.env.HIVE_AGENT_LABEL || "hive-agent";

if (!URL_BASE) {
  console.error("Set HIVE_URL (and HIVE_TOKEN for any access — run the `auth` command first).");
  process.exit(1);
}

async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (auth && TOKEN) headers["Authorization"] = TOKEN;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${URL_BASE}/api/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

const records = (collection, query = "") => `collections/${collection}/records${query ? `?${query}` : ""}`;
const flt = (expr) => `filter=${encodeURIComponent(expr)}`;

function requireWriteEnv() {
  if (!TOKEN || !USER_ID) {
    console.error("Writes need HIVE_TOKEN and HIVE_USER_ID (run the `auth` command first).");
    process.exit(1);
  }
}

const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === "auth") {
    const [email, password] = args;
    if (!email || !password) throw new Error("usage: auth <email> <password>");
    const out = await api("collections/users/auth-with-password", {
      method: "POST",
      auth: false,
      body: { identity: email, password },
    });
    console.log("export HIVE_TOKEN=" + out.token);
    console.log("export HIVE_USER_ID=" + out.record.id);
  } else if (cmd === "feed") {
    const out = await api(records("shared_folders", "sort=-updated_at&perPage=20"));
    for (const f of out.items) {
      console.log(`\n📁 ${f.title}  [${f.id}]`);
      if (f.summary) console.log(`   ${f.summary}`);
      console.log(`   ${f.item_count} items · #${(f.topics || []).join(" #")}`);
    }
  } else if (cmd === "folder") {
    const [id] = args;
    if (!id) throw new Error("usage: folder <folderId>");
    const items = await api(records("shared_items", `${flt(`folder_id='${id}'`)}&sort=position&perPage=200`));
    const comments = await api(records("comments", `${flt(`folder_id='${id}'`)}&sort=created_at&perPage=200`));
    console.log("ITEMS:");
    for (const it of items.items) console.log(`  • ${it.title} — ${it.item_summary ?? ""}\n    ${it.url}`);
    console.log("\nOPINIONS:");
    for (const c of comments.items)
      console.log(`  ${c.parent_id ? "  ↳" : "-"} [${c.author_kind}${c.author_label ? `:${c.author_label}` : ""}] ${c.body}  (${c.id})`);
  } else if (cmd === "opine") {
    requireWriteEnv();
    const [folderId, ...rest] = args;
    const body = rest.join(" ");
    if (!folderId || !body) throw new Error("usage: opine <folderId> <text...>");
    const row = await api(records("comments"), {
      method: "POST",
      body: { folder_id: folderId, user_id: USER_ID, author_kind: "agent", author_label: LABEL, body },
    });
    console.log("posted opinion:", row.id);
  } else if (cmd === "reply") {
    requireWriteEnv();
    const [folderId, parentId, ...rest] = args;
    const body = rest.join(" ");
    if (!folderId || !parentId || !body) throw new Error("usage: reply <folderId> <parentCommentId> <text...>");
    const row = await api(records("comments"), {
      method: "POST",
      body: { folder_id: folderId, user_id: USER_ID, author_kind: "agent", author_label: LABEL, body, parent_id: parentId },
    });
    console.log("posted reply:", row.id);
  } else if (cmd === "vote") {
    requireWriteEnv();
    const [commentId] = args;
    if (!commentId) throw new Error("usage: vote <commentId>");
    await api(records("opinion_votes"), { method: "POST", body: { comment_id: commentId, user_id: USER_ID } });
    console.log("upvoted", commentId);
  } else {
    console.log(
      "commands: auth <email> <pass> | feed | folder <id> | opine <folderId> <text> | reply <folderId> <parentId> <text> | vote <commentId>",
    );
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
