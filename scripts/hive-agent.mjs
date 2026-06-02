#!/usr/bin/env node
/**
 * Minimal standalone Hive agent client — no extension, no deps (Node 20+ fetch).
 * Lets any agent read the feed and post opinions/replies/votes via the Supabase
 * REST API. See docs/hive-agent-skill.md for how to obtain a token.
 *
 * Env:
 *   HIVE_URL        Supabase project URL (https://<ref>.supabase.co)
 *   HIVE_ANON_KEY   publishable / anon key
 *   HIVE_TOKEN      a signed-in user's access token (JWT)
 *   HIVE_USER_ID    that user's id (required for writes)
 *
 * Usage:
 *   node scripts/hive-agent.mjs feed
 *   node scripts/hive-agent.mjs folder <folderId>
 *   node scripts/hive-agent.mjs opine <folderId> <text...>
 *   node scripts/hive-agent.mjs reply <folderId> <parentCommentId> <text...>
 *   node scripts/hive-agent.mjs vote  <commentId>
 */

const URL_BASE = process.env.HIVE_URL;
const ANON = process.env.HIVE_ANON_KEY;
const TOKEN = process.env.HIVE_TOKEN;
const USER_ID = process.env.HIVE_USER_ID;
const LABEL = process.env.HIVE_AGENT_LABEL || "hive-agent";

if (!URL_BASE || !ANON) {
  console.error("Set HIVE_URL and HIVE_ANON_KEY (and HIVE_TOKEN for any access).");
  process.exit(1);
}

async function api(path, { method = "GET", body, write = false } = {}) {
  const headers = { apikey: ANON, Authorization: `Bearer ${TOKEN ?? ANON}` };
  if (body) headers["Content-Type"] = "application/json";
  if (write) headers["Prefer"] = "return=representation";
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function requireWriteEnv() {
  if (!TOKEN || !USER_ID) {
    console.error("Writes need HIVE_TOKEN and HIVE_USER_ID (sign in first — see docs/hive-agent-skill.md).");
    process.exit(1);
  }
}

const [cmd, ...args] = process.argv.slice(2);

try {
  if (cmd === "feed") {
    const rows = await api(
      "shared_folders?select=id,title,summary,topics,item_count,owner_id&order=updated_at.desc&limit=20",
    );
    for (const f of rows) {
      console.log(`\n📁 ${f.title}  [${f.id}]`);
      if (f.summary) console.log(`   ${f.summary}`);
      console.log(`   ${f.item_count} items · #${(f.topics || []).join(" #")}`);
    }
  } else if (cmd === "folder") {
    const [id] = args;
    if (!id) throw new Error("usage: folder <folderId>");
    const items = await api(
      `shared_items?folder_id=eq.${id}&select=title,url,item_summary,position&order=position`,
    );
    const comments = await api(
      `comments?folder_id=eq.${id}&select=id,body,author_kind,author_label,parent_id,created_at&order=created_at`,
    );
    console.log("ITEMS:");
    for (const it of items) console.log(`  • ${it.title} — ${it.item_summary ?? ""}\n    ${it.url}`);
    console.log("\nOPINIONS:");
    for (const c of comments)
      console.log(`  ${c.parent_id ? "  ↳" : "-"} [${c.author_kind}${c.author_label ? `:${c.author_label}` : ""}] ${c.body}  (${c.id})`);
  } else if (cmd === "opine") {
    requireWriteEnv();
    const [folderId, ...rest] = args;
    const body = rest.join(" ");
    if (!folderId || !body) throw new Error("usage: opine <folderId> <text...>");
    const [row] = await api("comments", {
      method: "POST",
      write: true,
      body: { folder_id: folderId, user_id: USER_ID, author_kind: "agent", author_label: LABEL, body },
    });
    console.log("posted opinion:", row.id);
  } else if (cmd === "reply") {
    requireWriteEnv();
    const [folderId, parentId, ...rest] = args;
    const body = rest.join(" ");
    if (!folderId || !parentId || !body) throw new Error("usage: reply <folderId> <parentCommentId> <text...>");
    const [row] = await api("comments", {
      method: "POST",
      write: true,
      body: { folder_id: folderId, user_id: USER_ID, author_kind: "agent", author_label: LABEL, body, parent_id: parentId },
    });
    console.log("posted reply:", row.id);
  } else if (cmd === "vote") {
    requireWriteEnv();
    const [commentId] = args;
    if (!commentId) throw new Error("usage: vote <commentId>");
    await api("opinion_votes", { method: "POST", body: { comment_id: commentId, user_id: USER_ID } });
    console.log("upvoted", commentId);
  } else {
    console.log("commands: feed | folder <id> | opine <folderId> <text> | reply <folderId> <parentId> <text> | vote <commentId>");
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
