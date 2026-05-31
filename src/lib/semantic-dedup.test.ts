import { describe, expect, it } from "vitest";
import type { BookmarkNode } from "./bookmarks";
import { buildSemanticDedupPrompt, parseSemanticGroups } from "./semantic-dedup";

function bm(id: string, dateAdded: number): BookmarkNode {
  return { id, title: id, url: `https://x/${id}`, parentId: "1", parentTitle: "Bar", dateAdded, index: 0 };
}

describe("buildSemanticDedupPrompt", () => {
  it("builds a system+user pair carrying the items", () => {
    const { messages } = buildSemanticDedupPrompt([{ id: "a", title: "T", snippet: "S" }]);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain('"id":"a"');
  });
});

describe("parseSemanticGroups", () => {
  const nodes = [bm("a", 100), bm("b", 200), bm("c", 300), bm("folder", 0)];
  // folder has no url
  (nodes[3] as { url?: string }).url = undefined;

  it("keeps the oldest in each group and removes the rest", () => {
    const actions = parseSemanticGroups('{"groups":[["a","b","c"]]}', nodes);
    // oldest = a (100) kept; b, c removed
    expect(actions.map((x) => x.id).sort()).toEqual(["remove-b", "remove-c"]);
    expect(actions.every((x) => x.kind === "remove" && x.reason === "duplicate")).toBe(true);
  });

  it("ignores singletons, unknown ids, and url-less entries", () => {
    expect(parseSemanticGroups('{"groups":[["a"],["zzz","folder"]]}', nodes)).toEqual([]);
  });

  it("parses the {ids,reason} form and carries the reason as note", () => {
    const actions = parseSemanticGroups('{"groups":[{"ids":["a","b"],"reason":"AMP copy"}]}', nodes);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: "remove-b", note: "AMP copy" });
  });

  it("does not propose the same bookmark twice across overlapping groups", () => {
    const actions = parseSemanticGroups('{"groups":[["a","b"],["a","b"]]}', nodes);
    expect(actions.map((x) => x.id)).toEqual(["remove-b"]);
  });

  it("returns [] for missing groups / garbage", () => {
    expect(parseSemanticGroups('{"foo":1}', nodes)).toEqual([]);
    expect(parseSemanticGroups("not json", nodes)).toEqual([]);
  });
});
