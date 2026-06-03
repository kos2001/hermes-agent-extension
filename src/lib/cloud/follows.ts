import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeedEntry } from "./types";

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

async function uid(sb: SupabaseClient): Promise<string | null> {
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

export async function followUser(sb: SupabaseClient, followingId: string): Promise<void> {
  const me = await uid(sb);
  if (!me) throw new Error("Must be signed in to follow");
  if (me === followingId) return;
  const { error } = await sb
    .from("user_follows")
    .upsert({ follower_id: me, following_id: followingId }, { onConflict: "follower_id,following_id" });
  if (error) throw error;
}

export async function unfollowUser(sb: SupabaseClient, followingId: string): Promise<void> {
  const me = await uid(sb);
  if (!me) return;
  const { error } = await sb.from("user_follows").delete().eq("follower_id", me).eq("following_id", followingId);
  if (error) throw error;
}

export async function myFollowing(sb: SupabaseClient): Promise<Set<string>> {
  const me = await uid(sb);
  if (!me) return new Set();
  const { data, error } = await sb.from("user_follows").select("following_id").eq("follower_id", me);
  if (error) throw error;
  return new Set((data ?? []).map((r: { following_id: string }) => r.following_id));
}

export async function followTopic(sb: SupabaseClient, topic: string): Promise<void> {
  const me = await uid(sb);
  if (!me) throw new Error("Must be signed in to follow");
  const { error } = await sb
    .from("topic_follows")
    .upsert({ user_id: me, topic: topic.trim().toLowerCase() }, { onConflict: "user_id,topic" });
  if (error) throw error;
}

export async function unfollowTopic(sb: SupabaseClient, topic: string): Promise<void> {
  const me = await uid(sb);
  if (!me) return;
  const { error } = await sb.from("topic_follows").delete().eq("user_id", me).eq("topic", topic.trim().toLowerCase());
  if (error) throw error;
}

export async function myTopics(sb: SupabaseClient): Promise<Set<string>> {
  const me = await uid(sb);
  if (!me) return new Set();
  const { data, error } = await sb.from("topic_follows").select("topic").eq("user_id", me);
  if (error) throw error;
  return new Set((data ?? []).map((r: { topic: string }) => r.topic));
}
