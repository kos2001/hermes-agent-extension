/**
 * Content-level semantic duplicate detection for bookmarks.
 *
 * URL canonicalization (`findDuplicates`) only folds together URLs that are
 * literally the same resource. This module catches the harder case: different
 * URLs that point at the SAME content — an article and its AMP/mobile copy, a
 * shortened link, the same story syndicated on another domain.
 *
 * To keep latency and token cost down, each page is reduced to a short snippet
 * (its title + the first few sentences), and a single LLM call clusters the
 * snippets into duplicate groups.
 */

import { type Action, type BookmarkNode } from "./bookmarks";
import { fetchSiteText } from "./market-report";
import { collectChat } from "./hermes-client";
import type { ChatMessage, ConnectionConfig } from "./types";

/** Max bookmarks compared per run (bounds fetch fan-out + LLM tokens). */
export const SEM_DEDUP_CAP = 40;
/** Chars of page text kept per bookmark — roughly the first few sentences. */
export const SNIPPET_CHARS = 280;

export interface SnippetItem {
  id: string;
  title: string;
  snippet: string;
}

/** Fetch a page and keep only its leading text (title comes from the bookmark). */
export async function fetchSnippet(url: string, signal?: AbortSignal): Promise<string> {
  const text = await fetchSiteText(url, signal);
  return text.slice(0, SNIPPET_CHARS);
}

/** Build the clustering request from {id, title, snippet} items. */
export function buildSemanticDedupPrompt(items: SnippetItem[]): { messages: ChatMessage[] } {
  const system =
    "You are given web bookmarks as a JSON array of {id, title, snippet}, where " +
    "snippet is the first few sentences of the page. Group entries that are the " +
    "SAME underlying content — e.g. an article and its AMP/mobile version, a " +
    "shortened or redirected link, or the same story syndicated on another " +
    'domain. Reply with JSON {"groups": [["<id>", "<id>", ...], ...]} where each ' +
    "inner array lists ids that are duplicates of EACH OTHER. Only group items " +
    "you are confident share the same content; never group merely-related or " +
    "same-topic pages, and omit singletons. Reply with JSON only.";
  return {
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(items) },
    ],
  };
}

/** Reuse bookmarks.ts's tolerant JSON extraction via a tiny local copy. */
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
 * Turn the model's `{groups:[[id,...],...]}` into remove actions: within each
 * group keep the oldest bookmark and remove the rest. A bookmark removed by one
 * group is never proposed again (deduped across groups).
 */
export function parseSemanticGroups(text: string, nodes: BookmarkNode[]): Action[] {
  const obj = extractJsonObject(text);
  if (!obj || !Array.isArray(obj.groups)) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const removed = new Set<string>();
  const kept = new Set<string>();
  const actions: Action[] = [];
  for (const group of obj.groups as unknown[]) {
    if (!Array.isArray(group)) continue;
    const members = group
      .filter((id): id is string => typeof id === "string")
      .map((id) => byId.get(id))
      .filter((n): n is BookmarkNode => !!n && !!n.url && !removed.has(n.id) && !kept.has(n.id));
    if (members.length < 2) continue;
    const oldestFirst = [...members].sort((a, b) => a.dateAdded - b.dateAdded || a.id.localeCompare(b.id));
    kept.add(oldestFirst[0].id);
    for (const dup of oldestFirst.slice(1)) {
      if (removed.has(dup.id)) continue;
      removed.add(dup.id);
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

export interface SemanticDedupOpts {
  nodes: BookmarkNode[];
  config: ConnectionConfig;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

/** Fetch snippets (concurrently), cluster via the LLM, return remove actions. */
export async function runSemanticDedup(
  opts: SemanticDedupOpts,
): Promise<{ actions: Action[]; skipped: number }> {
  const all = opts.nodes.filter((n) => n.url);
  const picked = all.slice(0, SEM_DEDUP_CAP);
  const items: SnippetItem[] = new Array(picked.length);
  const total = picked.length;
  let done = 0;
  let i = 0;
  const worker = async () => {
    while (i < picked.length && !opts.signal?.aborted) {
      const idx = i++;
      const n = picked[idx];
      const snippet = await fetchSnippet(n.url as string, opts.signal);
      items[idx] = { id: n.id, title: n.title, snippet };
      done++;
      opts.onProgress?.(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, picked.length) }, worker));
  if (opts.signal?.aborted) return { actions: [], skipped: all.length - picked.length };

  const { messages } = buildSemanticDedupPrompt(items.filter(Boolean));
  const text = await collectChat({ config: opts.config, messages, responseFormat: { type: "json_object" }, signal: opts.signal });
  return { actions: parseSemanticGroups(text, opts.nodes), skipped: all.length - picked.length };
}
