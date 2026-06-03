import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionConfig } from "@/lib/types";
import { t, type Lang } from "@/lib/i18n";
import { renderMarkdown } from "@/lib/markdown";
import { loadBookmarks, type BookmarkNode } from "@/lib/bookmarks";
import {
  type FolderInfo,
  type MarketReport,
  type MarketSettings,
  type ScheduleFreq,
  DEFAULT_MARKET_SETTINGS,
  downloadReport,
  listFolders,
  loadMarketSettings,
  loadReports,
  runMarketReport,
  saveMarketSettings,
  saveReport,
  scheduleMarketAlarm,
} from "@/lib/market-report";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

// Recharts is heavy — split it into its own chunk, loaded only when a report exists.
const MarketCharts = lazy(() => import("./Charts").then((m) => ({ default: m.MarketCharts })));

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
  const [settings, setSettings] = useState<MarketSettings>(DEFAULT_MARKET_SETTINGS);
  const [reports, setReports] = useState<MarketReport[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
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

  // Abort any in-flight report run if the view unmounts (e.g. switching tabs),
  // so it doesn't append a report to chat after the user navigated away.
  useEffect(() => () => abortRef.current?.abort(), []);

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
        lang,
        signal: ctrl.signal,
        onProgress: (done, total, label) => setProgress({ done, total, label }),
      });
      setReports(await saveReport(report));
      if (report.synthesis) onReport(report.synthesis);
    } catch (e) {
      if (ctrl.signal.aborted) return; // user/unmount cancelled — not an error
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setRunning(false);
      setProgress(null);
    }
  }, [config, settings.folderId, folders, nodes, lang, onReport]);

  const latest = reports[0];
  const latestHtml = useMemo(() => (latest?.synthesis ? renderMarkdown(latest.synthesis) : ""), [latest]);

  // Plain-language summary of what the current schedule + auto-save settings do,
  // so the relationship between 주기 / 자동 저장 / 저장 폴더 is obvious at a glance.
  const scheduleSummary = useMemo(() => {
    if (settings.freq === "off") return t(lang, "mr.sched.off");
    const freqLabel = t(lang, settings.freq === "daily" ? "mr.freq.daily" : "mr.freq.weekly");
    const key = settings.autoSave ? "mr.sched.auto" : "mr.sched.app";
    return t(lang, key)
      .replace("{freq}", freqLabel)
      .replace("{h}", String(settings.hour).padStart(2, "0"))
      .replace("{folder}", settings.saveFolder || "Downloads");
  }, [settings.freq, settings.autoSave, settings.hour, settings.saveFolder, lang]);

  // Save the latest report to the local Downloads/<saveFolder> directory.
  const saveLatest = useCallback(async () => {
    if (!latest) return;
    setSaved("");
    setError("");
    try {
      await downloadReport(latest, settings.saveFolder, false);
      setSaved(t(lang, "mr.saved").replace("{folder}", settings.saveFolder || "Downloads"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [latest, settings.saveFolder, lang]);

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
        <label className="mr-field" title={t(lang, "mr.schedule.title")}>
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
        <label className="mr-field" title={t(lang, "mr.saveFolder.title")}>
          <span>{t(lang, "mr.saveFolder")}</span>
          <input
            type="text"
            value={settings.saveFolder}
            onChange={(e) => persist({ ...settings, saveFolder: e.target.value })}
            placeholder="market-reports"
            disabled={running}
          />
        </label>
        {/* Auto-save only affects scheduled runs, so it appears only when a
            schedule is on — making its dependency on 주기 visually explicit. */}
        {settings.freq !== "off" && (
          <label className="mr-field mr-check" title={t(lang, "mr.autoSave.title")}>
            <input
              type="checkbox"
              checked={settings.autoSave}
              onChange={(e) => persist({ ...settings, autoSave: e.target.checked })}
              disabled={running}
            />
            <span>{t(lang, "mr.autoSave")}</span>
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

      <div className="mr-sched-summary">{scheduleSummary}</div>

      {folders.length === 0 && <div className="mr-status">{t(lang, "mr.noFolder")}</div>}
      {error && <div className="mr-status err">⚠ {error}</div>}
      {saved && <div className="mr-status">✓ {saved}</div>}
      {running && progress && (
        <div className="mr-status">
          {t(lang, "mr.running")} {progress.done}/{progress.total} {progress.label}
        </div>
      )}

      <div className="mr-body">
        {!latest && !running && <div className="mr-empty">{t(lang, "mr.empty")}</div>}
        {latest && (
          <>
            <div className="mr-latest-head">
              <span className="mr-section-title">{t(lang, "mr.latest")} — {latest.folderTitle}</span>
              <button className="tx-restore mr-save" onClick={() => void saveLatest()}>
                {t(lang, "mr.save")}
              </button>
            </div>
            {latest.skipped > 0 && (
              <div className="mr-status">{t(lang, "mr.skipped").replace("{n}", String(latest.skipped))}</div>
            )}
            <Suspense fallback={null}>
              <MarketCharts reports={reports} lang={lang} />
            </Suspense>
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
