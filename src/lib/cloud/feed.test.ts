import { describe, expect, it, vi } from "vitest";
import { listFeed, myReactions, react, reactionCounts, reactionKey, unreact } from "./feed";

describe("listFeed", () => {
  it("maps joined rows to FeedEntry with a flattened owner", async () => {
    const rows = [
      {
        id: "f1",
        owner_id: "u1",
        title: "AI",
        source_folder_name: "AI",
        summary: "s",
        topics: ["ai"],
        item_count: 2,
        created_at: "t",
        updated_at: "t",
        profiles: { display_name: "Kim", avatar_url: "a.png" },
      },
    ];
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          order: vi.fn(() => ({ limit: vi.fn(async () => ({ data: rows, error: null })) })),
        })),
      })),
    };
    const feed = await listFeed(client as never);
    expect(feed[0]).toMatchObject({ id: "f1", owner: { display_name: "Kim", avatar_url: "a.png" } });
    expect((feed[0] as unknown as { profiles?: unknown }).profiles).toBeUndefined();
  });
});

describe("react / unreact", () => {
  it("react inserts a row for the current user", async () => {
    let inserted: unknown = null;
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
      from: vi.fn(() => ({
        insert: vi.fn(async (r: unknown) => {
          inserted = r;
          return { error: null };
        }),
      })),
    };
    await react(client as never, "f1", "like");
    expect(inserted).toEqual({ folder_id: "f1", user_id: "u1", kind: "like" });
  });

  it("unreact deletes the matching row scoped to user and kind", async () => {
    const eqs: [string, string][] = [];
    // Chainable + awaitable: each .eq() records and returns the same builder,
    // which resolves to { error: null } when finally awaited (like PostgREST).
    const chain: Record<string, unknown> = {
      eq: vi.fn((k: string, v: string) => {
        eqs.push([k, v]);
        return chain;
      }),
      then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
    };
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
      from: vi.fn(() => ({ delete: vi.fn(() => chain) })),
    };
    await unreact(client as never, "f1", "like");
    expect(eqs).toEqual([
      ["folder_id", "f1"],
      ["user_id", "u1"],
      ["kind", "like"],
    ]);
  });
});

describe("reactionCounts", () => {
  it("tallies likes and saves per folder", async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          in: vi.fn(async () => ({
            data: [
              { folder_id: "f1", kind: "like" },
              { folder_id: "f1", kind: "like" },
              { folder_id: "f1", kind: "save" },
              { folder_id: "f2", kind: "save" },
            ],
            error: null,
          })),
        })),
      })),
    };
    expect(await reactionCounts(client as never, ["f1", "f2"])).toEqual({
      f1: { like: 2, save: 1 },
      f2: { like: 0, save: 1 },
    });
  });

  it("short-circuits with no ids", async () => {
    const client = { from: vi.fn() };
    expect(await reactionCounts(client as never, [])).toEqual({});
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("myReactions", () => {
  it("returns folder:kind keys the user reacted with", async () => {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(async () => ({ data: [{ folder_id: "f1", kind: "like" }], error: null })),
          })),
        })),
      })),
    };
    const set = await myReactions(client as never, ["f1", "f2"]);
    expect(set.has(reactionKey("f1", "like"))).toBe(true);
    expect(set.has(reactionKey("f1", "save"))).toBe(false);
  });

  it("returns empty when signed out", async () => {
    const client = { auth: { getUser: vi.fn(async () => ({ data: { user: null } })) }, from: vi.fn() };
    expect((await myReactions(client as never, ["f1"])).size).toBe(0);
  });
});
