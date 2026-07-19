import type PocketBase from "pocketbase";
import { eq, uid } from "./pb";

/** A member's self-written persona (agent_profiles). skills is a string array. */
export interface AgentProfile {
  id: string;
  user_id: string;
  role: string;
  bio: string;
  skills: string[];
  llm: string;
}

/** Parse a comma/space-separated skills string into a clean, deduped list. Pure. */
export function parseSkills(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of (raw || "").split(/[,\n]/)) {
    const t = s.trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

/** Normalize a raw record's skills (may be JSON array, string, or null). Pure. */
export function normalizeProfile(row: Record<string, unknown>): AgentProfile {
  const skills = Array.isArray(row.skills)
    ? (row.skills as unknown[]).map(String)
    : typeof row.skills === "string" && row.skills
      ? parseSkills(row.skills as string)
      : [];
  return {
    id: String(row.id ?? ""),
    user_id: String(row.user_id ?? ""),
    role: String(row.role ?? ""),
    bio: String(row.bio ?? ""),
    skills,
    llm: String(row.llm ?? ""),
  };
}

/** All personas, keyed by user_id (for merging into member/agent lists). */
export async function listProfiles(pb: PocketBase): Promise<Map<string, AgentProfile>> {
  const rows = await pb.collection("agent_profiles").getFullList();
  const map = new Map<string, AgentProfile>();
  for (const r of rows) {
    const p = normalizeProfile(r as Record<string, unknown>);
    if (p.user_id) map.set(p.user_id, p);
  }
  return map;
}

/** One member's persona, or null. */
export async function getProfile(pb: PocketBase, userId: string): Promise<AgentProfile | null> {
  const rows = await pb.collection("agent_profiles").getFullList({ filter: eq("user_id", userId) });
  return rows.length ? normalizeProfile(rows[0] as Record<string, unknown>) : null;
}

/** Create or update the current member's own persona; returns it. */
export async function upsertProfile(
  pb: PocketBase,
  data: { role?: string; bio?: string; skills?: string[]; llm?: string },
): Promise<AgentProfile> {
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in to set a profile");
  const payload = {
    role: (data.role ?? "").trim(),
    bio: (data.bio ?? "").trim(),
    skills: data.skills ?? [],
    llm: (data.llm ?? "").trim(),
  };
  const existing = await pb.collection("agent_profiles").getFullList({ filter: eq("user_id", userId) });
  const saved = existing.length
    ? await pb.collection("agent_profiles").update(existing[0].id, payload)
    : await pb.collection("agent_profiles").create({ user_id: userId, ...payload });
  return normalizeProfile(saved as Record<string, unknown>);
}
