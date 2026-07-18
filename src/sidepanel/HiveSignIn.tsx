import { useEffect, useState } from "react";
import type { HiveSession } from "@/lib/cloud/auth";
import { t, type Lang } from "@/lib/i18n";
import { cloudConfigured } from "@/lib/cloud/client";
import { getSession, onAuthChange, signInWithPassword, signOut } from "@/lib/cloud/auth";
import { isValidEmail } from "@/lib/cloud/email";

/**
 * Hive auth affordance using email + password — the same flow agents use (no
 * emailed codes, no OAuth, no redirect; first sign-in creates the account).
 * Top-bar button toggles a small popover with a single form. Renders nothing
 * when the build has no backend URL.
 */
export function HiveSignIn({ lang }: { lang: Lang }) {
  const [session, setSession] = useState<HiveSession | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cloudConfigured) return;
    void getSession().then(setSession).catch(() => {});
    return onAuthChange(setSession);
  }, []);

  if (!cloudConfigured) return null;

  const name =
    session?.user?.name ?? session?.user?.email ?? "";

  function reset() {
    setOpen(false);
    setPassword("");
    setError(null);
    setBusy(false);
  }

  async function handleSignIn() {
    if (!isValidEmail(email)) {
      setError(t(lang, "hiveEmailInvalid"));
      return;
    }
    if (password.length < 6) {
      setError(t(lang, "hivePasswordShort"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const s = await signInWithPassword(email, password);
      setSession(s);
      reset();
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
        title={t(lang, "hiveSignInTitle")}
        onClick={() => setOpen((v) => !v)}
      >
        {t(lang, "hiveSignIn")}
      </button>
      {open && (
        <div className="hive-popover">
          <input
            className="hive-input"
            type="email"
            placeholder={t(lang, "hiveEmail")}
            value={email}
            disabled={busy}
            autoFocus
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleSignIn()}
          />
          <input
            className="hive-input"
            type="password"
            placeholder={t(lang, "hivePassword")}
            value={password}
            disabled={busy}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleSignIn()}
          />
          <div className="hive-pop-note">{t(lang, "hiveFirstNote")}</div>
          <div className="hive-pop-row">
            <button className="tx-restore" onClick={reset} disabled={busy}>
              {t(lang, "hiveCancel")}
            </button>
            <button className="tx-go" onClick={() => void handleSignIn()} disabled={busy}>
              {busy ? t(lang, "hiveSigningIn") : t(lang, "hiveGo")}
            </button>
          </div>
          {error && <div className="hive-auth-error">{error}</div>}
        </div>
      )}
    </span>
  );
}
