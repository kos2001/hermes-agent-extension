import type { ChatMessage, ConnectionConfig } from "@/lib/types";
import { collectChat } from "@/lib/hermes-client";

/** A bookmark within the folder being shared. */
export interface FolderItem {
  title: string;
  url: string;
}

/** The summarized body of a publish payload (caller adds title/sourceFolderName). */
export interface FolderSummary {
  summary: string;
  topics: string[];
  items: { title: string; url: string; itemSummary: string }[];
}

/** Cap items per folder to bound token use. */
const MAX_ITEMS = 60;
/** Cap topics so a folder's tag set stays focused. */
const MAX_TOPICS = 8;

/**
 * Build the LLM request that summarizes a bookmark folder for sharing. Asks for
 * a strict JSON object: a folder-level summary, topic tags, and a one-line
 * summary per item URL. Returns how many items were actually sent.
 */
export function buildFolderSummaryPrompt(
  folderPath: string,
  items: FolderItem[],
): { messages: ChatMessage[]; sent: number } {
  const picked = items.slice(0, MAX_ITEMS);
  const system =
    "You summarize a user's bookmark folder so others can discover it. You are " +
    "given the folder path and its bookmarks ({title, url}). Produce: a concise " +
    "1-2 sentence `summary` of what the folder is about; up to 8 short `topics` " +
    "(lowercase tags); and for each bookmark a one-line `summary` (<=15 words). " +
    'Reply with JSON only: {"summary": "...", "topics": ["..."], "items": ' +
    '[{"url": "<url>", "summary": "..."}]}. No prose outside the JSON.';
  const user = JSON.stringify({
    folder: folderPath,
    bookmarks: picked.map((it) => ({ title: it.title, url: it.url })),
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
 * Parse a folder-summary response into a FolderSummary. The item list is driven
 * by the real `items` (capped to what was sent), so the published items always
 * match the user's actual bookmarks; the model only contributes per-URL
 * summaries (falling back to the bookmark title when absent). Throws when the
 * response carries no usable JSON object with a summary.
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
        const url = (it as Record<string, unknown>).url;
        const summary = (it as Record<string, unknown>).summary;
        if (typeof url === "string" && typeof summary === "string" && summary.trim()) {
          byUrl.set(url.trim(), summary.trim());
        }
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

/** Summarize a folder via the configured LLM, then parse the result. */
export async function summarizeFolder(
  config: ConnectionConfig,
  folderPath: string,
  items: FolderItem[],
  signal?: AbortSignal,
): Promise<FolderSummary> {
  const { messages } = buildFolderSummaryPrompt(folderPath, items);
  const text = await collectChat({ config, messages, model: config.model, signal });
  return parseFolderSummary(text, items);
}
