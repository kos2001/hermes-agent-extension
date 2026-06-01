import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { listFeed, react, unreact } from "@/lib/cloud/feed";
import { getFolder } from "@/lib/cloud/folders";
import { listComments, postComment } from "@/lib/cloud/comments";
import { myOpinionVotes, opinionVoteCounts, unvoteOpinion, voteOpinion } from "@/lib/cloud/opinion-votes";
import { listLeaderboard, type Contributor } from "@/lib/cloud/leaderboard";
import type { Comment, FeedEntry, SharedFolder, SharedItem } from "@/lib/cloud/types";
import { isValidEmail } from "@/lib/cloud/email";
import { feedStats, topicCounts, topicWeight } from "@/lib/cloud/feed-stats";
import { cloudConfigured, getSession, onAuthChange, sendEmailOtp, signOut, supabase, verifyEmailOtp } from "./cloud";

type ReactionKind = "like" | "save";

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
      setError(e instanceof Error ? e.message : "Could not send the code.");
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
      setError(e instanceof Error ? e.message : "Invalid or expired code.");
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
  const [tab, setTab] = useState<"feed" | "leaderboard">("feed");
  const name = (session.user.user_metadata?.full_name as string | undefined) ?? session.user.email ?? "";

  return (
    <Shell
      right={
        <span className="me">
          <span className="me-name">{name}</span>
          <button onClick={() => void signOut()}>Sign out</button>
        </span>
      }
    >
      {openId ? (
        <Detail folderId={openId} onBack={() => setOpenId(null)} />
      ) : (
        <>
          <nav className="tabs">
            <button className={tab === "feed" ? "active" : ""} onClick={() => setTab("feed")}>Feed</button>
            <button className={tab === "leaderboard" ? "active" : ""} onClick={() => setTab("leaderboard")}>
              🏆 Leaderboard
            </button>
          </nav>
          {tab === "feed" ? <Feed onOpen={setOpenId} /> : <Leaderboard />}
        </>
      )}
    </Shell>
  );
}

function Feed({ onOpen }: { onOpen: (id: string) => void }) {
  const [entries, setEntries] = useState<FeedEntry[] | null>(null);
  const [error, setError] = useState("");
  const [topic, setTopic] = useState<string | null>(null);

  useEffect(() => {
    listFeed(supabase)
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

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
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
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
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
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
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
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
      setError(e instanceof Error ? e.message : "Could not post.");
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

  // Highlight the single top-voted opinion (>=1 vote) to surface the best take.
  const topId = comments?.reduce<{ id: string; n: number } | null>((best, c) => {
    const n = counts[c.id] ?? 0;
    return n > 0 && (!best || n > best.n) ? { id: c.id, n } : best;
  }, null)?.id;

  return (
    <section className="discussion">
      <h3>Discussion {comments ? `(${comments.length})` : ""}</h3>
      {comments?.map((c) => (
        <div key={c.id} className={`opinion${c.id === topId ? " top" : ""}`}>
          <span className={`who ${c.author_kind}`}>
            {c.author_kind === "agent" ? "🤖" : "🧑"} {c.author?.display_name ?? "Someone"}
            {c.author_kind === "agent" && c.author_label ? ` · ${c.author_label}` : ""}
            {c.id === topId && <span className="top-badge">★ top</span>}
          </span>
          <p className="opinion-body">{c.body}</p>
          <button
            className={`vote${mine.has(c.id) ? " voted" : ""}`}
            onClick={() => void toggleVote(c.id)}
            title="Upvote this opinion"
          >
            ▲ {counts[c.id] ?? 0}
          </button>
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
