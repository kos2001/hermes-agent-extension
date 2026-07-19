import type PocketBase from "pocketbase";
import { eq, uid } from "./pb";

/** A team: a curated roster assembled around a stated problem. */
export interface Team {
  id: string;
  owner_id: string;
  name: string;
  topic: string;
  problem: string;
  status: "open" | "solved";
  outcome: string;
  created_at: string;
  updated_at: string;
}

/** A roster entry, with the member joined. */
export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role_note: string;
  member?: { display_name: string | null };
}

/** A message in a team discussion, with the author joined. */
export interface TeamMessage {
  id: string;
  team_id: string;
  user_id: string;
  author_kind: "human" | "agent" | "";
  author_label: string;
  body: string;
  created_at: string;
  author?: { display_name: string | null };
}

/** Trim/collapse a team name. Pure. */
export function normalizeTeamName(raw: string): string {
  return (raw || "").trim().replace(/\s+/g, " ");
}

/** A team name is 2–140 chars after normalizing. Pure. */
export function isValidTeamName(raw: string): boolean {
  const n = normalizeTeamName(raw);
  return n.length >= 2 && n.length <= 140;
}

/** All teams, newest first. */
export async function listTeams(pb: PocketBase, limit = 100): Promise<Team[]> {
  const res = await pb.collection("teams").getList(1, limit, { sort: "-created_at" });
  return res.items as unknown as Team[];
}

/** One team by id. */
export async function getTeam(pb: PocketBase, teamId: string): Promise<Team> {
  return (await pb.collection("teams").getOne(teamId)) as unknown as Team;
}

/** Create a team around a problem; returns its id. */
export async function createTeam(
  pb: PocketBase,
  data: { name: string; topic?: string; problem: string },
): Promise<string> {
  const name = normalizeTeamName(data.name);
  if (!isValidTeamName(name)) throw new Error("Team name must be 2–140 characters");
  const problem = (data.problem ?? "").trim();
  if (!problem) throw new Error("A problem statement is required");
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to create a team");
  const created = await pb.collection("teams").create({
    owner_id: userId,
    name,
    topic: (data.topic ?? "").trim(),
    problem,
    status: "open",
  });
  return created.id;
}

/** Conclude a team: record the outcome and mark it solved (owner only, server-enforced). */
export async function concludeTeam(pb: PocketBase, teamId: string, outcome: string): Promise<void> {
  const text = outcome.trim();
  if (!text) throw new Error("An outcome is required to conclude");
  await pb.collection("teams").update(teamId, { status: "solved", outcome: text });
}

/** The team's roster, with each member joined. */
export async function listTeamMembers(pb: PocketBase, teamId: string): Promise<TeamMember[]> {
  const res = await pb.collection("team_members").getFullList({
    filter: eq("team_id", teamId),
    expand: "user_id",
    sort: "created_at",
  });
  return res.map((row) => {
    const { expand, ...m } = row as Record<string, unknown> & {
      expand?: { user_id?: { display_name: string | null } };
    };
    return { ...m, member: { display_name: expand?.user_id?.display_name ?? null } } as TeamMember;
  });
}

/** Add a member to the roster (owner only, server-enforced). */
export async function addTeamMember(
  pb: PocketBase,
  teamId: string,
  userId: string,
  roleNote = "",
): Promise<void> {
  await pb.collection("team_members").create({ team_id: teamId, user_id: userId, role_note: roleNote });
}

/** Remove a roster entry (owner, or the member leaving). */
export async function removeTeamMember(pb: PocketBase, memberRowId: string): Promise<void> {
  await pb.collection("team_members").delete(memberRowId);
}

/** Team ids the current user is a roster member of. */
export async function myTeamIds(pb: PocketBase): Promise<Set<string>> {
  const userId = uid(pb);
  if (!userId) return new Set();
  const rows = await pb.collection("team_members").getFullList({ filter: eq("user_id", userId), fields: "team_id" });
  return new Set(rows.map((r) => (r as unknown as { team_id: string }).team_id));
}

/** A team's discussion, oldest first, joined with each author. */
export async function listTeamMessages(pb: PocketBase, teamId: string, limit = 200): Promise<TeamMessage[]> {
  const res = await pb.collection("team_messages").getList(1, limit, {
    filter: eq("team_id", teamId),
    sort: "created_at",
    expand: "user_id",
  });
  return res.items.map((row) => {
    const { expand, ...m } = row as Record<string, unknown> & {
      expand?: { user_id?: { display_name: string | null } };
    };
    return { ...m, author: { display_name: expand?.user_id?.display_name ?? null } } as TeamMessage;
  });
}

/** Post a message to a team discussion as the current user. */
export async function sendTeamMessage(pb: PocketBase, teamId: string, body: string): Promise<void> {
  const text = body.trim();
  if (!text) throw new Error("Message is empty");
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to post");
  await pb.collection("team_messages").create({
    team_id: teamId,
    user_id: userId,
    author_kind: "human",
    body: text,
  });
}
