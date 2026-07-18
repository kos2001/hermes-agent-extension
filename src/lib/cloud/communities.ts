import type PocketBase from "pocketbase";
import type { Community } from "./types";
import { and, eq, uid, createIgnoringDuplicate, deleteWhere } from "./pb";

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
export async function listCommunities(pb: PocketBase): Promise<Community[]> {
  const rows = await pb.collection("community_overview").getFullList({
    sort: "-member_count,created_at",
  });
  return rows as unknown as Community[];
}

/** Create a community and auto-join the creator. Returns the new id. */
export async function createCommunity(
  pb: PocketBase,
  name: string,
  description?: string,
): Promise<{ id: string }> {
  const cleanName = normalizeCommunityName(name);
  if (!isValidCommunityName(cleanName)) throw new Error("Community name must be 2–40 characters");

  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to create a community");

  const created = await pb.collection("communities").create({
    name: cleanName,
    description: description?.trim() || null,
    created_by: userId,
  });

  await pb.collection("community_members").create({ community_id: created.id, user_id: userId });
  return { id: created.id };
}

/** Delete a community you created (rules enforce ownership). Folders' community_id is set null. */
export async function deleteCommunity(pb: PocketBase, communityId: string): Promise<void> {
  await pb.collection("communities").delete(communityId);
}

export async function joinCommunity(pb: PocketBase, communityId: string): Promise<void> {
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to join");
  await createIgnoringDuplicate(pb, "community_members", { community_id: communityId, user_id: userId });
}

export async function leaveCommunity(pb: PocketBase, communityId: string): Promise<void> {
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to leave");
  await deleteWhere(pb, "community_members", and(eq("community_id", communityId), eq("user_id", userId)));
}

/** The set of community ids the current user has joined. */
export async function myCommunityIds(pb: PocketBase): Promise<Set<string>> {
  const userId = uid(pb);
  if (!userId) return new Set();
  const rows = await pb.collection("community_members").getFullList({
    filter: eq("user_id", userId),
    fields: "community_id",
  });
  return new Set((rows as unknown as { community_id: string }[]).map((r) => r.community_id));
}
