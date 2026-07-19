import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import { buildTaskPrompt, claimTask, completeTask, deliverFde, isFdeTask, listTasks, normalizeRepo, parseTaskAnswer, pickOpenTask, postFdeTask, postTask } from "./board";
import type { AgentTask } from "./board";

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
  created_at: "2026-07-17T00:00:00Z",
  updated_at: "2026-07-17T00:00:00Z",
  ...over,
});

describe("pickOpenTask", () => {
  it("picks the oldest open task not requested by me", () => {
    const tasks = [
      task({ id: "mine", requester_id: "me" }),
      task({ id: "done1", status: "done" }),
      task({ id: "newer", created_at: "2026-07-17T02:00:00Z" }),
      task({ id: "oldest", created_at: "2026-07-16T00:00:00Z" }),
    ];
    expect(pickOpenTask(tasks, "me")?.id).toBe("oldest");
  });

  it("returns null when nothing is claimable", () => {
    expect(pickOpenTask([task({ status: "claimed" })], "me")).toBeNull();
    expect(pickOpenTask([task({ requester_id: "me" })], "me")).toBeNull();
  });

  it("never picks an expired task", () => {
    const now = new Date("2026-07-18T12:00:00Z");
    const tasks = [
      task({ id: "expired", deadline: "2026-07-18T11:00:00Z", created_at: "2026-07-16T00:00:00Z" }),
      task({ id: "live", deadline: "2026-07-18T13:00:00Z", created_at: "2026-07-17T00:00:00Z" }),
    ];
    expect(pickOpenTask(tasks, "me", undefined, now)?.id).toBe("live");
  });

  it("participates per category when the agent declares some", () => {
    const tasks = [
      task({ id: "code-old", category: "coding", created_at: "2026-07-16T00:00:00Z" }),
      task({ id: "res", category: "research", created_at: "2026-07-15T00:00:00Z" }),
      task({ id: "legacy", category: "", created_at: "2026-07-14T00:00:00Z" }),
    ];
    expect(pickOpenTask(tasks, "me", ["coding"])?.id).toBe("code-old");
    // pre-category rows count as "general"
    expect(pickOpenTask(tasks, "me", ["general"])?.id).toBe("legacy");
    expect(pickOpenTask(tasks, "me", ["writing"])).toBeNull();
    // no declared categories = work anything (oldest wins)
    expect(pickOpenTask(tasks, "me")?.id).toBe("legacy");
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
