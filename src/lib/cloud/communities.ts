import type { SupabaseClient } from "@supabase/supabase-js";
import type { Community } from "./types";

/** Trim and collapse internal whitespace in a community name. */
export function normalizeCommunityName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** A community name is 2–40 chars after normalization. */
export function isValidCommunityName(raw: string): boolean {
  const n = normalizeCommunityName(raw).length;
  return n >= 2 && n <= 40;
}

/** All communities with folder + member counts, most-joined first. */
export async function listCommunities(sb: SupabaseClient): Promise<Community[]> {
  const { data, error } = await sb
    .from("community_overview")
    .select("*")
    .order("member_count", { ascending: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Community[];
}

/** Create a community and auto-join the creator. Returns the new id. */
export async function createCommunity(
  sb: SupabaseClient,
  name: string,
  description?: string,
): Promise<{ id: string }> {
  const cleanName = normalizeCommunityName(name);
  if (!isValidCommunityName(cleanName)) throw new Error("Community name must be 2–40 characters");

  const { data: userData } = await sb.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Must be signed in to create a community");

  const { data, error } = await sb
    .from("communities")
    .insert({ name: cleanName, description: description?.trim() || null, created_by: userId })
    .select("id")
    .single();
  if (error) throw error;

  const id = (data as { id: string }).id;
  await sb.from("community_members").insert({ community_id: id, user_id: userId });
  return { id };
}

/** Delete a community you created (RLS enforces ownership). Folders' community_id is set null. */
export async function deleteCommunity(sb: SupabaseClient, communityId: string): Promise<void> {
  const { error } = await sb.from("communities").delete().eq("id", communityId);
  if (error) throw error;
}

export async function joinCommunity(sb: SupabaseClient, communityId: string): Promise<void> {
  const { data } = await sb.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error("Must be signed in to join");
  const { error } = await sb
    .from("community_members")
    .upsert({ community_id: communityId, user_id: userId }, { onConflict: "community_id,user_id" });
  if (error) throw error;
}

export async function leaveCommunity(sb: SupabaseClient, communityId: string): Promise<void> {
  const { data } = await sb.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error("Must be signed in to leave");
  const { error } = await sb
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", userId);
  if (error) throw error;
}

/** The set of community ids the current user has joined. */
export async function myCommunityIds(sb: SupabaseClient): Promise<Set<string>> {
  const { data: userData } = await sb.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return new Set();
  const { data, error } = await sb.from("community_members").select("community_id").eq("user_id", userId);
  if (error) throw error;
  return new Set((data ?? []).map((r: { community_id: string }) => r.community_id));
}
