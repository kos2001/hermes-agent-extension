import type PocketBase from "pocketbase";
import type { RawEngagement } from "./activity";
import { eq, uid, createIgnoringDuplicate } from "./pb";

/** A member that can be @mentioned (from a thread/feed). */
export interface MentionCandidate {
  id: string;
  name: string;
}

/**
 * The mention query currently being typed: the partial `@word` immediately
 * before the caret (without the `@`), or null if the caret isn't in one. An
 * empty string means `@` was just typed (show all candidates). Pure.
 */
export function activeMention(text: string, caret: number): string | null {
  const before = text.slice(0, Math.max(0, caret));
  const m = before.match(/@([\p{L}\p{N}_]*)$/u);
  return m ? m[1] : null;
}

/**
 * Replace the active `@query` before the caret with `@name ` and return the new
 * text and caret position. No-op (returns text unchanged) if no active mention.
 */
export function applyMention(text: string, caret: number, name: string): { text: string; caret: number } {
  const c = Math.max(0, caret);
  const before = text.slice(0, c);
  const m = before.match(/@([\p{L}\p{N}_]*)$/u);
  if (!m) return { text, caret: c };
  const start = c - m[0].length;
  const insert = `@${name} `;
  return { text: text.slice(0, start) + insert + text.slice(c), caret: start + insert.length };
}

/** Candidate members whose name matches the typed query (prefix, case-insensitive). */
export function matchCandidates(query: string, candidates: MentionCandidate[], limit = 6): MentionCandidate[] {
  const q = query.trim().toLowerCase();
  const named = candidates.filter((c) => c.name.trim());
  const pool = q ? named.filter((c) => c.name.toLowerCase().includes(q)) : named;
  const seen = new Set<string>();
  const out: MentionCandidate[] = [];
  for (const c of pool) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/** Extract unique `@token` tokens from text (token = run of non-space, non-@ chars). */
export function extractMentionTokens(body: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /@([\p{L}\p{N}_]+)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const tok = m[1];
    const key = tok.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(tok);
    }
  }
  return out;
}

/**
 * Resolve `@token`s to member ids. A token matches a candidate when it equals
 * the candidate's display name (case-insensitive) or the candidate's first
 * whitespace-delimited word. Returns unique ids.
 */
export function resolveMentions(tokens: string[], candidates: MentionCandidate[]): string[] {
  const byKey = new Map<string, string>();
  for (const c of candidates) {
    const name = c.name.trim().toLowerCase();
    if (name && !byKey.has(name)) byKey.set(name, c.id);
    const first = name.split(/\s+/)[0];
    if (first && !byKey.has(first)) byKey.set(first, c.id);
  }
  const ids = new Set<string>();
  for (const tok of tokens) {
    const id = byKey.get(tok.trim().toLowerCase());
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Record mentions for a freshly posted comment (author = current user). */
export async function postMentions(pb: PocketBase, commentId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const byUser = uid(pb);
  if (!byUser) return;
  for (const mentioned of userIds) {
    if (mentioned === byUser) continue;
    await createIgnoringDuplicate(pb, "mentions", {
      comment_id: commentId,
      mentioned_user: mentioned,
      by_user: byUser,
    });
  }
}

/**
 * Mentions of the current user, shaped like a RawEngagement (actor = the
 * mentioner, folder = the comment's folder) so the activity loader can merge
 * them uniformly.
 */
/** A mention of me, with the comment that made it (for an agent to answer). */
export interface AnswerableMention {
  /** id of the comment that mentioned me — I reply with parent_id = this. */
  comment_id: string;
  folder_id: string;
  created: string;
}

/**
 * The oldest mention whose comment I haven't already replied to, or null. An
 * agent's beat loop uses this to answer one @mention per pass. Pure.
 * `answeredParentIds` = the set of parent_ids of my own replies.
 */
export function pickMentionToAnswer(
  mentions: AnswerableMention[],
  answeredParentIds: Set<string>,
): AnswerableMention | null {
  return (
    mentions
      .filter((m) => m.comment_id && !answeredParentIds.has(m.comment_id))
      .sort((a, b) => (a.created < b.created ? -1 : 1))[0] ?? null
  );
}

export async function mentionsForMe(pb: PocketBase): Promise<RawEngagement[]> {
  const myId = uid(pb);
  if (!myId) return [];
  const rows = await pb.collection("mentions").getFullList({
    filter: eq("mentioned_user", myId),
    expand: "comment_id",
  });
  return rows.map((row) => {
    const r = row as Record<string, unknown> & { expand?: { comment_id?: { folder_id?: string } } };
    return {
      id: r.id as string,
      user_id: r.by_user as string,
      folder_id: r.expand?.comment_id?.folder_id ?? "",
      created_at: r.created_at as string,
    };
  });
}
