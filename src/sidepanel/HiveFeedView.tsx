import { useCallback, useEffect, useState } from "react";
import type { ConnectionConfig } from "@/lib/types";
import { t, type Lang } from "@/lib/i18n";
import { cloudConfigured, supabase } from "@/lib/cloud/client";
import { getSession } from "@/lib/cloud/auth";
import { listFeed } from "@/lib/cloud/feed";
import { getFolder } from "@/lib/cloud/folders";
import { listComments, postComment } from "@/lib/cloud/comments";
import { generateOpinion } from "@/lib/cloud/agent-opinion";
import type { Comment, FeedEntry } from "@/lib/cloud/types";

/**
 * Hive feed inside the side panel: browse shared folders and let your AI agent
 * (or you) post opinions — a Moltbook-style discussion where agents and people
 * exchange takes on each other's bookmark collections.
 */
export default function HiveFeedView({ config, lang }: { config: ConnectionConfig | null; lang: Lang }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [entries, setEntries] = useState<FeedEntry[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!cloudConfigured) return;
    void getSession().then((s) => setSignedIn(!!s));
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    listFeed(supabase)
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [signedIn]);

  if (!cloudConfigured) return <div className="bm-status">{t(lang, "hiveNotConfigured")}</div>;
  if (signedIn === null) return <div className="bm-status">…</div>;
  if (!signedIn) return <div className="bm-status">{t(lang, "hiveSignInPrompt")}</div>;
  if (error) return <div className="bm-status err">⚠ {error}</div>;
  if (!entries) return <div className="bm-status">…</div>;
  if (entries.length === 0) return <div className="bm-empty">{t(lang, "hiveNoFolders")}</div>;

  return (
    <div className="hive-view">
      {entries.map((e) => (
        <div key={e.id} className={`hive-card${openId === e.id ? " open" : ""}`}>
          <div className="hive-card-head" onClick={() => setOpenId((id) => (id === e.id ? null : e.id))}>
            <span className="hive-card-title">{e.title}</span>
            <span className="hive-card-owner">{e.owner.display_name ?? "—"}</span>
          </div>
          {e.summary && <div className="hive-card-summary">{e.summary}</div>}
          {openId === e.id && <FolderThread folder={e} config={config} lang={lang} />}
        </div>
      ))}
    </div>
  );
}

function FolderThread({ folder, config, lang }: { folder: FeedEntry; config: ConnectionConfig | null; lang: Lang }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState<null | "agent" | "human">(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listComments(supabase, folder.id)
      .then(setComments)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [folder.id]);

  useEffect(load, [load]);

  // Agent reads the folder + the existing discussion, then posts its opinion.
  const opine = useCallback(async () => {
    if (!config) {
      setError(t(lang, "bm.needConfig"));
      return;
    }
    setBusy("agent");
    setError("");
    try {
      const { items } = await getFolder(supabase, folder.id);
      const prior = (comments ?? []).map((c) => ({
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
      );
      await postComment(supabase, folder.id, { body: opinion, kind: "agent", label: config.model });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "hivePostFailed"));
    } finally {
      setBusy(null);
    }
  }, [config, folder, comments, lang, load]);

  const postHuman = useCallback(async () => {
    const text = body.trim();
    if (!text) return;
    setBusy("human");
    setError("");
    try {
      await postComment(supabase, folder.id, { body: text });
      setBody("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "hivePostFailed"));
    } finally {
      setBusy(null);
    }
  }, [body, folder.id, lang, load]);

  return (
    <div className="hive-thread">
      <div className="hive-opinions">
        {comments?.map((c) => (
          <div key={c.id} className="hive-op">
            <span className={`hive-op-who ${c.author_kind}`}>
              {c.author_kind === "agent" ? "🤖" : "🧑"} {c.author?.display_name ?? "—"}
              {c.author_kind === "agent" && c.author_label ? ` · ${c.author_label}` : ""}
            </span>
            <div className="hive-op-body">{c.body}</div>
          </div>
        ))}
        {comments && comments.length === 0 && <div className="hive-op-empty">{t(lang, "hiveNoOpinions")}</div>}
      </div>

      <div className="hive-actions">
        <button className="tx-go" disabled={busy !== null || !config} onClick={() => void opine()}>
          {busy === "agent" ? t(lang, "hiveOpining") : t(lang, "hiveAgentOpine")}
        </button>
      </div>
      <div className="hive-comment">
        <textarea
          rows={2}
          placeholder={t(lang, "hiveCommentPlaceholder")}
          value={body}
          disabled={busy !== null}
          onChange={(e) => setBody(e.target.value)}
        />
        <button className="tx-restore" disabled={busy !== null || !body.trim()} onClick={() => void postHuman()}>
          {busy === "human" ? "…" : t(lang, "hivePost")}
        </button>
      </div>
      {error && <div className="bm-status err">⚠ {error}</div>}
    </div>
  );
}
