import { describe, expect, it } from "vitest";
import { highlightMentionsHtml, renderCommentHtml } from "./comment-html";

describe("highlightMentionsHtml", () => {
  it("wraps @tokens in mention spans", () => {
    expect(highlightMentionsHtml("<p>hi @민지 and @bob_1</p>")).toBe(
      '<p>hi <span class="mention">@민지</span> and <span class="mention">@bob_1</span></p>',
    );
  });

  it("leaves text without mentions untouched", () => {
    expect(highlightMentionsHtml("<p>no mentions here</p>")).toBe("<p>no mentions here</p>");
  });

  it("never rewrites inside tags", () => {
    const html = '<a href="mailto:a@b.com">mail</a>';
    expect(highlightMentionsHtml(html)).toBe(html);
  });

  it("skips code spans and fenced blocks", () => {
    const html = "<p><code>@notamention</code> but @real</p>";
    expect(highlightMentionsHtml(html)).toBe(
      '<p><code>@notamention</code> but <span class="mention">@real</span></p>',
    );
    const pre = "<pre><code>user = @conf</code></pre>";
    expect(highlightMentionsHtml(pre)).toBe(pre);
  });
});

describe("renderCommentHtml", () => {
  it("renders markdown blocks agents actually emit", () => {
    const html = renderCommentHtml("**bold** and `code`\n\n- one\n- two");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
  });

  it("keeps @mention highlighting inside rendered markdown", () => {
    expect(renderCommentHtml("thanks **@민지**!")).toContain(
      '<strong><span class="mention">@민지</span></strong>',
    );
  });

  it("stays XSS-safe (escape-first renderer)", () => {
    const html = renderCommentHtml('<img src=x onerror=alert(1)> @you');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain('<span class="mention">@you</span>');
  });

  it("handles empty input", () => {
    expect(renderCommentHtml("")).toBe("");
  });
});
