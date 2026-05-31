import { describe, expect, it } from "vitest";
import type { BookmarkNode } from "./bookmarks";
import {
  alarmSpec,
  bookmarksInFolder,
  htmlToText,
  joinDownloadPath,
  listFolders,
  type MarketReport,
  nextFireTime,
  reportFilename,
  reportToMarkdown,
  sanitizePathSegment,
} from "./market-report";

function node(id: string, title: string, url: string | undefined, parentId?: string): BookmarkNode {
  return { id, title, url, parentId, parentTitle: "", dateAdded: 0, index: 0 };
}

describe("htmlToText", () => {
  it("strips scripts, styles, tags and collapses whitespace", () => {
    const html = "<html><head><style>.x{color:red}</style></head><body><script>bad()</script><h1>Hi</h1>\n<p>World&amp;co</p></body></html>";
    expect(htmlToText(html)).toBe("Hi World&co");
  });
  it("strips comments and decodes common entities", () => {
    expect(htmlToText("<!-- c --><p>a&nbsp;b&lt;c&gt;</p>")).toBe("a b<c>");
  });
});

describe("listFolders", () => {
  it("lists folders that directly contain bookmarks, titled and sorted", () => {
    const nodes = [
      node("f2", "Zeta", undefined),
      node("f1", "Alpha", undefined),
      node("b1", "B1", "https://a.com/", "f1"),
      node("b2", "B2", "https://b.com/", "f2"),
      node("b3", "B3", "https://c.com/", "f1"),
    ];
    expect(listFolders(nodes)).toEqual([
      { id: "f1", title: "Alpha" },
      { id: "f2", title: "Zeta" },
    ]);
  });
  it("omits folders with no direct bookmarks", () => {
    const nodes = [node("f1", "Empty", undefined), node("sub", "Sub", undefined, "f1")];
    expect(listFolders(nodes)).toEqual([]);
  });
});

describe("bookmarksInFolder", () => {
  it("returns only direct url-bearing children of the folder", () => {
    const nodes = [
      node("b1", "B1", "https://a.com/", "f1"),
      node("sub", "Sub", undefined, "f1"),
      node("b2", "B2", "https://b.com/", "f2"),
    ];
    expect(bookmarksInFolder(nodes, "f1").map((n) => n.id)).toEqual(["b1"]);
  });
});

describe("alarmSpec", () => {
  it("maps frequencies to alarm periods", () => {
    expect(alarmSpec("off")).toBeNull();
    expect(alarmSpec("daily")).toEqual({ periodInMinutes: 1440 });
    expect(alarmSpec("weekly")).toEqual({ periodInMinutes: 10080 });
  });
});

describe("nextFireTime", () => {
  it("returns today at the given hour when that is still in the future", () => {
    const now = new Date(2026, 0, 1, 8, 0, 0).getTime();
    expect(nextFireTime(now, 9)).toBe(new Date(2026, 0, 1, 9, 0, 0).getTime());
  });
  it("rolls to tomorrow when the hour already passed", () => {
    const now = new Date(2026, 0, 1, 10, 0, 0).getTime();
    expect(nextFireTime(now, 9)).toBe(new Date(2026, 0, 2, 9, 0, 0).getTime());
  });
});

const sampleReport: MarketReport = {
  id: "r1",
  folderId: "f1",
  folderTitle: "News",
  createdAt: Date.UTC(2026, 4, 31),
  sites: [
    { url: "https://a.com/", title: "Alpha", summary: "- up 10%" },
    { url: "https://b.com/", title: "Beta", summary: "", error: "No readable content" },
  ],
  synthesis: "## Summary\nMarkets rose.",
  skipped: 2,
};

describe("reportToMarkdown", () => {
  it("includes the title, synthesis, per-site summaries, errors and skipped note", () => {
    const md = reportToMarkdown(sampleReport);
    expect(md).toContain("# News — Market report");
    expect(md).toContain("Markets rose.");
    expect(md).toContain("### Alpha");
    expect(md).toContain("- up 10%");
    expect(md).toContain("> ⚠ No readable content");
    expect(md).toContain("2 site(s) skipped");
  });
});

describe("sanitizePathSegment", () => {
  it("replaces filesystem-illegal characters and collapses dashes", () => {
    expect(sanitizePathSegment('a/b:c*?"<>|d')).toBe("a-b-c-d");
    expect(sanitizePathSegment("  spaced  out  ")).toBe("spaced-out");
  });
  it("returns empty for all-illegal input and preserves unicode", () => {
    expect(sanitizePathSegment("///")).toBe("");
    expect(sanitizePathSegment("뉴스")).toBe("뉴스");
  });
});

describe("reportFilename", () => {
  it("builds market-report-<slug>-<date>.md from createdAt", () => {
    expect(reportFilename(sampleReport)).toBe("market-report-News-2026-05-31.md");
  });
  it("falls back to 'report' when the title sanitizes to empty", () => {
    expect(reportFilename({ ...sampleReport, folderTitle: "///" })).toBe("market-report-report-2026-05-31.md");
  });
});

describe("joinDownloadPath", () => {
  it("joins a sanitized subfolder with the filename", () => {
    expect(joinDownloadPath("market-reports", "f.md")).toBe("market-reports/f.md");
    expect(joinDownloadPath("a/b", "f.md")).toBe("a/b/f.md");
  });
  it("returns just the filename for an empty folder", () => {
    expect(joinDownloadPath("", "f.md")).toBe("f.md");
  });
  it("drops path-traversal segments", () => {
    expect(joinDownloadPath("../../etc", "f.md")).toBe("etc/f.md");
  });
});
