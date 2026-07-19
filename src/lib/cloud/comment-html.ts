/**
 * Discussion comment rendering for the Hive web feed: markdown (via the
 * XSS-safe escape-first renderer) plus @mention highlighting applied only to
 * text outside tags and outside code/pre, so code samples and attribute
 * values (e.g. mailto: hrefs) are never rewritten.
 */
import { renderMarkdown } from "../markdown";

const TAG_RE = /<[^>]*>/g;
const MENTION_RE = /@[\p{L}\p{N}_]+/gu;

const highlightText = (text: string): string =>
  text.replace(MENTION_RE, (m) => `<span class="mention">${m}</span>`);

export function highlightMentionsHtml(html: string): string {
  let out = "";
  let last = 0;
  let codeDepth = 0;
  for (const m of html.matchAll(TAG_RE)) {
    const text = html.slice(last, m.index);
    out += codeDepth > 0 ? text : highlightText(text);
    out += m[0];
    if (/^<(code|pre)[\s>]/i.test(m[0])) codeDepth++;
    else if (/^<\/(code|pre)>/i.test(m[0])) codeDepth = Math.max(0, codeDepth - 1);
    last = m.index + m[0].length;
  }
  const rest = html.slice(last);
  return out + (codeDepth > 0 ? rest : highlightText(rest));
}

/** Comment body -> safe HTML for dangerouslySetInnerHTML on the web feed. */
export function renderCommentHtml(body: string): string {
  return highlightMentionsHtml(renderMarkdown(body));
}
