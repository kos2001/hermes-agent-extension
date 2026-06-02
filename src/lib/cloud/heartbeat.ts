import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConnectionConfig } from "@/lib/types";
import type { Comment, FeedEntry } from "./types";
import { listFeed } from "./feed";
import { getFolder } from "./folders";
import { listComments, postComment } from "./comments";
import { generateOpinion } from "./agent-opinion";

/** chrome.alarms name for the autonomous-opinion ("heartbeat") schedule. */
export const HEARTBEAT_ALARM = "hive.heartbeat";
const HEARTBEAT_KEY = "hive.heartbeat";
/** Folders opined on per heartbeat run (bounds LLM cost). */
export const HEARTBEAT_CAP = 3;

export type HeartbeatFreq = "off" | "hourly" | "daily";
export interface HeartbeatSettings {
  freq: HeartbeatFreq;
}

export async function loadHeartbeatSettings(): Promise<HeartbeatSettings> {
  const stored = await chrome.storage.local.get(HEARTBEAT_KEY);
  const s = stored[HEARTBEAT_KEY] as HeartbeatSettings | undefined;
  return { freq: s?.freq ?? "off" };
}

export async function saveHeartbeatSettings(s: HeartbeatSettings): Promise<void> {
  await chrome.storage.local.set({ [HEARTBEAT_KEY]: s });
}

/** chrome.alarms period for a frequency, or null when off. */
export function heartbeatAlarmSpec(freq: HeartbeatFreq): { periodInMinutes: number } | null {
  if (freq === "hourly") return { periodInMinutes: 60 };
  if (freq === "daily") return { periodInMinutes: 24 * 60 };
  return null;
}

/** (Re)apply the heartbeat alarm to match the chosen frequency. */
export async function applyHeartbeatSchedule(freq: HeartbeatFreq): Promise<void> {
  await chrome.alarms.clear(HEARTBEAT_ALARM);
  const spec = heartbeatAlarmSpec(freq);
  if (spec) chrome.alarms.create(HEARTBEAT_ALARM, spec);
}

/**
 * Folders the agent should consider opining on: others' folders (never your
 * own), newest first (listFeed is already newest-first), capped. The
 * already-opined check happens per-folder against its comments.
 */
export function pickHeartbeatCandidates(feed: FeedEntry[], myUserId: string, cap = HEARTBEAT_CAP): FeedEntry[] {
  return feed.filter((f) => f.owner_id !== myUserId).slice(0, cap);
}

/** True if this user already has any comment in the thread (don't double-post). */
export function alreadyOpined(comments: Comment[], myUserId: string): boolean {
  return comments.some((c) => c.user_id === myUserId);
}

/**
 * One autonomous pass: read up to `cap` of others' newest folders the agent
 * hasn't yet engaged with, and post an agent opinion on each. Returns how many
 * it posted and how many candidates it scanned.
 */
export async function runHeartbeat(
  sb: SupabaseClient,
  config: ConnectionConfig,
  opts: { cap?: number; signal?: AbortSignal } = {},
): Promise<{ posted: number; scanned: number }> {
  const { data: userData } = await sb.auth.getUser();
  const myUserId = userData.user?.id;
  if (!myUserId) return { posted: 0, scanned: 0 };

  const feed = await listFeed(sb);
  const candidates = pickHeartbeatCandidates(feed, myUserId, opts.cap ?? HEARTBEAT_CAP);

  let posted = 0;
  for (const folder of candidates) {
    if (opts.signal?.aborted) break;
    const comments = await listComments(sb, folder.id);
    if (alreadyOpined(comments, myUserId)) continue;

    const { items } = await getFolder(sb, folder.id);
    const prior = comments.map((c) => ({
      label: c.author_kind === "agent" ? c.author_label ?? "agent" : c.author?.display_name ?? "member",
      body: c.body,
    }));
    const opinion = await generateOpinion(
      config,
      {
        title: folder.title,
        summary: folder.summary,
        topics: folder.topics,
        items: items.map((i) => ({ title: i.title, itemSummary: i.item_summary })),
      },
      prior,
      opts.signal,
    );
    await postComment(sb, folder.id, { body: opinion, kind: "agent", label: config.model });
    posted++;
  }

  return { posted, scanned: candidates.length };
}
