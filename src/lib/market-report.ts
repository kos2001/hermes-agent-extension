import type { BookmarkNode } from "./bookmarks";

export interface SiteSummary {
  url: string;
  title: string;
  summary: string;
  error?: string;
}

export interface MarketReport {
  id: string;
  folderId: string;
  folderTitle: string;
  createdAt: number;
  sites: SiteSummary[];
  synthesis: string;
  skipped: number;
}

export type ScheduleFreq = "off" | "daily" | "weekly";

export interface MarketSettings {
  folderId: string;
  freq: ScheduleFreq;
  hour: number;
}

export interface FolderInfo {
  id: string;
  title: string;
}

/** Max sites summarized per report (service-worker lifetime + token cost). */
export const MAX_SITES = 20;
/** Below this many chars, the fetch result is "thin" and we try the tab path. */
export const MIN_TEXT = 200;

/** Folders that directly contain at least one bookmark, titled and sorted. */
export function listFolders(nodes: BookmarkNode[]): FolderInfo[] {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    if (n.url && n.parentId) counts.set(n.parentId, (counts.get(n.parentId) ?? 0) + 1);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: FolderInfo[] = [];
  for (const folderId of counts.keys()) {
    const node = byId.get(folderId);
    out.push({ id: folderId, title: node?.title || folderId });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

/** Direct url-bearing children of a folder. */
export function bookmarksInFolder(nodes: BookmarkNode[], folderId: string): BookmarkNode[] {
  return nodes.filter((n) => n.url && n.parentId === folderId);
}

/** Strip HTML to readable text without a DOM (service-worker safe). */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** chrome.alarms repeat period for a frequency, or null when off. */
export function alarmSpec(freq: ScheduleFreq): { periodInMinutes: number } | null {
  if (freq === "daily") return { periodInMinutes: 24 * 60 };
  if (freq === "weekly") return { periodInMinutes: 7 * 24 * 60 };
  return null;
}

/** Next timestamp at the given local hour, strictly after `now`. */
export function nextFireTime(now: number, hour: number): number {
  const d = new Date(now);
  d.setHours(hour, 0, 0, 0);
  let t = d.getTime();
  if (t <= now) t += 24 * 60 * 60 * 1000;
  return t;
}
