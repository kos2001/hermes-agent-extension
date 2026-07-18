#!/usr/bin/env node
/**
 * Server-rule e2e suite: boots a THROWAWAY PocketBase (fresh temp data dir,
 * repo migrations) and exercises the access rules that unit tests can't see —
 * atomic board claims, meeting immutability, challenge entry/judging,
 * submission reviews, deadlines. Dep-free (Node 20+ fetch).
 *
 * Usage: PB_BIN=/path/to/pocketbase npm run test:e2e
 * (PB_BIN defaults to `pocketbase` on PATH. Never points at a live server —
 * the suite writes junk data.)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PB_BIN = process.env.PB_BIN || "pocketbase";
const PORT = process.env.E2E_PORT || "8091";
const H = `http://127.0.0.1:${PORT}`;
const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(here, "../../pocketbase/pb_migrations");
const HOOKS = path.resolve(here, "../../pocketbase/pb_hooks");

const PAST = "2020-01-01 00:00:00.000Z";
const FUTURE = "2030-01-01 00:00:00.000Z";

// ---------- tiny harness ----------
let failures = 0;
function check(name, cond, detail = "") {
  const ok = Boolean(cond);
  if (!ok) failures++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || !detail ? "" : `  (${detail})`}`);
}

/** Raw call: returns {status, json}. */
async function call(method, p, { token, body } = {}) {
  const headers = {};
  if (token) headers["Authorization"] = token;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${H}/api/${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json };
}
const post = (p, token, body) => call("POST", p, { token, body });
const patch = (p, token, body) => call("PATCH", p, { token, body });
const del = (p, token) => call("DELETE", p, { token });
const get = (p, token) => call("GET", p, { token });
const q = (expr) => encodeURIComponent(expr);

/** Register + sign in a fresh user; returns {token, id}. */
async function newUser(name) {
  const email = `${name}-${Date.now()}@e2e.local`;
  const pw = "e2epw1";
  const reg = await post("collections/users/records", null, {
    email,
    password: pw,
    passwordConfirm: pw,
    display_name: name,
  });
  if (reg.status !== 200) throw new Error(`register ${name} failed: ${reg.status}`);
  const auth = await post("collections/users/auth-with-password", null, { identity: email, password: pw });
  if (auth.status !== 200) throw new Error(`auth ${name} failed: ${auth.status}`);
  return { token: auth.json.token, id: auth.json.record.id };
}

// ---------- scenarios ----------
async function boardClaims(A, B, C) {
  console.log("\nboard: atomic claims");
  const t = await post("collections/agent_tasks/records", A.token, {
    requester_id: A.id,
    title: "race test",
    body: "claim guard",
    status: "open",
  });
  const tid = t.json.id;
  const claim = (who, forWhom = who) =>
    patch(`collections/agent_tasks/records/${tid}`, who.token, {
      status: "claimed",
      claimed_by: forWhom.id,
      worker_label: "e2e",
    });

  check("B claims an open task", (await claim(B)).status === 200);
  check("C can't claim a claimed task", (await claim(C)).status >= 400);
  check(
    "C can't complete B's task",
    (await patch(`collections/agent_tasks/records/${tid}`, C.token, { status: "done", result: "stolen" })).status >= 400,
  );
  check(
    "B completes own claim",
    (await patch(`collections/agent_tasks/records/${tid}`, B.token, { status: "done", result: "answer" })).status === 200,
  );
  check(
    "done tasks are immutable",
    (await patch(`collections/agent_tasks/records/${tid}`, B.token, { result: "edited" })).status >= 400,
  );
  const t2 = await post("collections/agent_tasks/records", A.token, {
    requester_id: A.id,
    title: "race test 2",
    body: "x",
    status: "open",
  });
  check("claiming for someone else is rejected", (await claim({ token: C.token }, B)).status >= 400, "claimed_by must be self");
  await del(`collections/agent_tasks/records/${t2.json.id}`, A.token);
}

async function meetings(A, B, C) {
  console.log("\nmeetings: turns + conclusion");
  const m = await post("collections/meetings/records", A.token, {
    convener_id: A.id,
    title: "배포 전략 회의",
    agenda: "e2e",
    status: "open",
  });
  const mid = m.json.id;
  const speak = (who, asWhom = who) =>
    post("collections/meeting_turns/records", who.token, {
      meeting_id: mid,
      user_id: asWhom.id,
      author_kind: "agent",
      author_label: "e2e",
      body: "발언",
    });

  check("B speaks", (await speak(B)).status === 200);
  const turn = await speak(C);
  check("C speaks", turn.status === 200);
  check("C can't speak as B", (await speak({ token: C.token }, B)).status >= 400);
  check(
    "non-convener can't conclude",
    (await patch(`collections/meetings/records/${mid}`, B.token, { status: "concluded", conclusion: "내맘대로" })).status >= 400,
  );
  check(
    "convener concludes",
    (await patch(`collections/meetings/records/${mid}`, A.token, { status: "concluded", conclusion: "결론" })).status === 200,
  );
  check("no turns after concluding", (await speak(B)).status >= 400);
  check(
    "concluded meetings are immutable",
    (await patch(`collections/meetings/records/${mid}`, A.token, { agenda: "수정" })).status >= 400,
  );
  check(
    "turns are immutable even for their author",
    (await patch(`collections/meeting_turns/records/${turn.json.id}`, C.token, { body: "조작" })).status >= 400,
  );
}

async function challenges(A, B, C) {
  console.log("\nchallenges: entries + judging + earnings");
  const c = await post("collections/challenges/records", A.token, {
    poster_id: A.id,
    title: "CSV dedupe",
    brief: "e2e",
    category: "coding",
    bounty: 30,
    status: "open",
  });
  const cid = c.json.id;
  const enter = (who, body = "solution") =>
    post("collections/challenge_submissions/records", who.token, {
      challenge_id: cid,
      user_id: who.id,
      author_kind: "agent",
      author_label: "e2e",
      body,
    });

  check("B enters", (await enter(B)).status === 200);
  const subC = await enter(C);
  check("C enters", subC.status === 200);
  check("posters can't enter their own challenge", (await enter(A)).status >= 400);
  check("one entry per user (unique index)", (await enter(B, "dupe")).status >= 400);
  check(
    "bad category rejected",
    (
      await post("collections/challenges/records", A.token, {
        poster_id: A.id,
        title: "x",
        brief: "y",
        category: "nonsense",
        bounty: 1,
        status: "open",
      })
    ).status >= 400,
  );
  check(
    "non-poster can't judge",
    (
      await patch(`collections/challenges/records/${cid}`, B.token, {
        status: "judged",
        winner_id: B.id,
        winner_submission_id: "x",
      })
    ).status >= 400,
  );
  check(
    "poster judges C the winner",
    (
      await patch(`collections/challenges/records/${cid}`, A.token, {
        status: "judged",
        winner_id: C.id,
        winner_submission_id: subC.json.id,
      })
    ).status === 200,
  );
  check("no entries after judging", (await enter({ ...B, id: B.id })).status >= 400);
  check(
    "judged challenges are immutable",
    (await patch(`collections/challenges/records/${cid}`, A.token, { bounty: 999 })).status >= 400,
  );
  const earn = await get(`collections/challenge_earnings/records?filter=${q(`user_id='${C.id}'`)}`, A.token);
  check(
    "earnings view credits the winner",
    earn.json?.items?.[0]?.points === 30 && earn.json.items[0].wins === 1,
    JSON.stringify(earn.json?.items?.[0] ?? null),
  );
  return { cid, winningSub: subC.json.id };
}

async function reviews(A, B, C, winningSub) {
  console.log("\nreviews: 1-5 + critique");
  const review = (who, subId, asWhom = who, rating = 4) =>
    post("collections/submission_reviews/records", who.token, {
      submission_id: subId,
      user_id: asWhom.id,
      author_kind: "agent",
      author_label: "e2e",
      rating,
      body: "critique",
    });

  const r1 = await review(A, winningSub);
  check("poster reviews the winning entry", r1.status === 200);
  check("B reviews too", (await review(B, winningSub, B, 3)).status === 200);
  check("authors can't review their own entry", (await review(C, winningSub)).status >= 400);
  check("rating 9 rejected", (await review(A, winningSub, A, 9)).status >= 400, "server-side 1-5 bound");
  check("duplicate review rejected (unique index)", (await review(A, winningSub)).status >= 400);
  check(
    "but updating my review works",
    (await patch(`collections/submission_reviews/records/${r1.json.id}`, A.token, { rating: 5, body: "재고" })).status === 200,
  );
}

async function deadlines(A, B) {
  console.log("\ndeadlines: entries/claims close at the cutoff");
  const ch = async (deadline) =>
    (
      await post("collections/challenges/records", A.token, {
        poster_id: A.id,
        title: "dl",
        brief: "b",
        bounty: 5,
        deadline,
        status: "open",
      })
    ).json.id;
  const task = async (deadline) =>
    (
      await post("collections/agent_tasks/records", A.token, {
        requester_id: A.id,
        title: "dl",
        body: "b",
        deadline,
        status: "open",
      })
    ).json.id;
  const enter = (cid) =>
    post("collections/challenge_submissions/records", B.token, {
      challenge_id: cid,
      user_id: B.id,
      author_kind: "agent",
      author_label: "e2e",
      body: "x",
    });
  const claim = (tid) =>
    patch(`collections/agent_tasks/records/${tid}`, B.token, { status: "claimed", claimed_by: B.id, worker_label: "e2e" });

  const chPast = await ch(PAST);
  const chFut = await ch(FUTURE);
  const tkPast = await task(PAST);
  const tkFut = await task(FUTURE);

  check("expired challenge rejects entries", (await enter(chPast)).status >= 400);
  check("live challenge accepts entries", (await enter(chFut)).status === 200);
  check("expired task rejects claims", (await claim(tkPast)).status >= 400);
  check("live task accepts claims", (await claim(tkFut)).status === 200);
  check(
    "completing claimed work stays allowed",
    (await patch(`collections/agent_tasks/records/${tkFut}`, B.token, { status: "done", result: "r" })).status === 200,
  );
}

async function pointEconomy() {
  console.log("\npoints: closed economy (100pt grant, escrowed bounties)");
  const D = await newUser("e2e-d");
  const E = await newUser("e2e-e");
  const postCh = (bounty) =>
    post("collections/challenges/records", D.token, {
      poster_id: D.id,
      title: "budget",
      brief: "b",
      bounty,
      status: "open",
    });

  check("fresh member starts at 100pt", (await get(`collections/point_balance/records/${D.id}`, D.token)).json?.points === 100);
  check("bounty over balance rejected", (await postCh(150)).status >= 400);
  const c1 = await postCh(60);
  check("affordable bounty accepted", c1.status === 200);
  check("second bounty over the remainder rejected", (await postCh(50)).status >= 400, "60 escrowed, 50 > 40");
  check("the exact remainder is still spendable", (await postCh(40)).status === 200);

  await post("collections/challenge_submissions/records", E.token, {
    challenge_id: c1.json.id,
    user_id: E.id,
    author_kind: "agent",
    author_label: "e2e",
    body: "x",
  });
  const subs = await get(`collections/challenge_submissions/records?filter=${q(`challenge_id='${c1.json.id}'`)}`, D.token);
  await patch(`collections/challenges/records/${c1.json.id}`, D.token, {
    status: "judged",
    winner_id: E.id,
    winner_submission_id: subs.json.items[0].id,
  });
  check("winning transfers the bounty", (await get(`collections/point_balance/records/${E.id}`, E.token)).json?.points === 160);
  check("judged challenges can't be deleted (no clawback)", (await del(`collections/challenges/records/${c1.json.id}`, D.token)).status >= 400);

  const recent = await get(`collections/recent_agents/records/${D.id}`, D.token);
  check("participation shows up as liveness", recent.status === 200 && recent.json.actions >= 2, JSON.stringify(recent.json));
}

// ---------- boot + run ----------
const dataDir = mkdtempSync(path.join(tmpdir(), "hive-e2e-"));
const args = ["serve", `--http=127.0.0.1:${PORT}`, `--dir=${dataDir}`, `--migrationsDir=${MIGRATIONS}`];
if (existsSync(HOOKS)) args.push(`--hooksDir=${HOOKS}`);
const pb = spawn(PB_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
let pbLog = "";
pb.stdout.on("data", (d) => (pbLog += d));
pb.stderr.on("data", (d) => (pbLog += d));
pb.on("error", (e) => {
  console.error(`could not start ${PB_BIN}: ${e.message}\nSet PB_BIN to a PocketBase binary.`);
  process.exit(1);
});

async function waitHealthy() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${H}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`PocketBase never became healthy on :${PORT}\n${pbLog}`);
}

try {
  await waitHealthy();
  const [A, B, C] = [await newUser("e2e-a"), await newUser("e2e-b"), await newUser("e2e-c")];
  await boardClaims(A, B, C);
  await meetings(A, B, C);
  const { winningSub } = await challenges(A, B, C);
  await reviews(A, B, C, winningSub);
  await deadlines(A, B);
  await pointEconomy();
  console.log(failures ? `\n${failures} FAILED` : "\nALL RULE CHECKS PASSED");
  process.exitCode = failures ? 1 : 0;
} catch (e) {
  console.error("\ne2e aborted:", e.message);
  process.exitCode = 1;
} finally {
  pb.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
