import type { SupabaseClient } from "@supabase/supabase-js";
import type { PublishFolderInput, SharedFolder, SharedItem } from "./types";

/**
 * Publish (or re-publish) a folder. Idempotent on (owner_id, source_folder_name):
 * re-sharing the same folder updates the row and replaces its items rather than
 * creating duplicates.
 */
export async function publishFolder(
  sb: SupabaseClient,
  input: PublishFolderInput,
): Promise<{ folderId: string }> {
  const { data: userData } = await sb.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("Must be signed in to publish");

  const { data: folder, error: upErr } = await sb
    .from("shared_folders")
    .upsert(
      {
        owner_id: userId,
        title: input.title,
        source_folder_name: input.sourceFolderName,
        summary: input.summary,
        topics: input.topics,
        item_count: input.items.length,
        community_id: input.communityId ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,source_folder_name" },
    )
    .select()
    .single();
  if (upErr) throw upErr;

  const folderId = (folder as { id: string }).id;

  const { error: delErr } = await sb.from("shared_items").delete().eq("folder_id", folderId);
  if (delErr) throw delErr;

  if (input.items.length > 0) {
    const rows = input.items.map((it, i) => ({
      folder_id: folderId,
      title: it.title,
      url: it.url,
      item_summary: it.itemSummary ?? null,
      position: i,
    }));
    const { error: insErr } = await sb.from("shared_items").insert(rows);
    if (insErr) throw insErr;
  }

  return { folderId };
}

/** Fetch one folder with its items, ordered by position. */
export async function getFolder(
  sb: SupabaseClient,
  folderId: string,
): Promise<{ folder: SharedFolder; items: SharedItem[] }> {
  const { data: folder, error: fErr } = await sb
    .from("shared_folders")
    .select("*")
    .eq("id", folderId)
    .single();
  if (fErr) throw fErr;

  const { data: items, error: iErr } = await sb
    .from("shared_items")
    .select("*")
    .eq("folder_id", folderId)
    .order("position", { ascending: true });
  if (iErr) throw iErr;

  return { folder: folder as SharedFolder, items: (items ?? []) as SharedItem[] };
}
