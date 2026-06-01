import type { ChatMessage, ConnectionConfig } from "@/lib/types";
import { collectChat } from "@/lib/hermes-client";
import { fetchSiteText } from "@/lib/market-report";

/** A bookmark within the folder being shared. */
export interface FolderItem {
  title: string;
  url: string;
}

/** A folder item paired with the readable text fetched from its page. */
export interface ItemWithContent extends FolderItem {
  content: string;
}

/** The summarized body of a publish payload (caller adds title/sourceFolderName). */
export interface FolderSummary {
  summary: string;
  topics: string[];
  items: { title: string; url: string; itemSummary: string }[];
}

/** Cap items per folder to bound fetch fan-out + token use. */
export const MAX_ITEMS = 30;
/** Cap topics so a folder's tag set stays focused. */
export const MAX_TOPICS = 8;
/** Page text kept per item — enough to ground an insight, bounds tokens. */
export const CONTENT_CHARS = 2500;
/** Concurrent page fetches. */
const FETCH_CONCURRENCY = 6;

/**
 * Build the LLM request that READS each page and shares insight. The model is
 * given each bookmark's page text (not just title/url) and must produce a
 * genuine takeaway per item plus a folder-level synthesis — not a restatement
 * of the link. Returns how many items were included.
 */
export function buildFolderInsightPrompt(
  folderPath: string,
  items: ItemWithContent[],
): { messages: ChatMessage[]; sent: number } {
  const picked = items.slice(0, MAX_ITEMS);
  const system =
    "You are given a folder of web bookmarks, each with the READABLE TEXT of its " +
    "page. Actually read each page's content and share INSIGHT — the key takeaway, " +
    "what one would learn, or why it's worth reading — never a mere description of " +
    "the link or a restatement of the title. Produce: a concise 1-2 sentence " +
    "`summary` of what the whole folder is about and the through-line across the " +
    "pages; up to 8 short lowercase `topics`; and for each page an `insight` " +
    "(<=30 words) grounded in its actual content. If a page's text is empty or " +
    "unreadable, base the insight on the title and keep it modest. Reply with " +
    'JSON only: {"summary":"...","topics":["..."],"items":[{"url":"<url>",' +
    '"insight":"..."}]}. No prose outside the JSON.';
  const user = JSON.stringify({
    folder: folderPath,
    pages: picked.map((it) => ({
      title: it.title,
      url: it.url,
      content: (it.content || "").slice(0, CONTENT_CHARS),
    })),
  });
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    sent: picked.length,
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

function cleanTopics(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of raw) {
    if (typeof t !== "string") continue;
    const tag = t.trim().toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= MAX_TOPICS) break;
  }
  return out;
}

/**
 * Parse a folder-insight response into a FolderSummary. The item list is driven
 * by the real `items` (capped to what was sent), so the published items always
 * match the user's actual bookmarks; the model only contributes per-URL
 * insights — accepted under either `insight` or `summary`, falling back to the
 * bookmark title when absent. Throws when the response carries no usable JSON
 * object with a folder summary.
 */
export function parseFolderSummary(text: string, items: FolderItem[]): FolderSummary {
  const obj = extractJsonObject(text);
  if (!obj || typeof obj.summary !== "string" || !obj.summary.trim()) {
    throw new Error("Could not parse a folder summary from the response");
  }

  const byUrl = new Map<string, string>();
  if (Array.isArray(obj.items)) {
    for (const it of obj.items) {
      if (it && typeof it === "object") {
        const r = it as Record<string, unknown>;
        const url = r.url;
        const insight = typeof r.insight === "string" ? r.insight : typeof r.summary === "string" ? r.summary : "";
        if (typeof url === "string" && insight.trim()) byUrl.set(url.trim(), insight.trim());
      }
    }
  }

  const picked = items.slice(0, MAX_ITEMS);
  return {
    summary: obj.summary.trim(),
    topics: cleanTopics(obj.topics),
    items: picked.map((it) => ({
      title: it.title,
      url: it.url,
      itemSummary: byUrl.get(it.url) ?? it.title,
    })),
  };
}

export interface SummarizeOpts {
  signal?: AbortSignal;
  /** Reports page-fetch progress (done, total) so the UI can show it. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Read a folder's pages and summarize them into insights. Fetches each page's
 * text concurrently (reusing market-report's fetcher; failures yield empty
 * text, handled by the prompt), then asks the LLM for the folder summary +
 * per-item insights.
 */
export async function summarizeFolder(
  config: ConnectionConfig,
  folderPath: string,
  items: FolderItem[],
  opts: SummarizeOpts = {},
): Promise<FolderSummary> {
  const picked = items.slice(0, MAX_ITEMS);
  const withContent: ItemWithContent[] = new Array(picked.length);
  const total = picked.length;
  let done = 0;
  let i = 0;
  const worker = async () => {
    while (i < picked.length && !opts.signal?.aborted) {
      const idx = i++;
      const it = picked[idx];
      const content = await fetchSiteText(it.url, opts.signal);
      withContent[idx] = { ...it, content };
      done++;
      opts.onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, picked.length) }, worker));

  const { messages } = buildFolderInsightPrompt(folderPath, withContent.filter(Boolean));
  const text = await collectChat({
    config,
    messages,
    model: config.model,
    responseFormat: { type: "json_object" },
    signal: opts.signal,
  });
  return parseFolderSummary(text, picked);
}
