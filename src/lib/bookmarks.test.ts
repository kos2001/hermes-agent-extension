import { describe, expect, it } from "vitest";
import {
  buildCategorizePrompt,
  buildCleanupPrompt,
  findDuplicates,
  normalizeUrl,
  parseCategorization,
  parseCleanupRemovals,
} from "./bookmarks";

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

describe("parseCleanupRemovals", () => {
  const nodes = [
    bm("a", "https://a.com/", 1),
    bm("b", "https://b.com/", 2),
    bm("folder", undefined, 3),
  ];

  it('parses {"remove":[ids]} into meaningless-remove actions', () => {
    const actions = parseCleanupRemovals('{"remove":["a","b"]}', nodes);
    expect(actions.map((a) => a.id)).toEqual(["remove-a", "remove-b"]);
    expect(actions.every((a) => a.kind === "remove" && a.reason === "meaningless")).toBe(true);
  });

  it("accepts object entries and dedupes, ignoring unknown/folder ids", () => {
    const actions = parseCleanupRemovals('{"remove":[{"id":"a"},{"id":"a"},"zzz","folder"]}', nodes);
    expect(actions.map((a) => a.id)).toEqual(["remove-a"]);
  });

  it("returns [] for non-array / garbage", () => {
    expect(parseCleanupRemovals('{"remove":"a"}', nodes)).toEqual([]);
    expect(parseCleanupRemovals("not json", nodes)).toEqual([]);
  });
});

describe("buildCleanupPrompt", () => {
  it("sends only bookmarks (capped) with system+user roles", () => {
    const nodes = [bm("a", "https://a.com/", 1), bm("folder", undefined, 2)];
    const { messages, sent, skipped } = buildCleanupPrompt(nodes);
    expect(sent).toBe(1);
    expect(skipped).toBe(0);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });
});

describe("buildCategorizePrompt", () => {
  it("sends only bookmarks, capped at 300, and reports the skipped count", () => {
    const nodes = Array.from({ length: 305 }, (_, i) => bm(`b${i}`, `https://s${i}.com/`, i));
    nodes.push(bm("folder", undefined, 1));
    const { messages, sent, skipped } = buildCategorizePrompt(nodes);
    expect(sent).toBe(300);
    expect(skipped).toBe(5);
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });
});

describe("parseCategorization", () => {
  const nodes = [
    bm("a", "https://a.com/", 1, { parentTitle: "Bar" }),
    bm("b", "https://b.com/", 2, { parentTitle: "News" }),
  ];

  it("parses an assignments object into move actions", () => {
    const text = '{"assignments": {"a": "News", "b": "News"}}';
    const actions = parseCategorization(text, nodes);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: "move-a", kind: "move", toFolderPath: "News" });
  });

  it("skips bookmarks already in the target folder", () => {
    // b.parentTitle === "News", so assigning it to "News" yields no action.
    expect(parseCategorization('{"assignments": {"b": "News"}}', nodes)).toEqual([]);
  });

  it("extracts JSON from a fenced code block", () => {
    const text = "Here you go:\n```json\n{\"assignments\":{\"a\":\"Dev\"}}\n```";
    expect(parseCategorization(text, nodes)).toHaveLength(1);
  });

  it("ignores unknown ids and returns [] for garbage", () => {
    expect(parseCategorization('{"assignments":{"zzz":"X"}}', nodes)).toEqual([]);
    expect(parseCategorization("not json at all", nodes)).toEqual([]);
  });
});
