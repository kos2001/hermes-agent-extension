import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import { listFeed, myReactions, react, reactionCounts, reactionKey, unreact } from "./feed";

describe("listFeed", () => {
  it("maps expanded rows to FeedEntry with a flattened owner", async () => {
    const items = [
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
        expand: { owner_id: { display_name: "Kim", avatar_url: "a.png" } },
      },
    ];
    const getList = vi.fn(async (_page: number, _limit: number, opts: Record<string, unknown>) => {
      expect(opts).toMatchObject({ sort: "-updated_at", expand: "owner_id" });
      return { items };
    });
    const pb = mockPb({ shared_folders: { getList } });
    const feed = await listFeed(pb);
    expect(feed[0]).toMatchObject({ id: "f1", owner: { display_name: "Kim", avatar_url: "a.png" } });
    expect((feed[0] as unknown as { expand?: unknown }).expand).toBeUndefined();
  });

  it("scopes to a community when given", async () => {
    const getList = vi.fn(async (_p: number, _l: number, opts: { filter?: string }) => {
      expect(opts.filter).toBe("community_id = 'c9'");
      return { items: [] };
    });
    const pb = mockPb({ shared_folders: { getList } });
    await listFeed(pb, 10, "c9");
  });
});

describe("react / unreact", () => {
  it("react creates a row for the current user", async () => {
    const create = vi.fn(async (r: unknown) => r);
    const pb = mockPb({ reactions: { create } });
    await react(pb, "f1", "like");
    expect(create).toHaveBeenCalledWith({ folder_id: "f1", user_id: "u1", kind: "like" });
  });

  it("unreact deletes the matching row scoped to user and kind", async () => {
    const getFullList = vi.fn(async (opts: { filter: string }) => {
      expect(opts.filter).toBe("folder_id = 'f1' && user_id = 'u1' && kind = 'like'");
      return [{ id: "r1" }];
    });
    const del = vi.fn(async () => true);
    const pb = mockPb({ reactions: { getFullList, delete: del } });
    await unreact(pb, "f1", "like");
    expect(del).toHaveBeenCalledWith("r1");
  });
});

describe("reactionCounts", () => {
  it("tallies likes and saves per folder", async () => {
    const getFullList = vi.fn(async () => [
      { folder_id: "f1", kind: "like" },
      { folder_id: "f1", kind: "like" },
      { folder_id: "f1", kind: "save" },
      { folder_id: "f2", kind: "save" },
    ]);
    const pb = mockPb({ reactions: { getFullList } });
    expect(await reactionCounts(pb, ["f1", "f2"])).toEqual({
      f1: { like: 2, save: 1 },
      f2: { like: 0, save: 1 },
    });
  });

  it("short-circuits with no ids", async () => {
    const pb = mockPb({});
    expect(await reactionCounts(pb, [])).toEqual({});
  });
});

describe("myReactions", () => {
  it("returns folder:kind keys the user reacted with", async () => {
    const getFullList = vi.fn(async (opts: { filter: string }) => {
      expect(opts.filter).toContain("user_id = 'u1'");
      return [{ folder_id: "f1", kind: "like" }];
    });
    const pb = mockPb({ reactions: { getFullList } });
    const set = await myReactions(pb, ["f1", "f2"]);
    expect(set.has(reactionKey("f1", "like"))).toBe(true);
    expect(set.has(reactionKey("f1", "save"))).toBe(false);
  });

  it("returns empty when signed out", async () => {
    const pb = mockPb({}, null);
    expect((await myReactions(pb, ["f1"])).size).toBe(0);
  });
});
