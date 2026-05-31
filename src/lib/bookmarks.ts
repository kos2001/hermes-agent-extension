import type { ChatMessage } from "./types";

/** A flattened bookmark or folder from `chrome.bookmarks.getTree()`. */
export interface BookmarkNode {
  id: string;
  title: string;
  /** Present for bookmarks, absent for folders. */
  url?: string;
  parentId?: string;
  /** Title of the containing folder (for display + "already there" checks). */
  parentTitle?: string;
  dateAdded: number;
  index: number;
}

/**
 * A proposed change, rendered in the preview and consumed by `applyActions`.
 * `id` is derived from the Chrome bookmark id (`remove-<id>`, `move-<id>`);
 * Chrome ids are numeric strings, so these prefixes never collide with the id.
 */
export type RemoveReason = "duplicate" | "dead" | "meaningless";

export type Action =
  | { id: string; kind: "remove"; bmId: string; title: string; url: string; reason: RemoveReason }
  | { id: string; kind: "move"; bmId: string; title: string; url: string; toFolderPath: string };

/** Query params that only track/attribute and never change the destination. */
const TRACKING_PARAMS = new Set([
  "gclid", "fbclid", "msclkid", "yclid", "dclid", "gclsrc", "gbraid", "wbraid",
  "mc_eid", "mc_cid", "igshid", "igsh", "ref", "ref_src", "ref_url", "referrer",
  "source", "spm", "scm", "vero_id", "vero_conv", "_hsenc", "_hsmi", "_openstat",
  "oly_anon_id", "oly_enc_id", "cmpid", "ncid", "sr_share", "s_kwcid",
]);

/**
 * Canonical form of a URL for *semantic* duplicate detection. Beyond basic
 * normalization it folds together URLs that point at the same resource:
 *
 * - scheme-agnostic (http ≡ https) and `www.` stripped from the host
 * - fragment removed; trailing slash removed (except root)
 * - default documents (`/index.html`, `/default.aspx`, …) collapsed to `/`
 * - tracking/attribution params (utm_*, gclid, fbclid, ref, …) removed
 * - remaining query params sorted, so param ORDER no longer matters
 * - lowercased throughout
 *
 * Non-URLs fall back to a trimmed lowercase string.
 */
export function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    const isWeb = u.protocol === "http:" || u.protocol === "https:";
    const scheme = isWeb ? "" : `${u.protocol}//`;
    const host = u.host.toLowerCase().replace(/^www\./, "");
    let path = u.pathname.replace(/\/(?:index|default|home)\.(?:html?|php|aspx?|jsp)$/i, "/");
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAMS.has(k.toLowerCase()) && !/^utm_/i.test(k))
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const search = params.length ? "?" + params.map(([k, v]) => `${k}=${v}`).join("&") : "";
    return `${scheme}${host}${path}${search}`.toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

/**
 * Group by canonical URL (semantic duplicates: www/scheme/tracking-param/
 * param-order variants collapse together); keep the oldest, propose removing
 * the rest.
 */
export function findDuplicates(nodes: BookmarkNode[]): Action[] {
  const groups = new Map<string, BookmarkNode[]>();
  for (const n of nodes) {
    if (!n.url) continue;
    const key = canonicalUrl(n.url);
    const arr = groups.get(key);
    if (arr) arr.push(n);
    else groups.set(key, [n]);
  }
  const actions: Action[] = [];
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    // Tie-break on id so the kept bookmark is deterministic when timestamps match.
    const oldestFirst = [...arr].sort((a, b) => a.dateAdded - b.dateAdded || a.id.localeCompare(b.id));
    for (const dup of oldestFirst.slice(1)) {
      actions.push({
        id: `remove-${dup.id}`,
        kind: "remove",
        bmId: dup.id,
        title: dup.title,
        url: dup.url as string,
        reason: "duplicate",
      });
    }
  }
  return actions;
}

/** Max bookmarks sent to the model per categorize request (token bound). */
export const MAX_CATEGORIZE = 300;

/** Build the LLM request for categorization. Returns the sent/skipped counts. */
export function buildCategorizePrompt(
  nodes: BookmarkNode[],
): { messages: ChatMessage[]; sent: number; skipped: number } {
  const all = nodes.filter((n) => n.url);
  const picked = all.slice(0, MAX_CATEGORIZE);
  const list = picked.map((n) => ({ id: n.id, title: n.title, url: n.url }));
  const system =
    "You organize browser bookmarks into topic folders. Given a JSON array of " +
    'bookmarks ({id, title, url}), reply with a JSON object {"assignments": ' +
    '{"<bookmark id>": "<Folder Name>"}}. Use a small set of clear, single-level ' +
    "folder names (no nesting, no slashes). Every input id must appear exactly " +
    "once. Reply with JSON only.";
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(list) },
    ],
    sent: picked.length,
    skipped: all.length - picked.length,
  };
}

/** First balanced-ish `{...}` JSON object found in `text` (handles fences). */
function extractJsonObject(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Turn a model categorization response into `move` actions. */
export function parseCategorization(text: string, nodes: BookmarkNode[]): Action[] {
  const obj = extractJsonObject(text);
  if (!obj) return [];
  const raw = (obj.assignments ?? obj) as unknown;
  if (!raw || typeof raw !== "object") return [];
  const assignments = raw as Record<string, unknown>;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const actions: Action[] = [];
  for (const [bmId, folder] of Object.entries(assignments)) {
    // Ignore inherited / prototype keys from the parsed JSON.
    if (!Object.prototype.hasOwnProperty.call(assignments, bmId)) continue;
    if (bmId === "__proto__" || bmId === "constructor" || bmId === "prototype") continue;
    if (typeof folder !== "string" || !folder.trim()) continue;
    const node = byId.get(bmId);
    if (!node || !node.url) continue;
    const target = folder.trim();
    if ((node.parentTitle ?? "") === target) continue;
    actions.push({ id: `move-${bmId}`, kind: "move", bmId, title: node.title, url: node.url, toFolderPath: target });
  }
  return actions;
}

/** Build the LLM request that flags meaningless / low-value bookmarks. */
export function buildCleanupPrompt(
  nodes: BookmarkNode[],
): { messages: ChatMessage[]; sent: number; skipped: number } {
  const all = nodes.filter((n) => n.url);
  const picked = all.slice(0, MAX_CATEGORIZE);
  const list = picked.map((n) => ({ id: n.id, title: n.title, url: n.url }));
  const system =
    "You audit a list of browser bookmarks ({id, title, url}) and identify ones " +
    "that are meaningless or low-value to keep: blank/placeholder/untitled pages, " +
    "localhost or 127.0.0.1 test pages, login/auth or error pages, search-result " +
    "URLs, and obviously temporary or junk links. Reply with a JSON object " +
    '{"remove": ["<id>", ...]} listing ONLY the ids worth deleting. When unsure, ' +
    "omit the id. Reply with JSON only.";
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(list) },
    ],
    sent: picked.length,
    skipped: all.length - picked.length,
  };
}

/** Parse the cleanup response into `remove`/`meaningless` actions. */
export function parseCleanupRemovals(text: string, nodes: BookmarkNode[]): Action[] {
  const obj = extractJsonObject(text);
  if (!obj) return [];
  const raw = (obj.remove ?? obj.ids) as unknown;
  if (!Array.isArray(raw)) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const actions: Action[] = [];
  for (const entry of raw) {
    // Accept both ["id", ...] and [{ id: "..." }, ...] shapes.
    const bmId = typeof entry === "string" ? entry : (entry as { id?: unknown })?.id;
    if (typeof bmId !== "string" || seen.has(bmId)) continue;
    const node = byId.get(bmId);
    if (!node || !node.url) continue;
    seen.add(bmId);
    actions.push({ id: `remove-${bmId}`, kind: "remove", bmId, title: node.title, url: node.url, reason: "meaningless" });
  }
  return actions;
}

/** Flatten `chrome.bookmarks.getTree()` into a list (bookmarks + folders). */
export async function loadBookmarks(): Promise<BookmarkNode[]> {
  const tree = await chrome.bookmarks.getTree();
  const out: BookmarkNode[] = [];
  const walk = (node: chrome.bookmarks.BookmarkTreeNode, parentTitle: string) => {
    out.push({
      id: node.id,
      title: node.title,
      url: node.url,
      parentId: node.parentId,
      parentTitle,
      dateAdded: node.dateAdded ?? 0,
      index: node.index ?? 0,
    });
    if (node.children) for (const c of node.children) walk(c, node.title || parentTitle);
  };
  // Note: a virtual root's title ("Bookmarks bar", "Other bookmarks") is
  // locale-dependent; parentTitle is display-only — applyActions moves by id.
  for (const root of tree) {
    if (root.children) for (const c of root.children) walk(c, root.title);
  }
  return out;
}

/** Find or create a single-level topic folder under the bookmarks bar (id "1"). */
async function ensureFolder(title: string, cache: Map<string, string>): Promise<string> {
  const cached = cache.get(title);
  if (cached) return cached;
  // Exact match among the bookmarks-bar's direct children only. (search()
  // does a global, case-insensitive substring match and could otherwise
  // adopt an unrelated folder from elsewhere in the tree.)
  const children = await chrome.bookmarks.getChildren("1");
  const found = children.find((n) => !n.url && n.title === title);
  const id = found ? found.id : (await chrome.bookmarks.create({ parentId: "1", title })).id;
  cache.set(title, id);
  return id;
}

/** Execute approved actions. Per-action try/catch so one failure isn't fatal. */
export async function applyActions(actions: Action[]): Promise<{ applied: number; failed: number }> {
  let applied = 0;
  let failed = 0;
  const folderCache = new Map<string, string>();
  for (const action of actions) {
    try {
      if (action.kind === "remove") {
        await chrome.bookmarks.remove(action.bmId);
      } else {
        const folderId = await ensureFolder(action.toFolderPath, folderCache);
        await chrome.bookmarks.move(action.bmId, { parentId: folderId });
      }
      applied++;
    } catch {
      failed++;
    }
  }
  return { applied, failed };
}

export interface DeadLinkOpts {
  concurrency?: number;
  signal?: AbortSignal;
  /** Per-request timeout in ms (default 8000). */
  timeoutMs?: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Whether an HTTP status confidently means the page is gone. Only the canonical
 * "gone" statuses count — so we never propose deleting bookmarks that merely
 * block bots (403/429), require auth (401), or are temporarily erroring (5xx).
 */
export function isDeadStatus(status: number): boolean {
  return status === 404 || status === 410;
}

interface ProbeResult {
  status: number;
  timedOut: boolean;
  netErr: boolean;
}

/**
 * Fetch each http(s) bookmark and flag dead ones. A link is "dead" only when it
 * is confidently gone: a 404/410 status, or a hard network failure (DNS /
 * connection refused) that persists through a GET retry. Slow links that time
 * out are treated as UNCERTAIN and never flagged, so a sluggish server doesn't
 * get a bookmark deleted. HEAD is tried first (cheap); a 403/405/network result
 * retries with GET (some servers reject HEAD or block bots on it).
 * Concurrency-limited, abortable; a user abort is never counted as dead.
 */
export async function checkDeadLinks(nodes: BookmarkNode[], opts: DeadLinkOpts = {}): Promise<Action[]> {
  const concurrency = opts.concurrency ?? 6;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const targets = nodes.filter((n) => n.url && /^https?:/i.test(n.url));
  const total = targets.length;
  let done = 0;
  const actions: Action[] = [];

  const probe = async (url: string, method: "HEAD" | "GET"): Promise<ProbeResult> => {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs);
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener("abort", onAbort);
    try {
      const res = await fetch(url, { method, signal: ctrl.signal, redirect: "follow" });
      return { status: res.status, timedOut: false, netErr: false };
    } catch {
      return { status: 0, timedOut, netErr: !timedOut };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  };

  const isDead = async (n: BookmarkNode): Promise<boolean> => {
    const url = n.url as string;
    let r = await probe(url, "HEAD");
    // Retry with GET when HEAD is rejected (403/405) or errored — a second
    // chance that also smooths over a transient first failure.
    if (!opts.signal?.aborted && (r.status === 403 || r.status === 405 || r.netErr || (r.timedOut && r.status === 0))) {
      r = await probe(url, "GET");
    }
    if (opts.signal?.aborted || r.timedOut) return false; // aborted or slow → uncertain, not dead
    if (r.netErr) return true; // hard network failure after retry → dead
    return isDeadStatus(r.status);
  };

  let i = 0;
  const worker = async () => {
    while (i < targets.length && !opts.signal?.aborted) {
      const n = targets[i++];
      const dead = await isDead(n);
      if (dead && !opts.signal?.aborted) {
        actions.push({ id: `remove-${n.id}`, kind: "remove", bmId: n.id, title: n.title, url: n.url as string, reason: "dead" });
      }
      done++;
      if (!opts.signal?.aborted) opts.onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return actions;
}
