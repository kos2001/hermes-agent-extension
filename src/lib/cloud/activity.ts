import type PocketBase from "pocketbase";
import type { ActivityItem } from "./types";
import { getProfileNames } from "./messages";
import { mentionsForMe } from "./mentions";
import { and, eq, inList, neq, uid } from "./pb";

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

/**
 * A directed event from the agent-work surfaces, pre-resolved to a title:
 * my board request answered, an entry/review/win on my challenges, a turn in
 * my meeting. `type` distinguishes them; there is no folder to navigate to.
 */
export interface RawEvent {
  id: string;
  type: Extract<ActivityItem["type"], "task_done" | "submission" | "review" | "win" | "turn">;
  user_id: string;
  title: string;
  created_at: string;
}

export interface ActivitySources {
  replies: RawEngagement[];
  opinions: RawEngagement[];
  votes: RawVote[];
  mentions: RawEngagement[];
  events?: RawEvent[];
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
    ...(src.events ?? []).map(
      (e): ActivityItem => ({ id: `${e.type}-${e.id}`, type: e.type, actorId: e.user_id, actorName: name(e.user_id), folderId: "", folderTitle: e.title, when: e.created_at }),
    ),
  ];
  return items.filter((a) => a.actorId !== myId).sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
}

/** How many items are newer than the last-seen timestamp (null = all unseen). */
export function unseenCount(items: ActivityItem[], lastSeen: string | null): number {
  if (!lastSeen) return items.length;
  return items.filter((i) => i.when > lastSeen).length;
}

/** Load the current member's activity feed (derived from existing collections). */
export async function loadActivity(pb: PocketBase): Promise<ActivityItem[]> {
  const myId = uid(pb);
  if (!myId) return [];

  const commentRows = (await pb.collection("comments").getFullList({
    filter: eq("user_id", myId),
    fields: "id,folder_id",
  })) as unknown as { id: string; folder_id: string }[];
  const myCommentIds = commentRows.map((c) => c.id);
  const commentFolder: Record<string, string> = {};
  for (const c of commentRows) commentFolder[c.id] = c.folder_id;

  const myFolders = (await pb.collection("shared_folders").getFullList({
    filter: eq("owner_id", myId),
    fields: "id,title",
  })) as unknown as { id: string; title: string }[];
  const myFolderIds = myFolders.map((f) => f.id);
  const titles: Record<string, string> = {};
  for (const f of myFolders) titles[f.id] = f.title;

  let replies: RawEngagement[] = [];
  let votes: RawVote[] = [];
  if (myCommentIds.length) {
    replies = (await pb.collection("comments").getFullList({
      filter: and(inList("parent_id", myCommentIds), neq("user_id", myId)),
      fields: "id,user_id,folder_id,created_at",
    })) as unknown as RawEngagement[];
    votes = (await pb.collection("opinion_votes").getFullList({
      filter: and(inList("comment_id", myCommentIds), neq("user_id", myId)),
      fields: "comment_id,user_id,created_at",
    })) as unknown as RawVote[];
  }

  let opinions: RawEngagement[] = [];
  if (myFolderIds.length) {
    opinions = (await pb.collection("comments").getFullList({
      filter: and(inList("folder_id", myFolderIds), `parent_id = ""`, neq("user_id", myId)),
      fields: "id,user_id,folder_id,created_at",
    })) as unknown as RawEngagement[];
  }

  const mentions = await mentionsForMe(pb);
  const events = await loadWorkEvents(pb, myId);

  // Resolve titles for any folders not already known (reply / vote / mention folders).
  const involved = new Set<string>([
    ...replies.map((r) => r.folder_id),
    ...votes.map((v) => commentFolder[v.comment_id]).filter(Boolean),
    ...mentions.map((r) => r.folder_id).filter(Boolean),
  ]);
  const missing = [...involved].filter((id) => id && !titles[id]);
  if (missing.length) {
    const rows = (await pb.collection("shared_folders").getFullList({
      filter: inList("id", missing),
      fields: "id,title",
    })) as unknown as { id: string; title: string }[];
    for (const f of rows) titles[f.id] = f.title;
  }

  const actorIds = [...new Set([...replies, ...opinions, ...votes, ...mentions, ...events].map((r) => r.user_id))];
  const names = await getProfileNames(pb, actorIds);

  return buildActivity({ replies, opinions, votes, mentions, events }, { myId, names, titles, commentFolder });
}

/** Directed events from the board / challenges / meetings, titles resolved. */
async function loadWorkEvents(pb: PocketBase, myId: string): Promise<RawEvent[]> {
  const events: RawEvent[] = [];

  // my board requests that got answered
  const doneTasks = (await pb.collection("agent_tasks").getFullList({
    filter: and(eq("requester_id", myId), eq("status", "done")),
    fields: "id,title,claimed_by,updated_at",
  })) as unknown as { id: string; title: string; claimed_by: string; updated_at: string }[];
  events.push(...doneTasks.map((t): RawEvent => ({ id: t.id, type: "task_done", user_id: t.claimed_by, title: t.title, created_at: t.updated_at })));

  // entries on my challenges
  const myChallenges = (await pb.collection("challenges").getFullList({
    filter: eq("poster_id", myId),
    fields: "id,title",
  })) as unknown as { id: string; title: string }[];
  const chTitle: Record<string, string> = {};
  for (const c of myChallenges) chTitle[c.id] = c.title;
  if (myChallenges.length) {
    const subs = (await pb.collection("challenge_submissions").getFullList({
      filter: and(inList("challenge_id", myChallenges.map((c) => c.id)), neq("user_id", myId)),
      fields: "id,challenge_id,user_id,created_at",
    })) as unknown as { id: string; challenge_id: string; user_id: string; created_at: string }[];
    events.push(...subs.map((s): RawEvent => ({ id: s.id, type: "submission", user_id: s.user_id, title: chTitle[s.challenge_id] ?? "a challenge", created_at: s.created_at })));
  }

  // reviews on my entries (title = the challenge I entered)
  const mySubs = (await pb.collection("challenge_submissions").getFullList({
    filter: eq("user_id", myId),
    fields: "id,challenge_id",
  })) as unknown as { id: string; challenge_id: string }[];
  if (mySubs.length) {
    const subChallenge: Record<string, string> = {};
    for (const s of mySubs) subChallenge[s.id] = s.challenge_id;
    const missingCh = [...new Set(mySubs.map((s) => s.challenge_id))].filter((id) => !chTitle[id]);
    if (missingCh.length) {
      const rows = (await pb.collection("challenges").getFullList({
        filter: inList("id", missingCh),
        fields: "id,title",
      })) as unknown as { id: string; title: string }[];
      for (const c of rows) chTitle[c.id] = c.title;
    }
    const reviews = (await pb.collection("submission_reviews").getFullList({
      filter: inList("submission_id", mySubs.map((s) => s.id)),
      fields: "id,submission_id,user_id,created_at",
    })) as unknown as { id: string; submission_id: string; user_id: string; created_at: string }[];
    events.push(...reviews.map((r): RawEvent => ({ id: r.id, type: "review", user_id: r.user_id, title: chTitle[subChallenge[r.submission_id]] ?? "a challenge", created_at: r.created_at })));
  }

  // bounties I won (actor = the poster who judged)
  const wins = (await pb.collection("challenges").getFullList({
    filter: and(eq("winner_id", myId), eq("status", "judged")),
    fields: "id,title,poster_id,bounty,updated_at",
  })) as unknown as { id: string; title: string; poster_id: string; bounty: number; updated_at: string }[];
  events.push(...wins.map((c): RawEvent => ({ id: c.id, type: "win", user_id: c.poster_id, title: `${c.title} (+${c.bounty}pt)`, created_at: c.updated_at })));

  // turns in meetings I convened
  const myMeetings = (await pb.collection("meetings").getFullList({
    filter: eq("convener_id", myId),
    fields: "id,title",
  })) as unknown as { id: string; title: string }[];
  if (myMeetings.length) {
    const mTitle: Record<string, string> = {};
    for (const m of myMeetings) mTitle[m.id] = m.title;
    const turns = (await pb.collection("meeting_turns").getFullList({
      filter: and(inList("meeting_id", myMeetings.map((m) => m.id)), neq("user_id", myId)),
      fields: "id,meeting_id,user_id,created_at",
    })) as unknown as { id: string; meeting_id: string; user_id: string; created_at: string }[];
    events.push(...turns.map((tn): RawEvent => ({ id: tn.id, type: "turn", user_id: tn.user_id, title: mTitle[tn.meeting_id] ?? "a meeting", created_at: tn.created_at })));
  }

  return events;
}
