/**
 * Minimal, dependency-free, XSS-safe Markdown -> HTML renderer.
 *
 * Renders model responses in the side panel (React, via dangerouslySetInnerHTML)
 * and the selection toolbar (plain DOM, via innerHTML).
 *
 * Safety model: every piece of source text is HTML-escaped before any markup is
 * produced, so no raw HTML from the model can survive. We then re-introduce only
 * a fixed set of known tags (strong/em/code/pre/a/ul/ol/li/h1-6/blockquote/br/hr/p
 * /table/thead/tbody/tr/th/td). Link hrefs are scheme-validated.
 *
 * Supports the common subset LLMs emit -- headings, bold/italic, inline code,
 * fenced code blocks, ordered/unordered lists (incl. nesting), GFM tables,
 * blockquotes, links, horizontal rules, and paragraphs with soft line breaks.
 * Not a full CommonMark parser.
 */

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function safeUrl(raw: string): string | null {
  const u = raw.trim();
  if (/^(https?:\/\/|mailto:)/i.test(u)) return u;
  if (/^[/#]/.test(u)) return u; // relative / anchor
  return null;
}

// Code-span placeholder. Pure-ASCII sentinel that won't appear in real model
// output, isn't touched by escapeHtml, and isn't matched by the bold/italic/
// link passes -- so inline code is protected from further formatting.
const sentinel = (n: number): string => `@@HXC${n}@@`;
const RESTORE_RE = /@@HXC(\d+)@@/g;

/** Render inline spans (bold, italic, code, links) within already-block text. */
function inline(src: string): string {
  const codes: string[] = [];
  let s = src.replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(`<code>${escapeHtml(c)}</code>`);
    return sentinel(codes.length - 1);
  });

  // Protect inline LaTeX math \( ... \) so subscripts (_), operators (*, ^) and
  // backslashes inside it survive untouched by the markdown passes below.
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_m, x: string) => {
    codes.push(`<code class="hx-math">${escapeHtml(x.trim())}</code>`);
    return sentinel(codes.length - 1);
  });

  s = escapeHtml(s);

  s = s.replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^\n]+?)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_])_([^_\n]+?)_(?!_)/g, "$1<em>$2</em>");

  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    const safe = safeUrl(url);
    return safe
      ? `<a href="${safe}" target="_blank" rel="noreferrer noopener">${text}</a>`
      : `[${text}](${url})`;
  });

  return s.replace(RESTORE_RE, (_m, idx: string) => codes[Number(idx)] ?? "");
}

const isBlank = (l: string) => /^\s*$/.test(l);
const LIST_ITEM_RE = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
const TABLE_DELIM_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const BLOCK_STARTER =
  /^(\s*```|\s*(\\\[|\$\$)|#{1,6}\s+|\s*>\s?|\s*([-*+]|\d+\.)\s+|\s*([-*_])(\s*\4){2,}\s*$)/;

/** Split a markdown table row into trimmed cells (honouring escaped \| pipes). */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));
}

const ALIGN_STYLE: Record<string, string> = {
  center: ' style="text-align:center"',
  right: ' style="text-align:right"',
  left: ' style="text-align:left"',
};

function cellAlign(delimCell: string): string {
  const c = delimCell.trim();
  const left = c.startsWith(":");
  const right = c.endsWith(":");
  if (left && right) return ALIGN_STYLE.center;
  if (right) return ALIGN_STYLE.right;
  if (left) return ALIGN_STYLE.left;
  return "";
}

interface ListItem {
  indent: number;
  ordered: boolean;
  content: string;
}

/** Recursively build nested <ul>/<ol> from indent-tagged items. */
function buildList(items: ListItem[], start: number, indent: number): [string, number] {
  const tag = items[start].ordered ? "ol" : "ul";
  let html = `<${tag}>`;
  let i = start;
  while (i < items.length && items[i].indent >= indent) {
    if (items[i].indent > indent) break; // belongs to a shallower parent's child set
    let li = `<li>${inline(items[i].content)}`;
    const j = i + 1;
    if (j < items.length && items[j].indent > items[i].indent) {
      const [childHtml, next] = buildList(items, j, items[j].indent);
      li += childHtml;
      i = next;
    } else {
      i = j;
    }
    html += `${li}</li>`;
  }
  return [`${html}</${tag}>`, i];
}

export function renderMarkdown(src: string): string {
  const lines = (src || "").replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      i++;
      const buf: string[] = [];
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
      if (i < lines.length) i++; // closing fence
      const cls = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
      out.push(`<pre><code${cls}>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // Block LaTeX math: \[ ... \] or $$ ... $$ (single- or multi-line). Shown
    // as protected monospace — not typeset, but never mangled by markdown.
    const mblock = line.match(/^\s*(\\\[|\$\$)/);
    if (mblock) {
      const open = mblock[1];
      const closeTok = open === "$$" ? "$$" : "\\]";
      let segment = "";
      while (i < lines.length) {
        segment += (segment ? "\n" : "") + lines[i];
        i++;
        const openPos = segment.indexOf(open);
        if (segment.indexOf(closeTok, openPos + open.length) >= 0) break;
      }
      let inner = segment.slice(segment.indexOf(open) + open.length);
      const ci = inner.lastIndexOf(closeTok);
      if (ci >= 0) inner = inner.slice(0, ci);
      out.push(`<pre class="hx-math">${escapeHtml(inner.trim())}</pre>`);
      continue;
    }

    if (isBlank(line)) {
      i++;
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2].trim())}</h${h[1].length}>`);
      i++;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(`<blockquote>${inline(buf.join("\n")).replace(/\n/g, "<br>")}</blockquote>`);
      continue;
    }

    // GFM table: a header row followed by a |---|---| delimiter row.
    if (line.includes("|") && i + 1 < lines.length && TABLE_DELIM_RE.test(lines[i + 1])) {
      const headers = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map(cellAlign);
      i += 2;
      const head = headers
        .map((c, k) => `<th${aligns[k] ?? ""}>${inline(c)}</th>`)
        .join("");
      const bodyRows: string[] = [];
      while (i < lines.length && lines[i].includes("|") && !isBlank(lines[i])) {
        const cells = splitRow(lines[i]);
        const tds = headers
          .map((_h, k) => `<td${aligns[k] ?? ""}>${inline(cells[k] ?? "")}</td>`)
          .join("");
        bodyRows.push(`<tr>${tds}</tr>`);
        i++;
      }
      out.push(
        `<table><thead><tr>${head}</tr></thead><tbody>${bodyRows.join("")}</tbody></table>`,
      );
      continue;
    }

    // Lists (with nesting by indentation)
    if (LIST_ITEM_RE.test(line)) {
      const items: ListItem[] = [];
      let m: RegExpMatchArray | null;
      while (i < lines.length && (m = lines[i].match(LIST_ITEM_RE))) {
        items.push({
          indent: m[1].replace(/\t/g, "  ").length,
          ordered: /\d/.test(m[2]),
          content: m[3],
        });
        i++;
      }
      out.push(buildList(items, 0, items[0].indent)[0]);
      continue;
    }

    // Paragraph -- gather consecutive lines until a blank line or a new block.
    const buf: string[] = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !BLOCK_STARTER.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join("\n")).replace(/\n/g, "<br>")}</p>`);
  }

  return out.join("\n");
}
