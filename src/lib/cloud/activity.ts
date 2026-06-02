import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityItem } from "./types";
import { getProfileNames } from "./messages";

/** A raw engagement row (a comment by someone else, on my comment or folder). */
export interface RawEngagement {
  id: string;
  user_id: string;
  folder_id: string;
  created_at: string;
}

/**
 * Merge engagements directed at me into a sorted activity feed. `replies` are
 * comments replying to my opinions; `opinions` are top-level opinions on my
 * folders. Self-authored rows are dropped; newest first. Pure.
 */
export function buildActivity(
  replies: RawEngagement[],
  opinions: RawEngagement[],
  myId: string,
  names: Record<string, string>,
  titles: Record<string, string>,
): ActivityItem[] {
  const mk = (r: RawEngagement, type: ActivityItem["type"]): ActivityItem => ({
    id: r.id,
    type,
    actorId: r.user_id,
    actorName: names[r.user_id] ?? "Someone",
    folderId: r.folder_id,
    folderTitle: titles[r.folder_id] ?? "a folder",
    when: r.created_at,
  });
  return [...replies.map((r) => mk(r, "reply")), ...opinions.map((r) => mk(r, "opinion"))]
    .filter((a) => a.actorId !== myId)
    .sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
}

/** How many items are newer than the last-seen timestamp (null = all unseen). */
export function unseenCount(items: ActivityItem[], lastSeen: string | null): number {
  if (!lastSeen) return items.length;
  return items.filter((i) => i.when > lastSeen).length;
}

/** Load the current member's activity feed (derived from existing tables). */
export async function loadActivity(sb: SupabaseClient): Promise<ActivityItem[]> {
  const { data: userData } = await sb.auth.getUser();
  const myId = userData.user?.id;
  if (!myId) return [];

  const { data: myComments } = await sb.from("comments").select("id").eq("user_id", myId);
  const myCommentIds = (myComments ?? []).map((c: { id: string }) => c.id);

  const { data: myFolders } = await sb.from("shared_folders").select("id, title").eq("owner_id", myId);
  const myFolderIds = (myFolders ?? []).map((f: { id: string }) => f.id);
  const titles: Record<string, string> = {};
  for (const f of (myFolders ?? []) as { id: string; title: string }[]) titles[f.id] = f.title;

  let replies: RawEngagement[] = [];
  if (myCommentIds.length) {
    const { data } = await sb
      .from("comments")
      .select("id, user_id, folder_id, created_at")
      .in("parent_id", myCommentIds)
      .neq("user_id", myId);
    replies = (data ?? []) as RawEngagement[];
  }

  let opinions: RawEngagement[] = [];
  if (myFolderIds.length) {
    const { data } = await sb
      .from("comments")
      .select("id, user_id, folder_id, created_at")
      .in("folder_id", myFolderIds)
      .is("parent_id", null)
      .neq("user_id", myId);
    opinions = (data ?? []) as RawEngagement[];
  }

  // Titles for reply folders may include folders that aren't mine.
  const missing = [...new Set(replies.map((r) => r.folder_id))].filter((id) => !titles[id]);
  if (missing.length) {
    const { data } = await sb.from("shared_folders").select("id, title").in("id", missing);
    for (const f of (data ?? []) as { id: string; title: string }[]) titles[f.id] = f.title;
  }

  const actorIds = [...new Set([...replies, ...opinions].map((r) => r.user_id))];
  const names = await getProfileNames(sb, actorIds);

  return buildActivity(replies, opinions, myId, names, titles);
}
