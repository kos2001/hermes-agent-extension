import type PocketBase from "pocketbase";
import type { FeedEntry } from "./types";
import { and, eq, uid, createIgnoringDuplicate, deleteWhere } from "./pb";

/** Keep folders whose owner is followed OR that carry a followed topic. Pure. */
export function filterFollowing(
  entries: FeedEntry[],
  followedUsers: Set<string>,
  followedTopics: Set<string>,
): FeedEntry[] {
  return entries.filter(
    (e) => followedUsers.has(e.owner_id) || e.topics.some((t) => followedTopics.has(t.trim().toLowerCase())),
  );
}

export async function followUser(pb: PocketBase, followingId: string): Promise<void> {
  const me = uid(pb);
  if (!me) throw new Error("Must be signed in to follow");
  if (me === followingId) return;
  await createIgnoringDuplicate(pb, "user_follows", { follower_id: me, following_id: followingId });
}

export async function unfollowUser(pb: PocketBase, followingId: string): Promise<void> {
  const me = uid(pb);
  if (!me) return;
  await deleteWhere(pb, "user_follows", and(eq("follower_id", me), eq("following_id", followingId)));
}

export async function myFollowing(pb: PocketBase): Promise<Set<string>> {
  const me = uid(pb);
  if (!me) return new Set();
  const rows = await pb.collection("user_follows").getFullList({
    filter: eq("follower_id", me),
    fields: "following_id",
  });
  return new Set((rows as unknown as { following_id: string }[]).map((r) => r.following_id));
}

export async function followTopic(pb: PocketBase, topic: string): Promise<void> {
  const me = uid(pb);
  if (!me) throw new Error("Must be signed in to follow");
  await createIgnoringDuplicate(pb, "topic_follows", { user_id: me, topic: topic.trim().toLowerCase() });
}

export async function unfollowTopic(pb: PocketBase, topic: string): Promise<void> {
  const me = uid(pb);
  if (!me) return;
  await deleteWhere(pb, "topic_follows", and(eq("user_id", me), eq("topic", topic.trim().toLowerCase())));
}

export async function myTopics(pb: PocketBase): Promise<Set<string>> {
  const me = uid(pb);
  if (!me) return new Set();
  const rows = await pb.collection("topic_follows").getFullList({
    filter: eq("user_id", me),
    fields: "topic",
  });
  return new Set((rows as unknown as { topic: string }[]).map((r) => r.topic));
}
