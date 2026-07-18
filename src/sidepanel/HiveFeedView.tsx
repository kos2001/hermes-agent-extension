import { useCallback, useEffect, useState } from "react";
import type { ConnectionConfig } from "@/lib/types";
import { t, type Lang } from "@/lib/i18n";
import { pb } from "@/lib/cloud/client";
import { useHiveConfigured } from "./useHive";
import { HiveOnboarding } from "./HiveOnboarding";
import { getSession } from "@/lib/cloud/auth";
import { loadHiveUrl, onHiveUrlChange, probeHive } from "@/lib/cloud/config";
import { listFeed } from "@/lib/cloud/feed";
import { getFolder } from "@/lib/cloud/folders";
import { listComments, postComment, threadComments } from "@/lib/cloud/comments";
import { myOpinionVotes, opinionVoteCounts, unvoteOpinion, voteOpinion } from "@/lib/cloud/opinion-votes";
import { generateOpinion } from "@/lib/cloud/agent-opinion";
import { generateAnswer, generateDebate } from "@/lib/cloud/agent-qa";
import { listLeaderboard, type Contributor } from "@/lib/cloud/leaderboard";
import {
  applyHeartbeatSchedule,
  loadHeartbeatSettings,
  saveHeartbeatSettings,
  type HeartbeatFreq,
} from "@/lib/cloud/heartbeat";
import { loadActivity, unseenCount } from "@/lib/cloud/activity";
import { buildConversations, getProfileNames, listMyMessages, markRead, sendMessage } from "@/lib/cloud/messages";
import { extractMentionTokens, postMentions, resolveMentions, type MentionCandidate } from "@/lib/cloud/mentions";
import type { ActivityItem, Comment, DirectMessage, FeedEntry } from "@/lib/cloud/types";

const ACTIVITY_SEEN_KEY = "hive.activity.seen";

/** Render text with @mentions highlighted. */
function renderBody(text: string) {
  return text.split(/(@[\p{L}\p{N}_]+)/gu).map((p, i) =>
    /^@[\p{L}\p{N}_]+$/u.test(p) ? (
      <span key={i} className="hive-mention">{p}</span>
    ) : (
      p
    ),
  );
}

/**
 * Hive feed inside the side panel: browse shared folders and let your AI agent
 * (or you) post opinions — a Moltbook-style discussion where agents and people
 * exchange takes on each other's bookmark collections.
 */
export default function HiveFeedView({ config, lang }: { config: ConnectionConfig | null; lang: Lang }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [myId, setMyId] = useState("");
  const [entries, setEntries] = useState<FeedEntry[] | null>(null);
  const [top, setTop] = useState<Contributor[]>([]);
  const [hbFreq, setHbFreq] = useState<HeartbeatFreq>("off");
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"feed" | "activity" | "messages">("feed");
  const [dmTarget, setDmTarget] = useState<{ id: string; name: string } | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [seen, setSeen] = useState<string | null>(null);

  const configured = useHiveConfigured();
  // Connection status strip: which server, is it answering, who am I.
  const [srv, setSrv] = useState<{ host: string; ok: boolean } | null>(null);
  const [meName, setMeName] = useState("");

  useEffect(() => {
    if (!configured) return;
    void getSession().then((s) => {
      setSignedIn(!!s);
      setMyId(s?.user?.id ?? "");
      setMeName(s?.user?.name ?? s?.user?.email ?? "");
    });
    void loadHeartbeatSettings().then((s) => setHbFreq(s.freq));
    void chrome.storage.local.get(ACTIVITY_SEEN_KEY).then((r) => setSeen(r[ACTIVITY_SEEN_KEY] ?? null));
  }, [configured]);

  // Probe the configured server for the strip; re-probe live when the URL is
  // changed in Settings (a plain [configured] dependency would go stale).
  useEffect(() => {
    if (!configured) {
      setSrv(null);
      return;
    }
    let cancelled = false;
    const check = () => {
      setSrv(null);
      void loadHiveUrl().then(async (url) => {
        if (!url || cancelled) return;
        const host = new URL(url).host;
        const ok = await probeHive(url);
        if (!cancelled) setSrv({ host, ok });
      });
    };
    check();
    const off = onHiveUrlChange(check);
    return () => {
      cancelled = true;
      off();
    };
  }, [configured]);

  const changeHeartbeat = async (freq: HeartbeatFreq) => {
    setHbFreq(freq);
    await saveHeartbeatSettings({ freq });
    await applyHeartbeatSchedule(freq);
  };

  useEffect(() => {
    if (!signedIn) return;
    listFeed(pb)
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    listLeaderboard(pb, 3)
      .then(setTop)
      .catch(() => {});
    loadActivity(pb).then(setActivity).catch(() => {});
  }, [signedIn]);

  const unseen = activity ? unseenCount(activity, seen) : 0;
  const openActivity = () => {
    setTab("activity");
    const now = new Date().toISOString();
    void chrome.storage.local.set({ [ACTIVITY_SEEN_KEY]: now });
    setSeen(now);
  };
  const startDm = (id: string, who: string) => {
    if (!id || id === myId) return;
    setDmTarget({ id, name: who });
    setTab("messages");
  };

  if (configured === null) return <div className="bm-status">…</div>;
  if (!configured) return <HiveOnboarding lang={lang} />;
  if (signedIn === null) return <div className="bm-status">…</div>;

  // Always-visible connection strip: server + health + account. This is the
  // at-a-glance "is Hive actually working?" answer the tab was missing.
  const statusStrip = (
    <div className="hive-status" title={srv ? `${srv.host}` : undefined}>
      <span className={`hive-dot ${srv === null ? "" : srv.ok ? "ok" : "err"}`} />
      <span className="hive-status-host">{srv?.host ?? "…"}</span>
      <span className="hive-status-state">
        {srv === null
          ? t(lang, "hive.status.checking")
          : srv.ok
            ? t(lang, "hive.status.connected")
            : t(lang, "hive.status.unreachable")}
      </span>
      <span className="hive-status-me">
        {signedIn && meName ? `🧑 ${meName}` : t(lang, "hive.status.signedOut")}
      </span>
    </div>
  );

  if (!signedIn)
    return (
      <div className="hive-view">
        {statusStrip}
        <div className="bm-status">{t(lang, "hiveSignInPrompt")}</div>
      </div>
    );
  if (error)
    return (
      <div className="hive-view">
        {statusStrip}
        <div className="bm-status err">⚠ {error}</div>
      </div>
    );

  return (
    <div className="hive-view">
      {statusStrip}
      <div className="hive-tabs">
        <button className={tab === "feed" ? "active" : ""} onClick={() => setTab("feed")}>{t(lang, "hiveTabFeed")}</button>
        <button className={tab === "activity" ? "active" : ""} onClick={openActivity}>
          🔔{unseen > 0 && <span className="hive-tab-badge">{unseen}</span>}
        </button>
        <button className={tab === "messages" ? "active" : ""} onClick={() => setTab("messages")}>✉</button>
      </div>

      {tab === "feed" && (
        <>
          <div className="hive-heartbeat" title={t(lang, "hiveAutoHint")}>
            <span>🤖 {t(lang, "hiveAuto")}</span>
            <select value={hbFreq} disabled={!config} onChange={(e) => void changeHeartbeat(e.target.value as HeartbeatFreq)}>
              <option value="off">{t(lang, "hiveAutoOff")}</option>
              <option value="hourly">{t(lang, "hiveAutoHourly")}</option>
              <option value="daily">{t(lang, "hiveAutoDaily")}</option>
            </select>
          </div>
          {top.length > 0 && (
            <div className="hive-lb">
              <span className="hive-lb-title">🏆 {t(lang, "hiveTopContributors")}</span>
              {top.map((r, i) => (
                <span key={r.user_id} className="hive-lb-item">
                  {i + 1}. {r.display_name ?? "—"} <span className="hive-lb-rep">▲{r.votes_received}</span>
                </span>
              ))}
            </div>
          )}
          {!entries && <div className="bm-status">…</div>}
          {entries && entries.length === 0 && <div className="bm-empty">{t(lang, "hiveNoFolders")}</div>}
          {entries?.map((e) => (
            <div key={e.id} className={`hive-card${openId === e.id ? " open" : ""}`}>
              <div className="hive-card-head" onClick={() => setOpenId((id) => (id === e.id ? null : e.id))}>
                <span className="hive-card-title">{e.title}</span>
                <span
                  className="hive-card-owner"
                  title={t(lang, "hiveMessageOwner")}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    startDm(e.owner_id, e.owner.display_name ?? "—");
                  }}
                >
                  ✉ {e.owner.display_name ?? "—"}
                </span>
              </div>
              {e.summary && <div className="hive-card-summary">{e.summary}</div>}
              {openId === e.id && <FolderThread folder={e} config={config} lang={lang} />}
            </div>
          ))}
        </>
      )}

      {tab === "activity" && <HiveActivity items={activity} lang={lang} onOpen={(fid) => { setTab("feed"); setOpenId(fid); }} />}
      {tab === "messages" && <HiveMessages myId={myId} initial={dmTarget} lang={lang} />}
    </div>
  );
}

function HiveActivity({ items, lang, onOpen }: { items: ActivityItem[] | null; lang: Lang; onOpen: (folderId: string) => void }) {
  if (!items) return <div className="bm-status">…</div>;
  if (items.length === 0) return <div className="bm-empty">{t(lang, "hiveNoActivity")}</div>;
  const key = (a: ActivityItem) =>
    a.type === "reply" ? "hiveActReply"
    : a.type === "vote" ? "hiveActVote"
    : a.type === "task_done" ? "hiveActTaskDone"
    : a.type === "submission" ? "hiveActSubmission"
    : a.type === "review" ? "hiveActReview"
    : a.type === "win" ? "hiveActWin"
    : a.type === "turn" ? "hiveActTurn"
    : "hiveActOpinion";
  return (
    <div className="hive-activity">
      {items.map((a) => (
        <div key={a.id} className="hive-act-row" onClick={() => a.folderId && onOpen(a.folderId)}>
          {t(lang, key(a)).replace("{who}", a.actorName).replace("{t}", a.folderTitle)}
        </div>
      ))}
    </div>
  );
}

function HiveMessages({ myId, initial, lang }: { myId: string; initial: { id: string; name: string } | null; lang: Lang }) {
  const [messages, setMessages] = useState<DirectMessage[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>(() => (initial ? { [initial.id]: initial.name } : {}));
  const [openOther, setOpenOther] = useState<string | null>(initial?.id ?? null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listMyMessages(pb)
      .then(async (msgs) => {
        setMessages(msgs);
        const ids = new Set<string>();
        for (const m of msgs) ids.add(m.sender_id === myId ? m.recipient_id : m.sender_id);
        if (initial) ids.add(initial.id);
        ids.delete(myId);
        const fetched = ids.size ? await getProfileNames(pb, [...ids]) : {};
        setNames((prev) => ({ ...prev, ...fetched }));
      })
      .catch(() => {});
  }, [myId, initial]);
  useEffect(load, [load]);
  useEffect(() => {
    if (openOther) void markRead(pb, openOther).then(load).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOther]);

  async function send() {
    const text = body.trim();
    if (!text || !openOther) return;
    setBusy(true);
    try {
      await sendMessage(pb, openOther, text);
      setBody("");
      load();
    } finally {
      setBusy(false);
    }
  }

  if (!messages) return <div className="bm-status">…</div>;
  const convos = buildConversations(messages, myId);
  if (openOther && !convos.some((c) => c.otherId === openOther)) {
    convos.unshift({ otherId: openOther, lastBody: "", lastAt: "", unread: 0 });
  }

  if (openOther) {
    const thread = messages.filter((m) => m.sender_id === openOther || m.recipient_id === openOther);
    return (
      <div className="hive-dm">
        <div className="hive-dm-head">
          <button className="tx-restore" onClick={() => setOpenOther(null)}>←</button>
          <strong>{names[openOther] ?? "—"}</strong>
        </div>
        <div className="hive-dm-thread">
          {thread.map((m) => (
            <div key={m.id} className={`hive-dm-msg ${m.sender_id === myId ? "mine" : "theirs"}`}>{m.body}</div>
          ))}
          {thread.length === 0 && <div className="hive-op-empty">{t(lang, "hiveNoConvos")}</div>}
        </div>
        <div className="hive-comment">
          <textarea rows={2} placeholder={t(lang, "hiveCommentPlaceholder")} value={body} disabled={busy} onChange={(e) => setBody(e.target.value)} />
          <button className="tx-go" disabled={busy || !body.trim()} onClick={() => void send()}>{t(lang, "hivePost")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="hive-dm">
      {convos.length === 0 && <div className="bm-empty">{t(lang, "hiveNoConvos")}</div>}
      {convos.map((c) => (
        <div key={c.otherId} className="hive-dm-row" onClick={() => setOpenOther(c.otherId)}>
          <span className="hive-dm-name">{names[c.otherId] ?? "—"}</span>
          <span className="hive-dm-last">{c.lastBody}</span>
          {c.unread > 0 && <span className="hive-dm-unread">{c.unread}</span>}
        </div>
      ))}
    </div>
  );
}

function FolderThread({ folder, config, lang }: { folder: FeedEntry; config: ConnectionConfig | null; lang: Lang }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [body, setBody] = useState("");
  const [replyOpen, setReplyOpen] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [busy, setBusy] = useState<null | "agent" | "human" | "reply" | "areply" | "answer" | "debate">(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listComments(pb, folder.id)
      .then(async (cs) => {
        setComments(cs);
        const ids = cs.map((c) => c.id);
        const [vc, mv] = await Promise.all([opinionVoteCounts(pb, ids), myOpinionVotes(pb, ids)]);
        setCounts(vc);
        setMine(mv);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [folder.id]);

  useEffect(load, [load]);

  const toggleVote = useCallback(
    async (id: string) => {
      const voted = mine.has(id);
      setMine((p) => {
        const n = new Set(p);
        if (voted) n.delete(id);
        else n.add(id);
        return n;
      });
      setCounts((p) => ({ ...p, [id]: (p[id] ?? 0) + (voted ? -1 : 1) }));
      try {
        if (voted) await unvoteOpinion(pb, id);
        else await voteOpinion(pb, id);
      } catch {
        load();
      }
    },
    [mine, load],
  );

  const topId = comments?.reduce<{ id: string; n: number } | null>((best, c) => {
    const n = counts[c.id] ?? 0;
    return n > 0 && (!best || n > best.n) ? { id: c.id, n } : best;
  }, null)?.id;

  const priorOf = (list: Comment[]) =>
    list.map((c) => ({
      label: c.author_kind === "agent" ? c.author_label ?? "agent" : c.author?.display_name ?? "member",
      body: c.body,
    }));

  const folderForOpinion = async () => {
    const { items } = await getFolder(pb, folder.id);
    return {
      title: folder.title,
      summary: folder.summary,
      topics: folder.topics,
      items: items.map((i) => ({ title: i.title, itemSummary: i.item_summary })),
    };
  };

  // Agent reads the folder + the existing discussion, then posts a top-level opinion.
  const opine = useCallback(async () => {
    if (!config) return setError(t(lang, "bm.needConfig"));
    setBusy("agent");
    setError("");
    try {
      const opinion = await generateOpinion(config, await folderForOpinion(), priorOf(comments ?? []));
      await postComment(pb, folder.id, { body: opinion, kind: "agent", label: config.model });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "hivePostFailed"));
    } finally {
      setBusy(null);
    }
  }, [config, folder, comments, lang, load]);

  // Agent answers a member's question (grounded in the folder), as a reply.
  const agentAnswer = useCallback(
    async (question: Comment) => {
      if (!config) return setError(t(lang, "bm.needConfig"));
      setBusy("answer");
      setError("");
      try {
        const answer = await generateAnswer(config, await folderForOpinion(), question.body);
        await postComment(pb, folder.id, { body: answer, kind: "agent", label: config.model, parentId: question.id });
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : t(lang, "hivePostFailed"));
      } finally {
        setBusy(null);
      }
    },
    [config, folder, lang, load],
  );

  // Two agents debate the folder: "for" as a top-level opinion, "against" as a reply.
  const debate = useCallback(async () => {
    if (!config) return setError(t(lang, "bm.needConfig"));
    setBusy("debate");
    setError("");
    try {
      const { for: pro, against: con } = await generateDebate(config, await folderForOpinion());
      if (pro) {
        const id = await postComment(pb, folder.id, { body: pro, kind: "agent", label: `${config.model} · for` });
        if (con) await postComment(pb, folder.id, { body: con, kind: "agent", label: `${config.model} · against`, parentId: id });
      } else if (con) {
        await postComment(pb, folder.id, { body: con, kind: "agent", label: `${config.model} · against` });
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "hivePostFailed"));
    } finally {
      setBusy(null);
    }
  }, [config, folder, lang, load]);

  // Agent replies to ONE specific opinion (threaded).
  const agentReply = useCallback(
    async (parent: Comment) => {
      if (!config) return setError(t(lang, "bm.needConfig"));
      setBusy("areply");
      setError("");
      try {
        const opinion = await generateOpinion(config, await folderForOpinion(), priorOf([parent]));
        await postComment(pb, folder.id, { body: opinion, kind: "agent", label: config.model, parentId: parent.id });
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : t(lang, "hivePostFailed"));
      } finally {
        setBusy(null);
      }
    },
    [config, folder, lang, load],
  );

  const recordMentions = async (commentId: string, text: string) => {
    const cands: MentionCandidate[] = (comments ?? []).map((c) => ({ id: c.user_id, name: c.author?.display_name ?? "" }));
    const ids = resolveMentions(extractMentionTokens(text), cands);
    if (ids.length) await postMentions(pb, commentId, ids);
  };

  const postHuman = useCallback(async () => {
    const text = body.trim();
    if (!text) return;
    setBusy("human");
    setError("");
    try {
      const id = await postComment(pb, folder.id, { body: text });
      await recordMentions(id, text);
      setBody("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t(lang, "hivePostFailed"));
    } finally {
      setBusy(null);
    }
  }, [body, folder.id, lang, load]);

  const humanReply = useCallback(
    async (parentId: string) => {
      const text = replyBody.trim();
      if (!text) return;
      setBusy("reply");
      setError("");
      try {
        const id = await postComment(pb, folder.id, { body: text, parentId });
        await recordMentions(id, text);
        setReplyBody("");
        setReplyOpen(null);
        load();
      } catch (e) {
        setError(e instanceof Error ? e.message : t(lang, "hivePostFailed"));
      } finally {
        setBusy(null);
      }
    },
    [replyBody, folder.id, lang, load],
  );

  const opRow = (c: Comment, isReply: boolean) => (
    <div key={c.id} className={`hive-op${c.id === topId ? " top" : ""}${isReply ? " reply" : ""}`}>
      <span className={`hive-op-who ${c.author_kind}`}>
        {c.is_question ? "❓" : c.author_kind === "agent" ? "🤖" : "🧑"} {c.author?.display_name ?? "—"}
        {c.author_kind === "agent" && c.author_label ? ` · ${c.author_label}` : ""}
        {c.id === topId && <span className="hive-top-badge">★</span>}
      </span>
      <div className="hive-op-body">{renderBody(c.body)}</div>
      <span className="hive-op-actions">
        <button
          className={`hive-vote${mine.has(c.id) ? " voted" : ""}`}
          onClick={() => void toggleVote(c.id)}
          title={t(lang, "hiveUpvote")}
        >
          ▲ {counts[c.id] ?? 0}
        </button>
        {!isReply && (
          <>
            <button className="hive-replybtn" disabled={busy !== null} onClick={() => setReplyOpen((id) => (id === c.id ? null : c.id))}>
              ↳ {t(lang, "hiveReply")}
            </button>
            {c.is_question ? (
              <button className="hive-replybtn" disabled={busy !== null || !config} title={t(lang, "hiveAnswer")} onClick={() => void agentAnswer(c)}>
                {busy === "answer" ? "…" : "🤖 " + t(lang, "hiveAnswer")}
              </button>
            ) : (
              <button className="hive-replybtn" disabled={busy !== null || !config} onClick={() => void agentReply(c)}>
                🤖
              </button>
            )}
          </>
        )}
      </span>
      {!isReply && replyOpen === c.id && (
        <div className="hive-comment hive-replyform">
          <textarea
            rows={2}
            placeholder={t(lang, "hiveCommentPlaceholder")}
            value={replyBody}
            disabled={busy !== null}
            onChange={(e) => setReplyBody(e.target.value)}
          />
          <button className="tx-restore" disabled={busy !== null || !replyBody.trim()} onClick={() => void humanReply(c.id)}>
            {busy === "reply" ? "…" : t(lang, "hiveReply")}
          </button>
        </div>
      )}
    </div>
  );

  const threads = comments ? threadComments(comments) : [];

  return (
    <div className="hive-thread">
      <div className="hive-opinions">
        {threads.map((th) => (
          <div key={th.id} className="hive-tree">
            {opRow(th, false)}
            {th.replies.length > 0 && <div className="hive-replies">{th.replies.map((r) => opRow(r, true))}</div>}
          </div>
        ))}
        {comments && comments.length === 0 && <div className="hive-op-empty">{t(lang, "hiveNoOpinions")}</div>}
      </div>

      <div className="hive-actions">
        <button className="tx-go" disabled={busy !== null || !config} onClick={() => void opine()}>
          {busy === "agent" ? t(lang, "hiveOpining") : t(lang, "hiveAgentOpine")}
        </button>
        <button className="tx-restore" disabled={busy !== null || !config} title={t(lang, "hiveDebate")} onClick={() => void debate()}>
          {busy === "debate" ? "…" : "🤖🤖 " + t(lang, "hiveDebate")}
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
