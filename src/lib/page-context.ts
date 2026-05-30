/**
 * Capture the user's active tab as a text snapshot to feed into the LLM.
 *
 * Strategy: run a small extractor inside the page via chrome.scripting,
 * then return { url, title, text, selection }. The extractor prefers
 * <main>, <article>, role="main"; falls back to <body>; collapses
 * whitespace and strips <script>/<style>. Truncated to MAX_CHARS so we
 * don't blow the model's context.
 */

export interface PageContext {
  url: string;
  title: string;
  text: string;
  selection: string;
  truncated: boolean;
  error?: string;
}

export const MAX_CHARS = 30_000;

function extractInPage(maxChars: number): Omit<PageContext, "url" | "title"> {
  const selection = window.getSelection()?.toString() ?? "";

  const clone = (el: Element): string => {
    const c = el.cloneNode(true) as Element;
    c.querySelectorAll("script, style, noscript, template, svg, link, meta").forEach(
      (n) => n.remove(),
    );
    return (c.textContent ?? "").replace(/\s+/g, " ").trim();
  };

  const candidates: Element[] = [];
  const main = document.querySelector("main, [role=main], article");
  if (main) candidates.push(main);
  candidates.push(document.body);

  let raw = "";
  for (const el of candidates) {
    raw = clone(el);
    if (raw.length > 200) break;
  }

  const truncated = raw.length > maxChars;
  const text = truncated ? raw.slice(0, maxChars) + "…[truncated]" : raw;

  return { text, selection, truncated };
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  // Side panel runs in its own window context, so we explicitly query the
  // current window rather than `lastFocusedWindow` (which can desync when
  // the side panel itself takes focus).
  let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tabs.length === 0) {
    tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  }
  return tabs[0] ?? null;
}

const empty = (
  url: string,
  title: string,
  error: string,
): PageContext => ({ url, title, text: "", selection: "", truncated: false, error });

export async function capturePageContext(): Promise<PageContext> {
  const tab = await getActiveTab();
  if (!tab || tab.id === undefined) {
    return empty("", "", "No active tab");
  }

  const url = tab.url ?? "";
  const title = tab.title ?? "";
  if (/^(chrome|chrome-extension|edge|about|devtools|view-source):/i.test(url)) {
    return empty(url, title, "Cannot read browser/extension pages");
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: false },
      func: extractInPage,
      args: [MAX_CHARS],
    });
    const out = results[0]?.result;
    if (!out) return empty(url, title, "Empty extraction result");
    return { url, title, ...out };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return empty(url, title, msg);
  }
}

/** Request optional <all_urls> so we can read any tab without activeTab gestures. */
export async function requestAllSitesAccess(): Promise<boolean> {
  return chrome.permissions.request({
    origins: ["http://*/*", "https://*/*"],
  });
}

export async function hasAllSitesAccess(): Promise<boolean> {
  return chrome.permissions.contains({
    origins: ["http://*/*", "https://*/*"],
  });
}

/** Format a captured PageContext as a system-message body. */
export function formatContextForPrompt(ctx: PageContext): string {
  const parts = [
    "The user is asking about the following web page. Use this as primary context.",
    `URL: ${ctx.url}`,
    `Title: ${ctx.title}`,
  ];
  if (ctx.selection.trim()) {
    parts.push("", "User's selected text:", ctx.selection.trim());
  }
  parts.push("", "Page content:", ctx.text || "(empty)");
  if (ctx.truncated) parts.push("", "(Page content was truncated.)");
  return parts.join("\n");
}
