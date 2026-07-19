import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionConfig } from "@/lib/types";
import { t, type Lang } from "@/lib/i18n";
import { type FolderChoice, listFolderChoices, loadBookmarks, type BookmarkNode } from "@/lib/bookmarks";
import { pb } from "@/lib/cloud/client";
import { getSession } from "@/lib/cloud/auth";
import { publishFolder } from "@/lib/cloud/folders";
import { listCommunities } from "@/lib/cloud/communities";
import type { Community } from "@/lib/cloud/types";
import { summarizeFolder } from "@/lib/cloud/summarize-folder";

/**
 * Share-a-bookmark-folder-to-Hive control, living on the Hive page (🐝) so
 * every Hive action is in one place. Loads the local bookmark tree itself,
 * summarizes the chosen folder via the LLM, and publishes it. Signals the
 * parent on success so the freshly shared folder can be surfaced in the feed.
 */
export function ShareFolder({
  config,
  lang,
  onShared,
}: {
  config: ConnectionConfig | null;
  lang: Lang;
  onShared?: () => void;
}) {
  const [nodes, setNodes] = useState<BookmarkNode[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [folderId, setFolderId] = useState("");
  const [communityId, setCommunityId] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    void loadBookmarks().then(setNodes);
    void listCommunities(pb).then(setCommunities).catch(() => {});
    return () => abort.current?.abort();
  }, []);

  // Folders with at least one bookmark are the publishable targets.
  const shareFolders: FolderChoice[] = (() => {
    const withItems = new Set(nodes.filter((n) => n.url && n.parentId).map((n) => n.parentId));
    return listFolderChoices(nodes).filter((f) => withItems.has(f.id));
  })();

  const runShare = useCallback(async () => {
    if (!config) return setError(t(lang, "bm.needConfig"));
    const folder = listFolderChoices(nodes).find((f) => f.id === folderId);
    if (!folder) return;
    const items = nodes
      .filter((n) => n.parentId === folder.id && n.url)
      .map((n) => ({ title: n.title || n.url!, url: n.url! }));
    if (items.length === 0) return;

    setNote("");
    setError("");
    setBusy(true);
    setProgress({ done: 0, total: items.length });
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      if (!(await getSession())) {
        setError(t(lang, "bm.shareNeedSignIn"));
        return;
      }
      const summary = await summarizeFolder(config, folder.path, items, {
        signal: ctrl.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setProgress(null);
      await publishFolder(pb, {
        title: folder.path,
        sourceFolderName: folder.path,
        summary: summary.summary,
        topics: summary.topics,
        items: summary.items,
        communityId: communityId || null,
      });
      setNote(t(lang, "bm.shareDone").replace("{n}", String(summary.items.length)));
      setFolderId("");
      onShared?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "bm.shareFailed"));
    } finally {
      abort.current = null;
      setBusy(false);
      setProgress(null);
    }
  }, [config, nodes, folderId, communityId, lang, onShared]);

  return (
    <div className="hive-share">
      <button className="hive-share-toggle" onClick={() => setOpen((v) => !v)} data-tip={t(lang, "bm.shareTitle")}>
        {open ? "▾" : "▸"} {t(lang, "bm.shareToHive")}
      </button>
      {open && (
        <div className="hive-share-body">
          <select className="tx-lang" value={folderId} onChange={(e) => setFolderId(e.target.value)} disabled={busy}>
            <option value="">{t(lang, "bm.sharePick")}</option>
            {shareFolders.map((f) => (
              <option key={f.id} value={f.id}>{f.path}</option>
            ))}
          </select>
          {communities.length > 0 && (
            <select
              className="tx-lang"
              value={communityId}
              onChange={(e) => setCommunityId(e.target.value)}
              disabled={busy}
              title={t(lang, "bm.shareCommunity")}
            >
              <option value="">{t(lang, "bm.shareNoCommunity")}</option>
              {communities.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <button className="tx-go" onClick={() => void runShare()} disabled={busy || !config || !folderId}>
            {t(lang, "bm.shareToHive")}
          </button>
        </div>
      )}
      {busy && (
        <div className="bm-status">
          {progress ? `${progress.done} / ${progress.total}` : t(lang, "bm.sharing")}
          {progress && (
            <button className="tx-restore" onClick={() => abort.current?.abort()}>{t(lang, "stop")}</button>
          )}
        </div>
      )}
      {error && <div className="bm-status err">⚠ {error}</div>}
      {note && <div className="bm-status">{note}</div>}
    </div>
  );
}
