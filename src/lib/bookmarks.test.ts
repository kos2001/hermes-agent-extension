import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./bookmarks";

describe("normalizeUrl", () => {
  it("lowercases protocol and host but not the path", () => {
    expect(normalizeUrl("HTTPS://Example.COM/Path")).toBe("https://example.com/path");
  });

  it("drops the fragment", () => {
    expect(normalizeUrl("https://a.com/x#section")).toBe("https://a.com/x");
  });

  it("strips a trailing slash except on the root", () => {
    expect(normalizeUrl("https://a.com/x/")).toBe("https://a.com/x");
    expect(normalizeUrl("https://a.com/")).toBe("https://a.com/");
  });

  it("treats a lone '?' as no query", () => {
    expect(normalizeUrl("https://a.com/x?")).toBe("https://a.com/x");
  });

  it("falls back to a trimmed lowercase string for non-URLs", () => {
    expect(normalizeUrl("  Not A URL ")).toBe("not a url");
  });
});

import { findDuplicates } from "./bookmarks";

function bm(id: string, url: string | undefined, dateAdded: number, extra: Partial<import("./bookmarks").BookmarkNode> = {}) {
  return { id, title: id, url, dateAdded, index: 0, parentId: "1", parentTitle: "Bar", ...extra };
}

describe("findDuplicates", () => {
  it("keeps the oldest and removes the rest", () => {
    const nodes = [
      bm("a", "https://x.com/", 100),
      bm("b", "https://x.com", 200),
      bm("c", "https://x.com/#frag", 300),
    ];
    const actions = findDuplicates(nodes);
    expect(actions.map((a) => a.id).sort()).toEqual(["remove-b", "remove-c"]);
    expect(actions.every((a) => a.kind === "remove" && a.reason === "duplicate")).toBe(true);
  });

  it("ignores folders and unique URLs", () => {
    const nodes = [
      bm("folder", undefined, 1),
      bm("a", "https://x.com/", 100),
      bm("b", "https://y.com/", 200),
    ];
    expect(findDuplicates(nodes)).toEqual([]);
  });
});

import { planSort } from "./bookmarks";

describe("planSort", () => {
  it("emits a reorder action only for folders whose order changes", () => {
    const nodes = [
      bm("b", "https://b.com/", 200, { index: 0, parentId: "f1", parentTitle: "F1" }),
      bm("a", "https://a.com/", 100, { index: 1, parentId: "f1", parentTitle: "F1" }),
      bm("c", "https://c.com/", 300, { index: 0, parentId: "f2", parentTitle: "F2" }),
    ];
    const byName = planSort(nodes, "name");
    expect(byName).toHaveLength(1);
    expect(byName[0]).toMatchObject({ kind: "reorder", folderId: "f1", orderedIds: ["a", "b"], count: 2 });
  });

  it("sorts by date added", () => {
    const nodes = [
      bm("late", "https://l.com/", 999, { index: 0, parentId: "f1", parentTitle: "F1" }),
      bm("early", "https://e.com/", 1, { index: 1, parentId: "f1", parentTitle: "F1" }),
    ];
    const byDate = planSort(nodes, "date");
    expect(byDate[0].kind).toBe("reorder");
    expect((byDate[0] as { orderedIds: string[] }).orderedIds).toEqual(["early", "late"]);
  });

  it("returns nothing when already sorted", () => {
    const nodes = [
      bm("a", "https://a.com/", 100, { index: 0, parentId: "f1", parentTitle: "F1" }),
      bm("b", "https://b.com/", 200, { index: 1, parentId: "f1", parentTitle: "F1" }),
    ];
    expect(planSort(nodes, "name")).toEqual([]);
  });
});
