import type PocketBase from "pocketbase";
import type { PublishFolderInput, SharedFolder, SharedItem } from "./types";
import { and, eq, uid, deleteWhere } from "./pb";

/**
 * Publish (or re-publish) a folder. Idempotent on (owner_id, source_folder_name):
 * re-sharing the same folder updates the row and replaces its items rather than
 * creating duplicates.
 */
export async function publishFolder(
  pb: PocketBase,
  input: PublishFolderInput,
): Promise<{ folderId: string }> {
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to publish");

  const data = {
    owner_id: userId,
    title: input.title,
    source_folder_name: input.sourceFolderName,
    summary: input.summary,
    topics: input.topics,
    item_count: input.items.length,
    community_id: input.communityId ?? null,
  };

  const existing = await pb
    .collection("shared_folders")
    .getFirstListItem(and(eq("owner_id", userId), eq("source_folder_name", input.sourceFolderName)))
    .catch(() => null);

  const folder = existing
    ? await pb.collection("shared_folders").update(existing.id, data)
    : await pb.collection("shared_folders").create(data);
  const folderId = folder.id;

  await deleteWhere(pb, "shared_items", eq("folder_id", folderId));

  for (const [i, it] of input.items.entries()) {
    await pb.collection("shared_items").create({
      folder_id: folderId,
      title: it.title,
      url: it.url,
      item_summary: it.itemSummary ?? null,
      position: i,
    });
  }

  return { folderId };
}

/** Fetch one folder with its items, ordered by position. */
export async function getFolder(
  pb: PocketBase,
  folderId: string,
): Promise<{ folder: SharedFolder; items: SharedItem[] }> {
  const folder = await pb.collection("shared_folders").getOne(folderId);
  const items = await pb.collection("shared_items").getFullList({
    filter: eq("folder_id", folderId),
    sort: "position",
  });
  return { folder: folder as unknown as SharedFolder, items: items as unknown as SharedItem[] };
}
