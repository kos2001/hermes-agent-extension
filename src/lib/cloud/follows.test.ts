import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
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
  it("creates a follow for the current user; ignores self", async () => {
    const create = vi.fn(async (r: unknown) => r);
    const pb = mockPb({ user_follows: { create } }, "me");
    await followUser(pb, "u9");
    expect(create).toHaveBeenCalledWith({ follower_id: "me", following_id: "u9" });

    create.mockClear();
    await followUser(pb, "me"); // self → no-op
    expect(create).not.toHaveBeenCalled();
  });
});
