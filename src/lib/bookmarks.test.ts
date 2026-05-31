import { describe, expect, it } from "vitest";
import {
  type BookmarkNode,
  buildCategorizePrompt,
  buildCleanupPrompt,
  canonicalUrl,
  findDuplicates,
  isDeadStatus,
  listFolderChoices,
  parseCategorization,
  parseCleanupRemovals,
} from "./bookmarks";

describe("isDeadStatus", () => {
  it("flags only the canonical gone statuses", () => {
    expect(isDeadStatus(404)).toBe(true);
    expect(isDeadStatus(410)).toBe(true);
  });
  it("does not flag blocked/auth/server-error/ok statuses", () => {
    for (const s of [200, 301, 401, 403, 429, 500, 503]) expect(isDeadStatus(s)).toBe(false);
  });
});

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

  it("carries the per-item reason as note", () => {
    const actions = parseCleanupRemovals('{"remove":[{"id":"a","reason":"login page"}]}', nodes);
    expect(actions[0]).toMatchObject({ id: "remove-a", note: "login page" });
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

function folder(id: string, title: string, parentId?: string): BookmarkNode {
  return { id, title, url: undefined, parentId, parentTitle: "", dateAdded: 0, index: 0 };
}

describe("listFolderChoices", () => {
  it("lists folders with full paths and skips bookmarks", () => {
    const nodes = [
      folder("1", "Bookmarks bar"),
      folder("f1", "Tech", "1"),
      bm("a", "https://a.com/", 1, { parentId: "f1" }),
    ];
    expect(listFolderChoices(nodes)).toEqual([
      { id: "1", title: "Bookmarks bar", path: "Bookmarks bar" },
      { id: "f1", title: "Tech", path: "Bookmarks bar/Tech" },
    ]);
  });
});

describe("parseCategorization (into existing folders)", () => {
  const nodes = [
    folder("1", "Bookmarks bar"),
    folder("fNews", "News", "1"),
    folder("fDev", "Dev", "1"),
    bm("a", "https://a.com/", 1, { parentId: "1" }),
    bm("b", "https://b.com/", 2, { parentId: "fNews" }),
  ];

  it("assigns by existing folderId, targeting the real folder", () => {
    const text = '{"assignments":[{"id":"a","folderId":"fNews","reason":"news site"}]}';
    const actions = parseCategorization(text, nodes);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ id: "move-a", kind: "move", toFolderId: "fNews", toFolderPath: "Bookmarks bar/News", note: "news site" });
  });

  it("resolves a folder name/path to the existing folder (legacy map form)", () => {
    expect(parseCategorization('{"assignments":{"a":"News"}}', nodes)[0]).toMatchObject({ toFolderId: "fNews" });
  });

  it("drops assignments to non-existent folders (never invents)", () => {
    expect(parseCategorization('{"assignments":[{"id":"a","folder":"Recipes"}]}', nodes)).toEqual([]);
    expect(parseCategorization('{"assignments":[{"id":"a","folderId":"zzz"}]}', nodes)).toEqual([]);
  });

  it("skips a bookmark already in the target folder", () => {
    expect(parseCategorization('{"assignments":[{"id":"b","folderId":"fNews"}]}', nodes)).toEqual([]);
  });

  it("extracts JSON from a fenced block and returns [] for garbage", () => {
    expect(parseCategorization("```json\n{\"assignments\":[{\"id\":\"a\",\"folderId\":\"fDev\"}]}\n```", nodes)).toHaveLength(1);
    expect(parseCategorization("not json", nodes)).toEqual([]);
  });
});
