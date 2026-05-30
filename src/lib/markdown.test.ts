import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renders bold, italic, and inline code", () => {
    expect(renderMarkdown("**b** and *i* and `c`")).toBe(
      "<p><strong>b</strong> and <em>i</em> and <code>c</code></p>",
    );
  });

  it("renders headings and unordered lists", () => {
    expect(renderMarkdown("# Title")).toBe("<h1>Title</h1>");
    expect(renderMarkdown("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
  });

  it("renders ordered lists and fenced code blocks", () => {
    expect(renderMarkdown("1. one\n2. two")).toBe("<ol><li>one</li><li>two</li></ol>");
    expect(renderMarkdown("```js\nlet x = 1 < 2;\n```")).toBe(
      '<pre><code class="language-js">let x = 1 &lt; 2;</code></pre>',
    );
  });

  it("escapes raw HTML — no script injection survives", () => {
    const out = renderMarkdown("<img src=x onerror=alert(1)> hi");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("does not format markup inside inline code", () => {
    expect(renderMarkdown("`a*b*c`")).toBe("<p><code>a*b*c</code></p>");
  });

  it("renders safe links and rejects javascript: urls", () => {
    expect(renderMarkdown("[x](https://e.com)")).toContain(
      '<a href="https://e.com" target="_blank" rel="noreferrer noopener">x</a>',
    );
    const bad = renderMarkdown("[x](javascript:alert(1))");
    expect(bad).not.toContain("<a ");
    expect(bad).toContain("[x](javascript:alert(1))");
  });

  it("does not mistake plain numbers for code placeholders", () => {
    expect(renderMarkdown("step 5 done")).toBe("<p>step 5 done</p>");
  });

  it("renders nested lists by indentation", () => {
    expect(renderMarkdown("- a\n  - a1\n  - a2\n- b")).toBe(
      "<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul>",
    );
  });

  it("nests an ordered list under an unordered item", () => {
    expect(renderMarkdown("- top\n  1. one\n  2. two")).toBe(
      "<ul><li>top<ol><li>one</li><li>two</li></ol></li></ul>",
    );
  });

  it("renders GFM tables with column alignment", () => {
    expect(renderMarkdown("| A | B |\n|---|:-:|\n| 1 | 2 |")).toBe(
      '<table><thead><tr><th>A</th><th style="text-align:center">B</th></tr></thead>' +
        '<tbody><tr><td>1</td><td style="text-align:center">2</td></tr></tbody></table>',
    );
  });

  it("renders inline markup inside table cells", () => {
    const out = renderMarkdown("| H |\n|---|\n| **x** |");
    expect(out).toContain("<th>H</th>");
    expect(out).toContain("<td><strong>x</strong></td>");
  });

  it("treats a pipe line with no delimiter row as a paragraph", () => {
    expect(renderMarkdown("a | b | c")).toBe("<p>a | b | c</p>");
  });

  it("protects inline LaTeX math \\( ... \\) from markdown mangling", () => {
    expect(renderMarkdown("식: \\(P_t = P_r + G_r\\)")).toBe(
      '<p>식: <code class="hx-math">P_t = P_r + G_r</code></p>',
    );
    // underscores/asterisks inside math must NOT become <em>/<strong>
    const out = renderMarkdown("\\(a*b_c*d\\)");
    expect(out).toContain('<code class="hx-math">a*b_c*d</code>');
    expect(out).not.toContain("<em>");
    expect(out).not.toContain("<strong>");
  });

  it("renders block LaTeX math \\[ ... \\] and $$ ... $$ as protected blocks", () => {
    expect(renderMarkdown("\\[ E = mc^2 \\]")).toBe('<pre class="hx-math">E = mc^2</pre>');
    expect(renderMarkdown("$$a_b + c_d$$")).toBe('<pre class="hx-math">a_b + c_d</pre>');
  });
});
