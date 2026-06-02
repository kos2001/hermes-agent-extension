import type { SupabaseClient } from "@supabase/supabase-js";

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
export async function listLeaderboard(sb: SupabaseClient, limit = 20): Promise<Contributor[]> {
  const { data, error } = await sb.from("contributor_reputation").select("*");
  if (error) throw error;
  return rankContributors((data ?? []) as Contributor[]).slice(0, limit);
}

/** One member's reputation row (for their profile). */
export async function getContributor(sb: SupabaseClient, userId: string): Promise<Contributor | null> {
  const { data, error } = await sb.from("contributor_reputation").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return (data as Contributor | null) ?? null;
}
