import type { BookmarkNode } from "./bookmarks";
import type { ChatMessage, ConnectionConfig } from "./types";
import { collectChat } from "./hermes-client";
import type { Lang } from "./i18n";

/** Human-readable language name fed to the model so the report matches the UI language. */
export const LANG_NAMES: Record<Lang, string> = { ko: "Korean", en: "English", zh: "Chinese" };

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

/** Fetch a URL and reduce it to text. Returns "" on any failure (15s timeout). */
export async function fetchSiteText(url: string, signal?: AbortSignal): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return "";
    return htmlToText(await res.text());
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Open the URL in an inactive tab, extract innerText, close the tab. "" on failure. */
export async function extractViaTab(url: string): Promise<string> {
  let tabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    if (tabId === undefined) return "";
    await new Promise<void>((resolve) => {
      const done = () => {
        chrome.tabs.onUpdated.removeListener(listener);
        clearTimeout(t);
        resolve();
      };
      const listener = (id: number, info: chrome.tabs.TabChangeInfo) => {
        if (id === tabId && info.status === "complete") done();
      };
      const t = setTimeout(done, 15000);
      chrome.tabs.onUpdated.addListener(listener);
    });
    const res = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (document.body?.innerText || "").replace(/\s+/g, " ").trim(),
    });
    return (res[0]?.result as string | undefined) ?? "";
  } catch {
    return "";
  } finally {
    if (tabId !== undefined) {
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        /* tab already gone */
      }
    }
  }
}

/** Summarize one site into a few bullet points. */
export async function summarizeSite(
  config: ConnectionConfig,
  title: string,
  text: string,
  language: string,
  signal?: AbortSignal,
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Summarize the following web page for a market-trends briefing. Reply with " +
        "2-4 concise bullet points capturing key facts, figures, and signals. " +
        `Plain text bullets only, no preamble. Write the bullets in ${language}.`,
    },
    { role: "user", content: `Title: ${title}\n\n${text.slice(0, 8000)}` },
  ];
  return (await collectChat({ config, messages, signal })).trim();
}

/** Synthesize per-site summaries into a comprehensive Markdown report. */
export async function synthesizeReport(
  config: ConnectionConfig,
  folderTitle: string,
  sites: SiteSummary[],
  language: string,
  signal?: AbortSignal,
): Promise<string> {
  const body = sites
    .filter((s) => !s.error && s.summary)
    .map((s) => `## ${s.title}\n${s.url}\n${s.summary}`)
    .join("\n\n");
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "You are a market analyst. From the per-site summaries, write a comprehensive " +
        "market-trends report in Markdown with: an executive summary, key trends across " +
        "sources, notable signals and risks, and a short outlook. Be specific and cite " +
        `site titles. Write the entire report in ${language}.`,
    },
    { role: "user", content: `Folder: ${folderTitle}\n\n${body}` },
  ];
  return (await collectChat({ config, messages, signal })).trim();
}

export interface RunMarketReportOpts {
  nodes: BookmarkNode[];
  folderId: string;
  folderTitle: string;
  config: ConnectionConfig;
  /** UI language the report (and summaries) should be written in. */
  lang: Lang;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, label: string) => void;
}

/** End-to-end: per-site fetch (tab fallback) -> summarize -> synthesize. */
export async function runMarketReport(opts: RunMarketReportOpts): Promise<MarketReport> {
  const language = LANG_NAMES[opts.lang];
  const all = bookmarksInFolder(opts.nodes, opts.folderId);
  const picked = all.slice(0, MAX_SITES);
  const sites: SiteSummary[] = [];
  let done = 0;
  for (const n of picked) {
    if (opts.signal?.aborted) break;
    const url = n.url as string;
    const title = n.title || url;
    let summary = "";
    let error: string | undefined;
    try {
      let text = await fetchSiteText(url, opts.signal);
      if (text.length < MIN_TEXT) {
        const viaTab = await extractViaTab(url);
        if (viaTab.length > text.length) text = viaTab;
      }
      if (text.length < 50) error = "No readable content";
      else summary = await summarizeSite(opts.config, title, text, language, opts.signal);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    sites.push({ url, title, summary, error });
    done++;
    opts.onProgress?.(done, picked.length, title);
  }
  // Skip synthesis if the run was aborted mid-loop — synthesizeReport would
  // otherwise fetch with an already-aborted signal and throw.
  const synthesis =
    !opts.signal?.aborted && sites.some((s) => !s.error && s.summary)
      ? await synthesizeReport(opts.config, opts.folderTitle, sites, language, opts.signal)
      : "";
  return {
    id: crypto.randomUUID(),
    folderId: opts.folderId,
    folderTitle: opts.folderTitle,
    createdAt: Date.now(),
    sites,
    synthesis,
    skipped: all.length - picked.length,
  };
}

const REPORTS_KEY = "hermes.market.reports";
const SETTINGS_KEY = "hermes.market.settings";
const MAX_REPORTS = 10;

/** Alarm name for the scheduled market report. */
export const MARKET_ALARM = "hermes.market.run";

export async function loadReports(): Promise<MarketReport[]> {
  const r = await chrome.storage.local.get(REPORTS_KEY);
  return (r[REPORTS_KEY] as MarketReport[] | undefined) ?? [];
}

/** Prepend a report, keep the latest MAX_REPORTS, return the new list. */
export async function saveReport(report: MarketReport): Promise<MarketReport[]> {
  const next = [report, ...(await loadReports())].slice(0, MAX_REPORTS);
  await chrome.storage.local.set({ [REPORTS_KEY]: next });
  return next;
}

export async function loadMarketSettings(): Promise<MarketSettings> {
  const r = await chrome.storage.local.get(SETTINGS_KEY);
  return (r[SETTINGS_KEY] as MarketSettings | undefined) ?? { folderId: "", freq: "off", hour: 9 };
}

export async function saveMarketSettings(s: MarketSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: s });
}

/** Re-create the recurring alarm from settings (cleared when off / no folder). */
export async function scheduleMarketAlarm(settings: MarketSettings): Promise<void> {
  await chrome.alarms.clear(MARKET_ALARM);
  const spec = alarmSpec(settings.freq);
  if (!spec || !settings.folderId) return;
  chrome.alarms.create(MARKET_ALARM, {
    when: nextFireTime(Date.now(), settings.hour),
    periodInMinutes: spec.periodInMinutes,
  });
}
