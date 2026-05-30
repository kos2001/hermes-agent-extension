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
