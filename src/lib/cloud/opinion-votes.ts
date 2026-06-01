import type { SupabaseClient } from "@supabase/supabase-js";

/** Upvote an opinion as the current user (idempotent via the unique constraint). */
export async function voteOpinion(sb: SupabaseClient, commentId: string): Promise<void> {
  const { data } = await sb.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error("Must be signed in to vote");
  const { error } = await sb
    .from("opinion_votes")
    .upsert({ comment_id: commentId, user_id: userId }, { onConflict: "comment_id,user_id" });
  if (error) throw error;
}

/** Remove the current user's upvote from an opinion. */
export async function unvoteOpinion(sb: SupabaseClient, commentId: string): Promise<void> {
  const { data } = await sb.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error("Must be signed in to vote");
  const { error } = await sb
    .from("opinion_votes")
    .delete()
    .eq("comment_id", commentId)
    .eq("user_id", userId);
  if (error) throw error;
}

/** Upvote tallies per comment id. */
export async function opinionVoteCounts(
  sb: SupabaseClient,
  commentIds: string[],
): Promise<Record<string, number>> {
  if (commentIds.length === 0) return {};
  const { data, error } = await sb.from("opinion_votes").select("comment_id").in("comment_id", commentIds);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { comment_id: string }[]) {
    counts[row.comment_id] = (counts[row.comment_id] ?? 0) + 1;
  }
  return counts;
}

/** The set of comment ids the current user has upvoted (from the given ids). */
export async function myOpinionVotes(sb: SupabaseClient, commentIds: string[]): Promise<Set<string>> {
  if (commentIds.length === 0) return new Set();
  const { data: userData } = await sb.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return new Set();
  const { data, error } = await sb
    .from("opinion_votes")
    .select("comment_id")
    .eq("user_id", userId)
    .in("comment_id", commentIds);
  if (error) throw error;
  return new Set((data ?? []).map((r: { comment_id: string }) => r.comment_id));
}
