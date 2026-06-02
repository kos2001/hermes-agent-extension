import { describe, expect, it } from "vitest";
import { alreadyOpined, heartbeatAlarmSpec, pickHeartbeatCandidates } from "./heartbeat";
import type { Comment, FeedEntry } from "./types";

function feedEntry(over: Partial<FeedEntry>): FeedEntry {
  return {
    id: "f",
    owner_id: "other",
    title: "t",
    source_folder_name: "t",
    summary: null,
    topics: [],
    item_count: 0,
    created_at: "",
    updated_at: "",
    community_id: null,
    owner: { display_name: null, avatar_url: null },
    ...over,
  };
}

describe("heartbeatAlarmSpec", () => {
  it("maps frequencies to periods, off → null", () => {
    expect(heartbeatAlarmSpec("hourly")).toEqual({ periodInMinutes: 60 });
    expect(heartbeatAlarmSpec("daily")).toEqual({ periodInMinutes: 1440 });
    expect(heartbeatAlarmSpec("off")).toBeNull();
  });
});

describe("pickHeartbeatCandidates", () => {
  it("excludes the agent's own folders and caps the count", () => {
    const feed = [
      feedEntry({ id: "a", owner_id: "me" }),
      feedEntry({ id: "b", owner_id: "x" }),
      feedEntry({ id: "c", owner_id: "y" }),
      feedEntry({ id: "d", owner_id: "z" }),
    ];
    const picked = pickHeartbeatCandidates(feed, "me", 2);
    expect(picked.map((f) => f.id)).toEqual(["b", "c"]);
  });

  it("preserves feed order (newest-first from listFeed)", () => {
    const feed = [feedEntry({ id: "new", owner_id: "x" }), feedEntry({ id: "old", owner_id: "y" })];
    expect(pickHeartbeatCandidates(feed, "me").map((f) => f.id)).toEqual(["new", "old"]);
  });
});

describe("alreadyOpined", () => {
  const mk = (user_id: string): Comment => ({
    id: "c",
    folder_id: "f",
    user_id,
    author_kind: "agent",
    author_label: null,
    body: "x",
    created_at: "",
    parent_id: null,
  });

  it("is true when the user already commented (any kind)", () => {
    expect(alreadyOpined([mk("me")], "me")).toBe(true);
  });

  it("is false when only others commented", () => {
    expect(alreadyOpined([mk("other1"), mk("other2")], "me")).toBe(false);
  });

  it("is false on an empty thread", () => {
    expect(alreadyOpined([], "me")).toBe(false);
  });
});
