# Market-Trends Report Skill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A side-panel feature that summarizes each site in a chosen bookmark folder and writes a comprehensive market-trends report, runnable on demand and on a `chrome.alarms` schedule, with completion notifications.

**Architecture:** Logic + orchestration in `src/lib/market-report.ts` (pure helpers unit-tested; fetch/tab/LLM/storage/alarms verified manually). The background service worker runs scheduled reports via `chrome.alarms`. A dedicated `MarketReportView.tsx` drives manual runs, scheduling, and report viewing; `App.tsx` adds a third view.

**Tech Stack:** TypeScript, React 18, Vite+@crxjs, Chrome MV3 (`chrome.alarms`, `chrome.notifications`, `chrome.tabs`, `chrome.scripting`, `chrome.bookmarks`, `chrome.storage`), Vitest (node).

---

## File Structure

- `src/lib/market-report.ts` — **create** — types, pure helpers, fetch/tab extraction, LLM summarize/synthesize, `runMarketReport`, storage, alarm scheduling.
- `src/lib/market-report.test.ts` — **create** — node tests for the pure helpers.
- `src/background/index.ts` — **modify** — `chrome.alarms.onAlarm` runner + notification.
- `src/lib/i18n.ts` — **modify** — market-report strings.
- `src/sidepanel/MarketReportView.tsx` — **create** — the dedicated view.
- `src/sidepanel/App.tsx` — **modify** — third view + 📈 toggle + `onReport` → chat.
- `src/sidepanel/styles.css` — **modify** — view styles.
- `manifest.config.ts` — **modify** — add `alarms`, `notifications` permissions.

Reuses `loadBookmarks`/`BookmarkNode` from `src/lib/bookmarks.ts` and `collectChat` from `src/lib/hermes-client.ts`.

---

## Task 1: `market-report.ts` pure helpers + tests

**Files:** Create `src/lib/market-report.ts`, `src/lib/market-report.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/lib/market-report.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { BookmarkNode } from "./bookmarks";
import { alarmSpec, bookmarksInFolder, htmlToText, listFolders, nextFireTime } from "./market-report";

function node(id: string, title: string, url: string | undefined, parentId?: string): BookmarkNode {
  return { id, title, url, parentId, parentTitle: "", dateAdded: 0, index: 0 };
}

describe("htmlToText", () => {
  it("strips scripts, styles, tags and collapses whitespace", () => {
    const html = "<html><head><style>.x{color:red}</style></head><body><script>bad()</script><h1>Hi</h1>\n<p>World&amp;co</p></body></html>";
    expect(htmlToText(html)).toBe("Hi World&co");
  });
  it("strips comments and decodes common entities", () => {
    expect(htmlToText("<!-- c --><p>a&nbsp;b&lt;c&gt;</p>")).toBe("a b<c>");
  });
});

describe("listFolders", () => {
  it("lists folders that directly contain bookmarks, titled and sorted", () => {
    const nodes = [
      node("f2", "Zeta", undefined),
      node("f1", "Alpha", undefined),
      node("b1", "B1", "https://a.com/", "f1"),
      node("b2", "B2", "https://b.com/", "f2"),
      node("b3", "B3", "https://c.com/", "f1"),
    ];
    expect(listFolders(nodes)).toEqual([
      { id: "f1", title: "Alpha" },
      { id: "f2", title: "Zeta" },
    ]);
  });
  it("omits folders with no direct bookmarks", () => {
    const nodes = [node("f1", "Empty", undefined), node("sub", "Sub", undefined, "f1")];
    expect(listFolders(nodes)).toEqual([]);
  });
});

describe("bookmarksInFolder", () => {
  it("returns only direct url-bearing children of the folder", () => {
    const nodes = [
      node("b1", "B1", "https://a.com/", "f1"),
      node("sub", "Sub", undefined, "f1"),
      node("b2", "B2", "https://b.com/", "f2"),
    ];
    expect(bookmarksInFolder(nodes, "f1").map((n) => n.id)).toEqual(["b1"]);
  });
});

describe("alarmSpec", () => {
  it("maps frequencies to alarm periods", () => {
    expect(alarmSpec("off")).toBeNull();
    expect(alarmSpec("daily")).toEqual({ periodInMinutes: 1440 });
    expect(alarmSpec("weekly")).toEqual({ periodInMinutes: 10080 });
  });
});

describe("nextFireTime", () => {
  it("returns today at the given hour when that is still in the future", () => {
    const now = new Date(2026, 0, 1, 8, 0, 0).getTime(); // 08:00
    expect(nextFireTime(now, 9)).toBe(new Date(2026, 0, 1, 9, 0, 0).getTime());
  });
  it("rolls to tomorrow when the hour already passed", () => {
    const now = new Date(2026, 0, 1, 10, 0, 0).getTime(); // 10:00
    expect(nextFireTime(now, 9)).toBe(new Date(2026, 0, 2, 9, 0, 0).getTime());
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/lib/market-report.test.ts` → module not found.

- [ ] **Step 3: Implement** — create `src/lib/market-report.ts`:

```ts
import type { BookmarkNode } from "./bookmarks";
import type { ChatMessage, ConnectionConfig } from "./types";
import { collectChat } from "./hermes-client";

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
```

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/lib/market-report.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/market-report.ts src/lib/market-report.test.ts
git commit -m "feat(market): pure helpers (htmlToText, listFolders, alarm timing)"
```

---

## Task 2: LLM + fetch + tab orchestration (`runMarketReport`)

No unit tests (network/chrome/LLM). Verify with `npx tsc --noEmit`.

**Files:** Modify `src/lib/market-report.ts` (append)

- [ ] **Step 1: Implement** — APPEND to `src/lib/market-report.ts`:

```ts
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
  signal?: AbortSignal,
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "Summarize the following web page for a market-trends briefing. Reply with " +
        "2-4 concise bullet points capturing key facts, figures, and signals. " +
        "Plain text bullets only, no preamble.",
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
        "site titles. Reply in the user's language.",
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
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, label: string) => void;
}

/** End-to-end: per-site fetch (tab fallback) → summarize → synthesize. */
export async function runMarketReport(opts: RunMarketReportOpts): Promise<MarketReport> {
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
      else summary = await summarizeSite(opts.config, title, text, opts.signal);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    sites.push({ url, title, summary, error });
    done++;
    opts.onProgress?.(done, picked.length, title);
  }
  const synthesis = sites.some((s) => !s.error && s.summary)
    ? await synthesizeReport(opts.config, opts.folderTitle, sites, opts.signal)
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
```

- [ ] **Step 2: Type-check** — `npx tsc --noEmit` (expect clean).

- [ ] **Step 3: Commit**

```bash
git add src/lib/market-report.ts
git commit -m "feat(market): runMarketReport (fetch+tab extraction, summarize, synthesize)"
```

---

## Task 3: storage + alarm scheduling + manifest permissions

No unit tests (chrome.storage / chrome.alarms). Verify with `npx tsc --noEmit`.

**Files:** Modify `src/lib/market-report.ts` (append), `manifest.config.ts`

- [ ] **Step 1: Add permissions** — in `manifest.config.ts`, change the `permissions` array (currently ends `..., "tabs", "bookmarks"]`) to also include alarms + notifications:

```ts
  permissions: ["storage", "sidePanel", "activeTab", "scripting", "tabs", "bookmarks", "alarms", "notifications"],
```

- [ ] **Step 2: Implement storage + scheduling** — APPEND to `src/lib/market-report.ts`:

```ts
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
```

- [ ] **Step 3: Type-check** — `npx tsc --noEmit` (expect clean).

- [ ] **Step 4: Commit**

```bash
git add src/lib/market-report.ts manifest.config.ts
git commit -m "feat(market): report/settings storage + alarm scheduling; add alarms/notifications perms"
```

---

## Task 4: background alarm runner

No unit tests. Verify with `npx tsc --noEmit` and `npm run build`.

**Files:** Modify `src/background/index.ts`

- [ ] **Step 1: Add imports** — after the existing `import { loadConfig } from "@/lib/storage";` line, add:

```ts
import { loadBookmarks } from "@/lib/bookmarks";
import { loadMarketSettings, MARKET_ALARM, runMarketReport, saveReport } from "@/lib/market-report";
```

- [ ] **Step 2: Add the alarm listener** — append at the END of `src/background/index.ts`:

```ts
/** Run the scheduled market report and notify on completion. */
async function runScheduledMarketReport(): Promise<void> {
  const settings = await loadMarketSettings();
  if (settings.freq === "off" || !settings.folderId) return;
  const config = await loadConfig();
  const nodes = await loadBookmarks();
  const folder = nodes.find((n) => n.id === settings.folderId && !n.url);
  const folderTitle = folder?.title || settings.folderId;
  const report = await runMarketReport({ nodes, folderId: settings.folderId, folderTitle, config });
  await saveReport(report);
  const ok = report.sites.filter((s) => !s.error).length;
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon-128.png",
    title: "Market report ready",
    message: `${folderTitle}: ${ok}/${report.sites.length} sites summarized`,
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === MARKET_ALARM) void runScheduledMarketReport();
});
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit && npm run build` (expect clean + built).

- [ ] **Step 4: Commit**

```bash
git add src/background/index.ts
git commit -m "feat(market): background alarm runs scheduled report + notifies"
```

---

## Task 5: i18n strings

**Files:** Modify `src/lib/i18n.ts`

- [ ] **Step 1: Add strings** — in the `STR` object, after the bookmarks block (the `"bm.tagDead"` entry), insert:

```ts
  // Market-trends report
  market: { ko: "시장 동향", en: "Market", zh: "市场动向" },
  marketTitle: { ko: "시장 동향 보고서", en: "Market-trends report", zh: "市场动向报告" },
  "mr.folder": { ko: "폴더", en: "Folder", zh: "文件夹" },
  "mr.pickFolder": { ko: "폴더 선택…", en: "Pick a folder…", zh: "选择文件夹…" },
  "mr.schedule": { ko: "주기", en: "Schedule", zh: "周期" },
  "mr.freq.off": { ko: "끄기", en: "Off", zh: "关闭" },
  "mr.freq.daily": { ko: "매일", en: "Daily", zh: "每天" },
  "mr.freq.weekly": { ko: "매주", en: "Weekly", zh: "每周" },
  "mr.atHour": { ko: "시각", en: "At", zh: "时间" },
  "mr.run": { ko: "지금 생성", en: "Run now", zh: "立即生成" },
  "mr.running": { ko: "보고서 생성 중…", en: "Generating report…", zh: "正在生成报告…" },
  "mr.latest": { ko: "최신 보고서", en: "Latest report", zh: "最新报告" },
  "mr.history": { ko: "이전 보고서", en: "History", zh: "历史报告" },
  "mr.empty": { ko: "폴더를 선택하고 ‘지금 생성’을 누르세요.", en: "Pick a folder and press Run now.", zh: "选择文件夹并点击立即生成。" },
  "mr.needConfig": { ko: "먼저 설정에서 연결을 구성하세요.", en: "Configure a connection in settings first.", zh: "请先在设置中配置连接。" },
  "mr.noFolder": { ko: "북마크가 있는 폴더가 없습니다.", en: "No folders with bookmarks found.", zh: "未找到含书签的文件夹。" },
  "mr.skipped": { ko: "{n}개 사이트는 상한(20)으로 제외됨", en: "{n} sites skipped (cap 20)", zh: "{n} 个站点因上限(20)被跳过" },
  "mr.siteError": { ko: "수집 실패", en: "fetch failed", zh: "抓取失败" },
```

- [ ] **Step 2: Type-check** — `npx tsc --noEmit` (expect clean).

- [ ] **Step 3: Commit**

```bash
git add src/lib/i18n.ts
git commit -m "feat(i18n): market-trends report strings (ko/en/zh)"
```

---

## Task 6: `MarketReportView` + styles + App wiring

No unit tests (React/chrome). Verify with `npx tsc --noEmit`, `npm run build`, `npx vitest run`.

**Files:** Create `src/sidepanel/MarketReportView.tsx`; modify `src/sidepanel/styles.css`, `src/sidepanel/App.tsx`

- [ ] **Step 1: Create the view** — create `src/sidepanel/MarketReportView.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionConfig } from "@/lib/types";
import { t, type Lang } from "@/lib/i18n";
import { renderMarkdown } from "@/lib/markdown";
import { loadBookmarks, type BookmarkNode } from "@/lib/bookmarks";
import {
  type FolderInfo,
  type MarketReport,
  type MarketSettings,
  type ScheduleFreq,
  listFolders,
  loadMarketSettings,
  loadReports,
  runMarketReport,
  saveMarketSettings,
  saveReport,
  scheduleMarketAlarm,
} from "@/lib/market-report";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export default function MarketReportView({
  config,
  lang,
  onReport,
}: {
  config: ConnectionConfig | null;
  lang: Lang;
  onReport: (markdown: string) => void;
}) {
  const [nodes, setNodes] = useState<BookmarkNode[]>([]);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [settings, setSettings] = useState<MarketSettings>({ folderId: "", freq: "off", hour: 9 });
  const [reports, setReports] = useState<MarketReport[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void (async () => {
      const ns = await loadBookmarks();
      setNodes(ns);
      setFolders(listFolders(ns));
      setSettings(await loadMarketSettings());
      setReports(await loadReports());
    })();
  }, []);

  const persist = useCallback((next: MarketSettings) => {
    setSettings(next);
    void saveMarketSettings(next).then(() => scheduleMarketAlarm(next));
  }, []);

  const run = useCallback(async () => {
    if (!config) {
      setError(t(lang, "mr.needConfig"));
      return;
    }
    if (!settings.folderId) return;
    setError("");
    setRunning(true);
    setProgress({ done: 0, total: 0, label: "" });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const folder = folders.find((f) => f.id === settings.folderId);
      const report = await runMarketReport({
        nodes,
        folderId: settings.folderId,
        folderTitle: folder?.title || settings.folderId,
        config,
        signal: ctrl.signal,
        onProgress: (done, total, label) => setProgress({ done, total, label }),
      });
      setReports(await saveReport(report));
      if (report.synthesis) onReport(report.synthesis);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setRunning(false);
      setProgress(null);
    }
  }, [config, settings.folderId, folders, nodes, lang, onReport]);

  const latest = reports[0];
  const latestHtml = useMemo(() => (latest?.synthesis ? renderMarkdown(latest.synthesis) : ""), [latest]);

  return (
    <div className="mr-view">
      <div className="mr-controls">
        <label className="mr-field">
          <span>{t(lang, "mr.folder")}</span>
          <select
            value={settings.folderId}
            onChange={(e) => persist({ ...settings, folderId: e.target.value })}
            disabled={running}
          >
            <option value="">{t(lang, "mr.pickFolder")}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.title}</option>
            ))}
          </select>
        </label>
        <label className="mr-field">
          <span>{t(lang, "mr.schedule")}</span>
          <select
            value={settings.freq}
            onChange={(e) => persist({ ...settings, freq: e.target.value as ScheduleFreq })}
            disabled={running}
          >
            <option value="off">{t(lang, "mr.freq.off")}</option>
            <option value="daily">{t(lang, "mr.freq.daily")}</option>
            <option value="weekly">{t(lang, "mr.freq.weekly")}</option>
          </select>
        </label>
        {settings.freq !== "off" && (
          <label className="mr-field">
            <span>{t(lang, "mr.atHour")}</span>
            <select
              value={settings.hour}
              onChange={(e) => persist({ ...settings, hour: Number(e.target.value) })}
              disabled={running}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
              ))}
            </select>
          </label>
        )}
        {running ? (
          <button className="tx-restore" onClick={() => abortRef.current?.abort()}>{t(lang, "stop")}</button>
        ) : (
          <button className="tx-go" onClick={() => void run()} disabled={!config || !settings.folderId}>
            {t(lang, "mr.run")}
          </button>
        )}
      </div>

      {folders.length === 0 && <div className="mr-status">{t(lang, "mr.noFolder")}</div>}
      {error && <div className="mr-status err">⚠ {error}</div>}
      {running && progress && (
        <div className="mr-status">
          {t(lang, "mr.running")} {progress.done}/{progress.total} {progress.label}
        </div>
      )}

      <div className="mr-body">
        {!latest && !running && <div className="mr-empty">{t(lang, "mr.empty")}</div>}
        {latest && (
          <>
            <div className="mr-section-title">{t(lang, "mr.latest")} — {latest.folderTitle}</div>
            {latest.skipped > 0 && (
              <div className="mr-status">{t(lang, "mr.skipped").replace("{n}", String(latest.skipped))}</div>
            )}
            {latestHtml ? (
              <div className="md" dangerouslySetInnerHTML={{ __html: latestHtml }} />
            ) : (
              <div className="mr-status">{latest.sites.map((s) => s.title).join(", ") || "—"}</div>
            )}
            {reports.length > 1 && (
              <details className="mr-history">
                <summary>{t(lang, "mr.history")} ({reports.length - 1})</summary>
                {reports.slice(1).map((r) => (
                  <div key={r.id} className="mr-history-item">
                    {r.folderTitle} · {r.sites.length} sites
                  </div>
                ))}
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add styles** — APPEND to `src/sidepanel/styles.css`:

```css
/* Market-trends report view */
.mr-view { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.mr-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.mr-field { display: flex; flex-direction: column; gap: 3px; font-size: 11px; color: var(--muted); }
.mr-field select {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 3px 6px;
  font: inherit;
  font-size: 12px;
}
.mr-controls .tx-go, .mr-controls .tx-restore {
  border-radius: 5px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}
.mr-controls .tx-go { background: var(--accent); border: 0; color: var(--on-accent); font-weight: 600; }
.mr-controls .tx-restore { background: var(--panel-2); color: var(--text); border: 1px solid var(--border); }
.mr-controls button:disabled { opacity: 0.5; cursor: not-allowed; }
.mr-status { padding: 6px 12px; font-size: 12px; color: var(--muted); }
.mr-status.err { color: var(--error); }
.mr-body { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 16px; font-size: 13px; }
.mr-empty { padding: 24px 16px; color: var(--muted); text-align: center; }
.mr-section-title { font-weight: 600; margin-bottom: 8px; }
.mr-history { margin-top: 14px; font-size: 12px; color: var(--muted); }
.mr-history summary { cursor: pointer; }
.mr-history-item { padding: 4px 0; }
```

- [ ] **Step 3: Wire into App.tsx**

3a. After `import BookmarksView from "./BookmarksView";`, add:
```tsx
import MarketReportView from "./MarketReportView";
```

3b. Change the view state type (find `const [view, setView] = useState<"chat" | "bookmarks">("chat");`) to:
```tsx
  const [view, setView] = useState<"chat" | "bookmarks" | "market">("chat");
```

3c. Add a callback to append a report to chat. Immediately after the `newChat` useCallback (search for `const newChat = useCallback(` ... `}, []);`), add:
```tsx
  // Append a generated market report to the chat transcript.
  const appendReport = useCallback((markdown: string) => {
    setMessages((prev) => [...prev, newMessage("assistant", markdown)]);
  }, []);
```

3d. Add the 📈 toggle button in the top bar. Immediately BEFORE the 🔖 bookmarks button (`<button className={`icon-btn bookmarks...`), insert:
```tsx
        <button
          className={`icon-btn market${view === "market" ? " active" : ""}`}
          onClick={() => setView((v) => (v === "market" ? "chat" : "market"))}
          title={t(lang, "marketTitle")}
        >
          📈
        </button>
```

3e. Render the market view. The body currently is:
```tsx
      {view === "bookmarks" ? (
        <BookmarksView config={config} lang={lang} />
      ) : (
        <>
          ...chat blocks...
        </>
      )}
```
Change the opening of this conditional to handle three views — replace the line `{view === "bookmarks" ? (` and its matching `) : (` with a chained conditional. Specifically replace:
```tsx
      {view === "bookmarks" ? (
        <BookmarksView config={config} lang={lang} />
      ) : (
        <>
```
with:
```tsx
      {view === "bookmarks" ? (
        <BookmarksView config={config} lang={lang} />
      ) : view === "market" ? (
        <MarketReportView config={config} lang={lang} onReport={appendReport} />
      ) : (
        <>
```
Leave the chat blocks and the closing `</>\n      )}` unchanged.

- [ ] **Step 4: Verify** — `npx tsc --noEmit && npm run build && npx vitest run` (expect clean, built, all tests pass — bookmarks 15 + market-report new + others).

- [ ] **Step 5: Commit**

```bash
git add src/sidepanel/MarketReportView.tsx src/sidepanel/styles.css src/sidepanel/App.tsx
git commit -m "feat(market): MarketReportView + 📈 toggle + chat output"
```

---

## Task 7: Final verification (manual QA)

- [ ] **Step 1: Build** — `npm run build`; confirm `dist/manifest.json` lists `alarms` and `notifications`.

- [ ] **Step 2: Load `dist/`** via `chrome://extensions` (Developer mode → Load unpacked).

- [ ] **Step 3: Verify**
  - [ ] 📈 toggles the Market view; folder dropdown lists folders containing bookmarks.
  - [ ] Pick a folder, "Run now" → progress shows `done/total` + site; a Markdown report renders; the same report appears as a chat message when you switch back to chat.
  - [ ] Per-site failures don't abort the run; sites over 20 show the skipped note.
  - [ ] Set schedule = daily at the next hour; reload the SW (`chrome://extensions` → service worker → reload), confirm an alarm exists (`chrome.alarms.getAll` in the SW console) and that firing it (or waiting) produces a saved report + a notification.
  - [ ] Set schedule = off → alarm cleared.

- [ ] **Step 4: Final build + tests** — `npm run build && npx vitest run`.

No commit (verification only).

---

## Notes for the implementer
- `chrome` is globally typed via `@types/chrome` — no import needed.
- Service workers have no DOM, so `htmlToText` is regex-based; the tab path uses real `document.body.innerText` via `chrome.scripting`.
- Reuse `crypto.randomUUID()` for report ids (matches `storage.ts`).
- Do not add jsdom/testing-library; React/chrome code is verified manually.
