/**
 * In-place page translation.
 *
 * 1) Walk the active tab's DOM and collect text nodes (skipping code, inputs,
 *    contenteditable). Each node gets a numeric id, original text is cached
 *    on `window.__hermesTx` so we can restore it later.
 * 2) Batch into ~3K-char chunks; in parallel (×3) ask the LLM to translate
 *    each batch and return `{id: translated}` JSON.
 * 3) Apply translations back to the original Text nodes — page structure /
 *    styles are preserved because we only rewrite `nodeValue`.
 */

import { streamChat } from "./hermes-client";
import type { ConnectionConfig } from "./types";

export interface CollectedNode {
  id: number;
  text: string;
}

// Smaller chunks keep each translated JSON well under output-token limits,
// avoiding truncated/unparseable responses.
const CHUNK_CHARS = 1800;
const PARALLEL = 3;
/** Per-chunk hard cap so a hung connection can't freeze the whole translation. */
const CHUNK_TIMEOUT_MS = 90_000;

function collectInPage(): CollectedNode[] {
  // Stash everything we'll need for apply/restore on the page window.
  const w = window as unknown as {
    __hermesTx?: {
      byId: Map<number, { node: Text; original: string }>;
      nodeToId: WeakMap<Text, number>;
      nextId: number;
    };
  };
  const tx = (w.__hermesTx ??= {
    byId: new Map(),
    nodeToId: new WeakMap(),
    nextId: 0,
  });

  const skip = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE",
    "CODE", "PRE", "KBD", "SAMP", "VAR", "TT",
    "INPUT", "TEXTAREA", "SELECT", "OPTION",
  ]);

  const out: CollectedNode[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    let p: Element | null = t.parentElement;
    let bad = false;
    while (p) {
      if (skip.has(p.tagName) || (p as HTMLElement).isContentEditable) {
        bad = true;
        break;
      }
      p = p.parentElement;
    }
    if (bad) continue;

    const text = (t.nodeValue ?? "").trim();
    if (!text) continue;
    // Skip short fragments that contain no letters in ANY language (pure
    // numbers/punctuation/symbols). Uses a Unicode letter test — the old
    // ASCII-only `\w`/`\W` check wrongly dropped short non-Latin words
    // (Korean/CJK/accented), leaving them untranslated.
    if (text.length < 10 && !/\p{L}/u.test(text)) continue;

    let id = tx.nodeToId.get(t);
    if (id === undefined) {
      id = tx.nextId++;
      tx.byId.set(id, { node: t, original: t.nodeValue ?? "" });
      tx.nodeToId.set(t, id);
    }
    out.push({ id, text });
  }
  return out;
}

function applyInPage(map: Record<string, string>): number {
  const w = window as unknown as {
    __hermesTx?: { byId: Map<number, { node: Text; original: string }> };
  };
  if (!w.__hermesTx) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(map)) {
    const id = Number(k);
    if (!Number.isFinite(id)) continue;
    const entry = w.__hermesTx.byId.get(id);
    if (!entry?.node?.isConnected) continue;
    // Preserve leading/trailing whitespace from the original — inline layout
    // around the text node usually depends on it (e.g. "X <em>Y</em>").
    const orig = entry.original;
    const lead = /^\s*/.exec(orig)?.[0] ?? "";
    const trail = /\s*$/.exec(orig)?.[0] ?? "";
    entry.node.nodeValue = lead + v + trail;
    n++;
  }
  return n;
}

function restoreInPage(): number {
  const w = window as unknown as {
    __hermesTx?: { byId: Map<number, { node: Text; original: string }> };
  };
  if (!w.__hermesTx) return 0;
  let n = 0;
  for (const entry of w.__hermesTx.byId.values()) {
    if (entry.node?.isConnected) {
      entry.node.nodeValue = entry.original;
      n++;
    }
  }
  return n;
}

export async function collectTranslatable(tabId: number): Promise<CollectedNode[]> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func: collectInPage,
  });
  return (results[0]?.result as CollectedNode[] | undefined) ?? [];
}

export async function applyTranslations(
  tabId: number,
  map: Record<string, string>,
): Promise<number> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func: applyInPage,
    args: [map],
  });
  return (results[0]?.result as number | undefined) ?? 0;
}

export async function restoreOriginals(tabId: number): Promise<number> {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    func: restoreInPage,
  });
  return (results[0]?.result as number | undefined) ?? 0;
}

function buildChunks(nodes: CollectedNode[]): CollectedNode[][] {
  const out: CollectedNode[][] = [];
  let cur: CollectedNode[] = [];
  let len = 0;
  for (const n of nodes) {
    if (len + n.text.length > CHUNK_CHARS && cur.length > 0) {
      out.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(n);
    len += n.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

function stripFences(s: string): string {
  return s
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

async function translateChunk(
  cfg: ConnectionConfig,
  targetLang: string,
  chunk: CollectedNode[],
  signal: AbortSignal,
): Promise<Record<string, string>> {
  const input: Record<string, string> = {};
  for (const n of chunk) input[String(n.id)] = n.text;

  const sys =
    `You are a translation engine. Translate the value for EVERY key to ${targetLang}. ` +
    `Do NOT omit, merge, drop, or skip any key — your JSON must contain exactly the same keys as the input. ` +
    `Keep keys exactly as given. Preserve placeholders, URLs, code, numbers, and emojis. ` +
    `Return ONLY a single JSON object mapping each input key to its translated string — no prose, no markdown fences.`;

  // Run one full request/parse for a given payload. Guarded by a timeout AND
  // the caller's signal so a stalled connection can't hang forever.
  const runOnce = async (payload: Record<string, string>): Promise<Record<string, string>> => {
    const messages = [
      { role: "system" as const, content: sys },
      { role: "user" as const, content: JSON.stringify(payload) },
    ];
    const attempt = async (jsonMode: boolean) => {
      const ctrl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, CHUNK_TIMEOUT_MS);
      const onParentAbort = () => ctrl.abort();
      signal.addEventListener("abort", onParentAbort);
      let acc = "";
      let err = "";
      try {
        await streamChat(
          {
            config: cfg,
            messages,
            signal: ctrl.signal,
            // Native JSON output when supported — cuts "prose instead of JSON" failures.
            responseFormat: jsonMode ? { type: "json_object" } : undefined,
          },
          {
            onChunk: (t) => {
              acc += t;
            },
            onError: (msg) => {
              err = msg;
            },
          },
        );
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", onParentAbort);
      }
      return { acc, err, timedOut };
    };

    let r = await attempt(true);
    if (!r.acc.trim() && !r.timedOut && !signal.aborted) r = await attempt(false);
    if (r.timedOut) throw new Error(`Translation request timed out after ${CHUNK_TIMEOUT_MS / 1000}s`);
    if (!r.acc.trim()) throw new Error(r.err || "Empty response from model");

    const cleaned = stripFences(r.acc);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("LLM did not return JSON");
      parsed = JSON.parse(m[0]);
    }
    if (!parsed || typeof parsed !== "object") throw new Error("LLM JSON was not an object");
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      out[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    return out;
  };

  // Completeness loop: models routinely omit some keys (so those nodes stay in
  // the original language). Re-request only the missing keys — in shrinking
  // payloads the model is far more likely to return them — up to a few rounds.
  const result: Record<string, string> = {};
  let pending = input;
  for (let round = 0; round < 3 && Object.keys(pending).length > 0; round++) {
    if (signal.aborted) break;
    const got = await runOnce(pending);
    const stillMissing: Record<string, string> = {};
    for (const [k, original] of Object.entries(pending)) {
      const v = got[k];
      if (typeof v === "string" && v.trim()) result[k] = v;
      else stillMissing[k] = original;
    }
    pending = stillMissing;
  }
  return result;
}

export interface TranslatePageOptions {
  tabId: number;
  config: ConnectionConfig;
  targetLang: string;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  onError?: (chunkIndex: number, message: string) => void;
}

export async function translatePage(opts: TranslatePageOptions): Promise<{
  totalNodes: number;
  chunks: number;
  appliedNodes: number;
}> {
  const nodes = await collectTranslatable(opts.tabId);
  const chunks = buildChunks(nodes);
  if (chunks.length === 0) {
    return { totalNodes: nodes.length, chunks: 0, appliedNodes: 0 };
  }

  let done = 0;
  let applied = 0;
  opts.onProgress?.(0, chunks.length);

  const queue = chunks.map((c, i) => ({ c, i }));
  const signal = opts.signal ?? new AbortController().signal;

  const worker = async () => {
    while (queue.length) {
      const item = queue.shift();
      if (!item) return;
      if (signal.aborted) return;
      try {
        const map = await translateChunk(opts.config, opts.targetLang, item.c, signal);
        applied += await applyTranslations(opts.tabId, map);
      } catch (e) {
        // A user/unmount abort surfaces here as an empty-response or abort error;
        // it's expected cancellation, not a chunk failure — don't report it.
        if (signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        opts.onError?.(item.i, msg);
      }
      done++;
      opts.onProgress?.(done, chunks.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, chunks.length) }, () => worker()),
  );

  return { totalNodes: nodes.length, chunks: chunks.length, appliedNodes: applied };
}
