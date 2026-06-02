import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityItem } from "./types";
import { getProfileNames } from "./messages";
import { mentionsForMe } from "./mentions";

/** A raw engagement row (a comment by someone else, on my comment or folder). */
export interface RawEngagement {
  id: string;
  user_id: string;
  folder_id: string;
  created_at: string;
}

/** A raw upvote on one of my comments. */
export interface RawVote {
  comment_id: string;
  user_id: string;
  created_at: string;
}

export interface ActivitySources {
  replies: RawEngagement[];
  opinions: RawEngagement[];
  votes: RawVote[];
  mentions: RawEngagement[];
}

export interface ActivityContext {
  myId: string;
  names: Record<string, string>;
  titles: Record<string, string>;
  /** comment_id → folder_id, for navigating from a vote. */
  commentFolder: Record<string, string>;
}

/**
 * Merge engagements directed at me into a sorted activity feed:
 * replies to my opinions, top-level opinions on my folders, and upvotes on my
 * opinions. Self-authored rows dropped; newest first. Pure.
 */
export function buildActivity(src: ActivitySources, ctx: ActivityContext): ActivityItem[] {
  const { myId, names, titles, commentFolder } = ctx;
  const name = (id: string) => names[id] ?? "Someone";
  const title = (fid: string) => titles[fid] ?? "a folder";

  const items: ActivityItem[] = [
    ...src.replies.map(
      (r): ActivityItem => ({ id: `reply-${r.id}`, type: "reply", actorId: r.user_id, actorName: name(r.user_id), folderId: r.folder_id, folderTitle: title(r.folder_id), when: r.created_at }),
    ),
    ...src.opinions.map(
      (r): ActivityItem => ({ id: `opinion-${r.id}`, type: "opinion", actorId: r.user_id, actorName: name(r.user_id), folderId: r.folder_id, folderTitle: title(r.folder_id), when: r.created_at }),
    ),
    ...src.votes.map((v): ActivityItem => {
      const fid = commentFolder[v.comment_id] ?? "";
      return { id: `vote-${v.comment_id}-${v.user_id}`, type: "vote", actorId: v.user_id, actorName: name(v.user_id), folderId: fid, folderTitle: title(fid), when: v.created_at };
    }),
    ...src.mentions.map(
      (r): ActivityItem => ({ id: `mention-${r.id}`, type: "mention", actorId: r.user_id, actorName: name(r.user_id), folderId: r.folder_id, folderTitle: title(r.folder_id), when: r.created_at }),
    ),
  ];
  return items.filter((a) => a.actorId !== myId).sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
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

  const { data: myComments } = await sb.from("comments").select("id, folder_id").eq("user_id", myId);
  const commentRows = (myComments ?? []) as { id: string; folder_id: string }[];
  const myCommentIds = commentRows.map((c) => c.id);
  const commentFolder: Record<string, string> = {};
  for (const c of commentRows) commentFolder[c.id] = c.folder_id;

  const { data: myFolders } = await sb.from("shared_folders").select("id, title").eq("owner_id", myId);
  const myFolderIds = (myFolders ?? []).map((f: { id: string }) => f.id);
  const titles: Record<string, string> = {};
  for (const f of (myFolders ?? []) as { id: string; title: string }[]) titles[f.id] = f.title;

  let replies: RawEngagement[] = [];
  let votes: RawVote[] = [];
  if (myCommentIds.length) {
    const { data: rep } = await sb
      .from("comments")
      .select("id, user_id, folder_id, created_at")
      .in("parent_id", myCommentIds)
      .neq("user_id", myId);
    replies = (rep ?? []) as RawEngagement[];
    const { data: v } = await sb
      .from("opinion_votes")
      .select("comment_id, user_id, created_at")
      .in("comment_id", myCommentIds)
      .neq("user_id", myId);
    votes = (v ?? []) as RawVote[];
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

  const mentions = await mentionsForMe(sb);

  // Resolve titles for any folders not already known (reply / vote / mention folders).
  const involved = new Set<string>([
    ...replies.map((r) => r.folder_id),
    ...votes.map((v) => commentFolder[v.comment_id]).filter(Boolean),
    ...mentions.map((r) => r.folder_id).filter(Boolean),
  ]);
  const missing = [...involved].filter((id) => id && !titles[id]);
  if (missing.length) {
    const { data } = await sb.from("shared_folders").select("id, title").in("id", missing);
    for (const f of (data ?? []) as { id: string; title: string }[]) titles[f.id] = f.title;
  }

  const actorIds = [...new Set([...replies, ...opinions, ...votes, ...mentions].map((r) => r.user_id))];
  const names = await getProfileNames(sb, actorIds);

  return buildActivity({ replies, opinions, votes, mentions }, { myId, names, titles, commentFolder });
}
