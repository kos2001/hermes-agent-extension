import { describe, expect, it } from "vitest";
import { buildActivity, unseenCount, type RawEngagement } from "./activity";

const r = (id: string, user_id: string, folder_id: string, created_at: string): RawEngagement => ({
  id,
  user_id,
  folder_id,
  created_at,
});

describe("buildActivity", () => {
  it("merges replies + opinions, newest first, with actor + title resolved", () => {
    const items = buildActivity(
      [r("rep1", "a", "f1", "2026-01-01T01:00:00Z")],
      [r("op1", "b", "f2", "2026-01-01T03:00:00Z")],
      "me",
      { a: "Ada", b: "Bo" },
      { f1: "AI", f2: "Net" },
    );
    expect(items.map((i) => i.id)).toEqual(["op1", "rep1"]); // op1 newer
    expect(items[0]).toMatchObject({ type: "opinion", actorName: "Bo", folderTitle: "Net" });
    expect(items[1]).toMatchObject({ type: "reply", actorName: "Ada", folderTitle: "AI" });
  });

  it("drops my own engagements and falls back for unknown names/titles", () => {
    const items = buildActivity(
      [r("mine", "me", "f1", "t"), r("x", "other", "f9", "t2")],
      [],
      "me",
      {},
      {},
    );
    expect(items.map((i) => i.id)).toEqual(["x"]);
    expect(items[0].actorName).toBe("Someone");
    expect(items[0].folderTitle).toBe("a folder");
  });
});

describe("unseenCount", () => {
  const items = buildActivity(
    [r("a", "u", "f", "2026-01-02T00:00:00Z"), r("b", "u", "f", "2026-01-04T00:00:00Z")],
    [],
    "me",
    {},
    {},
  );
  it("counts items strictly newer than last-seen", () => {
    expect(unseenCount(items, "2026-01-03T00:00:00Z")).toBe(1);
  });
  it("treats null last-seen as all unseen", () => {
    expect(unseenCount(items, null)).toBe(2);
  });
});
