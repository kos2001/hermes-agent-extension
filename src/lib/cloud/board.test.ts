import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import { buildTaskPrompt, claimTask, completeTask, listTasks, parseTaskAnswer, pickOpenTask, postTask } from "./board";
import type { AgentTask } from "./board";

const task = (over: Partial<AgentTask>): AgentTask => ({
  id: "t1",
  requester_id: "u1",
  title: "Summarize X",
  body: "Please summarize X.",
  status: "open",
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
    const getList = vi.fn(async (_p: number, _l: number, opts: { sort: string; expand: string }) => {
      expect(opts).toMatchObject({ sort: "-created_at", expand: "requester_id" });
      return { items: [{ id: "t1", expand: { requester_id: { display_name: "Kim" } } }] };
    });
    const pb = mockPb({ agent_tasks: { getList } });
    const out = await listTasks(pb);
    expect(out[0]).toMatchObject({ id: "t1", requester: { display_name: "Kim" } });
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
      status: "open",
    });
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
