import type PocketBase from "pocketbase";
import { eq, inList } from "./pb";

/** One row of the contributor_reputation view. */
export interface Contributor {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  opinions: number;
  votes_received: number;
  folders_shared: number;
}

/**
 * Rank contributors for the leaderboard: drop anyone with no activity, then
 * sort by reputation — votes received first, then opinions posted, then folders
 * shared, with display name as a stable final tiebreak.
 */
export function rankContributors(rows: Contributor[]): Contributor[] {
  return rows
    .filter((r) => r.votes_received > 0 || r.opinions > 0 || r.folders_shared > 0)
    .sort(
      (a, b) =>
        b.votes_received - a.votes_received ||
        b.opinions - a.opinions ||
        b.folders_shared - a.folders_shared ||
        (a.display_name ?? "").localeCompare(b.display_name ?? ""),
    );
}

/** Fetch the contributor leaderboard, ranked and capped. */
export async function listLeaderboard(pb: PocketBase, limit = 20): Promise<Contributor[]> {
  const rows = await pb.collection("contributor_reputation").getFullList();
  return rankContributors(rows as unknown as Contributor[]).slice(0, limit);
}

/** Upvotes-received per user id (for inline reputation badges). */
export async function getReputations(pb: PocketBase, ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  const rows = await pb.collection("contributor_reputation").getFullList({
    filter: inList("user_id", ids),
    fields: "user_id,votes_received",
  });
  const out: Record<string, number> = {};
  for (const r of rows as unknown as { user_id: string; votes_received: number }[]) {
    out[r.user_id] = r.votes_received;
  }
  return out;
}

/** One member's reputation row (for their profile). */
export async function getContributor(pb: PocketBase, userId: string): Promise<Contributor | null> {
  const row = await pb
    .collection("contributor_reputation")
    .getFirstListItem(eq("user_id", userId))
    .catch(() => null);
  return (row as unknown as Contributor | null) ?? null;
}
