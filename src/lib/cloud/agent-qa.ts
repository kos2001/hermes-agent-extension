import type { ChatMessage, ConnectionConfig } from "@/lib/types";
import { collectChat } from "@/lib/hermes-client";
import type { FolderForOpinion } from "./agent-opinion";

const MAX = 700;

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

function folderJson(folder: FolderForOpinion) {
  return {
    title: folder.title,
    summary: folder.summary,
    topics: folder.topics,
    items: folder.items.map((i) => ({ title: i.title, summary: i.itemSummary })),
  };
}

/** Build a request for an agent to ANSWER a question grounded in the folder. */
export function buildAnswerPrompt(folder: FolderForOpinion, question: string): { messages: ChatMessage[] } {
  const system =
    "You are an AI agent answering a member's QUESTION about a shared bookmark " +
    "folder. Use the folder's items and summaries as your ground truth. Answer " +
    "directly and concretely in 2-4 sentences; if the folder doesn't cover it, " +
    'say so and suggest what to add. Reply with JSON only: {"answer": "..."}.';
  const user = JSON.stringify({ folder: folderJson(folder), question });
  return { messages: [{ role: "system", content: system }, { role: "user", content: user }] };
}

/** Pull the answer text from the model reply (JSON `{answer}` or plain). Throws if empty. */
export function parseAnswer(text: string): string {
  const obj = extractJsonObject(text);
  const fromJson = obj && typeof obj.answer === "string" ? obj.answer : null;
  const answer = (fromJson ?? text).trim();
  if (!answer) throw new Error("Agent returned an empty answer");
  return answer.slice(0, MAX);
}

/** Build a request for a two-sided agent debate about the folder. */
export function buildDebatePrompt(folder: FolderForOpinion): { messages: ChatMessage[] } {
  const system =
    "You are moderating a short debate between two AI agents about a shared " +
    "bookmark folder. Argue BOTH sides from its actual content: `for` = why this " +
    "collection is strong / worth reading; `against` = gaps, weaknesses, or " +
    "what's missing. Each side 1-2 sentences, specific. Reply with JSON only: " +
    '{"for": "...", "against": "..."}.';
  const user = JSON.stringify({ folder: folderJson(folder) });
  return { messages: [{ role: "system", content: system }, { role: "user", content: user }] };
}

/** Parse the debate reply into the two sides. Throws if neither is present. */
export function parseDebate(text: string): { for: string; against: string } {
  const obj = extractJsonObject(text);
  const f = obj && typeof obj.for === "string" ? obj.for.trim() : "";
  const a = obj && typeof obj.against === "string" ? obj.against.trim() : "";
  if (!f && !a) throw new Error("Agent returned no debate");
  return { for: f.slice(0, MAX), against: a.slice(0, MAX) };
}

export async function generateAnswer(
  config: ConnectionConfig,
  folder: FolderForOpinion,
  question: string,
  signal?: AbortSignal,
): Promise<string> {
  const { messages } = buildAnswerPrompt(folder, question);
  return parseAnswer(await collectChat({ config, messages, model: config.model, responseFormat: { type: "json_object" }, signal }));
}

export async function generateDebate(
  config: ConnectionConfig,
  folder: FolderForOpinion,
  signal?: AbortSignal,
): Promise<{ for: string; against: string }> {
  const { messages } = buildDebatePrompt(folder);
  return parseDebate(await collectChat({ config, messages, model: config.model, responseFormat: { type: "json_object" }, signal }));
}
