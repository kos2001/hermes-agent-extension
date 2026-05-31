import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionConfig } from "@/lib/types";
import { t, type Lang } from "@/lib/i18n";
import { collectChat } from "@/lib/hermes-client";
import {
  type Action,
  type BookmarkNode,
  applyActions,
  buildCategorizePrompt,
  checkDeadLinks,
  findDuplicates,
  loadBookmarks,
  parseCategorization,
  planSort,
} from "@/lib/bookmarks";

/** null = idle. "dead"/"ai" = a long op running. "apply" = applying changes. */
type Busy = null | "dead" | "ai" | "apply";

function describe(a: Action, lang: Lang): string {
  if (a.kind === "remove") {
    const why = a.reason === "duplicate" ? t(lang, "bm.tagDup") : t(lang, "bm.tagDead");
    return `🗑 [${why}] ${a.title || a.url}`;
  }
  if (a.kind === "move") return `📁 ${a.toFolderPath} ← ${a.title || a.url}`;
  return `↕ ${a.folderTitle} (${a.count})`;
}

/** The site URL an action refers to, if any (reorder actions have none). */
function urlOf(a: Action): string | undefined {
  return a.kind === "reorder" ? undefined : a.url;
}

export default function BookmarksView({
  config,
  lang,
}: {
  config: ConnectionConfig | null;
  lang: Lang;
}) {
  const [nodes, setNodes] = useState<BookmarkNode[]>([]);
  const [actions, setActions] = useState<Action[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Busy>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const deadAbort = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    setNodes(await loadBookmarks());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Abort any in-flight dead-link scan if the view unmounts.
  useEffect(() => () => deadAbort.current?.abort(), []);

  const setResult = useCallback((next: Action[], noteMsg = "") => {
    setActions(next);
    setChecked(new Set(next.map((a) => a.id)));
    setNote(noteMsg);
    setError("");
  }, []);

  const runDedup = useCallback(() => setResult(findDuplicates(nodes)), [nodes, setResult]);
  const runSort = useCallback((key: "name" | "date") => setResult(planSort(nodes, key)), [nodes, setResult]);

  const runDead = useCallback(async () => {
    setResult([]);
    setBusy("dead");
    setProgress({ done: 0, total: 0 });
    const ctrl = new AbortController();
    deadAbort.current = ctrl;
    try {
      const result = await checkDeadLinks(nodes, {
        signal: ctrl.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setResult(result);
    } finally {
      deadAbort.current = null;
      setBusy(null);
      setProgress(null);
    }
  }, [nodes, setResult]);

  const runAi = useCallback(async () => {
    if (!config) {
      setError(t(lang, "bm.needConfig"));
      return;
    }
    setResult([]);
    setBusy("ai");
    try {
      const { messages, skipped } = buildCategorizePrompt(nodes);
      const text = await collectChat({ config, messages, responseFormat: { type: "json_object" } });
      const result = parseCategorization(text, nodes);
      if (result.length === 0) {
        setError(t(lang, "bm.aiNoResult"));
      } else {
        setResult(result, skipped > 0 ? t(lang, "bm.aiSkipped").replace("{n}", String(skipped)) : "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [config, nodes, lang, setResult]);

  // Open a single site in a background tab so the user can verify the issue.
  const openOne = useCallback((url: string) => {
    void chrome.tabs.create({ url, active: false });
  }, []);

  // Open every checked URL-bearing action in background tabs (deduped).
  const openSelected = useCallback(() => {
    const urls = Array.from(
      new Set(
        actions
          .filter((a) => checked.has(a.id))
          .map(urlOf)
          .filter((u): u is string => !!u),
      ),
    );
    if (urls.length === 0) return;
    if (urls.length > 10 && !window.confirm(t(lang, "bm.confirmOpen").replace("{n}", String(urls.length)))) return;
    for (const url of urls) void chrome.tabs.create({ url, active: false });
  }, [actions, checked, lang]);

  const toggle = useCallback((id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const apply = useCallback(async () => {
    const selected = actions.filter((a) => checked.has(a.id));
    if (selected.length === 0) return;
    const removals = selected.filter((a) => a.kind === "remove").length;
    if (removals > 0 && !window.confirm(t(lang, "bm.confirmRemove").replace("{n}", String(removals)))) return;
    setBusy("apply");
    try {
      const { applied, failed } = await applyActions(selected);
      setActions([]);
      setChecked(new Set());
      setNote(t(lang, "bm.applied").replace("{a}", String(applied)).replace("{f}", String(failed)));
      await reload();
    } finally {
      setBusy(null);
    }
  }, [actions, checked, lang, reload]);

  const disabled = busy !== null;

  return (
    <div className="bm-view">
      <div className="bm-actions">
        <button className="skill" onClick={runDedup} disabled={disabled}>{t(lang, "bm.dedup")}</button>
        <button className="skill" onClick={() => void runDead()} disabled={disabled}>{t(lang, "bm.dead")}</button>
        <button className="skill" onClick={() => runSort("name")} disabled={disabled}>{t(lang, "bm.sortName")}</button>
        <button className="skill" onClick={() => runSort("date")} disabled={disabled}>{t(lang, "bm.sortDate")}</button>
        <button className="skill" onClick={() => void runAi()} disabled={disabled || !config}>{t(lang, "bm.ai")}</button>
      </div>

      {busy === "dead" && progress && (
        <div className="bm-status">
          {progress.done} / {progress.total}
          <button className="tx-restore" onClick={() => deadAbort.current?.abort()}>{t(lang, "stop")}</button>
        </div>
      )}
      {(busy === "ai" || busy === "apply") && <div className="bm-status">{t(lang, "working")}</div>}
      {error && <div className="bm-status err">⚠ {error}</div>}
      {note && <div className="bm-status">{note}</div>}

      <div className="bm-list">
        {actions.length === 0 && !disabled && <div className="bm-empty">{t(lang, "bm.empty")}</div>}
        {actions.map((a) => {
          const url = urlOf(a);
          return (
            <div key={a.id} className="bm-row">
              <label className="bm-row-label">
                <input type="checkbox" checked={checked.has(a.id)} onChange={() => toggle(a.id)} />
                <span className="bm-row-main">{describe(a, lang)}</span>
              </label>
              {url && (
                <button className="bm-open" title={`${t(lang, "bm.open")}: ${url}`} onClick={() => openOne(url)}>
                  ↗
                </button>
              )}
            </div>
          );
        })}
      </div>

      {actions.length > 0 && (
        <div className="bm-apply">
          <span>{t(lang, "bm.selected").replace("{n}", String(checked.size))}</span>
          <span className="bm-apply-btns">
            {actions.some((a) => urlOf(a)) && (
              <button
                className="tx-restore"
                onClick={openSelected}
                disabled={disabled || checked.size === 0}
              >
                {t(lang, "bm.openSelected")}
              </button>
            )}
            <button className="tx-go" onClick={() => void apply()} disabled={disabled || checked.size === 0}>
              {t(lang, "bm.apply")}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
