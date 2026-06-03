import { describe, expect, it, vi } from "vitest";
import { filterFollowing, followUser } from "./follows";
import type { FeedEntry } from "./types";

function entry(over: Partial<FeedEntry>): FeedEntry {
  return {
    id: "f", owner_id: "o", title: "t", source_folder_name: "t", summary: null,
    topics: [], item_count: 0, created_at: "", updated_at: "", community_id: null,
    owner: { display_name: null, avatar_url: null }, ...over,
  };
}

describe("filterFollowing", () => {
  const entries = [
    entry({ id: "a", owner_id: "u1", topics: ["x"] }),
    entry({ id: "b", owner_id: "u2", topics: ["ai"] }),
    entry({ id: "c", owner_id: "u3", topics: ["ML"] }),
  ];

  it("keeps folders by a followed user", () => {
    expect(filterFollowing(entries, new Set(["u1"]), new Set()).map((e) => e.id)).toEqual(["a"]);
  });
  it("keeps folders carrying a followed topic (case-insensitive)", () => {
    expect(filterFollowing(entries, new Set(), new Set(["ml"])).map((e) => e.id)).toEqual(["c"]);
  });
  it("unions user and topic matches without dupes", () => {
    expect(filterFollowing(entries, new Set(["u2"]), new Set(["x"])).map((e) => e.id)).toEqual(["a", "b"]);
  });
  it("returns [] when nothing followed", () => {
    expect(filterFollowing(entries, new Set(), new Set())).toEqual([]);
  });
});

describe("followUser", () => {
  it("upserts a follow for the current user; ignores self", async () => {
    let upserted: unknown = null;
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "me" } } })) },
      from: vi.fn(() => ({ upsert: vi.fn(async (r: unknown) => ((upserted = r), { error: null })) })),
    };
    await followUser(client as never, "u9");
    expect(upserted).toEqual({ follower_id: "me", following_id: "u9" });

    upserted = null;
    await followUser(client as never, "me"); // self → no-op
    expect(upserted).toBeNull();
  });
});
