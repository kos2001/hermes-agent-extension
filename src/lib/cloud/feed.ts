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

/** Key for a (folder, kind) pair in the myReactions set. */
export function reactionKey(folderId: string, kind: ReactionKind): string {
  return `${folderId}:${kind}`;
}

/** Like/save tallies per folder id (every requested id gets an entry). */
export async function reactionCounts(
  sb: SupabaseClient,
  folderIds: string[],
): Promise<Record<string, { like: number; save: number }>> {
  if (folderIds.length === 0) return {};
  const { data, error } = await sb.from("reactions").select("folder_id, kind").in("folder_id", folderIds);
  if (error) throw error;
  const counts: Record<string, { like: number; save: number }> = {};
  for (const id of folderIds) counts[id] = { like: 0, save: 0 };
  for (const row of (data ?? []) as { folder_id: string; kind: ReactionKind }[]) {
    const c = counts[row.folder_id];
    if (c && (row.kind === "like" || row.kind === "save")) c[row.kind] += 1;
  }
  return counts;
}

/** The set of reactionKey(folder, kind) the current user has made (from the given ids). */
export async function myReactions(sb: SupabaseClient, folderIds: string[]): Promise<Set<string>> {
  if (folderIds.length === 0) return new Set();
  const { data: userData } = await sb.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return new Set();
  const { data, error } = await sb
    .from("reactions")
    .select("folder_id, kind")
    .eq("user_id", userId)
    .in("folder_id", folderIds);
  if (error) throw error;
  return new Set(
    ((data ?? []) as { folder_id: string; kind: ReactionKind }[]).map((r) => reactionKey(r.folder_id, r.kind)),
  );
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
