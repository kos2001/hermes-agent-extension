import type { SupabaseClient } from "@supabase/supabase-js";
import type { Conversation, DirectMessage } from "./types";

/**
 * Summarize a flat message list into per-counterpart conversations: the last
 * message (by time) and the count of unread messages addressed to me, newest
 * conversation first. Pure — drives the inbox.
 */
export function buildConversations(messages: DirectMessage[], myId: string): Conversation[] {
  const byOther = new Map<string, Conversation>();
  for (const m of messages) {
    const otherId = m.sender_id === myId ? m.recipient_id : m.sender_id;
    const isUnreadToMe = m.recipient_id === myId && !m.read_at;
    const existing = byOther.get(otherId);
    if (!existing) {
      byOther.set(otherId, { otherId, lastBody: m.body, lastAt: m.created_at, unread: isUnreadToMe ? 1 : 0 });
    } else {
      if (m.created_at > existing.lastAt) {
        existing.lastBody = m.body;
        existing.lastAt = m.created_at;
      }
      if (isUnreadToMe) existing.unread += 1;
    }
  }
  return [...byOther.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
}

/** All messages I'm a participant in (RLS already scopes to me), oldest first. */
export async function listMyMessages(sb: SupabaseClient): Promise<DirectMessage[]> {
  const { data, error } = await sb.from("direct_messages").select("*").order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DirectMessage[];
}

export async function sendMessage(sb: SupabaseClient, recipientId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) throw new Error("Message is empty");
  const { data: userData } = await sb.auth.getUser();
  const myId = userData.user?.id;
  if (!myId) throw new Error("Must be signed in to message");
  if (recipientId === myId) throw new Error("Cannot message yourself");
  const { error } = await sb
    .from("direct_messages")
    .insert({ sender_id: myId, recipient_id: recipientId, body: text });
  if (error) throw error;
}

/** Mark messages from `otherId` to me as read. */
export async function markRead(sb: SupabaseClient, otherId: string): Promise<void> {
  const { data: userData } = await sb.auth.getUser();
  const myId = userData.user?.id;
  if (!myId) return;
  await sb
    .from("direct_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", myId)
    .eq("sender_id", otherId)
    .is("read_at", null);
}

/** Resolve display names for a set of user ids. */
export async function getProfileNames(sb: SupabaseClient, ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data, error } = await sb.from("profiles").select("id, display_name").in("id", ids);
  if (error) throw error;
  const names: Record<string, string> = {};
  for (const p of (data ?? []) as { id: string; display_name: string | null }[]) {
    names[p.id] = p.display_name ?? "Someone";
  }
  return names;
}
