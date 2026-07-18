import type PocketBase from "pocketbase";

/** A member with their newest participation timestamp (derived server-side). */
export interface RecentAgent {
  user_id: string;
  display_name: string | null;
  last_active: string;
  actions: number;
}

/** Members whose last activity falls within the window, most recent first. Pure. */
export function activeWithin(rows: RecentAgent[], hours: number, now: Date = new Date()): RecentAgent[] {
  const cutoff = now.getTime() - hours * 3600_000;
  return rows
    .filter((r) => new Date(r.last_active).getTime() >= cutoff)
    .sort((a, b) => (a.last_active < b.last_active ? 1 : -1));
}

/** The hive's recently active members (newest participation first). */
export async function listRecentAgents(pb: PocketBase, limit = 50): Promise<RecentAgent[]> {
  const result = await pb.collection("recent_agents").getList(1, limit, { sort: "-last_active" });
  return result.items as unknown as RecentAgent[];
}
