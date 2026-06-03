import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommunityMessage } from "./types";

/** A community's chat messages, oldest first, joined with each poster. */
export async function listCommunityMessages(sb: SupabaseClient, communityId: string, limit = 100): Promise<CommunityMessage[]> {
  const { data, error } = await sb
    .from("community_messages")
    .select("*, profiles!community_messages_user_id_fkey(display_name, avatar_url)")
    .eq("community_id", communityId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row: Record<string, unknown>) => {
    const { profiles, ...m } = row as Record<string, unknown> & {
      profiles?: { display_name: string | null; avatar_url: string | null };
    };
    return {
      ...m,
      author: { display_name: profiles?.display_name ?? null, avatar_url: profiles?.avatar_url ?? null },
    } as CommunityMessage;
  });
}

/** Post a message to a community chat as the current user. */
export async function sendCommunityMessage(sb: SupabaseClient, communityId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) throw new Error("Message is empty");
  const { data: userData } = await sb.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Must be signed in to chat");
  const { error } = await sb.from("community_messages").insert({ community_id: communityId, user_id: userId, body: text });
  if (error) throw error;
}
