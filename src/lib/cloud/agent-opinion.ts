import type { ChatMessage, ConnectionConfig } from "@/lib/types";
import { collectChat } from "@/lib/hermes-client";

/** The shared-folder context an agent forms an opinion about. */
export interface FolderForOpinion {
  title: string;
  summary: string | null;
  topics: string[];
  items: { title: string; itemSummary: string | null }[];
}

/** A prior opinion in the thread, so the agent can respond to it. */
export interface PriorOpinion {
  label: string;
  body: string;
}

const MAX_OPINION_CHARS = 600;

/**
 * Build the request for an AI agent's opinion on a shared folder — Moltbook-
 * style: the agent reads the folder and the existing discussion, then adds a
 * substantive take (what's valuable, what's missing, a related angle, or a
 * response to prior opinions) rather than a bland summary.
 */
export function buildOpinionPrompt(
  folder: FolderForOpinion,
  priorOpinions: PriorOpinion[],
): { messages: ChatMessage[] } {
  const system =
    "You are an AI agent participating in a shared knowledge community where " +
    "agents and people exchange opinions about each other's bookmark " +
    "collections. Given a folder (its summary, topics, and items) and the " +
    "existing discussion, contribute ONE substantive opinion: what's most " +
    "valuable here, what's missing or worth adding, a related angle, or a " +
    "thoughtful response to a prior opinion. Be specific and concise (2-4 " +
    "sentences), conversational, and add something new — don't just summarize. " +
    'Reply with JSON only: {"opinion": "..."}.';
  const user = JSON.stringify({
    folder: {
      title: folder.title,
      summary: folder.summary,
      topics: folder.topics,
      items: folder.items.map((i) => ({ title: i.title, summary: i.itemSummary })),
    },
    discussion: priorOpinions.map((o) => ({ from: o.label, opinion: o.body })),
  });
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };
}

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

/**
 * Pull the opinion text from the model reply. Prefers JSON `{opinion}`, falls
 * back to trimmed plain text. Throws when there is no usable opinion.
 */
export function parseOpinion(text: string): string {
  const obj = extractJsonObject(text);
  const fromJson = obj && typeof obj.opinion === "string" ? obj.opinion : null;
  const opinion = (fromJson ?? text).trim();
  if (!opinion) throw new Error("Agent returned an empty opinion");
  return opinion.slice(0, MAX_OPINION_CHARS);
}

/** Generate an agent opinion for a folder via the configured LLM. */
export async function generateOpinion(
  config: ConnectionConfig,
  folder: FolderForOpinion,
  priorOpinions: PriorOpinion[],
  signal?: AbortSignal,
): Promise<string> {
  const { messages } = buildOpinionPrompt(folder, priorOpinions);
  const text = await collectChat({
    config,
    messages,
    model: config.model,
    responseFormat: { type: "json_object" },
    signal,
  });
  return parseOpinion(text);
}
