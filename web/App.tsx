import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { listFeed, listOwnerFolders, react, unreact } from "@/lib/cloud/feed";
import { getFolder } from "@/lib/cloud/folders";
import { listComments, postComment, threadComments } from "@/lib/cloud/comments";
import { myOpinionVotes, opinionVoteCounts, unvoteOpinion, voteOpinion } from "@/lib/cloud/opinion-votes";
import { getContributor, listLeaderboard, type Contributor } from "@/lib/cloud/leaderboard";
import { createCommunity, deleteCommunity, joinCommunity, leaveCommunity, listCommunities, myCommunityIds } from "@/lib/cloud/communities";
import { buildConversations, getProfileNames, listMyMessages, markRead, sendMessage } from "@/lib/cloud/messages";
import { loadActivity, unseenCount } from "@/lib/cloud/activity";
import { eqFilter, onTableInserts } from "@/lib/cloud/realtime";
import { avatarFor } from "@/lib/cloud/avatar";
import { extractMentionTokens, postMentions, resolveMentions, type MentionCandidate } from "@/lib/cloud/mentions";
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
import type { ActivityItem, Comment, Community, DirectMessage, FeedEntry, SharedFolder, SharedItem } from "@/lib/cloud/types";
import { isValidEmail } from "@/lib/cloud/email";
import { feedStats, topicCounts, topicWeight } from "@/lib/cloud/feed-stats";
import { cloudConfigured, getSession, onAuthChange, sendEmailOtp, signOut, supabase, verifyEmailOtp } from "./cloud";

type ReactionKind = "like" | "save";

/** Readable message from any thrown value — Supabase errors are plain objects. */
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

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

  if (!cloudConfigured) {
    return (
      <Shell>
        <p className="hint">
          Hive is not configured. Set <code>VITE_SUPABASE_URL</code> and{" "}
          <code>VITE_SUPABASE_ANON_KEY</code> and rebuild.
        </p>
      </Shell>
    );
  }

  if (!ready) return <Shell><p className="hint">Loading…</p></Shell>;

  if (!session) {
    return (
      <Shell>
        <SignIn onSignedIn={setSession} />
      </Shell>
    );
  }

  return <SignedIn session={session} />;
}

function SignIn({ onSignedIn }: { onSignedIn: (s: Session) => void }) {
  const [phase, setPhase] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    if (!isValidEmail(email)) {
      setError("Enter a valid email.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await sendEmailOtp(email);
      setPhase("code");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!code.trim()) return;
    setBusy(true);
    setError("");
    try {
      onSignedIn(await verifyEmailOtp(email, code));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="signin">
      <h2>Discover what others are reading</h2>
      <p className="hint">Sign in with an email code to browse what members have shared.</p>
      {phase === "email" ? (
        <div className="signin-form">
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            disabled={busy}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void send()}
          />
          <button className="primary" onClick={() => void send()} disabled={busy}>
            {busy ? "Sending…" : "Send code"}
          </button>
        </div>
      ) : (
        <div className="signin-form">
          <p className="hint">Code sent to {email}.</p>
          <input
            inputMode="numeric"
            placeholder="6-digit code"
            value={code}
            disabled={busy}
            autoFocus
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void verify()}
          />
          <button className="primary" onClick={() => void verify()} disabled={busy}>
            {busy ? "Verifying…" : "Verify"}
          </button>
          <button onClick={() => void send()} disabled={busy}>Resend</button>
        </div>
      )}
      {error && <p className="hint err">⚠ {error}</p>}
    </div>
  );
}

function SignedIn({ session }: { session: Session }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<"feed" | "leaderboard" | "communities" | "messages" | "activity">("feed");
  const [community, setCommunity] = useState<{ id: string; name: string } | null>(null);
  const [dmTarget, setDmTarget] = useState<{ id: string; name: string } | null>(null);
  const [profile, setProfile] = useState<{ id: string; name: string } | null>(null);
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);
  const [seen, setSeen] = useState<string | null>(() => localStorage.getItem("hive.activity.seen"));
  const myId = session.user.id;
  const name = (session.user.user_metadata?.full_name as string | undefined) ?? session.user.email ?? "";

  useEffect(() => {
    loadActivity(supabase).then(setActivity).catch(() => {});
  }, []);
  const unseen = activity ? unseenCount(activity, seen) : 0;
  const openActivity = () => {
    setTab("activity");
    const now = new Date().toISOString();
    localStorage.setItem("hive.activity.seen", now);
    setSeen(now);
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
            Community · <strong>{community.name}</strong>
          </span>
          <button onClick={() => setCommunity(null)}>← All communities</button>
        </div>
        <Feed onOpen={setOpenId} onOpenProfile={openProfile} communityId={community.id} />
      </>
    );
  } else {
    content = (
      <>
        <nav className="tabs">
          <button className={tab === "feed" ? "active" : ""} onClick={() => setTab("feed")}>Feed</button>
          <button className={tab === "leaderboard" ? "active" : ""} onClick={() => setTab("leaderboard")}>
            🏆 Leaderboard
          </button>
          <button className={tab === "communities" ? "active" : ""} onClick={() => setTab("communities")}>
            👥 Communities
          </button>
          <button className={tab === "messages" ? "active" : ""} onClick={() => setTab("messages")}>
            ✉ Messages
          </button>
          <button className={tab === "activity" ? "active" : ""} onClick={openActivity}>
            🔔 Activity{unseen > 0 && <span className="tab-badge">{unseen}</span>}
          </button>
        </nav>
        {tab === "feed" ? (
          <Feed onOpen={setOpenId} onOpenProfile={openProfile} />
        ) : tab === "leaderboard" ? (
          <Leaderboard onOpenProfile={openProfile} />
        ) : tab === "communities" ? (
          <Communities onOpen={setCommunity} myId={myId} />
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
          <button onClick={() => void signOut()}>Sign out</button>
        </span>
      }
    >
      {content}
    </Shell>
  );
}

function Communities({ onOpen, myId }: { onOpen: (c: { id: string; name: string }) => void; myId: string }) {
  const [rows, setRows] = useState<Community[] | null>(null);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    Promise.all([listCommunities(supabase), myCommunityIds(supabase)])
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
      await createCommunity(supabase, name, desc);
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
      if (joined) await leaveCommunity(supabase, id);
      else await joinCommunity(supabase, id);
      load();
    } catch {
      load();
    }
  }

  async function remove(id: string, cname: string) {
    if (!window.confirm(`Delete community "${cname}"? Folders stay but leave the community.`)) return;
    try {
      await deleteCommunity(supabase, id);
      load();
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <div className="communities">
      <div className="community-create">
        <input placeholder="New community name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
        <input placeholder="Description (optional)" value={desc} disabled={busy} onChange={(e) => setDesc(e.target.value)} />
        <button className="primary" onClick={() => void create()} disabled={busy || name.trim().length < 2}>
          Create
        </button>
      </div>
      {error && <p className="hint err">⚠ {error}</p>}
      {!rows && <p className="hint">Loading…</p>}
      {rows && rows.length === 0 && <p className="hint">No communities yet — create the first one.</p>}
      <div className="community-list">
        {rows?.map((c) => (
          <div key={c.id} className="community-row">
            <div className="community-main" onClick={() => onOpen({ id: c.id, name: c.name })}>
              <span className="community-name">{c.name}</span>
              {c.description && <span className="community-desc">{c.description}</span>}
              <span className="community-stats">📁 {c.folder_count} · 👥 {c.member_count}</span>
            </div>
            <button className={mine.has(c.id) ? "active" : ""} onClick={() => void toggleJoin(c.id)}>
              {mine.has(c.id) ? "Joined" : "Join"}
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
  const [messages, setMessages] = useState<DirectMessage[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>(() =>
    initialOther ? { [initialOther.id]: initialOther.name } : {},
  );
  const [openOther, setOpenOther] = useState<string | null>(initialOther?.id ?? null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listMyMessages(supabase)
      .then(async (msgs) => {
        setMessages(msgs);
        const ids = new Set<string>();
        for (const m of msgs) ids.add(m.sender_id === myId ? m.recipient_id : m.sender_id);
        if (initialOther) ids.add(initialOther.id);
        ids.delete(myId);
        const fetched = ids.size ? await getProfileNames(supabase, [...ids]) : {};
        setNames((prev) => ({ ...prev, ...fetched }));
      })
      .catch((e) => setError(errMsg(e)));
  }, [myId, initialOther]);
  useEffect(load, [load]);

  useEffect(() => {
    if (openOther) void markRead(supabase, openOther).then(load).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openOther]);

  async function send() {
    const text = body.trim();
    if (!text || !openOther) return;
    setBusy(true);
    setError("");
    try {
      await sendMessage(supabase, openOther, text);
      setBody("");
      load();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="hint err">⚠ {error}</p>;
  if (!messages) return <p className="hint">Loading…</p>;

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
          <button onClick={() => setOpenOther(null)}>← All messages</button>
        </div>
        <div className="dm-thread">
          {thread.map((m) => (
            <div key={m.id} className={`dm-msg ${m.sender_id === myId ? "mine" : "theirs"}`}>{m.body}</div>
          ))}
          {thread.length === 0 && <p className="hint">No messages yet — say hello.</p>}
        </div>
        <div className="opinion-form">
          <textarea rows={2} placeholder="Message…" value={body} disabled={busy} onChange={(e) => setBody(e.target.value)} />
          <button className="primary" onClick={() => void send()} disabled={busy || !body.trim()}>Send</button>
        </div>
      </div>
    );
  }

  return (
    <div className="messages">
      {convos.length === 0 && <p className="hint">No conversations yet. Use ✉ on a folder to message its author.</p>}
      <div className="dm-list">
        {convos.map((c) => (
          <div key={c.otherId} className="dm-row" onClick={() => setOpenOther(c.otherId)}>
            <span className="dm-name">{names[c.otherId] ?? "Someone"}</span>
            <span className="dm-last">{c.lastBody}</span>
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
  const [entries, setEntries] = useState<FeedEntry[] | null>(null);
  const [error, setError] = useState("");
  const [topic, setTopic] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "following">("all");
  const [fUsers, setFUsers] = useState<Set<string>>(new Set());
  const [fTopics, setFTopics] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    listFeed(supabase, 50, communityId)
      .then(setEntries)
      .catch((e) => setError(errMsg(e)));
  }, [communityId]);
  useEffect(load, [load]);
  useEffect(() => {
    Promise.all([myFollowing(supabase), myTopics(supabase)]).then(([u, t]) => {
      setFUsers(u);
      setFTopics(t);
    }).catch(() => {});
  }, []);
  // Live: a newly shared (or re-shared) folder appears without a refresh.
  useEffect(() => onTableInserts(supabase, "shared_folders", undefined, load), [load]);

  if (error) return <p className="hint err">⚠ {error}</p>;
  if (!entries) return <p className="hint">Loading feed…</p>;
  if (entries.length === 0) return <p className="hint">No shared folders yet. Be the first to share one from the extension.</p>;

  const stats = feedStats(entries);
  const counts = topicCounts(entries);
  const maxCount = counts.length ? counts[0].count : 1;
  const base = scope === "following" && !communityId ? filterFollowing(entries, fUsers, fTopics) : entries;
  const shown = topic ? base.filter((e) => e.topics.some((t) => t.toLowerCase() === topic)) : base;

  async function toggleTopicFollow(tp: string) {
    const has = fTopics.has(tp);
    setFTopics((p) => { const n = new Set(p); has ? n.delete(tp) : n.add(tp); return n; });
    try { has ? await unfollowTopic(supabase, tp) : await followTopic(supabase, tp); } catch { /* revert silently */ }
  }

  return (
    <>
      {!communityId && (
        <div className="scope">
          <button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>All</button>
          <button className={scope === "following" ? "active" : ""} onClick={() => setScope("following")}>Following</button>
        </div>
      )}
      <section className="collective">
        <div className="stats">
          <Stat n={stats.folders} label="folders" />
          <Stat n={stats.members} label="members" />
          <Stat n={stats.items} label="links" />
          <Stat n={stats.topics} label="topics" />
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
            Showing <strong>#{topic}</strong> · {shown.length} result{shown.length === 1 ? "" : "s"}
          </span>
          <span style={{ display: "inline-flex", gap: 8 }}>
            <button className={fTopics.has(topic) ? "active" : ""} onClick={() => void toggleTopicFollow(topic)}>
              {fTopics.has(topic) ? "★ Following" : "☆ Follow topic"}
            </button>
            <button onClick={() => setTopic(null)}>Clear</button>
          </span>
        </div>
      )}

      {scope === "following" && !communityId && shown.length === 0 && (
        <p className="hint">Nothing here yet. Follow members (on their profile) or topics (☆ on a topic) to fill this feed.</p>
      )}

      <div className="feed">
        {shown.map((e) => (
          <FolderCard key={e.id} entry={e} onOpen={() => onOpen(e.id)} onOpenProfile={onOpenProfile} />
        ))}
      </div>
    </>
  );
}

function Activity({ items, onOpenFolder }: { items: ActivityItem[] | null; onOpenFolder: (id: string) => void }) {
  if (!items) return <p className="hint">Loading…</p>;
  if (items.length === 0)
    return <p className="hint">No activity yet. When others reply to your opinions or post on your folders, it shows here.</p>;
  return (
    <div className="activity">
      {items.map((a) => (
        <div key={a.id} className="activity-row" onClick={() => onOpenFolder(a.folderId)}>
          <span className="activity-icon">{a.type === "reply" ? "↳" : a.type === "vote" ? "▲" : "💬"}</span>
          <span className="activity-text">
            <strong>{a.actorName}</strong>{" "}
            {a.type === "reply"
              ? "replied to your opinion in"
              : a.type === "vote"
                ? "upvoted your opinion in"
                : "shared an opinion on your folder"}{" "}
            <strong>{a.folderTitle}</strong>
          </span>
        </div>
      ))}
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
  const [rep, setRep] = useState<Contributor | null>(null);
  const [folders, setFolders] = useState<FeedEntry[] | null>(null);
  const [following, setFollowing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getContributor(supabase, userId), listOwnerFolders(supabase, userId), myFollowing(supabase)])
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
    try { next ? await followUser(supabase, userId) : await unfollowUser(supabase, userId); } catch { setFollowing(!next); }
  }

  return (
    <div className="profile">
      <div className="filter-bar">
        <span className="profile-head"><Avatar seed={userId} label={who} /> <strong>{who}</strong></span>
        <button onClick={onBack}>← Back</button>
      </div>
      {error && <p className="hint err">⚠ {error}</p>}
      <div className="stats">
        <Stat n={rep?.votes_received ?? 0} label="upvotes" />
        <Stat n={rep?.opinions ?? 0} label="opinions" />
        <Stat n={rep?.folders_shared ?? 0} label="folders" />
      </div>
      {!isMe && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button className={following ? "active" : "primary"} onClick={() => void toggleFollow()}>
            {following ? "✓ Following" : "+ Follow"}
          </button>
          <button onClick={() => onMessage(userId, who)}>✉ Message</button>
        </div>
      )}
      <h3>Shared folders</h3>
      {!folders && <p className="hint">Loading…</p>}
      {folders && folders.length === 0 && <p className="hint">No shared folders yet.</p>}
      <div className="feed">
        {folders?.map((f) => (
          <article key={f.id} className="card" onClick={() => onOpenFolder(f.id)} style={{ cursor: "pointer" }}>
            <header className="card-head">
              <h3>{f.title}</h3>
              <span className="count">{f.item_count} items</span>
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
  const [rows, setRows] = useState<Contributor[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    listLeaderboard(supabase)
      .then(setRows)
      .catch((e) => setError(errMsg(e)));
  }, []);

  if (error) return <p className="hint err">⚠ {error}</p>;
  if (!rows) return <p className="hint">Loading leaderboard…</p>;
  if (rows.length === 0) return <p className="hint">No contributors yet — share a folder or post an opinion.</p>;

  return (
    <div className="leaderboard">
      <p className="hint">Ranked by upvotes their opinions earned. Click a name for their profile.</p>
      <ol className="lb-list">
        {rows.map((r, i) => (
          <li key={r.user_id} className="lb-row" onClick={() => onOpenProfile(r.user_id, r.display_name ?? "Someone")} style={{ cursor: "pointer" }}>
            <span className={`lb-rank r${i + 1}`}>{i + 1}</span>
            <Avatar seed={r.user_id} label={r.display_name ?? "Someone"} />
            <span className="lb-name">{r.display_name ?? "Someone"}</span>
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
}: {
  entry: FeedEntry;
  onOpen: () => void;
  onOpenProfile: (id: string, name: string) => void;
}) {
  const owner = entry.owner.display_name ?? "Someone";
  return (
    <article className="card">
      <header className="card-head" onClick={onOpen}>
        <h3>{entry.title}</h3>
        <span
          className="owner"
          title={`View ${owner}'s profile`}
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
        {entry.topics.map((t) => (
          <span key={t} className="chip">#{t}</span>
        ))}
      </div>
      <footer className="card-foot">
        <span className="count">{entry.item_count} items</span>
        <Reactions folderId={entry.id} />
      </footer>
    </article>
  );
}

function Reactions({ folderId }: { folderId: string }) {
  const [on, setOn] = useState<Record<ReactionKind, boolean>>({ like: false, save: false });

  const toggle = useCallback(
    async (kind: ReactionKind) => {
      const next = !on[kind];
      setOn((p) => ({ ...p, [kind]: next })); // optimistic
      try {
        if (next) await react(supabase, folderId, kind);
        else await unreact(supabase, folderId, kind);
      } catch {
        setOn((p) => ({ ...p, [kind]: !next })); // revert on failure
      }
    },
    [folderId, on],
  );

  return (
    <span className="reactions">
      <button className={on.like ? "active" : ""} onClick={() => void toggle("like")}>
        ♥ Like
      </button>
      <button className={on.save ? "active" : ""} onClick={() => void toggle("save")}>
        ☆ Save
      </button>
    </span>
  );
}

function Detail({ folderId, onBack }: { folderId: string; onBack: () => void }) {
  const [data, setData] = useState<{ folder: SharedFolder; items: SharedItem[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getFolder(supabase, folderId)
      .then(setData)
      .catch((e) => setError(errMsg(e)));
  }, [folderId]);

  return (
    <div className="detail">
      <button className="back" onClick={onBack}>← Back to feed</button>
      {error && <p className="hint err">⚠ {error}</p>}
      {!data && !error && <p className="hint">Loading…</p>}
      {data && (
        <>
          <h2>{data.folder.title}</h2>
          {data.folder.summary && <p className="summary">{data.folder.summary}</p>}
          <div className="topics">
            {data.folder.topics.map((t) => (
              <span key={t} className="chip">#{t}</span>
            ))}
          </div>
          <ul className="items">
            {data.items.map((it) => (
              <li key={it.id}>
                <a href={it.url} target="_blank" rel="noreferrer noopener">{it.title}</a>
                {it.item_summary && <span className="item-summary"> — {it.item_summary}</span>}
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
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [body, setBody] = useState("");
  const [asQuestion, setAsQuestion] = useState(false);
  const [replyOpen, setReplyOpen] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listComments(supabase, folderId)
      .then(async (cs) => {
        setComments(cs);
        const ids = cs.map((c) => c.id);
        const [vc, mv] = await Promise.all([opinionVoteCounts(supabase, ids), myOpinionVotes(supabase, ids)]);
        setCounts(vc);
        setMine(mv);
      })
      .catch((e) => setError(errMsg(e)));
  }, [folderId]);

  useEffect(load, [load]);
  // Live: refresh when anyone posts an opinion/reply on this folder.
  useEffect(() => onTableInserts(supabase, "comments", eqFilter("folder_id", folderId), load), [folderId, load]);

  // Resolve @mentions in `text` against thread participants and record them.
  async function recordMentions(commentId: string, text: string) {
    const cands: MentionCandidate[] = (comments ?? []).map((c) => ({ id: c.user_id, name: c.author?.display_name ?? "" }));
    const ids = resolveMentions(extractMentionTokens(text), cands);
    if (ids.length) await postMentions(supabase, commentId, ids);
  }

  async function submit() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      const id = await postComment(supabase, folderId, { body: text, isQuestion: asQuestion });
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
        if (voted) await unvoteOpinion(supabase, id);
        else await voteOpinion(supabase, id);
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
      const id = await postComment(supabase, folderId, { body: text, parentId });
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
    <div key={c.id} className={`opinion${c.id === topId ? " top" : ""}${isReply ? " reply" : ""}`}>
      <span className={`who ${c.author_kind}`}>
        {c.is_question ? "❓" : c.author_kind === "agent" ? "🤖" : "🧑"} {c.author?.display_name ?? "Someone"}
        {c.author_kind === "agent" && c.author_label ? ` · ${c.author_label}` : ""}
        {c.is_question && <span className="q-badge">question</span>}
        {c.id === topId && <span className="top-badge">★ top</span>}
      </span>
      <p className="opinion-body">{renderBody(c.body)}</p>
      <span className="opinion-actions">
        <button className={`vote${mine.has(c.id) ? " voted" : ""}`} onClick={() => void toggleVote(c.id)} title="Upvote">
          ▲ {counts[c.id] ?? 0}
        </button>
        {!isReply && (
          <button className="reply-btn" onClick={() => setReplyOpen((id) => (id === c.id ? null : c.id))}>
            ↳ Reply
          </button>
        )}
      </span>
    </div>
  );

  const threads = comments ? threadComments(comments) : [];

  return (
    <section className="discussion">
      <h3>Discussion {comments ? `(${comments.length})` : ""}</h3>
      {threads.map((t) => (
        <div key={t.id} className="thread">
          {opinionRow(t, false)}
          {t.replies.length > 0 && <div className="replies">{t.replies.map((r) => opinionRow(r, true))}</div>}
          {replyOpen === t.id && (
            <div className="opinion-form reply-form">
              <textarea
                placeholder="Write a reply…"
                value={replyBody}
                disabled={busy}
                rows={2}
                autoFocus
                onChange={(e) => setReplyBody(e.target.value)}
              />
              <button className="primary" onClick={() => void submitReply(t.id)} disabled={busy || !replyBody.trim()}>
                {busy ? "…" : "Reply"}
              </button>
            </div>
          )}
        </div>
      ))}
      {comments && comments.length === 0 && <p className="hint">No opinions yet. Start the conversation.</p>}
      <div className="opinion-form">
        <textarea
          placeholder={asQuestion ? "Ask a question…" : "Share your opinion…"}
          value={body}
          disabled={busy}
          rows={2}
          onChange={(e) => setBody(e.target.value)}
        />
        <button className="primary" onClick={() => void submit()} disabled={busy || !body.trim()}>
          {busy ? "Posting…" : asQuestion ? "Ask" : "Post"}
        </button>
      </div>
      <label className="ask-toggle">
        <input type="checkbox" checked={asQuestion} disabled={busy} onChange={(e) => setAsQuestion(e.target.checked)} />
        Ask as a question (agents can answer)
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
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">🐝 Hive</span>
        {right}
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
