import { describe, expect, it, vi } from "vitest";
import { commentCounts, listComments, postComment, threadComments } from "./comments";
import type { Comment } from "./types";

describe("listComments", () => {
  it("flattens the joined poster into `author`", async () => {
    const rows = [
      {
        id: "c1",
        folder_id: "f1",
        user_id: "u1",
        author_kind: "agent",
        author_label: "gpt",
        body: "neat",
        created_at: "t",
        profiles: { display_name: "Kim", avatar_url: null },
      },
    ];
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ order: vi.fn(async () => ({ data: rows, error: null })) })),
        })),
      })),
    };
    const out = await listComments(client as never, "f1");
    expect(out[0]).toMatchObject({ id: "c1", author_kind: "agent", author: { display_name: "Kim" } });
    expect((out[0] as unknown as { profiles?: unknown }).profiles).toBeUndefined();
  });
});

describe("postComment", () => {
  it("inserts with the current user, kind and label", async () => {
    let inserted: unknown = null;
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
      from: vi.fn(() => ({
        insert: vi.fn((r: unknown) => {
          inserted = r;
          return { select: () => ({ single: async () => ({ data: { id: "c-new" }, error: null }) }) };
        }),
      })),
    };
    const id = await postComment(client as never, "f1", { body: "  hi  ", kind: "agent", label: "gpt-x" });
    expect(id).toBe("c-new");
    expect(inserted).toEqual({
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
    let inserted: { parent_id?: unknown } = {};
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
      from: vi.fn(() => ({
        insert: vi.fn((r: typeof inserted) => ((inserted = r), { select: () => ({ single: async () => ({ data: { id: "c-new" }, error: null }) }) })),
      })),
    };
    await postComment(client as never, "f1", { body: "reply", parentId: "c-parent" });
    expect(inserted.parent_id).toBe("c-parent");
  });

  it("defaults to a human comment", async () => {
    let inserted: { author_kind?: string; author_label?: unknown } = {};
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
      from: vi.fn(() => ({
        insert: vi.fn((r: typeof inserted) => ((inserted = r), { select: () => ({ single: async () => ({ data: { id: "c-new" }, error: null }) }) })),
      })),
    };
    await postComment(client as never, "f1", { body: "hello" });
    expect(inserted.author_kind).toBe("human");
    expect(inserted.author_label).toBeNull();
  });

  it("rejects an empty body", async () => {
    const client = { auth: { getUser: vi.fn() }, from: vi.fn() };
    await expect(postComment(client as never, "f1", { body: "   " })).rejects.toThrow(/empty/i);
  });

  it("requires a signed-in user", async () => {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: null } })) },
      from: vi.fn(),
    };
    await expect(postComment(client as never, "f1", { body: "hi" })).rejects.toThrow(/signed in/i);
  });
});

describe("commentCounts", () => {
  it("tallies comments per folder id", async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          in: vi.fn(async () => ({
            data: [{ folder_id: "a" }, { folder_id: "a" }, { folder_id: "b" }],
            error: null,
          })),
        })),
      })),
    };
    expect(await commentCounts(client as never, ["a", "b"])).toEqual({ a: 2, b: 1 });
  });

  it("short-circuits on no ids", async () => {
    const client = { from: vi.fn() };
    expect(await commentCounts(client as never, [])).toEqual({});
    expect(client.from).not.toHaveBeenCalled();
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
