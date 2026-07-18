import type PocketBase from "pocketbase";
import type { Conversation, DirectMessage } from "./types";
import { and, eq, inList, uid } from "./pb";

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

/** All messages I'm a participant in (API rules already scope to me), oldest first. */
export async function listMyMessages(pb: PocketBase): Promise<DirectMessage[]> {
  const rows = await pb.collection("direct_messages").getFullList({ sort: "created_at" });
  return rows as unknown as DirectMessage[];
}

export async function sendMessage(pb: PocketBase, recipientId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) throw new Error("Message is empty");
  const myId = uid(pb);
  if (!myId) throw new Error("Must be signed in to message");
  if (recipientId === myId) throw new Error("Cannot message yourself");
  await pb.collection("direct_messages").create({ sender_id: myId, recipient_id: recipientId, body: text });
}

/** Mark messages from `otherId` to me as read. */
export async function markRead(pb: PocketBase, otherId: string): Promise<void> {
  const myId = uid(pb);
  if (!myId) return;
  const unread = await pb.collection("direct_messages").getFullList({
    filter: and(eq("recipient_id", myId), eq("sender_id", otherId), `read_at = ""`),
    fields: "id",
  });
  const when = new Date().toISOString();
  for (const m of unread) await pb.collection("direct_messages").update(m.id, { read_at: when });
}

/** Resolve display names for a set of user ids. */
export async function getProfileNames(pb: PocketBase, ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const rows = await pb.collection("users").getFullList({
    filter: inList("id", ids),
    fields: "id,display_name",
  });
  const names: Record<string, string> = {};
  for (const p of rows as unknown as { id: string; display_name: string | null }[]) {
    names[p.id] = p.display_name ?? "Someone";
  }
  return names;
}
