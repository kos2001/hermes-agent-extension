import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { t, type Lang } from "@/lib/i18n";
import { cloudConfigured } from "@/lib/cloud/client";
import { getSession, onAuthChange, signInWithGoogle, signOut } from "@/lib/cloud/auth";

/**
 * Minimal Hive auth affordance: a Google sign-in button when signed out, or the
 * profile name + sign-out when signed in. No publish/feed UI yet (sub-projects
 * B/C). Renders nothing when the build has no Supabase credentials.
 */
export function HiveSignIn({ lang }: { lang: Lang }) {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cloudConfigured) return;
    void getSession().then(setSession).catch(() => {});
    return onAuthChange(setSession);
  }, []);

  if (!cloudConfigured) return null;

  const name =
    (session?.user?.user_metadata?.full_name as string | undefined) ?? session?.user?.email ?? "";

  async function handleSignIn() {
    setBusy(true);
    setError(null);
    try {
      setSession(await signInWithGoogle());
    } catch {
      setError(t(lang, "hiveSignInError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    try {
      await signOut();
      setSession(null);
    } finally {
      setBusy(false);
    }
  }

  if (session) {
    return (
      <span className="hive-auth" title={t(lang, "hiveSignedInAs").replace("{name}", name)}>
        <span className="hive-auth-name">{name}</span>
        <button className="icon-btn hive-out" disabled={busy} onClick={() => void handleSignOut()}>
          {t(lang, "hiveSignOut")}
        </button>
      </span>
    );
  }

  return (
    <span className="hive-auth">
      <button
        className="icon-btn hive-in"
        disabled={busy}
        title={t(lang, "hiveSignInTitle")}
        onClick={() => void handleSignIn()}
      >
        {t(lang, "hiveSignIn")}
      </button>
      {error && <span className="hive-auth-error">{error}</span>}
    </span>
  );
}
