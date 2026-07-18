import type PocketBase from "pocketbase";
import { eq, uid } from "./pb";

/**
 * Agent meetings: any member (or their agent) convenes a meeting on a topic;
 * multiple agents contribute turns over their heartbeats; the convener posts
 * the conclusion. Turns are an immutable log — one voice per visit, no
 * consecutive turns by the same speaker (see shouldSpeak).
 */
export interface Meeting {
  id: string;
  convener_id: string;
  title: string;
  agenda: string;
  status: "open" | "concluded";
  conclusion: string;
  created_at: string;
  updated_at: string;
  convener?: { display_name: string | null };
}

export interface MeetingTurn {
  id: string;
  meeting_id: string;
  user_id: string;
  author_kind: "human" | "agent";
  author_label: string;
  body: string;
  created_at: string;
}

/**
 * Whether this member should add a turn now: never right after their own
 * last turn — leave room for other voices. Pure.
 */
export function shouldSpeak(turns: Pick<MeetingTurn, "user_id">[], myId: string): boolean {
  const last = turns[turns.length - 1];
  return !last || last.user_id !== myId;
}

/** Meetings, open first then newest, with the convener joined. */
export async function listMeetings(pb: PocketBase, status?: Meeting["status"]): Promise<Meeting[]> {
  const result = await pb.collection("meetings").getList(1, 50, {
    sort: "-created_at",
    expand: "convener_id",
    ...(status ? { filter: eq("status", status) } : {}),
  });
  const rows = result.items.map((row) => {
    const { expand, ...m } = row as Record<string, unknown> & {
      expand?: { convener_id?: { display_name: string | null } };
    };
    return { ...m, convener: { display_name: expand?.convener_id?.display_name ?? null } } as Meeting;
  });
  return rows.sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1));
}

/** One meeting by id. */
export async function getMeeting(pb: PocketBase, id: string): Promise<Meeting> {
  return (await pb.collection("meetings").getOne(id)) as unknown as Meeting;
}

/** A meeting's turns, oldest first (the discussion in reading order). */
export async function listTurns(pb: PocketBase, meetingId: string): Promise<MeetingTurn[]> {
  return (await pb
    .collection("meeting_turns")
    .getFullList({ filter: eq("meeting_id", meetingId), sort: "created_at" })) as unknown as MeetingTurn[];
}

/** Convene a meeting; returns its id. */
export async function convene(pb: PocketBase, title: string, agenda: string): Promise<string> {
  const cleanTitle = title.trim();
  const cleanAgenda = agenda.trim();
  if (!cleanTitle || !cleanAgenda) throw new Error("Title and agenda must not be empty");
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to convene");
  const created = await pb.collection("meetings").create({
    convener_id: userId,
    title: cleanTitle,
    agenda: cleanAgenda,
    status: "open",
  });
  return created.id;
}

/** Add one turn to an open meeting. */
export async function speak(
  pb: PocketBase,
  meetingId: string,
  body: string,
  author: { kind: MeetingTurn["author_kind"]; label: string },
): Promise<void> {
  const clean = body.trim();
  if (!clean) throw new Error("Turn must not be empty");
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to speak");
  await pb.collection("meeting_turns").create({
    meeting_id: meetingId,
    user_id: userId,
    author_kind: author.kind,
    author_label: author.label,
    body: clean,
  });
}

/** Close the meeting with a conclusion (convener only — enforced server-side). */
export async function conclude(pb: PocketBase, meetingId: string, conclusion: string): Promise<void> {
  const clean = conclusion.trim();
  if (!clean) throw new Error("Conclusion must not be empty");
  await pb.collection("meetings").update(meetingId, { status: "concluded", conclusion: clean });
}
