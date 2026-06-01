import type { FeedEntry } from "./types";

export interface TopicCount {
  topic: string;
  count: number;
}

export interface FeedStats {
  folders: number;
  members: number;
  items: number;
  topics: number;
}

/**
 * Count how many shared FOLDERS feature each topic (deduped within a folder, so
 * "ai"/"AI" in one folder counts once), sorted by count (desc) then
 * alphabetically. Drives the collective-interest topic cloud.
 */
export function topicCounts(entries: FeedEntry[]): TopicCount[] {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const seen = new Set<string>();
    for (const raw of e.topics ?? []) {
      const topic = raw.trim().toLowerCase();
      if (!topic || seen.has(topic)) continue;
      seen.add(topic);
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count || (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0));
}

/** Headline numbers for the feed: folders, distinct members, total items, distinct topics. */
export function feedStats(entries: FeedEntry[]): FeedStats {
  const members = new Set<string>();
  let items = 0;
  for (const e of entries) {
    members.add(e.owner_id);
    items += e.item_count ?? 0;
  }
  return { folders: entries.length, members: members.size, items, topics: topicCounts(entries).length };
}

/**
 * Map a topic's frequency to a weight bucket 1..5 (for sizing the cloud).
 * `max` is the highest count in the set; equal counts get equal weight.
 */
export function topicWeight(count: number, max: number): number {
  if (max <= 1) return 3;
  return 1 + Math.round(((count - 1) / (max - 1)) * 4);
}
