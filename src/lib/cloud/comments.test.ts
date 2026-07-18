import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import { commentCounts, listComments, postComment, threadComments } from "./comments";
import type { Comment } from "./types";

describe("listComments", () => {
  it("flattens the expanded poster into `author`", async () => {
    const rows = [
      {
        id: "c1",
        folder_id: "f1",
        user_id: "u1",
        author_kind: "agent",
        author_label: "gpt",
        body: "neat",
        created_at: "t",
        parent_id: "",
        expand: { user_id: { display_name: "Kim", avatar_url: null } },
      },
    ];
    const getFullList = vi.fn(async (opts: { filter: string; sort: string; expand: string }) => {
      expect(opts).toMatchObject({ filter: "folder_id = 'f1'", sort: "created_at", expand: "user_id" });
      return rows;
    });
    const pb = mockPb({ comments: { getFullList } });
    const out = await listComments(pb, "f1");
    expect(out[0]).toMatchObject({ id: "c1", author_kind: "agent", author: { display_name: "Kim" } });
    expect(out[0].parent_id).toBeNull(); // empty relation normalized
    expect((out[0] as unknown as { expand?: unknown }).expand).toBeUndefined();
  });
});

describe("postComment", () => {
  it("creates with the current user, kind and label; returns the id", async () => {
    const create = vi.fn(async (_d: Record<string, unknown>) => ({ id: "c-new" }));
    const pb = mockPb({ comments: { create } });
    const id = await postComment(pb, "f1", { body: "  hi  ", kind: "agent", label: "gpt-x" });
    expect(id).toBe("c-new");
    expect(create).toHaveBeenCalledWith({
      folder_id: "f1",
      user_id: "u1",
      author_kind: "agent",
      author_label: "gpt-x",
      body: "hi",
      parent_id: null,
      is_question: false,
    });
  });

  it("sets parent_id when replying", async () => {
    const create = vi.fn(async (_d: Record<string, unknown>) => ({ id: "c-new" }));
    const pb = mockPb({ comments: { create } });
    await postComment(pb, "f1", { body: "reply", parentId: "c-parent" });
    expect(create.mock.calls[0][0]).toMatchObject({ parent_id: "c-parent" });
  });

  it("defaults to a human comment", async () => {
    const create = vi.fn(async (_d: Record<string, unknown>) => ({ id: "c-new" }));
    const pb = mockPb({ comments: { create } });
    await postComment(pb, "f1", { body: "hello" });
    expect(create.mock.calls[0][0]).toMatchObject({ author_kind: "human", author_label: null });
  });

  it("rejects an empty body", async () => {
    const pb = mockPb({});
    await expect(postComment(pb, "f1", { body: "   " })).rejects.toThrow(/empty/i);
  });

  it("requires a signed-in user", async () => {
    const pb = mockPb({}, null);
    await expect(postComment(pb, "f1", { body: "hi" })).rejects.toThrow(/signed in/i);
  });
});

describe("commentCounts", () => {
  it("tallies comments per folder id", async () => {
    const getFullList = vi.fn(async () => [{ folder_id: "a" }, { folder_id: "a" }, { folder_id: "b" }]);
    const pb = mockPb({ comments: { getFullList } });
    expect(await commentCounts(pb, ["a", "b"])).toEqual({ a: 2, b: 1 });
  });

  it("short-circuits on no ids", async () => {
    const pb = mockPb({});
    expect(await commentCounts(pb, [])).toEqual({});
  });
});

describe("threadComments", () => {
  const mk = (id: string, parent_id: string | null): Comment => ({
    id,
    folder_id: "f",
    user_id: "u",
    author_kind: "human",
    author_label: null,
    body: id,
    created_at: "",
    parent_id,
  });

  it("nests replies under their top-level opinion, preserving order", () => {
    const threads = threadComments([mk("a", null), mk("b", null), mk("a1", "a"), mk("a2", "a")]);
    expect(threads.map((t) => t.id)).toEqual(["a", "b"]);
    expect(threads[0].replies.map((r) => r.id)).toEqual(["a1", "a2"]);
    expect(threads[1].replies).toEqual([]);
  });

  it("promotes a reply whose parent is missing to top level", () => {
    const threads = threadComments([mk("orphan", "gone")]);
    expect(threads.map((t) => t.id)).toEqual(["orphan"]);
  });
});
