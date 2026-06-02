import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawEngagement } from "./activity";

/** A member that can be @mentioned (from a thread/feed). */
export interface MentionCandidate {
  id: string;
  name: string;
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
export async function postMentions(sb: SupabaseClient, commentId: string, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const { data: userData } = await sb.auth.getUser();
  const byUser = userData.user?.id;
  if (!byUser) return;
  const rows = userIds
    .filter((uid) => uid !== byUser)
    .map((uid) => ({ comment_id: commentId, mentioned_user: uid, by_user: byUser }));
  if (rows.length === 0) return;
  const { error } = await sb.from("mentions").upsert(rows, { onConflict: "comment_id,mentioned_user" });
  if (error) throw error;
}

/**
 * Mentions of the current user, shaped like a RawEngagement (actor = the
 * mentioner, folder = the comment's folder) so the activity loader can merge
 * them uniformly.
 */
export async function mentionsForMe(sb: SupabaseClient): Promise<RawEngagement[]> {
  const { data: userData } = await sb.auth.getUser();
  const myId = userData.user?.id;
  if (!myId) return [];
  const { data, error } = await sb
    .from("mentions")
    .select("id, by_user, created_at, comments!mentions_comment_id_fkey(folder_id)")
    .eq("mentioned_user", myId);
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => {
    const comment = row.comments as { folder_id?: string } | null;
    return {
      id: row.id as string,
      user_id: row.by_user as string,
      folder_id: comment?.folder_id ?? "",
      created_at: row.created_at as string,
    };
  });
}
