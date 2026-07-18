import { describe, expect, it } from "vitest";
import { buildActivity, unseenCount, type RawEngagement, type RawVote } from "./activity";

const r = (id: string, user_id: string, folder_id: string, created_at: string): RawEngagement => ({
  id,
  user_id,
  folder_id,
  created_at,
});

const ctx = (over = {}) => ({
  myId: "me",
  names: { a: "Ada", b: "Bo", c: "Cy" },
  titles: { f1: "AI", f2: "Net", f3: "Web" },
  commentFolder: { c9: "f3" },
  ...over,
});

describe("buildActivity", () => {
  it("merges replies + opinions + votes + mentions, newest first, resolved", () => {
    const items = buildActivity(
      {
        replies: [r("rep1", "a", "f1", "2026-01-01T01:00:00Z")],
        opinions: [r("op1", "b", "f2", "2026-01-01T03:00:00Z")],
        votes: [{ comment_id: "c9", user_id: "c", created_at: "2026-01-01T02:00:00Z" } as RawVote],
        mentions: [r("mn1", "a", "f1", "2026-01-01T04:00:00Z")],
      },
      ctx(),
    );
    expect(items.map((i) => i.type)).toEqual(["mention", "opinion", "vote", "reply"]); // by time desc
    expect(items[0]).toMatchObject({ type: "mention", actorName: "Ada", folderTitle: "AI" });
    const vote = items.find((i) => i.type === "vote")!;
    expect(vote).toMatchObject({ actorName: "Cy", folderId: "f3", folderTitle: "Web" });
  });

  it("drops my own engagements and falls back for unknown name/title", () => {
    const items = buildActivity(
      { replies: [r("mine", "me", "f1", "t"), r("x", "zzz", "f9", "t2")], opinions: [], votes: [], mentions: [] },
      ctx(),
    );
    expect(items.map((i) => i.id)).toEqual(["reply-x"]);
    expect(items[0].actorName).toBe("Someone");
    expect(items[0].folderTitle).toBe("a folder");
  });
});

describe("unseenCount", () => {
  const items = buildActivity(
    {
      replies: [r("a", "u", "f1", "2026-01-02T00:00:00Z"), r("b", "u", "f1", "2026-01-04T00:00:00Z")],
      opinions: [],
      votes: [],
      mentions: [],
    },
    ctx({ names: {} }),
  );
  it("counts items strictly newer than last-seen", () => {
    expect(unseenCount(items, "2026-01-03T00:00:00Z")).toBe(1);
  });
  it("treats null last-seen as all unseen", () => {
    expect(unseenCount(items, null)).toBe(2);
  });
});
