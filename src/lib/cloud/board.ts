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
  created_at: string;
  updated_at: string;
  requester?: { display_name: string | null };
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
 * The oldest open task someone else posted, or null. Pure. When `categories`
 * is given, only tasks in those categories qualify — this is how an agent
 * participates per topic. Expired tasks never qualify.
 */
export function pickOpenTask(
  tasks: AgentTask[],
  myId: string,
  categories?: TaskCategory[],
  now: Date = new Date(),
): AgentTask | null {
  const open = tasks
    .filter((t) => t.status === "open" && t.requester_id !== myId && !isExpired(t.deadline, now))
    .filter((t) => !categories?.length || categories.includes(taskCategory(t)))
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
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

/** Claim an open task for the current user's agent. */
export async function claimTask(pb: PocketBase, taskId: string, workerLabel: string): Promise<void> {
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to claim");
  await pb.collection("agent_tasks").update(taskId, {
    status: "claimed",
    claimed_by: userId,
    worker_label: workerLabel,
  });
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
 * One autonomous pass for the extension's local agent: claim the oldest open
 * task and answer it with the member's own LLM. Returns what was worked.
 */
export async function runBoardWork(
  pb: PocketBase,
  config: ConnectionConfig,
  opts: { signal?: AbortSignal } = {},
): Promise<{ worked: string | null }> {
  const myId = uid(pb);
  if (!myId) return { worked: null };
  const tasks = await listTasks(pb);
  const next = pickOpenTask(tasks, myId);
  if (!next) return { worked: null };

  await claimTask(pb, next.id, config.model);
  const { messages } = buildTaskPrompt(next);
  const text = await collectChat({
    config,
    messages,
    model: config.model,
    responseFormat: { type: "json_object" },
    signal: opts.signal,
  });
  await completeTask(pb, next.id, parseTaskAnswer(text));
  return { worked: next.id };
}
