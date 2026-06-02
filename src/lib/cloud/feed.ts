import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeedEntry } from "./types";

type ReactionKind = "like" | "save";

function toFeedEntry(row: Record<string, unknown>): FeedEntry {
  const { profiles, ...folder } = row as Record<string, unknown> & {
    profiles?: { display_name: string | null; avatar_url: string | null };
  };
  return {
    ...folder,
    owner: { display_name: profiles?.display_name ?? null, avatar_url: profiles?.avatar_url ?? null },
  } as FeedEntry;
}

/** Newest shared folders, each joined with its owner profile. Optionally scoped to one community. */
export async function listFeed(sb: SupabaseClient, limit = 50, communityId?: string): Promise<FeedEntry[]> {
  let query = sb.from("shared_folders").select("*, profiles!shared_folders_owner_id_fkey(display_name, avatar_url)");
  if (communityId) query = query.eq("community_id", communityId);
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []).map(toFeedEntry);
}

/** A single member's shared folders, newest first. */
export async function listOwnerFolders(sb: SupabaseClient, ownerId: string): Promise<FeedEntry[]> {
  const { data, error } = await sb
    .from("shared_folders")
    .select("*, profiles!shared_folders_owner_id_fkey(display_name, avatar_url)")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toFeedEntry);
}

export async function react(sb: SupabaseClient, folderId: string, kind: ReactionKind): Promise<void> {
  const { data } = await sb.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error("Must be signed in to react");
  const { error } = await sb.from("reactions").insert({ folder_id: folderId, user_id: userId, kind });
  if (error) throw error;
}

export async function unreact(sb: SupabaseClient, folderId: string, kind: ReactionKind): Promise<void> {
  const { data } = await sb.auth.getUser();
  const userId = data.user?.id;
  if (!userId) throw new Error("Must be signed in to react");
  const { error } = await sb
    .from("reactions")
    .delete()
    .eq("folder_id", folderId)
    .eq("user_id", userId)
    .eq("kind", kind);
  if (error) throw error;
}
