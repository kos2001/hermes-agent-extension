import { useEffect, useState } from "react";
import type { HiveSession } from "@/lib/cloud/auth";
import { t, type Lang } from "@/lib/i18n";
import { cloudConfigured } from "@/lib/cloud/client";
import { getSession, onAuthChange, sendEmailOtp, signOut, verifyEmailOtp } from "@/lib/cloud/auth";
import { isValidEmail } from "@/lib/cloud/email";

/**
 * Hive auth affordance using email one-time codes (no external OAuth, no
 * redirect). Top-bar button toggles a small popover: enter email → receive a
 * code → enter code. Renders nothing when the build has no backend URL.
 */
export function HiveSignIn({ lang }: { lang: Lang }) {
  const [session, setSession] = useState<HiveSession | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
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
    setPhase("email");
    setCode("");
    setError(null);
    setBusy(false);
  }

  async function handleSend() {
    if (!isValidEmail(email)) {
      setError(t(lang, "hiveEmailInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendEmailOtp(email);
      setPhase("code");
    } catch {
      setError(t(lang, "hiveSignInError"));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify() {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const s = await verifyEmailOtp(email, code);
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
          {phase === "email" ? (
            <>
              <input
                className="hive-input"
                type="email"
                placeholder={t(lang, "hiveEmail")}
                value={email}
                disabled={busy}
                autoFocus
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleSend()}
              />
              <div className="hive-pop-row">
                <button className="tx-restore" onClick={reset} disabled={busy}>
                  {t(lang, "hiveCancel")}
                </button>
                <button className="tx-go" onClick={() => void handleSend()} disabled={busy}>
                  {busy ? t(lang, "hiveSending") : t(lang, "hiveSendCode")}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="hive-pop-note">{t(lang, "hiveCodeSent").replace("{email}", email)}</div>
              <input
                className="hive-input"
                inputMode="numeric"
                placeholder={t(lang, "hiveCode")}
                value={code}
                disabled={busy}
                autoFocus
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void handleVerify()}
              />
              <div className="hive-pop-row">
                <button className="tx-restore" onClick={() => void handleSend()} disabled={busy}>
                  {t(lang, "hiveResend")}
                </button>
                <button className="tx-go" onClick={() => void handleVerify()} disabled={busy}>
                  {busy ? t(lang, "hiveVerifying") : t(lang, "hiveVerify")}
                </button>
              </div>
            </>
          )}
          {error && <div className="hive-auth-error">{error}</div>}
        </div>
      )}
    </span>
  );
}
