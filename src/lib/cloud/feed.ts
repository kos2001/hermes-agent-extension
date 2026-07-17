import type PocketBase from "pocketbase";
import type { FeedEntry } from "./types";
import { and, eq, inList, uid, createIgnoringDuplicate, deleteWhere } from "./pb";

type ReactionKind = "like" | "save";

function toFeedEntry(row: Record<string, unknown>): FeedEntry {
  const { expand, ...folder } = row as Record<string, unknown> & {
    expand?: { owner_id?: { display_name: string | null; avatar_url: string | null } };
  };
  return {
    ...folder,
    owner: {
      display_name: expand?.owner_id?.display_name ?? null,
      avatar_url: expand?.owner_id?.avatar_url ?? null,
    },
  } as FeedEntry;
}

/** Newest shared folders, each joined with its owner profile. Optionally scoped to one community. */
export async function listFeed(pb: PocketBase, limit = 50, communityId?: string): Promise<FeedEntry[]> {
  const result = await pb.collection("shared_folders").getList(1, limit, {
    sort: "-updated_at",
    expand: "owner_id",
    ...(communityId ? { filter: eq("community_id", communityId) } : {}),
  });
  return result.items.map((r) => toFeedEntry(r as Record<string, unknown>));
}

/** A single member's shared folders, newest first. */
export async function listOwnerFolders(pb: PocketBase, ownerId: string): Promise<FeedEntry[]> {
  const rows = await pb.collection("shared_folders").getFullList({
    filter: eq("owner_id", ownerId),
    sort: "-updated_at",
    expand: "owner_id",
  });
  return rows.map((r) => toFeedEntry(r as Record<string, unknown>));
}

export async function react(pb: PocketBase, folderId: string, kind: ReactionKind): Promise<void> {
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to react");
  await createIgnoringDuplicate(pb, "reactions", { folder_id: folderId, user_id: userId, kind });
}

export async function unreact(pb: PocketBase, folderId: string, kind: ReactionKind): Promise<void> {
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to react");
  await deleteWhere(pb, "reactions", and(eq("folder_id", folderId), eq("user_id", userId), eq("kind", kind)));
}

/** Key for a (folder, kind) pair in the myReactions set. */
export function reactionKey(folderId: string, kind: ReactionKind): string {
  return `${folderId}:${kind}`;
}

/** Like/save tallies per folder id (every requested id gets an entry). */
export async function reactionCounts(
  pb: PocketBase,
  folderIds: string[],
): Promise<Record<string, { like: number; save: number }>> {
  if (folderIds.length === 0) return {};
  const rows = await pb.collection("reactions").getFullList({
    filter: inList("folder_id", folderIds),
    fields: "folder_id,kind",
  });
  const counts: Record<string, { like: number; save: number }> = {};
  for (const id of folderIds) counts[id] = { like: 0, save: 0 };
  for (const row of rows as unknown as { folder_id: string; kind: ReactionKind }[]) {
    const c = counts[row.folder_id];
    if (c && (row.kind === "like" || row.kind === "save")) c[row.kind] += 1;
  }
  return counts;
}

/** The set of reactionKey(folder, kind) the current user has made (from the given ids). */
export async function myReactions(pb: PocketBase, folderIds: string[]): Promise<Set<string>> {
  if (folderIds.length === 0) return new Set();
  const userId = uid(pb);
  if (!userId) return new Set();
  const rows = await pb.collection("reactions").getFullList({
    filter: and(eq("user_id", userId), inList("folder_id", folderIds)),
    fields: "folder_id,kind",
  });
  return new Set(
    (rows as unknown as { folder_id: string; kind: ReactionKind }[]).map((r) => reactionKey(r.folder_id, r.kind)),
  );
}
