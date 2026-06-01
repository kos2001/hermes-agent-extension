import { describe, expect, it } from "vitest";
import { feedStats, topicCounts, topicWeight } from "./feed-stats";
import type { FeedEntry } from "./types";

function entry(over: Partial<FeedEntry>): FeedEntry {
  return {
    id: "f",
    owner_id: "u1",
    title: "t",
    source_folder_name: "t",
    summary: null,
    topics: [],
    item_count: 0,
    created_at: "",
    updated_at: "",
    owner: { display_name: null, avatar_url: null },
    ...over,
  };
}

const entries: FeedEntry[] = [
  entry({ id: "a", owner_id: "u1", topics: ["ai", "ml"], item_count: 3 }),
  entry({ id: "b", owner_id: "u2", topics: ["ai", "AI", "web"], item_count: 5 }),
  entry({ id: "c", owner_id: "u1", topics: ["ml"], item_count: 2 }),
];

describe("topicCounts", () => {
  it("counts case-insensitively, sorted by count then alpha", () => {
    expect(topicCounts(entries)).toEqual([
      { topic: "ai", count: 2 },
      { topic: "ml", count: 2 },
      { topic: "web", count: 1 },
    ]);
  });

  it("returns [] for no entries", () => {
    expect(topicCounts([])).toEqual([]);
  });
});

describe("feedStats", () => {
  it("counts folders, distinct members, total items, distinct topics", () => {
    expect(feedStats(entries)).toEqual({ folders: 3, members: 2, items: 10, topics: 3 });
  });
});

describe("topicWeight", () => {
  it("buckets frequency into 1..5", () => {
    expect(topicWeight(1, 5)).toBe(1);
    expect(topicWeight(5, 5)).toBe(5);
    expect(topicWeight(3, 5)).toBe(3);
  });
  it("uses a mid weight when all counts are equal", () => {
    expect(topicWeight(1, 1)).toBe(3);
  });
});
