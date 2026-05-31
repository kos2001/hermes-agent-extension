import { describe, expect, it } from "vitest";
import {
  buildCategorizePrompt,
  buildCleanupPrompt,
  canonicalUrl,
  findDuplicates,
  parseCategorization,
  parseCleanupRemovals,
} from "./bookmarks";

describe("canonicalUrl", () => {
  it("lowercases, drops the fragment, and is scheme-agnostic", () => {
    expect(canonicalUrl("HTTPS://Example.COM/Path")).toBe("example.com/path");
    expect(canonicalUrl("http://a.com/x")).toBe(canonicalUrl("https://a.com/x"));
  });

  it("strips a www. prefix", () => {
    expect(canonicalUrl("https://www.a.com/x")).toBe("a.com/x");
  });

  it("strips a trailing slash except on the root", () => {
    expect(canonicalUrl("https://a.com/x/")).toBe("a.com/x");
    expect(canonicalUrl("https://a.com/")).toBe("a.com/");
  });

  it("collapses default documents", () => {
    expect(canonicalUrl("https://a.com/index.html")).toBe("a.com/");
    expect(canonicalUrl("https://a.com/sub/index.php")).toBe("a.com/sub");
  });

  it("removes tracking params and sorts the rest", () => {
    expect(canonicalUrl("https://a.com/x?utm_source=t&id=5&fbclid=z")).toBe("a.com/x?id=5");
    expect(canonicalUrl("https://a.com/x?b=2&a=1")).toBe("a.com/x?a=1&b=2");
    expect(canonicalUrl("https://a.com/x?utm_campaign=c")).toBe("a.com/x");
  });

  it("treats a lone '?' as no query", () => {
    expect(canonicalUrl("https://a.com/x?")).toBe("a.com/x");
  });

  it("falls back to a trimmed lowercase string for non-URLs", () => {
    expect(canonicalUrl("  Not A URL ")).toBe("not a url");
  });
});

describe("findDuplicates — semantic", () => {
  it("folds www/scheme/tracking-param/param-order variants of the same page", () => {
    const nodes = [
      bm("keep", "https://a.com/p?x=1", 100),
      bm("www", "http://www.a.com/p?x=1", 200),
      bm("utm", "https://a.com/p?x=1&utm_source=news", 300),
    ];
    const actions = findDuplicates(nodes);
    expect(actions.map((a) => a.id).sort()).toEqual(["remove-utm", "remove-www"]);
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
