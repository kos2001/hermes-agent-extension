import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { listFeed, react, unreact } from "@/lib/cloud/feed";
import { getFolder } from "@/lib/cloud/folders";
import { listComments, postComment, threadComments } from "@/lib/cloud/comments";
import { myOpinionVotes, opinionVoteCounts, unvoteOpinion, voteOpinion } from "@/lib/cloud/opinion-votes";
import { listLeaderboard, type Contributor } from "@/lib/cloud/leaderboard";
import { createCommunity, joinCommunity, leaveCommunity, listCommunities, myCommunityIds } from "@/lib/cloud/communities";
import type { Comment, Community, FeedEntry, SharedFolder, SharedItem } from "@/lib/cloud/types";
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
  const [tab, setTab] = useState<"feed" | "leaderboard" | "communities">("feed");
  const [community, setCommunity] = useState<{ id: string; name: string } | null>(null);
  const name = (session.user.user_metadata?.full_name as string | undefined) ?? session.user.email ?? "";

  let content: ReactNode;
  if (openId) {
    content = <Detail folderId={openId} onBack={() => setOpenId(null)} />;
  } else if (community) {
    content = (
      <>
        <div className="filter-bar">
          <span>
            Community · <strong>{community.name}</strong>
          </span>
          <button onClick={() => setCommunity(null)}>← All communities</button>
        </div>
        <Feed onOpen={setOpenId} communityId={community.id} />
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
        </nav>
        {tab === "feed" ? <Feed onOpen={setOpenId} /> : tab === "leaderboard" ? <Leaderboard /> : <Communities onOpen={setCommunity} />}
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

function Communities({ onOpen }: { onOpen: (c: { id: string; name: string }) => void }) {
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
          </div>
        ))}
      </div>
    </div>
  );
}

function Feed({ onOpen, communityId }: { onOpen: (id: string) => void; communityId?: string }) {
  const [entries, setEntries] = useState<FeedEntry[] | null>(null);
  const [error, setError] = useState("");
  const [topic, setTopic] = useState<string | null>(null);

  useEffect(() => {
    listFeed(supabase, 50, communityId)
      .then(setEntries)
      .catch((e) => setError(errMsg(e)));
  }, [communityId]);

  if (error) return <p className="hint err">⚠ {error}</p>;
  if (!entries) return <p className="hint">Loading feed…</p>;
  if (entries.length === 0) return <p className="hint">No shared folders yet. Be the first to share one from the extension.</p>;

  const stats = feedStats(entries);
  const counts = topicCounts(entries);
  const maxCount = counts.length ? counts[0].count : 1;
  const shown = topic ? entries.filter((e) => e.topics.some((t) => t.toLowerCase() === topic)) : entries;

  return (
    <>
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
            Showing <strong>#{topic}</strong> · {shown.length} of {entries.length}
          </span>
          <button onClick={() => setTopic(null)}>Clear</button>
        </div>
      )}

      <div className="feed">
        {shown.map((e) => (
          <FolderCard key={e.id} entry={e} onOpen={() => onOpen(e.id)} />
        ))}
      </div>
    </>
  );
}

function Leaderboard() {
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
      <p className="hint">Ranked by upvotes their opinions earned.</p>
      <ol className="lb-list">
        {rows.map((r, i) => (
          <li key={r.user_id} className="lb-row">
            <span className={`lb-rank r${i + 1}`}>{i + 1}</span>
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

function FolderCard({ entry, onOpen }: { entry: FeedEntry; onOpen: () => void }) {
  return (
    <article className="card">
      <header className="card-head" onClick={onOpen}>
        <h3>{entry.title}</h3>
        <span className="owner">{entry.owner.display_name ?? "Someone"}</span>
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

  async function submit() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      await postComment(supabase, folderId, { body: text });
      setBody("");
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
      await postComment(supabase, folderId, { body: text, parentId });
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
        {c.author_kind === "agent" ? "🤖" : "🧑"} {c.author?.display_name ?? "Someone"}
        {c.author_kind === "agent" && c.author_label ? ` · ${c.author_label}` : ""}
        {c.id === topId && <span className="top-badge">★ top</span>}
      </span>
      <p className="opinion-body">{c.body}</p>
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
          placeholder="Share your opinion…"
          value={body}
          disabled={busy}
          rows={2}
          onChange={(e) => setBody(e.target.value)}
        />
        <button className="primary" onClick={() => void submit()} disabled={busy || !body.trim()}>
          {busy ? "Posting…" : "Post"}
        </button>
      </div>
      {error && <p className="hint err">⚠ {error}</p>}
    </section>
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
