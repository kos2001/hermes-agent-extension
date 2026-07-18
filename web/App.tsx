import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { detectLang, localizeTimeAgo, saveLang, t as tr, type Lang, type StrKey } from "./i18n";
import { listFeed, listOwnerFolders, myReactions, react, reactionCounts, reactionKey, unreact } from "@/lib/cloud/feed";
import { isRecent, timeAgo } from "@/lib/cloud/time";
import { getFolder } from "@/lib/cloud/folders";
import { listComments, postComment, threadComments } from "@/lib/cloud/comments";
import { myOpinionVotes, opinionVoteCounts, unvoteOpinion, voteOpinion } from "@/lib/cloud/opinion-votes";
import { getContributor, getReputations, listLeaderboard, type Contributor } from "@/lib/cloud/leaderboard";
import { createCommunity, deleteCommunity, joinCommunity, leaveCommunity, listCommunities, myCommunityIds } from "@/lib/cloud/communities";
import { buildConversations, getProfileNames, listMyMessages, markRead, sendMessage } from "@/lib/cloud/messages";
import { listCommunityMessages, sendCommunityMessage } from "@/lib/cloud/community-chat";
import { loadActivity, unseenCount } from "@/lib/cloud/activity";
import { listTasks, postTask, TASK_CATEGORIES, taskCategory, type AgentTask, type TaskCategory } from "@/lib/cloud/board";
import { conclude, convene, getMeeting, listMeetings, listTurns, speak, type Meeting, type MeetingTurn } from "@/lib/cloud/meetings";
import { avgRating, getChallenge, judgeChallenge, listChallenges, listEarnings, listReviews, listSubmissions, myBalance, postChallenge, reviewSubmission, submitSolution, type Challenge, type ChallengeEarning, type ChallengeSubmission, type SubmissionReview } from "@/lib/cloud/challenges";
import { activeWithin, listRecentAgents, type RecentAgent } from "@/lib/cloud/presence";
import { eqFilter, onTableEvents, onTableInserts } from "@/lib/cloud/realtime";
import { avatarFor } from "@/lib/cloud/avatar";
import { activeMention, applyMention, extractMentionTokens, matchCandidates, postMentions, resolveMentions, type MentionCandidate } from "@/lib/cloud/mentions";
import {
  filterFollowing,
  followTopic,
  followUser,
  myFollowing,
  myTopics,
  unfollowTopic,
  unfollowUser,
} from "@/lib/cloud/follows";

/** Render text with @mentions highlighted. */
function renderBody(text: string): ReactNode {
  const parts = text.split(/(@[\p{L}\p{N}_]+)/gu);
  return parts.map((p, i) => (/^@[\p{L}\p{N}_]+$/u.test(p) ? <span key={i} className="mention">{p}</span> : p));
}
import type { ActivityItem, Comment, Community, CommunityMessage, DirectMessage, FeedEntry, SharedFolder, SharedItem } from "@/lib/cloud/types";
import { isValidEmail } from "@/lib/cloud/email";
import { feedStats, topicCounts, topicWeight } from "@/lib/cloud/feed-stats";
import { cloudConfigured, getSession, onAuthChange, pb, signInWithPassword, signOut, type HiveSession } from "./cloud";

type ReactionKind = "like" | "save";
type ReactionTally = { like: number; save: number };

/** UI language, switchable from the top bar (persisted). */
const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: "en", setLang: () => {} });

/** Bound translator for the active language. */
function useT() {
  const { lang } = useContext(LangCtx);
  return useCallback((key: StrKey, vars?: Record<string, string | number>) => tr(lang, key, vars), [lang]);
}

/** How long a just-inserted row keeps its "new" flash (realtime arrivals). */
const FRESH_MS = 20_000;

/** Relative timestamp with the exact moment on hover. */
function TimeAgo({ iso }: { iso: string }) {
  const { lang } = useContext(LangCtx);
  const label = localizeTimeAgo(lang, timeAgo(iso));
  if (!label) return null;
  return (
    <span className="time" title={new Date(iso).toLocaleString()}>
      {label}
    </span>
  );
}

/** Pulsing placeholder cards shown while a list loads. */
function SkeletonCards({ n = 3 }: { n?: number }) {
  return (
    <div className="feed" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card skeleton-card">
          <div className="sk sk-title" />
          <div className="sk sk-line" />
          <div className="sk sk-line short" />
          <div className="sk-chips">
            <div className="sk sk-chip" />
            <div className="sk sk-chip" />
            <div className="sk sk-chip" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Pulsing placeholder rows (leaderboard, lists, threads). */
function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div className="sk-rows" aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="skeleton-card sk-row">
          <div className="sk sk-avatar" />
          <div className="sk sk-line" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden>{icon}</span>
      <p className="empty-title">{title}</p>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

const HOW_STEPS: { icon: string; title: StrKey; desc: StrKey }[] = [
  { icon: "📁", title: "how1Title", desc: "how1Desc" },
  { icon: "🤖", title: "how2Title", desc: "how2Desc" },
  { icon: "🐝", title: "how3Title", desc: "how3Desc" },
  { icon: "💬", title: "how4Title", desc: "how4Desc" },
];

type TabKey = "feed" | "leaderboard" | "communities" | "board" | "challenges" | "meetings" | "messages" | "activity";

/** The site's pages; labels and descriptions come from the i18n dictionary. */
const PAGES: { key: TabKey; icon: string }[] = [
  { key: "feed", icon: "📰" },
  { key: "leaderboard", icon: "🏆" },
  { key: "communities", icon: "👥" },
  { key: "board", icon: "🧠" },
  { key: "challenges", icon: "🎯" },
  { key: "meetings", icon: "🗣️" },
  { key: "messages", icon: "✉️" },
  { key: "activity", icon: "🔔" },
];

const pageKey = (key: TabKey, part: "label" | "desc" | "pageDesc") => `${key}.${part}` as StrKey;

/** Page title + one-line explanation shown at the top of each page. */
function PageHead({ page }: { page: (typeof PAGES)[number] }) {
  const t = useT();
  return (
    <header className="page-head">
      <h2>
        {page.icon} {t(pageKey(page.key, "label"))}
      </h2>
      <p className="page-sub">{t(pageKey(page.key, "pageDesc"))}</p>
    </header>
  );
}

/** Sidebar footer: where the name comes from. */
function WhyHive() {
  const t = useT();
  return (
    <div className="side-why">
      <strong>{t("whyHiveTitle")}</strong>
      {t("whyHiveBody")}
    </div>
  );
}

/** Sidebar: Moltbook-style agent onboarding — one URL any agent can read. */
/** Sidebar liveness strip: who participated in the last 24h (derived — no fake heartbeats). */
function ActiveNow() {
  const t = useT();
  const [rows, setRows] = useState<RecentAgent[]>([]);
  useEffect(() => {
    listRecentAgents(pb)
      .then((all) => setRows(activeWithin(all, 24)))
      .catch(() => {});
  }, []);
  if (!rows.length) return null;
  return (
    <div className="side-why side-active">
      <strong>🐝 {t("activeNowTitle", { n: rows.length })}</strong>
      {rows.slice(0, 4).map((r) => (
        <span key={r.user_id} className="active-name">
          {r.display_name ?? t("someone")} · <TimeAgo iso={r.last_active} />
        </span>
      ))}
    </div>
  );
}

function AgentInvite() {
  const t = useT();
  const url = `${window.location.origin}/skill.md`;
  return (
    <div className="side-why side-agents">
      <strong>{t("agentInviteTitle")}</strong>
      {t("agentInviteBody")}
      <a className="agent-cta" href="/skill.md" target="_blank" rel="noreferrer">
        {t("agentInviteCta", { url })}
      </a>
    </div>
  );
}

/** Intro section on the signed-out landing: how people and agents join. */
function JoinGuide() {
  const t = useT();
  const url = `${window.location.origin}/skill.md`;
  return (
    <section className="join-guide">
      <h3>{t("introJoinTitle")}</h3>
      <div className="join-cards">
        <div className="join-card">
          <strong>{t("introMemberTitle")}</strong>
          <ol className="join-steps">
            <li>{t("introMemberStep1")}</li>
            <li>{t("introMemberStep2")}</li>
            <li>{t("introMemberStep3")}</li>
          </ol>
        </div>
        <div className="join-card">
          <strong>{t("introAgentTitle")}</strong>
          <p className="join-agent-body">{t("introAgentBody")}</p>
          <a className="agent-cta" href="/skill.md" target="_blank" rel="noreferrer">
            {t("agentInviteCta", { url })}
          </a>
        </div>
      </div>
    </section>
  );
}

/** Visual pipeline of what Hive does — shown on sign-in and on an empty feed. */
function HowItWorks() {
  const t = useT();
  return (
    <div className="how">
      {HOW_STEPS.map((s, i) => (
        <div key={s.title} className="how-step" style={{ animationDelay: `${i * 120}ms` }}>
          <span className="how-icon" aria-hidden>{s.icon}</span>
          <span className="how-title">{t(s.title)}</span>
          <span className="how-desc">{t(s.desc)}</span>
        </div>
      ))}
    </div>
  );
}

/** Readable message from any thrown value — API errors may be plain objects. */
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}

export function App() {
  const [session, setSession] = useState<HiveSession | null>(null);
  const [ready, setReady] = useState(false);
  const [lang, setLangState] = useState<Lang>(() => detectLang());
  const setLang = (l: Lang) => {
    saveLang(l);
    setLangState(l);
  };

  useEffect(() => {
    if (!cloudConfigured) {
      setReady(true);
      return;
    }
    void getSession().then((s) => {
      setSession(s);
      setReady(true);
    });
    return onAuthChange(setSession);
  }, []);

  let body: ReactNode;
  if (!cloudConfigured) {
    body = (
      <Shell>
        <p className="hint">{tr(lang, "notConfigured")}</p>
      </Shell>
    );
  } else if (!ready) {
    body = <Shell><p className="hint">{tr(lang, "loading")}</p></Shell>;
  } else if (!session) {
    body = (
      <Shell>
        <SignIn onSignedIn={setSession} />
      </Shell>
    );
  } else {
    body = <SignedIn session={session} />;
  }

  return <LangCtx.Provider value={{ lang, setLang }}>{body}</LangCtx.Provider>;
}

function SignIn({ onSignedIn }: { onSignedIn: (s: HiveSession) => void }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!isValidEmail(email)) {
      setError(t("emailInvalid"));
      return;
    }
    if (password.length < 6) {
      setError(t("passwordShort"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      onSignedIn(await signInWithPassword(email, password));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <h2>{t("signinTitle")}</h2>
      <p className="hint">{t("signinSub")}</p>
      <div className="signin-form">
        <input
          type="email"
          placeholder={t("emailPlaceholder")}
          value={email}
          disabled={busy}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
        <input
          type="password"
          placeholder={t("passwordPlaceholder")}
          value={password}
          disabled={busy}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
        <button className="primary" onClick={() => void submit()} disabled={busy}>
          {busy ? t("signingIn") : t("signinBtn")}
        </button>
      </div>
      {error && <p className="hint err">⚠ {error}</p>}
      <HowItWorks />
      <JoinGuide />
      <div className="intro-why">
        <WhyHive />
      </div>
    </div>
  );
}

function SignedIn({ session }: { session: HiveSession }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("feed");
  const [community, setCommunity] = useState<{ id: string; name: string } | null>(null);
  const [communityTab, setCommunityTab] = useState<"folders" | "chat">("folders");
  const [dmTarget, setDmTarget] = useState<{ id: string; name: string } | null>(null);
  const [profile, setProfile] = useState<{ id: string; name: string } | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [seen, setSeen] = useState<string | null>(() => localStorage.getItem("hive.activity.seen"));
  const myId = session.user.id;
  const name = session.user.name ?? session.user.email ?? "";
  const t = useT();

  useEffect(() => {
    loadActivity(pb).then(setActivity).catch(() => {});
  }, []);
  const unseen = activity ? unseenCount(activity, seen) : 0;

  /** Sidebar navigation: switch page and leave any drill-down view. */
  const goTab = (key: TabKey) => {
    setTab(key);
    setOpenId(null);
    setProfile(null);
    setCommunity(null);
    if (key === "activity") {
      const now = new Date().toISOString();
      localStorage.setItem("hive.activity.seen", now);
      setSeen(now);
    }
  };

  const startDm = (id: string, who: string) => {
    if (id === myId) return;
    setDmTarget({ id, name: who });
    setProfile(null);
    setTab("messages");
    setOpenId(null);
    setCommunity(null);
  };
  const openProfile = (id: string, who: string) => {
    setProfile({ id, name: who });
    setOpenId(null);
  };

  let content: ReactNode;
  if (openId) {
    content = <Detail folderId={openId} onBack={() => setOpenId(null)} />;
  } else if (profile) {
    content = (
      <Profile
        userId={profile.id}
        fallbackName={profile.name}
        isMe={profile.id === myId}
        onBack={() => setProfile(null)}
        onOpenFolder={setOpenId}
        onMessage={startDm}
      />
    );
  } else if (community) {
    content = (
      <>
        <div className="filter-bar">
          <span>
            {t("communityLabel")} · <strong>{community.name}</strong>
          </span>
          <button onClick={() => setCommunity(null)}>{t("allCommunities")}</button>
        </div>
        <p className="page-sub">{t("communityPageDesc")}</p>
        <div className="scope">
          <button className={communityTab === "folders" ? "active" : ""} onClick={() => setCommunityTab("folders")}>{t("foldersTab")}</button>
          <button className={communityTab === "chat" ? "active" : ""} onClick={() => setCommunityTab("chat")}>{t("chatTab")}</button>
        </div>
        {communityTab === "folders" ? (
          <Feed onOpen={setOpenId} onOpenProfile={openProfile} communityId={community.id} />
        ) : (
          <CommunityChat communityId={community.id} myId={myId} />
        )}
      </>
    );
  } else {
    const page = PAGES.find((p) => p.key === tab)!;
    content = (
      <>
        <PageHead page={page} />
        {tab === "feed" ? (
          <Feed onOpen={setOpenId} onOpenProfile={openProfile} />
        ) : tab === "leaderboard" ? (
          <Leaderboard onOpenProfile={openProfile} />
        ) : tab === "communities" ? (
          <Communities onOpen={setCommunity} myId={myId} />
        ) : tab === "board" ? (
          <Board myId={myId} />
        ) : tab === "challenges" ? (
          <Challenges myId={myId} myName={name} />
        ) : tab === "meetings" ? (
          <Meetings myId={myId} myName={name} />
        ) : tab === "messages" ? (
          <Messages myId={myId} initialOther={dmTarget} />
        ) : (
          <Activity items={activity} onOpenFolder={setOpenId} />
        )}
      </>
    );
  }

  return (
    <Shell
      right={
        <span className="me">
          <span className="me-name">{name}</span>
          <button onClick={() => void signOut()}>{t("signOut")}</button>
        </span>
      }
    >
      <div className="layout">
        <aside className="sidebar">
          <p className="side-tagline">{t("tagline")}</p>
          <nav className="side-nav" aria-label="Pages">
            {PAGES.map((p) => (
              <button key={p.key} className={`side-item${tab === p.key ? " active" : ""}`} onClick={() => goTab(p.key)}>
                <span className="side-icon" aria-hidden>{p.icon}</span>
                <span className="side-text">
                  <span className="side-label">
                    {t(pageKey(p.key, "label"))}
                    {p.key === "activity" && unseen > 0 && <span className="tab-badge">{unseen}</span>}
                  </span>
                  <span className="side-desc">{t(pageKey(p.key, "desc"))}</span>
                </span>
              </button>
            ))}
          </nav>
          <ActiveNow />
          <AgentInvite />
          <WhyHive />
        </aside>
        <div className="page">{content}</div>
      </div>
    </Shell>
  );
}

function CommunityChat({ communityId, myId }: { communityId: string; myId: string }) {
  const t = useT();
  const [messages, setMessages] = useState<CommunityMessage[] | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listCommunityMessages(pb, communityId)
      .then(setMessages)
      .catch((e) => setError(errMsg(e)));
  }, [communityId]);
  useEffect(load, [load]);
  useEffect(() => onTableInserts(pb, "community_messages", eqFilter("community_id", communityId), load), [communityId, load]);

  async function send() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      await sendCommunityMessage(pb, communityId, text);
      setBody("");
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="chat">
      {error && <p className="hint err">⚠ {error}</p>}
      {!messages && <SkeletonRows n={3} />}
      {messages && messages.length === 0 && (
        <EmptyState icon="💬" title={t("chatEmptyTitle")} hint={t("chatEmptyHint")} />
      )}
      <div className="chat-thread">
        {messages?.map((m) => {
          const who = m.author?.display_name ?? t("someone");
          const mine = m.user_id === myId;
          return (
            <div key={m.id} className={`chat-msg ${mine ? "mine" : "theirs"}${isRecent(m.created_at, FRESH_MS) ? " fresh" : ""}`}>
              {!mine && (
                <span className="chat-from">
                  <Avatar seed={m.user_id} label={who} /> {who} <TimeAgo iso={m.created_at} />
                </span>
              )}
              <span className="chat-bubble">{m.body}</span>
              {mine && <span className="msg-time"><TimeAgo iso={m.created_at} /></span>}
            </div>
          );
        })}
      </div>
      <div className="opinion-form">
        <textarea rows={2} placeholder={t("chatPlaceholder")} value={body} disabled={busy} onChange={(e) => setBody(e.target.value)} />
        <button className="primary" onClick={() => void send()} disabled={busy || !body.trim()}>{t("send")}</button>
      </div>
    </div>
  );
}

/** The agent blackboard: post a request; any member's agent answers. */
function Board({ myId }: { myId: string }) {
  const t = useT();
  const [tasks, setTasks] = useState<AgentTask[] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [cat, setCat] = useState<TaskCategory>("general");
  const [dl, setDl] = useState("");
  const [filterCat, setFilterCat] = useState<TaskCategory | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const catLabel = (c: TaskCategory) => t(`boardCat_${c}` as StrKey);

  const load = useCallback(() => {
    listTasks(pb, 50, filterCat || undefined)
      .then(setTasks)
      .catch((e) => setError(errMsg(e)));
  }, [filterCat]);
  useEffect(load, [load]);
  // Live: new requests appear and claims/answers update without a refresh.
  useEffect(() => onTableEvents(pb, "agent_tasks", undefined, load), [load]);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await postTask(pb, title, body, cat, dl ? new Date(dl).toISOString() : "");
      setTitle("");
      setBody("");
      setDl("");
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const statusChip = (task: AgentTask) =>
    task.status === "open" ? (
      <span className="task-status open">🟡 {t("boardOpen")}</span>
    ) : task.status === "claimed" ? (
      <span className="task-status claimed">🔵 {t("boardClaimed")}{task.worker_label ? ` ${t("boardBy")} ${task.worker_label}` : ""}</span>
    ) : (
      <span className="task-status done">✅ {t("boardDone")}{task.worker_label ? ` ${t("boardBy")} ${task.worker_label}` : ""}</span>
    );

  return (
    <div className="board">
      <div className="board-form">
        <div className="board-title-row">
          <input placeholder={t("boardTitlePh")} value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
          <select value={cat} disabled={busy} onChange={(e) => setCat(e.target.value as TaskCategory)} title={t("boardCatPick")}>
            {TASK_CATEGORIES.map((c) => (
              <option key={c} value={c}>{catLabel(c)}</option>
            ))}
          </select>
          <input type="datetime-local" title={t("deadlinePick")} value={dl} disabled={busy} onChange={(e) => setDl(e.target.value)} />
        </div>
        <div className="opinion-form">
          <textarea rows={2} placeholder={t("boardBodyPh")} value={body} disabled={busy} onChange={(e) => setBody(e.target.value)} />
          <button className="primary" onClick={() => void submit()} disabled={busy || !title.trim() || !body.trim()}>
            {t("boardPost")}
          </button>
        </div>
      </div>
      <div className="scope board-cats">
        <button className={filterCat === "" ? "active" : ""} onClick={() => setFilterCat("")}>{t("boardCatAll")}</button>
        {TASK_CATEGORIES.map((c) => (
          <button key={c} className={filterCat === c ? "active" : ""} onClick={() => setFilterCat(c)}>
            {catLabel(c)}
          </button>
        ))}
      </div>
      {error && <p className="hint err">⚠ {error}</p>}
      {!tasks && <SkeletonRows />}
      {tasks && tasks.length === 0 && <EmptyState icon="🧠" title={t("boardEmptyTitle")} hint={t("boardEmptyHint")} />}
      <div className="feed">
        {tasks?.map((task) => (
          <article key={task.id} className={`card task${isRecent(task.updated_at, FRESH_MS) ? " fresh" : ""}`}>
            <header className="card-head">
              <h3>{task.title}</h3>
              {statusChip(task)}
            </header>
            <div className="tags">
              <span className="chip">#{catLabel(taskCategory(task))}</span>
              <DeadlineChip deadline={task.deadline} />
            </div>
            <p className="summary">{task.body}</p>
            <p className="task-meta">
              <Avatar seed={task.requester_id} label={task.requester?.display_name ?? t("someone")} />{" "}
              {task.requester?.display_name ?? t("someone")}
              {task.requester_id === myId ? " ✳" : ""} · <TimeAgo iso={task.created_at} />
            </p>
            {task.status === "done" && task.result && (
              <div className="task-result">
                <strong>🤖 {t("boardResult")}</strong>
                <p>{task.result}</p>
              </div>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

/** Kaggle-style challenges: post a bounty task; agents compete; the poster awards the winner. */
function Challenges({ myId, myName }: { myId: string; myName: string }) {
  const t = useT();
  const [rows, setRows] = useState<Challenge[] | null>(null);
  const [earnings, setEarnings] = useState<ChallengeEarning[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [bounty, setBounty] = useState("10");
  const [cat, setCat] = useState<TaskCategory>("general");
  const [dl, setDl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const catLabel = (c: TaskCategory) => t(`boardCat_${c}` as StrKey);

  const load = useCallback(() => {
    listChallenges(pb)
      .then(setRows)
      .catch((e) => setError(errMsg(e)));
    listEarnings(pb, 5)
      .then(setEarnings)
      .catch(() => {});
    myBalance(pb)
      .then(setBalance)
      .catch(() => {});
  }, []);
  useEffect(load, [load]);
  useEffect(() => onTableEvents(pb, "challenges", undefined, load), [load]);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      setOpenId(await postChallenge(pb, title, brief, Number(bounty), cat, dl ? new Date(dl).toISOString() : ""));
      setTitle("");
      setBrief("");
      setDl("");
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (openId) return <ChallengeRoom challengeId={openId} myId={myId} myName={myName} onBack={() => setOpenId(null)} />;

  return (
    <div className="board">
      <div className="board-form">
        <div className="board-title-row">
          <input placeholder={t("chTitlePh")} value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
          <select value={cat} disabled={busy} onChange={(e) => setCat(e.target.value as TaskCategory)} title={t("boardCatPick")}>
            {TASK_CATEGORIES.map((c) => (
              <option key={c} value={c}>{catLabel(c)}</option>
            ))}
          </select>
          <input
            className="ch-bounty-input"
            type="number"
            min={1}
            title={t("chBounty")}
            value={bounty}
            disabled={busy}
            onChange={(e) => setBounty(e.target.value)}
          />
          <input type="datetime-local" title={t("deadlinePick")} value={dl} disabled={busy} onChange={(e) => setDl(e.target.value)} />
        </div>
        {balance !== null && (
          <p className="hint ch-balance">{t("chMyBalance", { n: balance })}</p>
        )}
        <div className="opinion-form">
          <textarea rows={2} placeholder={t("chBriefPh")} value={brief} disabled={busy} onChange={(e) => setBrief(e.target.value)} />
          <button
            className="primary"
            onClick={() => void submit()}
            disabled={busy || !title.trim() || !brief.trim() || !(Number(bounty) >= 1)}
          >
            {t("chPost")}
          </button>
        </div>
      </div>
      {earnings.length > 0 && (
        <p className="ch-earnings">
          {t("chEarningsTitle")}{" "}
          {earnings.map((e, i) => (
            <span key={e.user_id} className="chip">
              {i + 1}. {e.display_name ?? t("someone")} · {e.points}pt
            </span>
          ))}
        </p>
      )}
      {error && <p className="hint err">⚠ {error}</p>}
      {!rows && <SkeletonRows />}
      {rows && rows.length === 0 && <EmptyState icon="🎯" title={t("chEmptyTitle")} hint={t("chEmptyHint")} />}
      <div className="feed">
        {rows?.map((c) => (
          <article
            key={c.id}
            className={`card task${isRecent(c.updated_at, FRESH_MS) ? " fresh" : ""}`}
            onClick={() => setOpenId(c.id)}
            style={{ cursor: "pointer" }}
          >
            <header className="card-head">
              <h3>{c.title}</h3>
              {c.status === "open" ? (
                <span className="task-status open">💰 {c.bounty}pt · {t("chOpen")}</span>
              ) : (
                <span className="task-status done">🏆 {c.bounty}pt · {t("chJudged")}</span>
              )}
            </header>
            <div className="tags">
              <span className="chip">#{catLabel((c.category || "general") as TaskCategory)}</span>
              <DeadlineChip deadline={c.deadline} />
            </div>
            <p className="summary">{c.brief}</p>
            <p className="task-meta">
              <Avatar seed={c.poster_id} label={c.poster?.display_name ?? t("someone")} />{" "}
              {c.poster?.display_name ?? t("someone")}
              {c.poster_id === myId ? " ✳" : ""} · <TimeAgo iso={c.created_at} />
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

/** One challenge: brief → competing submissions → my entry form; the poster awards the winner. */
function ChallengeRoom({
  challengeId,
  myId,
  myName,
  onBack,
}: {
  challengeId: string;
  myId: string;
  myName: string;
  onBack: () => void;
}) {
  const t = useT();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [subs, setSubs] = useState<ChallengeSubmission[] | null>(null);
  const [reviews, setReviews] = useState<SubmissionReview[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    Promise.all([getChallenge(pb, challengeId), listSubmissions(pb, challengeId)])
      .then(async ([c, ss]) => {
        setChallenge(c);
        setSubs(ss);
        setReviews(await listReviews(pb, ss.map((s) => s.id)));
      })
      .catch((e) => setError(errMsg(e)));
  }, [challengeId]);
  useEffect(load, [load]);
  useEffect(() => onTableEvents(pb, "challenge_submissions", undefined, load), [load]);
  useEffect(() => onTableEvents(pb, "challenges", undefined, load), [load]);
  useEffect(() => onTableEvents(pb, "submission_reviews", undefined, load), [load]);

  async function submitEntry() {
    setBusy(true);
    setError("");
    try {
      await submitSolution(pb, challengeId, text, { kind: "human", label: myName });
      setText("");
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function award(sub: ChallengeSubmission) {
    setBusy(true);
    setError("");
    try {
      await judgeChallenge(pb, challengeId, sub);
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (!challenge) return <SkeletonRows />;
  const isPoster = challenge.poster_id === myId;

  return (
    <div className="board">
      <div className="filter-bar">
        <span>
          🎯 <strong>{challenge.title}</strong>{" "}
          {challenge.status === "open" ? (
            <span className="task-status open">💰 {challenge.bounty}pt · {t("chOpen")}</span>
          ) : (
            <span className="task-status done">🏆 {challenge.bounty}pt · {t("chJudged")}</span>
          )}{" "}
          <DeadlineChip deadline={challenge.deadline} />
        </span>
        <button onClick={onBack}>{t("chBack")}</button>
      </div>
      <div className="card meet-agenda">
        <strong>{t("chBrief")}</strong>
        <p className="summary">{challenge.brief}</p>
      </div>
      {!subs && <SkeletonRows />}
      {subs && subs.length === 0 && <p className="hint">{t("chNoSubs")}</p>}
      <div className="meet-turns">
        {subs?.map((sub) => {
          const won = challenge.winner_submission_id === sub.id;
          const subReviews = reviews.filter((r) => r.submission_id === sub.id);
          const avg = avgRating(subReviews);
          return (
            <div key={sub.id} className={`meet-turn${won ? " ch-winner" : ""}`}>
              <p className="task-meta">
                {sub.author_kind === "agent" ? "🤖" : "👤"}{" "}
                <strong>{sub.author_label || t("someone")}</strong>
                {sub.user_id === myId ? " ✳" : ""} · <TimeAgo iso={sub.updated_at} />
                {avg !== null && <span className="ch-avg"> ⭐ {avg} ({subReviews.length})</span>}
                {won && <span className="task-status done"> 🏆 {t("chWinner")} +{challenge.bounty}pt</span>}
              </p>
              <p className="summary">{sub.body}</p>
              {subReviews.map((r) => (
                <p key={r.id} className="ch-review">
                  {"⭐".repeat(r.rating)} <strong>{r.author_label || t("someone")}</strong>
                  {r.user_id === myId ? " ✳" : ""} — {r.body}
                </p>
              ))}
              {sub.user_id !== myId && (
                <ReviewForm submissionId={sub.id} myName={myName} mine={subReviews.find((r) => r.user_id === myId)} onDone={load} />
              )}
              {isPoster && challenge.status === "open" && (
                <button className="ch-award" disabled={busy} onClick={() => void award(sub)}>
                  {t("chPickWinner")}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {challenge.status === "open" && !isPoster && (
        <div className="opinion-form">
          <textarea rows={3} placeholder={t("chSubmitPh")} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} />
          <button className="primary" onClick={() => void submitEntry()} disabled={busy || !text.trim()}>
            {t("chSubmit")}
          </button>
        </div>
      )}
      {error && <p className="hint err">⚠ {error}</p>}
    </div>
  );
}

/** Rate-and-critique form under a submission; reviewing again updates my review. */
function ReviewForm({
  submissionId,
  myName,
  mine,
  onDone,
}: {
  submissionId: string;
  myName: string;
  mine?: SubmissionReview;
  onDone: () => void;
}) {
  const t = useT();
  const [rating, setRating] = useState(mine ? String(mine.rating) : "4");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await reviewSubmission(pb, submissionId, Number(rating), body, { kind: "human", label: myName });
      setBody("");
      onDone();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ch-review-form">
      <select value={rating} disabled={busy} onChange={(e) => setRating(e.target.value)} title={t("chRating")}>
        {[5, 4, 3, 2, 1].map((n) => (
          <option key={n} value={n}>{"⭐".repeat(n)}</option>
        ))}
      </select>
      <input
        placeholder={mine ? t("chRereviewPh") : t("chReviewPh")}
        value={body}
        disabled={busy}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void submit()}
      />
      <button disabled={busy || !body.trim()} onClick={() => void submit()}>{t("chReview")}</button>
      {error && <span className="hint err">⚠ {error}</span>}
    </div>
  );
}

/** Agent meetings: convene a topic; agents drop in on their heartbeats; the convener concludes. */
function Meetings({ myId, myName }: { myId: string; myName: string }) {
  const t = useT();
  const [rows, setRows] = useState<Meeting[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [agenda, setAgenda] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listMeetings(pb)
      .then(setRows)
      .catch((e) => setError(errMsg(e)));
  }, []);
  useEffect(load, [load]);
  useEffect(() => onTableEvents(pb, "meetings", undefined, load), [load]);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      setOpenId(await convene(pb, title, agenda));
      setTitle("");
      setAgenda("");
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (openId) return <MeetingRoom meetingId={openId} myId={myId} myName={myName} onBack={() => setOpenId(null)} />;

  return (
    <div className="board">
      <div className="board-form">
        <input placeholder={t("meetTitlePh")} value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
        <div className="opinion-form">
          <textarea rows={2} placeholder={t("meetAgendaPh")} value={agenda} disabled={busy} onChange={(e) => setAgenda(e.target.value)} />
          <button className="primary" onClick={() => void submit()} disabled={busy || !title.trim() || !agenda.trim()}>
            {t("meetConvene")}
          </button>
        </div>
      </div>
      {error && <p className="hint err">⚠ {error}</p>}
      {!rows && <SkeletonRows />}
      {rows && rows.length === 0 && <EmptyState icon="🗣️" title={t("meetEmptyTitle")} hint={t("meetEmptyHint")} />}
      <div className="feed">
        {rows?.map((m) => (
          <article
            key={m.id}
            className={`card task${isRecent(m.updated_at, FRESH_MS) ? " fresh" : ""}`}
            onClick={() => setOpenId(m.id)}
            style={{ cursor: "pointer" }}
          >
            <header className="card-head">
              <h3>{m.title}</h3>
              {m.status === "open" ? (
                <span className="task-status open">🟢 {t("meetOpen")}</span>
              ) : (
                <span className="task-status done">🏁 {t("meetConcluded")}</span>
              )}
            </header>
            <p className="summary">{m.agenda}</p>
            <p className="task-meta">
              <Avatar seed={m.convener_id} label={m.convener?.display_name ?? t("someone")} />{" "}
              {m.convener?.display_name ?? t("someone")}
              {m.convener_id === myId ? " ✳" : ""} · <TimeAgo iso={m.created_at} />
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

/** One meeting: agenda → turns in reading order → speak box; the convener can conclude. */
function MeetingRoom({
  meetingId,
  myId,
  myName,
  onBack,
}: {
  meetingId: string;
  myId: string;
  myName: string;
  onBack: () => void;
}) {
  const t = useT();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [turns, setTurns] = useState<MeetingTurn[] | null>(null);
  const [text, setText] = useState("");
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    Promise.all([getMeeting(pb, meetingId), listTurns(pb, meetingId)])
      .then(([m, ts]) => {
        setMeeting(m);
        setTurns(ts);
      })
      .catch((e) => setError(errMsg(e)));
  }, [meetingId]);
  useEffect(load, [load]);
  useEffect(() => onTableEvents(pb, "meeting_turns", undefined, load), [load]);
  useEffect(() => onTableEvents(pb, "meetings", undefined, load), [load]);

  async function submitTurn() {
    setBusy(true);
    setError("");
    try {
      await speak(pb, meetingId, text, { kind: "human", label: myName });
      setText("");
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitConclusion() {
    setBusy(true);
    setError("");
    try {
      await conclude(pb, meetingId, summary);
      setSummary("");
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (!meeting) return <SkeletonRows />;
  const isConvener = meeting.convener_id === myId;

  return (
    <div className="board">
      <div className="filter-bar">
        <span>
          🗣️ <strong>{meeting.title}</strong>{" "}
          {meeting.status === "open" ? (
            <span className="task-status open">🟢 {t("meetOpen")}</span>
          ) : (
            <span className="task-status done">🏁 {t("meetConcluded")}</span>
          )}
        </span>
        <button onClick={onBack}>{t("meetBack")}</button>
      </div>
      <div className="card meet-agenda">
        <strong>{t("meetAgenda")}</strong>
        <p className="summary">{meeting.agenda}</p>
      </div>
      {meeting.status === "concluded" && meeting.conclusion && (
        <div className="card task-result meet-conclusion">
          <strong>🏁 {t("meetConclusion")}</strong>
          <p>{meeting.conclusion}</p>
        </div>
      )}
      {!turns && <SkeletonRows />}
      {turns && turns.length === 0 && <p className="hint">{t("meetNoTurns")}</p>}
      <div className="meet-turns">
        {turns?.map((turn) => (
          <div key={turn.id} className="meet-turn">
            <p className="task-meta">
              {turn.author_kind === "agent" ? "🤖" : "👤"}{" "}
              <strong>{turn.author_label || t("someone")}</strong>
              {turn.user_id === myId ? " ✳" : ""} · <TimeAgo iso={turn.created_at} />
            </p>
            <p className="summary">{turn.body}</p>
          </div>
        ))}
      </div>
      {meeting.status === "open" && (
        <div className="opinion-form">
          <textarea rows={2} placeholder={t("meetSpeakPh")} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} />
          <button className="primary" onClick={() => void submitTurn()} disabled={busy || !text.trim()}>
            {t("meetSpeak")}
          </button>
        </div>
      )}
      {meeting.status === "open" && isConvener && (
        <div className="opinion-form meet-conclude">
          <textarea rows={2} placeholder={t("meetConcludePh")} value={summary} disabled={busy} onChange={(e) => setSummary(e.target.value)} />
          <button onClick={() => void submitConclusion()} disabled={busy || !summary.trim()}>
            {t("meetConclude")}
          </button>
        </div>
      )}
      {error && <p className="hint err">⚠ {error}</p>}
    </div>
  );
}

function Communities({ onOpen, myId }: { onOpen: (c: { id: string; name: string }) => void; myId: string }) {
  const t = useT();
  const [rows, setRows] = useState<Community[] | null>(null);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    Promise.all([listCommunities(pb), myCommunityIds(pb)])
      .then(([cs, mv]) => {
        setRows(cs);
        setMine(mv);
      })
      .catch((e) => setError(errMsg(e)));
  }, []);
  useEffect(load, [load]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      await createCommunity(pb, name, desc);
      setName("");
      setDesc("");
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleJoin(id: string) {
    const joined = mine.has(id);
    setMine((p) => {
      const n = new Set(p);
      joined ? n.delete(id) : n.add(id);
      return n;
    });
    try {
      if (joined) await leaveCommunity(pb, id);
      else await joinCommunity(pb, id);
      load();
    } catch {
      load();
    }
  }

  async function remove(id: string, cname: string) {
    if (!window.confirm(t("deleteCommunityConfirm", { name: cname }))) return;
    try {
      await deleteCommunity(pb, id);
      load();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <div className="communities">
      <div className="community-create">
        <input placeholder={t("communityName")} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        <input placeholder={t("communityDesc")} value={desc} disabled={busy} onChange={(e) => setDesc(e.target.value)} />
        <button className="primary" onClick={() => void create()} disabled={busy || name.trim().length < 2}>
          {t("create")}
        </button>
      </div>
      {error && <p className="hint err">⚠ {error}</p>}
      {!rows && <SkeletonRows />}
      {rows && rows.length === 0 && (
        <EmptyState icon="👥" title={t("commEmptyTitle")} hint={t("commEmptyHint")} />
      )}
      <div className="community-list">
        {rows?.map((c) => (
          <div key={c.id} className="community-row">
            <div className="community-main" onClick={() => onOpen({ id: c.id, name: c.name })}>
              <span className="community-name">{c.name}</span>
              {c.description && <span className="community-desc">{c.description}</span>}
              <span className="community-stats">📁 {c.folder_count} · 👥 {c.member_count}</span>
            </div>
            <button className={mine.has(c.id) ? "active" : ""} onClick={() => void toggleJoin(c.id)}>
              {mine.has(c.id) ? t("joined") : t("join")}
            </button>
            {c.created_by === myId && (
              <button className="danger" title="Delete community" onClick={() => void remove(c.id, c.name)}>
                🗑
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Messages({ myId, initialOther }: { myId: string; initialOther: { id: string; name: string } | null }) {
  const t = useT();
  const [messages, setMessages] = useState<DirectMessage[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>(() =>
    initialOther ? { [initialOther.id]: initialOther.name } : {},
  );
  const [openOther, setOpenOther] = useState<string | null>(initialOther?.id ?? null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listMyMessages(pb)
      .then(async (msgs) => {
        setMessages(msgs);
        const ids = new Set<string>();
        for (const m of msgs) ids.add(m.sender_id === myId ? m.recipient_id : m.sender_id);
        if (initialOther) ids.add(initialOther.id);
        ids.delete(myId);
        const fetched = ids.size ? await getProfileNames(pb, [...ids]) : {};
        setNames((prev) => ({ ...prev, ...fetched }));
      })
      .catch((e) => setError(errMsg(e)));
  }, [myId, initialOther]);
  useEffect(load, [load]);

  useEffect(() => {
    if (openOther) void markRead(pb, openOther).then(load).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOther]);

  async function send() {
    const text = body.trim();
    if (!text || !openOther) return;
    setBusy(true);
    setError("");
    try {
      await sendMessage(pb, openOther, text);
      setBody("");
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="hint err">⚠ {error}</p>;
  if (!messages) return <SkeletonRows />;

  const convos = buildConversations(messages, myId);
  if (openOther && !convos.some((c) => c.otherId === openOther)) {
    convos.unshift({ otherId: openOther, lastBody: "", lastAt: "", unread: 0 });
  }

  if (openOther) {
    const thread = messages
      .filter((m) => m.sender_id === openOther || m.recipient_id === openOther)
      .filter((m) => m.sender_id === myId || m.recipient_id === myId);
    return (
      <div className="messages">
        <div className="filter-bar">
          <span>✉ <strong>{names[openOther] ?? "…"}</strong></span>
          <button onClick={() => setOpenOther(null)}>{t("allMessages")}</button>
        </div>
        <div className="dm-thread">
          {thread.map((m) => (
            <div key={m.id} className={`dm-wrap ${m.sender_id === myId ? "mine" : "theirs"}`}>
              <div className={`dm-msg ${m.sender_id === myId ? "mine" : "theirs"}`}>{m.body}</div>
              <span className="msg-time">
                <TimeAgo iso={m.created_at} />
                {m.sender_id === myId && m.read_at && <span className="msg-read" title="read">✓✓</span>}
              </span>
            </div>
          ))}
          {thread.length === 0 && <p className="hint">{t("dmNoMessages")}</p>}
        </div>
        <div className="opinion-form">
          <textarea rows={2} placeholder={t("dmPlaceholder")} value={body} disabled={busy} onChange={(e) => setBody(e.target.value)} />
          <button className="primary" onClick={() => void send()} disabled={busy || !body.trim()}>{t("send")}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="messages">
      {convos.length === 0 && (
        <EmptyState icon="✉" title={t("dmEmptyTitle")} hint={t("dmEmptyHint")} />
      )}
      <div className="dm-list">
        {convos.map((c) => (
          <div key={c.otherId} className="dm-row" onClick={() => setOpenOther(c.otherId)}>
            <Avatar seed={c.otherId} label={names[c.otherId] ?? t("someone")} />
            <span className="dm-name">{names[c.otherId] ?? t("someone")}</span>
            <span className="dm-last">{c.lastBody}</span>
            <TimeAgo iso={c.lastAt} />
            {c.unread > 0 && <span className="dm-unread">{c.unread}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Feed({
  onOpen,
  onOpenProfile,
  communityId,
}: {
  onOpen: (id: string) => void;
  onOpenProfile: (id: string, name: string) => void;
  communityId?: string;
}) {
  const t = useT();
  const [entries, setEntries] = useState<FeedEntry[] | null>(null);
  const [error, setError] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "following">("all");
  const [fUsers, setFUsers] = useState<Set<string>>(new Set());
  const [fTopics, setFTopics] = useState<Set<string>>(new Set());
  const [rCounts, setRCounts] = useState<Record<string, ReactionTally>>({});
  const [rMine, setRMine] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    listFeed(pb, 50, communityId)
      .then(setEntries)
      .catch((e) => setError(errMsg(e)));
  }, [communityId]);
  useEffect(load, [load]);
  useEffect(() => {
    Promise.all([myFollowing(pb), myTopics(pb)]).then(([u, t]) => {
      setFUsers(u);
      setFTopics(t);
    }).catch(() => {});
  }, []);
  // Reaction tallies + which ones are mine, so ♥/☆ reflect reality on load.
  useEffect(() => {
    if (!entries || entries.length === 0) return;
    const ids = entries.map((e) => e.id);
    Promise.all([reactionCounts(pb, ids), myReactions(pb, ids)])
      .then(([c, m]) => {
        setRCounts(c);
        setRMine(m);
      })
      .catch(() => {});
  }, [entries]);
  // Live: a newly shared (or re-shared) folder appears without a refresh.
  useEffect(() => onTableInserts(pb, "shared_folders", undefined, load), [load]);

  const toggleReaction = useCallback(
    async (folderId: string, kind: ReactionKind) => {
      const key = reactionKey(folderId, kind);
      const on = rMine.has(key);
      const bump = (p: Record<string, ReactionTally>, d: number): Record<string, ReactionTally> => {
        const cur = p[folderId] ?? { like: 0, save: 0 };
        return { ...p, [folderId]: { ...cur, [kind]: Math.max(0, cur[kind] + d) } };
      };
      // optimistic
      setRMine((p) => {
        const n = new Set(p);
        on ? n.delete(key) : n.add(key);
        return n;
      });
      setRCounts((p) => bump(p, on ? -1 : 1));
      try {
        if (on) await unreact(pb, folderId, kind);
        else await react(pb, folderId, kind);
      } catch {
        // revert on failure
        setRMine((p) => {
          const n = new Set(p);
          on ? n.add(key) : n.delete(key);
          return n;
        });
        setRCounts((p) => bump(p, on ? 1 : -1));
      }
    },
    [rMine],
  );

  if (error) return <p className="hint err">⚠ {error}</p>;
  if (!entries) return <SkeletonCards />;
  if (entries.length === 0)
    return (
      <>
        <EmptyState icon="🐝" title={t("emptyFeedTitle")} hint={t("emptyFeedHint")} />
        <HowItWorks />
      </>
    );

  const stats = feedStats(entries);
  const counts = topicCounts(entries);
  const maxCount = counts.length ? counts[0].count : 1;
  const base = scope === "following" && !communityId ? filterFollowing(entries, fUsers, fTopics) : entries;
  const shown = topic ? base.filter((e) => e.topics.some((t) => t.toLowerCase() === topic)) : base;

  async function toggleTopicFollow(tp: string) {
    const has = fTopics.has(tp);
    setFTopics((p) => { const n = new Set(p); has ? n.delete(tp) : n.add(tp); return n; });
    try { has ? await unfollowTopic(pb, tp) : await followTopic(pb, tp); } catch { /* revert silently */ }
  }

  return (
    <>
      {!communityId && (
        <div className="scope">
          <button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>{t("scopeAll")}</button>
          <button className={scope === "following" ? "active" : ""} onClick={() => setScope("following")}>{t("scopeFollowing")}</button>
        </div>
      )}
      <section className="collective">
        <div className="stats">
          <Stat n={stats.folders} label={t("statFolders")} />
          <Stat n={stats.members} label={t("statMembers")} />
          <Stat n={stats.items} label={t("statLinks")} />
          <Stat n={stats.topics} label={t("statTopics")} />
        </div>
        {counts.length > 0 && (
          <div className="cloud">
            {counts.map((c) => (
              <button
                key={c.topic}
                className={`cloud-chip w${topicWeight(c.count, maxCount)}${topic === c.topic ? " active" : ""}`}
                title={`${c.count} folder${c.count > 1 ? "s" : ""}`}
                onClick={() => setTopic((cur) => (cur === c.topic ? null : c.topic))}
              >
                #{c.topic}
              </button>
            ))}
          </div>
        )}
      </section>

      {topic && (
        <div className="filter-bar">
          <span>
            {t("showing")} <strong>#{topic}</strong> · {shown.length} {shown.length === 1 ? t("result") : t("results")}
          </span>
          <span style={{ display: "inline-flex", gap: 8 }}>
            <button className={fTopics.has(topic) ? "active" : ""} onClick={() => void toggleTopicFollow(topic)}>
              {fTopics.has(topic) ? t("followingTopic") : t("followTopic")}
            </button>
            <button onClick={() => setTopic(null)}>{t("clear")}</button>
          </span>
        </div>
      )}

      {scope === "following" && !communityId && shown.length === 0 && (
        <p className="hint">{t("followingEmpty")}</p>
      )}

      <div className="feed">
        {shown.map((e) => (
          <FolderCard
            key={e.id}
            entry={e}
            onOpen={() => onOpen(e.id)}
            onOpenProfile={onOpenProfile}
            reactions={rCounts[e.id]}
            mine={rMine}
            onToggleReaction={toggleReaction}
          />
        ))}
      </div>
    </>
  );
}

/** ⏳ deadline chip for board tasks / challenges; hidden when none is set. */
function DeadlineChip({ deadline }: { deadline: string }) {
  const t = useT();
  if (!deadline) return null;
  const over = new Date(deadline).getTime() <= Date.now();
  const label = new Date(deadline).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return <span className={`chip ch-deadline${over ? " over" : ""}`}>{over ? `⌛ ${t("deadlineOver")}` : `⏳ ${label}`}</span>;
}

const ACTIVITY_LOOK: Record<ActivityItem["type"], { icon: string; verb: StrKey }> = {
  reply: { icon: "↳", verb: "actReply" },
  vote: { icon: "▲", verb: "actVote" },
  mention: { icon: "@", verb: "actMention" },
  opinion: { icon: "💬", verb: "actOpinion" },
  task_done: { icon: "🧠", verb: "actTaskDone" },
  submission: { icon: "🎯", verb: "actSubmission" },
  review: { icon: "⭐", verb: "actReview" },
  win: { icon: "🏆", verb: "actWin" },
  turn: { icon: "🗣️", verb: "actTurn" },
};

function Activity({ items, onOpenFolder }: { items: ActivityItem[] | null; onOpenFolder: (id: string) => void }) {
  const t = useT();
  if (!items) return <SkeletonRows />;
  if (items.length === 0)
    return <EmptyState icon="🔔" title={t("actEmptyTitle")} hint={t("actEmptyHint")} />;
  return (
    <div className="activity">
      {items.map((a) => {
        const look = ACTIVITY_LOOK[a.type] ?? ACTIVITY_LOOK.opinion;
        return (
          <div key={a.id} className="activity-row" onClick={() => a.folderId && onOpenFolder(a.folderId)}>
            <span className={`activity-icon t-${a.type}`}>{look.icon}</span>
            <span className="activity-text">
              <strong>{a.actorName}</strong> {t(look.verb)} <strong>{a.folderTitle}</strong>
            </span>
            <TimeAgo iso={a.when} />
          </div>
        );
      })}
    </div>
  );
}

function Profile({
  userId,
  fallbackName,
  isMe,
  onBack,
  onOpenFolder,
  onMessage,
}: {
  userId: string;
  fallbackName: string;
  isMe: boolean;
  onBack: () => void;
  onOpenFolder: (id: string) => void;
  onMessage: (id: string, name: string) => void;
}) {
  const t = useT();
  const [rep, setRep] = useState<Contributor | null>(null);
  const [folders, setFolders] = useState<FeedEntry[] | null>(null);
  const [following, setFollowing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getContributor(pb, userId), listOwnerFolders(pb, userId), myFollowing(pb)])
      .then(([r, f, fset]) => {
        setRep(r);
        setFolders(f);
        setFollowing(fset.has(userId));
      })
      .catch((e) => setError(errMsg(e)));
  }, [userId]);

  const who = rep?.display_name ?? fallbackName;

  async function toggleFollow() {
    const next = !following;
    setFollowing(next);
    try { next ? await followUser(pb, userId) : await unfollowUser(pb, userId); } catch { setFollowing(!next); }
  }

  return (
    <div className="profile">
      <div className="filter-bar">
        <span className="profile-head"><Avatar seed={userId} label={who} /> <strong>{who}</strong></span>
        <button onClick={onBack}>{t("back")}</button>
      </div>
      {error && <p className="hint err">⚠ {error}</p>}
      <div className="stats">
        <Stat n={rep?.votes_received ?? 0} label={t("upvotes")} />
        <Stat n={rep?.opinions ?? 0} label={t("opinions")} />
        <Stat n={rep?.folders_shared ?? 0} label={t("folders")} />
      </div>
      {!isMe && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button className={following ? "active" : "primary"} onClick={() => void toggleFollow()}>
            {following ? t("followingUser") : t("follow")}
          </button>
          <button onClick={() => onMessage(userId, who)}>{t("message")}</button>
        </div>
      )}
      <h3>{t("sharedFolders")}</h3>
      {!folders && <SkeletonCards n={2} />}
      {folders && folders.length === 0 && <EmptyState icon="📁" title={t("noFolders")} />}
      <div className="feed">
        {folders?.map((f) => (
          <article key={f.id} className="card" onClick={() => onOpenFolder(f.id)} style={{ cursor: "pointer" }}>
            <header className="card-head">
              <h3>{f.title}</h3>
              <span className="count">
                {f.item_count} {t("items")} · <TimeAgo iso={f.updated_at} />
              </span>
            </header>
            {f.summary && <p className="summary">{f.summary}</p>}
            <div className="topics">
              {f.topics.map((t) => (
                <span key={t} className="chip">#{t}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function Leaderboard({ onOpenProfile }: { onOpenProfile: (id: string, name: string) => void }) {
  const t = useT();
  const [rows, setRows] = useState<Contributor[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    listLeaderboard(pb)
      .then(setRows)
      .catch((e) => setError(errMsg(e)));
  }, []);

  if (error) return <p className="hint err">⚠ {error}</p>;
  if (!rows) return <SkeletonRows />;
  if (rows.length === 0)
    return <EmptyState icon="🏆" title={t("lbEmptyTitle")} hint={t("lbEmptyHint")} />;

  const maxVotes = Math.max(1, ...rows.map((r) => r.votes_received));
  return (
    <div className="leaderboard">
      <p className="hint">{t("lbHint")}</p>
      <ol className="lb-list">
        {rows.map((r, i) => (
          <li key={r.user_id} className="lb-row" onClick={() => onOpenProfile(r.user_id, r.display_name ?? t("someone"))} style={{ cursor: "pointer" }}>
            <span className={`lb-rank r${i + 1}`}>{i + 1}</span>
            <Avatar seed={r.user_id} label={r.display_name ?? t("someone")} />
            <span className="lb-main">
              <span className="lb-name">{r.display_name ?? t("someone")}</span>
              <span className="lb-bar" aria-hidden>
                <span className="lb-bar-fill" style={{ width: `${(r.votes_received / maxVotes) * 100}%` }} />
              </span>
            </span>
            <span className="lb-stats">
              <span className="lb-rep" title="upvotes received">▲ {r.votes_received}</span>
              <span title="opinions posted">💬 {r.opinions}</span>
              <span title="folders shared">📁 {r.folders_shared}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span className="stat">
      <span className="stat-n">{n}</span>
      <span className="stat-label">{label}</span>
    </span>
  );
}

function FolderCard({
  entry,
  onOpen,
  onOpenProfile,
  reactions,
  mine,
  onToggleReaction,
}: {
  entry: FeedEntry;
  onOpen: () => void;
  onOpenProfile: (id: string, name: string) => void;
  reactions?: ReactionTally;
  mine: Set<string>;
  onToggleReaction: (folderId: string, kind: ReactionKind) => void;
}) {
  const t = useT();
  const owner = entry.owner.display_name ?? t("someone");
  return (
    <article className={`card${isRecent(entry.updated_at, FRESH_MS) ? " fresh" : ""}`}>
      <header className="card-head" onClick={onOpen}>
        <h3>{entry.title}</h3>
        <span
          className="owner"
          title={owner}
          onClick={(e) => {
            e.stopPropagation();
            onOpenProfile(entry.owner_id, owner);
          }}
        >
          <Avatar seed={entry.owner_id} label={owner} /> {owner}
        </span>
      </header>
      {entry.summary && <p className="summary" onClick={onOpen}>{entry.summary}</p>}
      <div className="topics">
        {entry.topics.map((tp) => (
          <span key={tp} className="chip">#{tp}</span>
        ))}
      </div>
      <footer className="card-foot">
        <span className="count">
          {entry.item_count} {t("items")} · <TimeAgo iso={entry.updated_at} />
        </span>
        <Reactions folderId={entry.id} counts={reactions} mine={mine} onToggle={onToggleReaction} />
      </footer>
    </article>
  );
}

function Reactions({
  folderId,
  counts,
  mine,
  onToggle,
}: {
  folderId: string;
  counts?: ReactionTally;
  mine: Set<string>;
  onToggle: (folderId: string, kind: ReactionKind) => void;
}) {
  const t = useT();
  const btn = (kind: ReactionKind, icon: string, label: string) => {
    const n = counts?.[kind] ?? 0;
    return (
      <button className={mine.has(reactionKey(folderId, kind)) ? "active" : ""} onClick={() => onToggle(folderId, kind)}>
        {icon} {label}
        {n > 0 && <span className="rcount">{n}</span>}
      </button>
    );
  };
  return (
    <span className="reactions">
      {btn("like", "♥", t("like"))}
      {btn("save", "☆", t("save"))}
    </span>
  );
}

function Detail({ folderId, onBack }: { folderId: string; onBack: () => void }) {
  const t = useT();
  const [data, setData] = useState<{ folder: SharedFolder; items: SharedItem[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getFolder(pb, folderId)
      .then(setData)
      .catch((e) => setError(errMsg(e)));
  }, [folderId]);

  return (
    <div className="detail">
      <button className="back" onClick={onBack}>{t("backToFeed")}</button>
      {error && <p className="hint err">⚠ {error}</p>}
      {!data && !error && <SkeletonCards n={1} />}
      {data && (
        <>
          <h2>{data.folder.title}</h2>
          <p className="detail-meta">
            📁 {t("linksSharedMeta", { n: data.items.length })} <TimeAgo iso={data.folder.updated_at} />
          </p>
          {data.folder.summary && <p className="summary">{data.folder.summary}</p>}
          <div className="topics">
            {data.folder.topics.map((t) => (
              <span key={t} className="chip">#{t}</span>
            ))}
          </div>
          <ul className="items">
            {data.items.map((it, i) => (
              <li key={it.id}>
                <span className="item-num" aria-hidden>{i + 1}</span>
                <span className="item-body">
                  <a href={it.url} target="_blank" rel="noreferrer noopener">{it.title}</a>
                  {it.item_summary && <span className="item-summary"> — {it.item_summary}</span>}
                </span>
              </li>
            ))}
          </ul>
          <Discussion folderId={folderId} />
        </>
      )}
    </div>
  );
}

function Discussion({ folderId }: { folderId: string }) {
  const t = useT();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [reps, setReps] = useState<Record<string, number>>({});
  const [body, setBody] = useState("");
  const [asQuestion, setAsQuestion] = useState(false);
  const [menu, setMenu] = useState<MentionCandidate[] | null>(null);
  const [replyOpen, setReplyOpen] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(() => {
    listComments(pb, folderId)
      .then(async (cs) => {
        setComments(cs);
        const ids = cs.map((c) => c.id);
        const authorIds = [...new Set(cs.map((c) => c.user_id))];
        const [vc, mv, rp] = await Promise.all([
          opinionVoteCounts(pb, ids),
          myOpinionVotes(pb, ids),
          getReputations(pb, authorIds),
        ]);
        setCounts(vc);
        setMine(mv);
        setReps(rp);
      })
      .catch((e) => setError(errMsg(e)));
  }, [folderId]);

  useEffect(load, [load]);
  // Live: refresh when anyone posts an opinion/reply on this folder.
  useEffect(() => onTableInserts(pb, "comments", eqFilter("folder_id", folderId), load), [folderId, load]);

  const participants = (): MentionCandidate[] => (comments ?? []).map((c) => ({ id: c.user_id, name: c.author?.display_name ?? "" }));

  // Resolve @mentions in `text` against thread participants and record them.
  async function recordMentions(commentId: string, text: string) {
    const ids = resolveMentions(extractMentionTokens(text), participants());
    if (ids.length) await postMentions(pb, commentId, ids);
  }

  // Compose handler driving the @mention autocomplete menu.
  function onCompose(value: string, caret: number) {
    setBody(value);
    const q = activeMention(value, caret);
    setMenu(q === null ? null : matchCandidates(q, participants()));
  }
  function pickMention(name: string) {
    const ta = taRef.current;
    const caret = ta ? ta.selectionStart : body.length;
    const r = applyMention(body, caret, name);
    setBody(r.text);
    setMenu(null);
    requestAnimationFrame(() => {
      if (ta) {
        ta.focus();
        ta.setSelectionRange(r.caret, r.caret);
      }
    });
  }

  async function submit() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      const id = await postComment(pb, folderId, { body: text, isQuestion: asQuestion });
      await recordMentions(id, text);
      setBody("");
      setAsQuestion(false);
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  const toggleVote = useCallback(
    async (id: string) => {
      const voted = mine.has(id);
      // optimistic
      setMine((p) => {
        const n = new Set(p);
        voted ? n.delete(id) : n.add(id);
        return n;
      });
      setCounts((p) => ({ ...p, [id]: (p[id] ?? 0) + (voted ? -1 : 1) }));
      try {
        if (voted) await unvoteOpinion(pb, id);
        else await voteOpinion(pb, id);
      } catch {
        load(); // reconcile on failure
      }
    },
    [mine, load],
  );

  async function submitReply(parentId: string) {
    const text = replyBody.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      const id = await postComment(pb, folderId, { body: text, parentId });
      await recordMentions(id, text);
      setReplyBody("");
      setReplyOpen(null);
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  // Highlight the single top-voted opinion (>=1 vote) to surface the best take.
  const topId = comments?.reduce<{ id: string; n: number } | null>((best, c) => {
    const n = counts[c.id] ?? 0;
    return n > 0 && (!best || n > best.n) ? { id: c.id, n } : best;
  }, null)?.id;

  const opinionRow = (c: Comment, isReply: boolean) => (
    <div
      key={c.id}
      className={`opinion${c.id === topId ? " top" : ""}${isReply ? " reply" : ""}${isRecent(c.created_at, FRESH_MS) ? " fresh" : ""}`}
    >
      <span className={`who ${c.author_kind}`}>
        {c.is_question ? "❓" : c.author_kind === "agent" ? "🤖" : "🧑"} {c.author?.display_name ?? t("someone")}
        {(reps[c.user_id] ?? 0) > 0 && <span className="rep-badge" title="reputation">▲{reps[c.user_id]}</span>}
        {c.author_kind === "agent" && c.author_label ? ` · ${c.author_label}` : ""}
        {c.is_question && <span className="q-badge">{t("questionBadge")}</span>}
        {c.id === topId && <span className="top-badge">{t("topBadge")}</span>}
        <TimeAgo iso={c.created_at} />
      </span>
      <p className="opinion-body">{renderBody(c.body)}</p>
      <span className="opinion-actions">
        <button className={`vote${mine.has(c.id) ? " voted" : ""}`} onClick={() => void toggleVote(c.id)} title={t("upvote")}>
          ▲ {counts[c.id] ?? 0}
        </button>
        {!isReply && (
          <button className="reply-btn" onClick={() => setReplyOpen((id) => (id === c.id ? null : c.id))}>
            {t("reply")}
          </button>
        )}
      </span>
    </div>
  );

  const threads = comments ? threadComments(comments) : [];

  return (
    <section className="discussion">
      <h3>{t("discussion")} {comments ? `(${comments.length})` : ""}</h3>
      {!comments && !error && <SkeletonRows n={2} />}
      {threads.map((th) => (
        <div key={th.id} className="thread">
          {opinionRow(th, false)}
          {th.replies.length > 0 && <div className="replies">{th.replies.map((r) => opinionRow(r, true))}</div>}
          {replyOpen === th.id && (
            <div className="opinion-form reply-form">
              <textarea
                placeholder={t("replyPlaceholder")}
                value={replyBody}
                disabled={busy}
                rows={2}
                autoFocus
                onChange={(e) => setReplyBody(e.target.value)}
              />
              <button className="primary" onClick={() => void submitReply(th.id)} disabled={busy || !replyBody.trim()}>
                {busy ? "…" : t("replyBtn")}
              </button>
            </div>
          )}
        </div>
      ))}
      {comments && comments.length === 0 && <p className="hint">{t("noOpinions")}</p>}
      <div className="compose-wrap">
        {menu && menu.length > 0 && (
          <div className="mention-menu">
            {menu.map((c) => (
              <button key={c.id} className="mention-item" onMouseDown={(e) => { e.preventDefault(); pickMention(c.name); }}>
                <Avatar seed={c.id} label={c.name} /> {c.name}
              </button>
            ))}
          </div>
        )}
        <div className="opinion-form">
          <textarea
            ref={taRef}
            placeholder={asQuestion ? t("questionPlaceholder") : t("opinionPlaceholder")}
            value={body}
            disabled={busy}
            rows={2}
            onChange={(e) => onCompose(e.target.value, e.target.selectionStart ?? e.target.value.length)}
            onKeyUp={(e) => onCompose((e.target as HTMLTextAreaElement).value, (e.target as HTMLTextAreaElement).selectionStart ?? 0)}
          />
          <button className="primary" onClick={() => void submit()} disabled={busy || !body.trim()}>
            {busy ? t("posting") : asQuestion ? t("ask") : t("post")}
          </button>
        </div>
      </div>
      <label className="ask-toggle">
        <input type="checkbox" checked={asQuestion} disabled={busy} onChange={(e) => setAsQuestion(e.target.checked)} />
        {t("askToggle")}
      </label>
      {error && <p className="hint err">⚠ {error}</p>}
    </section>
  );
}

function Avatar({ seed, label }: { seed: string; label: string }) {
  const { bg, initial } = avatarFor(seed, label);
  return (
    <span className="avatar" style={{ background: bg }} aria-hidden>
      {initial}
    </span>
  );
}

function Shell({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const { lang, setLang } = useContext(LangCtx);
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">🐝 Hive</span>
        <span className="top-right">
          <button
            className="lang-btn"
            title="Language / 언어"
            onClick={() => setLang(lang === "ko" ? "en" : "ko")}
          >
            {lang === "ko" ? "EN" : "한국어"}
          </button>
          {right}
        </span>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
