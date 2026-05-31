import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionConfig } from "@/lib/types";
import { t, type Lang } from "@/lib/i18n";
import { collectChat } from "@/lib/hermes-client";
import {
  type Action,
  type BookmarkNode,
  type FolderChoice,
  applyActions,
  buildCategorizePrompt,
  buildCleanupPrompt,
  checkDeadLinks,
  findDuplicates,
  listFolderChoices,
  loadBookmarks,
  parseCategorization,
  parseCleanupRemovals,
} from "@/lib/bookmarks";
import { runSemanticDedup } from "@/lib/semantic-dedup";
import { cloudConfigured, supabase } from "@/lib/cloud/client";
import { getSession } from "@/lib/cloud/auth";
import { publishFolder } from "@/lib/cloud/folders";
import { summarizeFolder } from "@/lib/cloud/summarize-folder";

/** null = idle. Long ops: "dead"/"ai"/"clean"/"sdup"/"share". "apply" = applying. */
type Busy = null | "dead" | "ai" | "clean" | "sdup" | "apply" | "share";

/** Short rationale for an action: the AI's note if present, else a default. */
function rationale(a: Action, lang: Lang): string {
  if (a.note) return a.note;
  if (a.kind === "move") return "";
  return a.reason === "duplicate"
    ? t(lang, "bm.whyDup")
    : a.reason === "dead"
      ? t(lang, "bm.whyDead")
      : t(lang, "bm.whyJunk");
}

function describe(a: Action, lang: Lang): string {
  const why = rationale(a, lang);
  if (a.kind === "remove") {
    const tag =
      a.reason === "duplicate"
        ? t(lang, "bm.tagDup")
        : a.reason === "dead"
          ? t(lang, "bm.tagDead")
          : t(lang, "bm.tagJunk");
    return `🗑 [${tag}] ${a.title || a.url}${why ? ` — ${why}` : ""}`;
  }
  return `📁 ${a.toFolderPath} ← ${a.title || a.url}${why ? ` — ${why}` : ""}`;
}

/**
 * One preview row. Memoized so toggling a single checkbox (or Select-all) only
 * re-renders the rows whose `checked` actually changed, and `describe` runs
 * once per row instead of on every list re-render — matters for large results.
 */
const BookmarkRow = memo(function BookmarkRow({
  action,
  checked,
  lang,
  onToggle,
  onOpen,
}: {
  action: Action;
  checked: boolean;
  lang: Lang;
  onToggle: (id: string) => void;
  onOpen: (url: string) => void;
}) {
  const label = describe(action, lang);
  return (
    <div className="bm-row">
      <label className="bm-row-label">
        <input type="checkbox" checked={checked} onChange={() => onToggle(action.id)} />
        <span className="bm-row-main" title={label}>{label}</span>
      </label>
      <button className="bm-open" title={`${t(lang, "bm.open")}: ${action.url}`} onClick={() => onOpen(action.url)}>
        ↗
      </button>
    </div>
  );
});

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

  // Results start with NOTHING selected — the user opts in to each change.
  const setResult = useCallback((next: Action[], noteMsg = "") => {
    setActions(next);
    setChecked(new Set());
    setNote(noteMsg);
    setError("");
  }, []);

  const allChecked = actions.length > 0 && checked.size === actions.length;
  const toggleAll = useCallback(() => {
    setChecked((prev) => (prev.size === actions.length ? new Set() : new Set(actions.map((a) => a.id))));
  }, [actions]);

  // Note shown when an operation finishes with no proposed changes.
  const noChanges = (n: number) => (n === 0 ? t(lang, "bm.noChanges") : "");

  const runDedup = useCallback(() => {
    const r = findDuplicates(nodes);
    setResult(r, noChanges(r.length));
  }, [nodes, setResult, lang]);

  // AI cleanup: duplicates + dead links + AI-judged low-value links, merged
  // (one remove per bookmark). Requires a configured connection for the AI pass.
  const runAiClean = useCallback(async () => {
    if (!config) {
      setError(t(lang, "bm.needConfig"));
      return;
    }
    setResult([]);
    setBusy("clean");
    setProgress({ done: 0, total: 0 });
    const ctrl = new AbortController();
    deadAbort.current = ctrl;
    try {
      const dupes = findDuplicates(nodes);
      const dead = await checkDeadLinks(nodes, {
        signal: ctrl.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setProgress(null);
      let junk: Action[] = [];
      if (!ctrl.signal.aborted) {
        const { messages } = buildCleanupPrompt(nodes);
        const text = await collectChat({ config, messages, responseFormat: { type: "json_object" }, signal: ctrl.signal });
        junk = parseCleanupRemovals(text, nodes);
      }
      // Merge, one remove per bookmark (duplicate > dead > meaningless order).
      const byId = new Map<string, Action>();
      for (const a of [...dupes, ...dead, ...junk]) if (!byId.has(a.bmId)) byId.set(a.bmId, a);
      const merged = [...byId.values()];
      setResult(merged, noChanges(merged.length));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      deadAbort.current = null;
      setBusy(null);
      setProgress(null);
    }
  }, [config, nodes, lang, setResult]);

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
      setResult(result, noChanges(result.length));
    } finally {
      deadAbort.current = null;
      setBusy(null);
      setProgress(null);
    }
  }, [nodes, setResult, lang]);

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
      new Set(actions.filter((a) => checked.has(a.id)).map((a) => a.url)),
    );
    if (urls.length === 0) return;
    if (urls.length > 10 && !window.confirm(t(lang, "bm.confirmOpen").replace("{n}", String(urls.length)))) return;
    for (const url of urls) void chrome.tabs.create({ url, active: false });
  }, [actions, checked, lang]);

  // Content-level semantic dedup: judge by title + first few sentences (short
  // snippet) to keep latency down. Catches AMP/mobile/shortened/cross-domain
  // copies that URL canonicalization can't.
  const runSemanticDup = useCallback(async () => {
    if (!config) {
      setError(t(lang, "bm.needConfig"));
      return;
    }
    setResult([]);
    setBusy("sdup");
    setProgress({ done: 0, total: 0 });
    const ctrl = new AbortController();
    deadAbort.current = ctrl;
    try {
      const { actions, skipped } = await runSemanticDedup({
        nodes,
        config,
        signal: ctrl.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setProgress(null);
      const skipNote = skipped > 0 ? t(lang, "bm.aiSkipped").replace("{n}", String(skipped)) : "";
      setResult(actions, actions.length === 0 ? t(lang, "bm.noChanges") : skipNote);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      deadAbort.current = null;
      setBusy(null);
      setProgress(null);
    }
  }, [config, nodes, lang, setResult]);

  // Folders the user can publish to Hive (non-empty, with at least one bookmark).
  const shareFolders: FolderChoice[] = (() => {
    if (!cloudConfigured) return [];
    const withItems = new Set(nodes.filter((n) => n.url && n.parentId).map((n) => n.parentId));
    return listFolderChoices(nodes).filter((f) => withItems.has(f.id));
  })();
  const [shareFolderId, setShareFolderId] = useState("");

  // Share a folder to Hive: summarize its bookmarks client-side, then publish.
  const runShare = useCallback(async () => {
    if (!config) {
      setError(t(lang, "bm.needConfig"));
      return;
    }
    const folder = listFolderChoices(nodes).find((f) => f.id === shareFolderId);
    if (!folder) return;
    const items = nodes
      .filter((n) => n.parentId === folder.id && n.url)
      .map((n) => ({ title: n.title || n.url!, url: n.url! }));
    if (items.length === 0) return;

    setResult([]);
    setError("");
    setBusy("share");
    try {
      const session = await getSession();
      if (!session) {
        setError(t(lang, "bm.shareNeedSignIn"));
        return;
      }
      const summary = await summarizeFolder(config, folder.path, items);
      await publishFolder(supabase, {
        title: folder.path,
        sourceFolderName: folder.path,
        summary: summary.summary,
        topics: summary.topics,
        items: summary.items,
      });
      setNote(t(lang, "bm.shareDone").replace("{n}", String(summary.items.length)));
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "bm.shareFailed"));
    } finally {
      setBusy(null);
    }
  }, [config, nodes, shareFolderId, lang, setResult]);

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
        <button
          className="skill"
          title={t(lang, "bm.aiClean.title")}
          onClick={() => void runAiClean()}
          disabled={disabled || !config}
        >
          {t(lang, "bm.aiClean")}
        </button>
        <button
          className="skill"
          title={t(lang, "bm.aiDup.title")}
          onClick={() => void runSemanticDup()}
          disabled={disabled || !config}
        >
          {t(lang, "bm.aiDup")}
        </button>
        <button className="skill" onClick={() => void runAi()} disabled={disabled || !config}>{t(lang, "bm.ai")}</button>
      </div>

      {cloudConfigured && (
        <div className="bm-share" title={t(lang, "bm.shareTitle")}>
          <select
            className="tx-lang"
            value={shareFolderId}
            onChange={(e) => setShareFolderId(e.target.value)}
            disabled={disabled}
          >
            <option value="">{t(lang, "bm.sharePick")}</option>
            {shareFolders.map((f) => (
              <option key={f.id} value={f.id}>{f.path}</option>
            ))}
          </select>
          <button
            className="tx-go"
            onClick={() => void runShare()}
            disabled={disabled || !config || !shareFolderId}
            title={t(lang, "bm.shareTitle")}
          >
            {t(lang, "bm.shareToHive")}
          </button>
        </div>
      )}
      {busy === "share" && <div className="bm-status">{t(lang, "bm.sharing")}</div>}

      {(busy === "dead" || busy === "clean" || busy === "sdup") && progress && (
        <div className="bm-status">
          {progress.done} / {progress.total}
          <button className="tx-restore" onClick={() => deadAbort.current?.abort()}>{t(lang, "stop")}</button>
        </div>
      )}
      {busy === "clean" && !progress && <div className="bm-status">{t(lang, "bm.cleaning")}</div>}
      {busy === "sdup" && !progress && <div className="bm-status">{t(lang, "bm.dupAnalyzing")}</div>}
      {(busy === "ai" || busy === "apply") && <div className="bm-status">{t(lang, "working")}</div>}
      {error && <div className="bm-status err">⚠ {error}</div>}
      {note && <div className="bm-status">{note}</div>}

      <div className="bm-list">
        {actions.length === 0 && !disabled && !note && <div className="bm-empty">{t(lang, "bm.empty")}</div>}
        {actions.map((a) => (
          <BookmarkRow key={a.id} action={a} checked={checked.has(a.id)} lang={lang} onToggle={toggle} onOpen={openOne} />
        ))}
      </div>

      {actions.length > 0 && (
        <div className="bm-apply">
          <span>{t(lang, "bm.selected").replace("{n}", String(checked.size))}</span>
          <span className="bm-apply-btns">
            <button className="tx-restore" onClick={toggleAll} disabled={disabled}>
              {allChecked ? t(lang, "bm.selectNone") : t(lang, "bm.selectAll")}
            </button>
            <button className="tx-restore" onClick={openSelected} disabled={disabled || checked.size === 0}>
              {t(lang, "bm.openSelected")}
            </button>
            <button className="tx-go" onClick={() => void apply()} disabled={disabled || checked.size === 0}>
              {t(lang, "bm.apply")}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
