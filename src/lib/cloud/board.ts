import type PocketBase from "pocketbase";
import type { ChatMessage, ConnectionConfig } from "@/lib/types";
import { collectChat } from "@/lib/hermes-client";
import { eq, uid } from "./pb";

/**
 * The agent blackboard: members post requests; any member's agent — the
 * extension, a hermes-agent on some PC, or a coding harness (Claude Code,
 * Codex, …) — claims an open task, works it, and posts the result.
 */
export interface AgentTask {
  id: string;
  requester_id: string;
  title: string;
  body: string;
  category: TaskCategory | "";
  /** Optional ISO cutoff; past it the server refuses new claims. */
  deadline: string;
  /** Optional OKR link + valuation (value density = impact ÷ effort_mm). */
  objective_id: string;
  effort_mm: number;
  impact: number;
  status: "open" | "claimed" | "done";
  /** "fde" = build a code change; "" / "question" = answer with text. */
  kind: "question" | "fde" | "";
  /** Target GitHub repo (owner/name) for an FDE task. */
  repo: string;
  /** The delivered pull request URL for an FDE task. */
  pr_url: string;
  claimed_by: string;
  worker_label: string;
  result: string;
  /** While claimed, when the claim lapses and another agent may take over. */
  lease_until: string;
  created_at: string;
  updated_at: string;
  requester?: { display_name: string | null };
}

/**
 * One open task as ranked by the `board_queue` view. The score is
 * `value density × urgency × aging`, computed server-side so the extension,
 * the web app and `scripts/hive-agent.mjs` all rank identically — see
 * pb_migrations/1752700017_board_control.js for the formula and its bounds.
 */
export interface QueuedTask
  extends Pick<
    AgentTask,
    | "id"
    | "requester_id"
    | "title"
    | "body"
    | "category"
    | "kind"
    | "repo"
    | "deadline"
    | "objective_id"
    | "effort_mm"
    | "impact"
    | "created_at"
  > {
  queue_score: number;
}

/** Work topics a request can belong to (stored English; UIs translate). */
export const TASK_CATEGORIES = ["general", "research", "coding", "writing", "data", "review", "ops"] as const;
export type TaskCategory = (typeof TASK_CATEGORIES)[number];

/** A task's category, with pre-category rows counting as "general". Pure. */
export function taskCategory(task: Pick<AgentTask, "category">): TaskCategory {
  return task.category || "general";
}

/** Whether an ISO deadline has passed ('' = no deadline). Pure. */
export function isExpired(deadline: string, now: Date = new Date()): boolean {
  return Boolean(deadline) && new Date(deadline).getTime() <= now.getTime();
}

/**
 * The best open task someone else posted, or null. Pure.
 *
 * "Best" is the highest `queue_score` — the blackboard's opportunistic control
 * step. The score itself is the view's job; this only applies the parts that
 * depend on *who is asking*: never your own request, never an expired one, and
 * only your categories when you participate per topic. Ties (equal scores, or
 * a caller that passed unranked rows) fall back to oldest-first, the FIFO
 * behaviour this replaced.
 */
export function pickOpenTask(
  tasks: QueuedTask[],
  myId: string,
  categories?: TaskCategory[],
  now: Date = new Date(),
): QueuedTask | null {
  const open = tasks
    .filter((t) => t.requester_id !== myId && !isExpired(t.deadline, now))
    .filter((t) => !categories?.length || categories.includes(taskCategory(t)))
    .sort((a, b) => (b.queue_score ?? 0) - (a.queue_score ?? 0) || (a.created_at < b.created_at ? -1 : 1));
  return open[0] ?? null;
}

/** LLM request for answering a board task. Pure. */
export function buildTaskPrompt(task: Pick<AgentTask, "title" | "body">): { messages: ChatMessage[] } {
  const system =
    "You are an AI agent working a shared task board for a knowledge-sharing " +
    "community. A member posted the request below. Produce a genuinely useful, " +
    "self-contained answer (a few paragraphs at most). " +
    'Reply with JSON only: {"answer": "..."}.';
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify({ title: task.title, request: task.body }) },
    ],
  };
}

/** Pull the answer text from the model reply (JSON `{answer}` or plain text). Pure. */
export function parseTaskAnswer(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1)) as { answer?: unknown };
      if (typeof obj.answer === "string" && obj.answer.trim()) return obj.answer.trim();
    } catch {
      // fall through to plain text
    }
  }
  const plain = text.trim();
  if (!plain) throw new Error("Agent returned an empty answer");
  return plain;
}

/** All board tasks, newest first, with the requester joined; optionally one category. */
export async function listTasks(pb: PocketBase, limit = 50, category?: TaskCategory): Promise<AgentTask[]> {
  const result = await pb.collection("agent_tasks").getList(1, limit, {
    sort: "-created_at",
    expand: "requester_id",
    // pre-category rows count as "general"
    ...(category
      ? { filter: category === "general" ? `(${eq("category", "general")} || category = '')` : eq("category", category) }
      : {}),
  });
  return result.items.map((row) => {
    const { expand, ...t } = row as Record<string, unknown> & {
      expand?: { requester_id?: { display_name: string | null } };
    };
    return { ...t, requester: { display_name: expand?.requester_id?.display_name ?? null } } as AgentTask;
  });
}

/**
 * The open tasks, best first, from the ranked `board_queue` view. Claimed and
 * finished tasks are not in the view; use `listTasks` for the full board.
 */
export async function listQueue(pb: PocketBase, limit = 50, category?: TaskCategory): Promise<QueuedTask[]> {
  const result = await pb.collection("board_queue").getList(1, limit, {
    sort: "-queue_score",
    ...(category
      ? { filter: category === "general" ? `(${eq("category", "general")} || category = '')` : eq("category", category) }
      : {}),
  });
  return result.items as unknown as QueuedTask[];
}

/** Post a request to the board; returns the new task id. */
/** Optional OKR link + valuation carried by a work item at post time. */
export interface WorkValue {
  objectiveId?: string;
  effortMm?: number;
  impact?: number;
}

/** The create-payload fields for a WorkValue (only what's actually set). */
export function workValueFields(value?: WorkValue): Record<string, unknown> {
  return {
    ...(value?.objectiveId ? { objective_id: value.objectiveId } : {}),
    ...(value?.effortMm ? { effort_mm: value.effortMm } : {}),
    ...(value?.impact ? { impact: value.impact } : {}),
  };
}

export async function postTask(
  pb: PocketBase,
  title: string,
  body: string,
  category: TaskCategory = "general",
  deadline = "",
  value?: WorkValue,
): Promise<string> {
  const cleanTitle = title.trim();
  const cleanBody = body.trim();
  if (!cleanTitle || !cleanBody) throw new Error("Title and body must not be empty");
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to post");
  const created = await pb.collection("agent_tasks").create({
    requester_id: userId,
    title: cleanTitle,
    body: cleanBody,
    category,
    deadline,
    status: "open",
    ...workValueFields(value),
  });
  return created.id;
}

/**
 * Claim an open task — or take over one whose lease lapsed — for the current
 * user's agent. The server stamps `lease_until`; a throw means someone else
 * holds a live claim.
 */
export async function claimTask(pb: PocketBase, taskId: string, workerLabel: string): Promise<void> {
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to claim");
  await pb.collection("agent_tasks").update(taskId, {
    status: "claimed",
    claimed_by: userId,
    worker_label: workerLabel,
  });
}

/**
 * Hold a claim that outlives one lease. Work longer than the lease — an FDE
 * task building a pull request always is — has to touch the record on the way,
 * or another agent may take the task over. The server re-stamps the lease on
 * any update by the claimer, so the body only has to be valid.
 */
export async function renewLease(pb: PocketBase, taskId: string): Promise<void> {
  await pb.collection("agent_tasks").update(taskId, { status: "claimed" });
}

/**
 * Hand a claimed task back to the board. The counterpart to `completeTask` for
 * work that failed: without it a task sits claimed until its lease runs out.
 */
export async function releaseTask(pb: PocketBase, taskId: string): Promise<void> {
  await pb.collection("agent_tasks").update(taskId, { status: "open", claimed_by: null, worker_label: "" });
}

/** Post the result and mark the task done. */
export async function completeTask(pb: PocketBase, taskId: string, result: string): Promise<void> {
  await pb.collection("agent_tasks").update(taskId, { status: "done", result });
}

// ---- AI-FDE tasks: board requests that become a GitHub PR --------------------

/** Whether a task is an FDE (build-a-PR) request. Legacy rows default to question. Pure. */
export function isFdeTask(task: Pick<AgentTask, "kind">): boolean {
  return task.kind === "fde";
}

/** Canonical `owner/name` from a repo string or github URL, or null. Pure. */
export function normalizeRepo(raw: string): string | null {
  let s = (raw || "").trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  return /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(s) ? s : null;
}

/** Post an FDE task (build a change in `repo` per the spec body); returns its id. */
export async function postFdeTask(
  pb: PocketBase,
  repo: string,
  title: string,
  body: string,
  deadline = "",
  value?: WorkValue,
): Promise<string> {
  const cleanRepo = normalizeRepo(repo);
  if (!cleanRepo) throw new Error(`Not a valid GitHub repo (owner/name): "${repo}"`);
  const cleanTitle = title.trim();
  const cleanBody = body.trim();
  if (!cleanTitle || !cleanBody) throw new Error("Title and spec body must not be empty");
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to post");
  const created = await pb.collection("agent_tasks").create({
    requester_id: userId,
    title: cleanTitle,
    body: cleanBody,
    category: "coding",
    kind: "fde",
    repo: cleanRepo,
    deadline,
    status: "open",
    ...workValueFields(value),
  });
  return created.id;
}

/** Report an FDE task's pull request and mark it done. */
export async function deliverFde(
  pb: PocketBase,
  taskId: string,
  delivery: { pr_url: string; summary: string },
): Promise<void> {
  const pr = delivery.pr_url.trim();
  if (!pr) throw new Error("A PR url is required to deliver an FDE task");
  await pb.collection("agent_tasks").update(taskId, {
    status: "done",
    pr_url: pr,
    result: delivery.summary.trim(),
  });
}

/**
 * One autonomous pass for the extension's local agent: claim the best-ranked
 * open task and answer it with the member's own LLM. Returns what was worked.
 *
 * A failed answer releases the claim rather than leaving the task parked until
 * its lease runs out — the lease only has to cover the case where this agent
 * dies outright.
 */
export async function runBoardWork(
  pb: PocketBase,
  config: ConnectionConfig,
  opts: { signal?: AbortSignal } = {},
): Promise<{ worked: string | null }> {
  const myId = uid(pb);
  if (!myId) return { worked: null };
  const next = pickOpenTask(await listQueue(pb), myId);
  if (!next) return { worked: null };

  await claimTask(pb, next.id, config.model);
  try {
    const { messages } = buildTaskPrompt(next);
    const text = await collectChat({
      config,
      messages,
      model: config.model,
      responseFormat: { type: "json_object" },
      signal: opts.signal,
    });
    await completeTask(pb, next.id, parseTaskAnswer(text));
  } catch (e) {
    await releaseTask(pb, next.id).catch(() => {});
    throw e;
  }
  return { worked: next.id };
}
