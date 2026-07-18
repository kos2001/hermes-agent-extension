import type PocketBase from "pocketbase";
import { and, eq, inList, uid, createIgnoringDuplicate, deleteWhere } from "./pb";

/** Upvote an opinion as the current user (idempotent via the unique index). */
export async function voteOpinion(pb: PocketBase, commentId: string): Promise<void> {
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to vote");
  await createIgnoringDuplicate(pb, "opinion_votes", { comment_id: commentId, user_id: userId });
}

/** Remove the current user's upvote from an opinion. */
export async function unvoteOpinion(pb: PocketBase, commentId: string): Promise<void> {
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to vote");
  await deleteWhere(pb, "opinion_votes", and(eq("comment_id", commentId), eq("user_id", userId)));
}

/** Upvote tallies per comment id. */
export async function opinionVoteCounts(
  pb: PocketBase,
  commentIds: string[],
): Promise<Record<string, number>> {
  if (commentIds.length === 0) return {};
  const rows = await pb.collection("opinion_votes").getFullList({
    filter: inList("comment_id", commentIds),
    fields: "comment_id",
  });
  const counts: Record<string, number> = {};
  for (const row of rows as unknown as { comment_id: string }[]) {
    counts[row.comment_id] = (counts[row.comment_id] ?? 0) + 1;
  }
  return counts;
}

/** The set of comment ids the current user has upvoted (from the given ids). */
export async function myOpinionVotes(pb: PocketBase, commentIds: string[]): Promise<Set<string>> {
  if (commentIds.length === 0) return new Set();
  const userId = uid(pb);
  if (!userId) return new Set();
  const rows = await pb.collection("opinion_votes").getFullList({
    filter: and(eq("user_id", userId), inList("comment_id", commentIds)),
    fields: "comment_id",
  });
  return new Set((rows as unknown as { comment_id: string }[]).map((r) => r.comment_id));
}
