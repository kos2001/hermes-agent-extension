import type PocketBase from "pocketbase";
import type { CommunityMessage } from "./types";
import { eq, uid } from "./pb";

/** A community's chat messages, oldest first, joined with each poster. */
export async function listCommunityMessages(pb: PocketBase, communityId: string, limit = 100): Promise<CommunityMessage[]> {
  const result = await pb.collection("community_messages").getList(1, limit, {
    filter: eq("community_id", communityId),
    sort: "created_at",
    expand: "user_id",
  });
  return result.items.map((row) => {
    const { expand, ...m } = row as Record<string, unknown> & {
      expand?: { user_id?: { display_name: string | null; avatar_url: string | null } };
    };
    return {
      ...m,
      author: {
        display_name: expand?.user_id?.display_name ?? null,
        avatar_url: expand?.user_id?.avatar_url ?? null,
      },
    } as CommunityMessage;
  });
}

/** Post a message to a community chat as the current user. */
export async function sendCommunityMessage(pb: PocketBase, communityId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) throw new Error("Message is empty");
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to chat");
  await pb.collection("community_messages").create({ community_id: communityId, user_id: userId, body: text });
}
