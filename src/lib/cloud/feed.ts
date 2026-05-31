import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeedEntry } from "./types";

type ReactionKind = "like" | "save";

/** Newest shared folders, each joined with its owner profile. */
export async function listFeed(sb: SupabaseClient, limit = 50): Promise<FeedEntry[]> {
  const { data, error } = await sb
    .from("shared_folders")
    .select("*, profiles!shared_folders_owner_id_fkey(display_name, avatar_url)")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => {
    const { profiles, ...folder } = row as Record<string, unknown> & {
      profiles?: { display_name: string | null; avatar_url: string | null };
    };
    return {
      ...folder,
      owner: { display_name: profiles?.display_name ?? null, avatar_url: profiles?.avatar_url ?? null },
    } as FeedEntry;
  });
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
