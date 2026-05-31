import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { listFeed, react, unreact } from "@/lib/cloud/feed";
import { getFolder } from "@/lib/cloud/folders";
import type { FeedEntry, SharedFolder, SharedItem } from "@/lib/cloud/types";
import { cloudConfigured, getSession, onAuthChange, signInWithGoogle, signOut, supabase } from "./cloud";

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
        <div className="signin">
          <h2>Discover what others are reading</h2>
          <p className="hint">Sign in to browse folders members have shared.</p>
          <button className="primary" onClick={() => void signInWithGoogle()}>
            Sign in with Google
          </button>
        </div>
      </Shell>
    );
  }

  return <SignedIn session={session} />;
}

function SignedIn({ session }: { session: Session }) {
  const [openId, setOpenId] = useState<string | null>(null);
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
      {openId ? <Detail folderId={openId} onBack={() => setOpenId(null)} /> : <Feed onOpen={setOpenId} />}
    </Shell>
  );
}

function Feed({ onOpen }: { onOpen: (id: string) => void }) {
  const [entries, setEntries] = useState<FeedEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    listFeed(supabase)
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <p className="hint err">⚠ {error}</p>;
  if (!entries) return <p className="hint">Loading feed…</p>;
  if (entries.length === 0) return <p className="hint">No shared folders yet. Be the first to share one from the extension.</p>;

  return (
    <div className="feed">
      {entries.map((e) => (
        <FolderCard key={e.id} entry={e} onOpen={() => onOpen(e.id)} />
      ))}
    </div>
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
        </>
      )}
    </div>
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
