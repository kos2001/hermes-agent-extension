import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import { buildTaskPrompt, claimTask, completeTask, deliverFde, isFdeTask, listQueue, listTasks, normalizeRepo, parseTaskAnswer, pickOpenTask, postFdeTask, postTask, releaseTask, renewLease } from "./board";
import type { AgentTask, QueuedTask } from "./board";

const task = (over: Partial<AgentTask>): AgentTask => ({
  id: "t1",
  requester_id: "u1",
  title: "Summarize X",
  body: "Please summarize X.",
  category: "general",
  deadline: "",
  objective_id: "",
  effort_mm: 0,
  impact: 0,
  status: "open",
  kind: "question",
  repo: "",
  pr_url: "",
  claimed_by: "",
  worker_label: "",
  result: "",
  lease_until: "",
  created_at: "2026-07-17T00:00:00Z",
  updated_at: "2026-07-17T00:00:00Z",
  ...over,
});

/** A row as `board_queue` returns it: open, with the server's score. */
const queued = (over: Partial<QueuedTask>): QueuedTask => ({
  id: "t1",
  requester_id: "u1",
  title: "Summarize X",
  body: "Please summarize X.",
  category: "general",
  kind: "question",
  repo: "",
  deadline: "",
  objective_id: "",
  effort_mm: 0,
  impact: 0,
  created_at: "2026-07-17T00:00:00Z",
  queue_score: 1,
  ...over,
});

describe("pickOpenTask", () => {
  it("picks the best-ranked task, not the oldest", () => {
    const tasks = [
      queued({ id: "oldest", created_at: "2026-07-16T00:00:00Z", queue_score: 2.5 }),
      queued({ id: "urgent", created_at: "2026-07-17T02:00:00Z", queue_score: 37.3 }),
    ];
    expect(pickOpenTask(tasks, "me")?.id).toBe("urgent");
  });

  it("never works my own request, however well it scores", () => {
    const tasks = [
      queued({ id: "mine", requester_id: "me", queue_score: 99 }),
      queued({ id: "theirs", queue_score: 1 }),
    ];
    expect(pickOpenTask(tasks, "me")?.id).toBe("theirs");
    expect(pickOpenTask([queued({ requester_id: "me" })], "me")).toBeNull();
    expect(pickOpenTask([], "me")).toBeNull();
  });

  it("never picks an expired task", () => {
    const now = new Date("2026-07-18T12:00:00Z");
    const tasks = [
      queued({ id: "expired", deadline: "2026-07-18T11:00:00Z", queue_score: 99 }),
      queued({ id: "live", deadline: "2026-07-18T13:00:00Z", queue_score: 1 }),
    ];
    expect(pickOpenTask(tasks, "me", undefined, now)?.id).toBe("live");
  });

  it("falls back to oldest-first on a tie", () => {
    const tasks = [
      queued({ id: "newer", created_at: "2026-07-17T02:00:00Z", queue_score: 3 }),
      queued({ id: "older", created_at: "2026-07-16T00:00:00Z", queue_score: 3 }),
    ];
    expect(pickOpenTask(tasks, "me")?.id).toBe("older");
  });

  it("participates per category when the agent declares some", () => {
    const tasks = [
      queued({ id: "code", category: "coding", queue_score: 2 }),
      queued({ id: "res", category: "research", queue_score: 5 }),
      queued({ id: "legacy", category: "", queue_score: 1 }),
    ];
    expect(pickOpenTask(tasks, "me", ["coding"])?.id).toBe("code");
    // pre-category rows count as "general"
    expect(pickOpenTask(tasks, "me", ["general"])?.id).toBe("legacy");
    expect(pickOpenTask(tasks, "me", ["writing"])).toBeNull();
    // no declared categories = work anything (best score wins)
    expect(pickOpenTask(tasks, "me")?.id).toBe("res");
  });
});

describe("listQueue", () => {
  it("reads the ranked view, best first", async () => {
    const getList = vi.fn(async (_p: number, _l: number, opts: { sort: string; filter?: string }) => {
      expect(opts.sort).toBe("-queue_score");
      expect(opts.filter).toBeUndefined();
      return { items: [{ id: "t1", queue_score: 9 }] };
    });
    const pb = mockPb({ board_queue: { getList } });
    expect((await listQueue(pb))[0]).toMatchObject({ id: "t1", queue_score: 9 });
  });

  it("filters by category, folding legacy rows into general", async () => {
    const getList = vi.fn(async (_p: number, _l: number, _opts: { sort: string; filter?: string }) => ({ items: [] }));
    const pb = mockPb({ board_queue: { getList } });
    await listQueue(pb, 50, "research");
    expect(getList.mock.calls[0][2].filter).toBe("category = 'research'");
    await listQueue(pb, 50, "general");
    expect(getList.mock.calls[1][2].filter).toBe("(category = 'general' || category = '')");
  });
});

describe("buildTaskPrompt / parseTaskAnswer", () => {
  it("builds messages carrying the request and parses a JSON answer", () => {
    const { messages } = buildTaskPrompt(task({ title: "T", body: "B" }));
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toContain("T");
    expect(messages[1].content).toContain("B");
    expect(parseTaskAnswer('{"answer": "hi"}')).toBe("hi");
    expect(parseTaskAnswer("plain text")).toBe("plain text");
    expect(() => parseTaskAnswer("   ")).toThrow(/empty/i);
  });
});

describe("listTasks", () => {
  it("lists newest first with the requester expanded", async () => {
    const getList = vi.fn(async (_p: number, _l: number, opts: { sort: string; expand: string; filter?: string }) => {
      expect(opts).toMatchObject({ sort: "-created_at", expand: "requester_id" });
      expect(opts.filter).toBeUndefined();
      return { items: [{ id: "t1", expand: { requester_id: { display_name: "Kim" } } }] };
    });
    const pb = mockPb({ agent_tasks: { getList } });
    const out = await listTasks(pb);
    expect(out[0]).toMatchObject({ id: "t1", requester: { display_name: "Kim" } });
  });

  it("filters by category, folding legacy rows into general", async () => {
    const getList = vi.fn(async (_p: number, _l: number, opts: { filter?: string }) => {
      return { items: [], filterSeen: opts.filter } as { items: never[]; filterSeen?: string };
    });
    const pb = mockPb({ agent_tasks: { getList } });
    await listTasks(pb, 50, "research");
    expect(getList.mock.calls[0][2].filter).toBe("category = 'research'");
    await listTasks(pb, 50, "general");
    expect(getList.mock.calls[1][2].filter).toBe("(category = 'general' || category = '')");
  });
});

describe("postTask", () => {
  it("creates an open task from the current user", async () => {
    const create = vi.fn(async (_d: Record<string, unknown>) => ({ id: "t-new" }));
    const pb = mockPb({ agent_tasks: { create } });
    const id = await postTask(pb, "  Title  ", "  Body  ");
    expect(id).toBe("t-new");
    expect(create).toHaveBeenCalledWith({
      requester_id: "u1",
      title: "Title",
      body: "Body",
      category: "general",
      deadline: "",
      status: "open",
    });
  });

  it("carries the chosen category", async () => {
    const create = vi.fn(async (_d: Record<string, unknown>) => ({ id: "t-new" }));
    const pb = mockPb({ agent_tasks: { create } });
    await postTask(pb, "T", "B", "coding");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ category: "coding" }));
  });

  it("carries OKR valuation only when actually set", async () => {
    const create = vi.fn(async (_d: Record<string, unknown>) => ({ id: "t-new" }));
    const pb = mockPb({ agent_tasks: { create } });
    await postTask(pb, "T", "B", "coding", "", { objectiveId: "o1", effortMm: 0.5, impact: 7 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ objective_id: "o1", effort_mm: 0.5, impact: 7 }));
    await postTask(pb, "T", "B");
    expect(create.mock.calls[1][0]).not.toHaveProperty("objective_id");
  });

  it("rejects empty fields and signed-out", async () => {
    await expect(postTask(mockPb({}), " ", "b")).rejects.toThrow(/empty/i);
    await expect(postTask(mockPb({}, null), "t", "b")).rejects.toThrow(/signed in/i);
  });
});

describe("claimTask / completeTask", () => {
  it("claim sets claimed status, claimer and label", async () => {
    const update = vi.fn(async (_id: string, _d: Record<string, unknown>) => ({}));
    const pb = mockPb({ agent_tasks: { update } });
    await claimTask(pb, "t1", "Claude Code");
    expect(update).toHaveBeenCalledWith("t1", { status: "claimed", claimed_by: "u1", worker_label: "Claude Code" });
  });

  it("complete stores the result and marks done", async () => {
    const update = vi.fn(async (_id: string, _d: Record<string, unknown>) => ({}));
    const pb = mockPb({ agent_tasks: { update } });
    await completeTask(pb, "t1", "the answer");
    expect(update).toHaveBeenCalledWith("t1", { status: "done", result: "the answer" });
  });

  it("renew touches the record so the server re-stamps the lease", async () => {
    const update = vi.fn(async (_id: string, _d: Record<string, unknown>) => ({}));
    const pb = mockPb({ agent_tasks: { update } });
    await renewLease(pb, "t1");
    expect(update).toHaveBeenCalledWith("t1", { status: "claimed" });
  });

  it("release hands the task back and drops the claimer", async () => {
    const update = vi.fn(async (_id: string, _d: Record<string, unknown>) => ({}));
    const pb = mockPb({ agent_tasks: { update } });
    await releaseTask(pb, "t1");
    expect(update).toHaveBeenCalledWith("t1", { status: "open", claimed_by: null, worker_label: "" });
  });
});

describe("normalizeRepo", () => {
  it("accepts owner/name and strips a github URL or trailing junk", () => {
    expect(normalizeRepo(" kos2001/hermes-agent-extension ")).toBe("kos2001/hermes-agent-extension");
    expect(normalizeRepo("https://github.com/kos2001/hermes-agent-extension")).toBe("kos2001/hermes-agent-extension");
    expect(normalizeRepo("https://github.com/kos2001/hermes-agent-extension.git")).toBe("kos2001/hermes-agent-extension");
  });
  it("rejects anything that isn't owner/name", () => {
    expect(normalizeRepo("")).toBeNull();
    expect(normalizeRepo("just-a-name")).toBeNull();
    expect(normalizeRepo("a/b/c")).toBeNull();
    expect(normalizeRepo("bad owner/name")).toBeNull();
  });
});

describe("isFdeTask", () => {
  it("is true only for kind=fde", () => {
    expect(isFdeTask(task({ kind: "fde", repo: "o/n" }))).toBe(true);
    expect(isFdeTask(task({ kind: "question" }))).toBe(false);
    expect(isFdeTask(task({}))).toBe(false); // legacy rows default to question
  });
});

describe("postFdeTask", () => {
  it("creates a kind=fde task with a normalized repo", async () => {
    const create = vi.fn(async (_d: Record<string, unknown>) => ({ id: "fde1" }));
    const pb = mockPb({ agent_tasks: { create } });
    const id = await postFdeTask(pb, "https://github.com/kos2001/repo", "Add X", "spec body");
    expect(id).toBe("fde1");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "fde",
        repo: "kos2001/repo",
        title: "Add X",
        body: "spec body",
        category: "coding",
        status: "open",
      }),
    );
  });
  it("rejects an invalid repo and an empty spec", async () => {
    const pb = mockPb({ agent_tasks: { create: vi.fn() } });
    await expect(postFdeTask(pb, "not-a-repo", "t", "b")).rejects.toThrow(/repo/i);
    await expect(postFdeTask(pb, "o/n", "t", " ")).rejects.toThrow(/empty/i);
  });
});

describe("deliverFde", () => {
  it("records the PR url, summary, and marks done", async () => {
    const update = vi.fn(async (_id: string, _d: Record<string, unknown>) => ({}));
    const pb = mockPb({ agent_tasks: { update } });
    await deliverFde(pb, "fde1", { pr_url: "https://github.com/o/n/pull/5", summary: "opened draft PR" });
    expect(update).toHaveBeenCalledWith("fde1", {
      status: "done",
      pr_url: "https://github.com/o/n/pull/5",
      result: "opened draft PR",
    });
  });
  it("requires a PR url", async () => {
    const pb = mockPb({ agent_tasks: { update: vi.fn() } });
    await expect(deliverFde(pb, "fde1", { pr_url: "", summary: "x" })).rejects.toThrow(/PR/i);
  });
});
