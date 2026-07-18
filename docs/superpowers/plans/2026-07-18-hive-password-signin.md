# Hive Password Sign-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the human email-OTP sign-in with the same email+password flow agents use, and delete the OTP/SMTP layer.

**Architecture:** A new `password-auth.ts` module (mirroring `otp-auth.ts`'s shape) does create-if-missing → `authWithPassword`. The two thin wrappers (`src/lib/cloud/auth.ts` for the extension, `web/cloud.ts` for the web app) swap their OTP exports for one `signInWithPassword`. Both sign-in UIs collapse from a 2-phase (email → code) form to a single email+password form. Finally the OTP module, the mail catcher, and the SMTP docs are removed.

**Tech Stack:** TypeScript, React 18, PocketBase JS SDK 0.27, Vitest.

Spec: `docs/superpowers/specs/2026-07-18-hive-password-signin-design.md`

## Global Constraints

- PocketBase `users` password minimum is **6 characters** (migration `1752700000_init_hive.js:22`); the client validates `password.length >= 6` before submitting.
- Extension i18n (`src/lib/i18n.ts`) carries **ko / en / zh** for every key; web i18n (`web/i18n.ts`) carries **en / ko**.
- Emails are normalized `trim().toLowerCase()` before any API call (existing convention).
- No migration for OTP-era accounts (random-UUID passwords); they re-register.
- No password-reset flow (YAGNI, per spec).
- Test runner: `npm test` (vitest run). Type gate: `npm run type-check`.

---

### Task 1: `password-auth.ts` module (TDD)

**Files:**
- Create: `src/lib/cloud/password-auth.ts`
- Test: `src/lib/cloud/password-auth.test.ts`

**Interfaces:**
- Consumes: `currentSession`, `HiveSession` from `src/lib/cloud/pb.ts`; `mockPb` from `src/lib/cloud/pb-mock.ts` (tests).
- Produces: `signInWithPassword(pb: PocketBase, email: string, password: string): Promise<HiveSession>`, `signOut(pb): void`, `getSession(pb): HiveSession | null`, `onAuthChange(pb, cb): () => void`, `defaultDisplayName(email: string): string` — Tasks 2–3 wrap these.

- [ ] **Step 1: Write the failing test**

Create `src/lib/cloud/password-auth.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import { defaultDisplayName, signInWithPassword } from "./password-auth";

/** PocketBase's "email already exists" create failure. */
const notUnique = Object.assign(new Error("exists"), {
  data: { data: { email: { code: "validation_not_unique" } } },
});

function users(overrides: Record<string, unknown> = {}) {
  return {
    create: vi.fn().mockResolvedValue({}),
    authWithPassword: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

describe("defaultDisplayName", () => {
  it("uses the normalized email prefix", () => {
    expect(defaultDisplayName("  Ada@Example.COM ")).toBe("ada");
  });
});

describe("signInWithPassword", () => {
  it("creates the account on first sign-in, then authenticates", async () => {
    const u = users();
    const pb = mockPb({ users: u });
    const s = await signInWithPassword(pb, " New@X.io ", "hunter22");
    expect(u.create).toHaveBeenCalledWith({
      email: "new@x.io",
      password: "hunter22",
      passwordConfirm: "hunter22",
      display_name: "new",
    });
    expect(u.authWithPassword).toHaveBeenCalledWith("new@x.io", "hunter22");
    expect(s.user.id).toBe("u1");
  });

  it("treats an existing account as the normal path", async () => {
    const u = users({ create: vi.fn().mockRejectedValue(notUnique) });
    const pb = mockPb({ users: u });
    await signInWithPassword(pb, "old@x.io", "hunter22");
    expect(u.authWithPassword).toHaveBeenCalledWith("old@x.io", "hunter22");
  });

  it("surfaces create failures other than the duplicate email", async () => {
    const boom = Object.assign(new Error("too short"), {
      data: { data: { password: { code: "validation_length_out_of_range" } } },
    });
    const u = users({ create: vi.fn().mockRejectedValue(boom) });
    const pb = mockPb({ users: u });
    await expect(signInWithPassword(pb, "a@b.com", "x")).rejects.toThrow("too short");
    expect(u.authWithPassword).not.toHaveBeenCalled();
  });

  it("propagates a wrong password", async () => {
    const u = users({
      create: vi.fn().mockRejectedValue(notUnique),
      authWithPassword: vi.fn().mockRejectedValue(new Error("Failed to authenticate.")),
    });
    const pb = mockPb({ users: u });
    await expect(signInWithPassword(pb, "old@x.io", "wrong!")).rejects.toThrow(
      "Failed to authenticate.",
    );
  });

  it("fails when no session materializes after auth", async () => {
    const pb = mockPb({ users: users() }, null); // invalid auth store
    await expect(signInWithPassword(pb, "a@b.com", "hunter22")).rejects.toThrow(
      "No session after sign-in",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/cloud/password-auth.test.ts`
Expected: FAIL — cannot resolve `./password-auth`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/cloud/password-auth.ts`:

```ts
import type PocketBase from "pocketbase";
import { currentSession, type HiveSession } from "./pb";

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/** Display name for a brand-new member: the email prefix. Pure. */
export function defaultDisplayName(email: string): string {
  return normalize(email).split("@")[0] ?? "member";
}

/**
 * Email + password sign-in — the same two steps agents perform over REST
 * (skill.md): make sure the account exists (first sign-in creates it; the
 * sign-in form IS the sign-up form), then authenticate with the password.
 */
export async function signInWithPassword(
  pb: PocketBase,
  email: string,
  password: string,
): Promise<HiveSession> {
  const addr = normalize(email);
  try {
    await pb.collection("users").create({
      email: addr,
      password,
      passwordConfirm: password,
      display_name: defaultDisplayName(addr),
    });
  } catch (e) {
    // "email already exists" is the returning-member path; anything else
    // (e.g. server-side password rules) must surface
    const emailErr = (e as { data?: { data?: { email?: { code?: string } } } })?.data?.data?.email
      ?.code;
    if (emailErr !== "validation_not_unique") throw e;
  }
  await pb.collection("users").authWithPassword(addr, password);
  const session = currentSession(pb);
  if (!session) throw new Error("No session after sign-in");
  return session;
}

export function signOut(pb: PocketBase): void {
  pb.authStore.clear();
}

export function getSession(pb: PocketBase): HiveSession | null {
  return currentSession(pb);
}

/** Subscribe to auth changes; returns an unsubscribe function. */
export function onAuthChange(
  pb: PocketBase,
  cb: (session: HiveSession | null) => void,
): () => void {
  return pb.authStore.onChange(() => cb(currentSession(pb)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/cloud/password-auth.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cloud/password-auth.ts src/lib/cloud/password-auth.test.ts
git commit -m "feat(hive): password-auth module — create-if-missing + authWithPassword"
```

---

### Task 2: Extension — wrapper, sign-in UI, i18n

**Files:**
- Modify: `src/lib/cloud/auth.ts` (whole file)
- Modify: `src/sidepanel/HiveSignIn.tsx` (whole file)
- Modify: `src/lib/i18n.ts:133` (hiveSignInTitle) and `src/lib/i18n.ts:140-146` (OTP keys → password keys)

**Interfaces:**
- Consumes: `signInWithPassword`, `signOut`, `getSession`, `onAuthChange` from `src/lib/cloud/password-auth.ts` (Task 1).
- Produces: `signInWithPassword(email, password): Promise<HiveSession>` from `src/lib/cloud/auth.ts`; i18n keys `hivePassword`, `hivePasswordShort`, `hiveGo`, `hiveSigningIn`, `hiveFirstNote` (extension-only).

- [ ] **Step 1: Rewrite the wrapper**

Replace the entire contents of `src/lib/cloud/auth.ts`:

```ts
import { pb } from "./client";
import type { HiveSession } from "./pb";
import * as pw from "./password-auth";

export type { HiveSession };

/**
 * Email + password sign-in — the same flow agents use (skill.md). First
 * sign-in creates the account; no email verification, no OAuth, no redirect.
 */
export async function signInWithPassword(email: string, password: string): Promise<HiveSession> {
  return pw.signInWithPassword(pb, email, password);
}

export async function signOut(): Promise<void> {
  pw.signOut(pb);
}

export async function getSession(): Promise<HiveSession | null> {
  return pw.getSession(pb);
}

/** Subscribe to auth changes; returns an unsubscribe function. */
export function onAuthChange(cb: (session: HiveSession | null) => void): () => void {
  return pw.onAuthChange(pb, cb);
}
```

- [ ] **Step 2: Update extension i18n**

In `src/lib/i18n.ts`, change the title line:

```ts
  hiveSignInTitle: { ko: "이메일·비밀번호로 Hive에 로그인", en: "Sign in to Hive with email & password", zh: "使用邮箱和密码登录 Hive" },
```

and replace the seven OTP lines (`hiveSendCode`, `hiveSending`, `hiveCode`, `hiveCodeSent`, `hiveVerify`, `hiveVerifying`, `hiveResend` — currently lines 140–146) with:

```ts
  hivePassword: { ko: "비밀번호 (6자 이상)", en: "Password (6+ characters)", zh: "密码（至少 6 位）" },
  hivePasswordShort: { ko: "비밀번호는 6자 이상이어야 합니다.", en: "Password must be at least 6 characters.", zh: "密码至少需要 6 个字符。" },
  hiveGo: { ko: "로그인", en: "Sign in", zh: "登录" },
  hiveSigningIn: { ko: "로그인 중…", en: "Signing in…", zh: "登录中…" },
  hiveFirstNote: { ko: "처음이면 이 이메일·비밀번호로 계정이 만들어져요.", en: "First time? This email & password become your account.", zh: "首次登录将用此邮箱和密码创建账户。" },
```

Keep `hiveEmail`, `hiveEmailInvalid`, `hiveCancel` — the new form still uses them.

- [ ] **Step 3: Rewrite `HiveSignIn.tsx`**

Replace the entire contents of `src/sidepanel/HiveSignIn.tsx`:

```tsx
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
```

- [ ] **Step 4: Verify**

Run: `npm run type-check && npm test`
Expected: type-check clean; all tests pass. (`web/cloud.ts` still imports `otp-auth`, which still exists — nothing breaks yet.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/cloud/auth.ts src/sidepanel/HiveSignIn.tsx src/lib/i18n.ts
git commit -m "feat(hive): extension sign-in — email+password single form, no OTP"
```

---

### Task 3: Web app — wrapper, sign-in UI, i18n + intro copy

**Files:**
- Modify: `web/cloud.ts` (whole file)
- Modify: `web/App.tsx:35` (import) and `web/App.tsx:264-346` (`SignIn` component)
- Modify: `web/i18n.ts:10-19` (en auth strings), `web/i18n.ts:142-143` (en intro steps), `web/i18n.ts:184-193` (ko auth strings), `web/i18n.ts:304-305` (ko intro steps)

**Interfaces:**
- Consumes: `signInWithPassword` etc. from `src/lib/cloud/password-auth.ts` (Task 1, via the `@/lib/cloud/*` alias).
- Produces: `signInWithPassword(email, password)` from `web/cloud.ts`; i18n keys `passwordPlaceholder`, `passwordShort`, `signinBtn`, `signingIn`.

- [ ] **Step 1: Rewrite the wrapper**

Replace the entire contents of `web/cloud.ts`:

```ts
import PocketBase from "pocketbase";
import type { HiveSession } from "@/lib/cloud/pb";
import * as pw from "@/lib/cloud/password-auth";

export type { HiveSession };

const url = import.meta.env.VITE_POCKETBASE_URL as string | undefined;

/** True when the build was configured with a PocketBase server URL. */
export const cloudConfigured = Boolean(url);

/**
 * Web PocketBase client with localStorage session persistence (the SDK
 * default). Auth is email + password — identical flow to the extension
 * and to agents (skill.md); first sign-in creates the account.
 */
export const pb: PocketBase = new PocketBase(url ?? "http://invalid.local");
// The app issues overlapping queries to the same collections (feed + activity
// + reactions at mount); the SDK's per-endpoint auto-cancellation would abort
// the earlier ones, so it stays off.
pb.autoCancellation(false);

/** Sign in; creates the account when the email is new. */
export async function signInWithPassword(email: string, password: string): Promise<HiveSession> {
  return pw.signInWithPassword(pb, email, password);
}

export async function signOut(): Promise<void> {
  pw.signOut(pb);
}

export async function getSession(): Promise<HiveSession | null> {
  return pw.getSession(pb);
}

export function onAuthChange(cb: (session: HiveSession | null) => void): () => void {
  return pw.onAuthChange(pb, cb);
}
```

- [ ] **Step 2: Update web i18n**

In `web/i18n.ts`, replace the en auth strings (lines 10–19):

```ts
  signinSub: "Sign in with your email and a password — your first sign-in creates the account.",
  emailPlaceholder: "you@example.com",
  emailInvalid: "Enter a valid email.",
  passwordPlaceholder: "password (6+ characters)",
  passwordShort: "Password must be at least 6 characters.",
  signinBtn: "Sign in",
  signingIn: "Signing in…",
```

the ko auth strings (lines 184–193):

```ts
  signinSub: "이메일과 비밀번호로 로그인하세요 — 첫 로그인이 곧 가입입니다.",
  emailPlaceholder: "you@example.com",
  emailInvalid: "올바른 이메일을 입력하세요.",
  passwordPlaceholder: "비밀번호 (6자 이상)",
  passwordShort: "비밀번호는 6자 이상이어야 합니다.",
  signinBtn: "로그인",
  signingIn: "로그인 중…",
```

the en intro steps (lines 142–143):

```ts
  introMemberStep1: "Enter your email and a password — there is no sign-up form. Your first sign-in creates the account.",
  introMemberStep2: "That's it — you're a member, instantly. It's the same flow your agents use.",
```

and the ko intro steps (lines 304–305):

```ts
  introMemberStep1: "이메일과 비밀번호만 입력하세요 — 별도 가입 절차가 없습니다. 첫 로그인이 곧 가입이에요.",
  introMemberStep2: "그걸로 끝 — 바로 멤버가 됩니다. 에이전트와 똑같은 방식이에요.",
```

- [ ] **Step 3: Rewrite the `SignIn` component**

In `web/App.tsx` line 35, change the cloud import to:

```ts
import { cloudConfigured, getSession, onAuthChange, pb, signInWithPassword, signOut, type HiveSession } from "./cloud";
```

Replace the `SignIn` function (lines 264–346) with:

```tsx
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
```

- [ ] **Step 4: Verify**

Run: `npm run type-check && npm test`
Expected: clean. Then confirm no web code still references OTP:
`grep -rn "sendEmailOtp\|verifyEmailOtp\|sendCode\|codeSentTo\|codePlaceholder" web/ && echo LEFTOVER || echo CLEAN`
Expected: `CLEAN`.

- [ ] **Step 5: Commit**

```bash
git add web/cloud.ts web/App.tsx web/i18n.ts
git commit -m "feat(hive): web sign-in — email+password single form, no OTP"
```

---

### Task 4: Remove the OTP/SMTP layer, update docs

**Files:**
- Delete: `src/lib/cloud/otp-auth.ts`, `scripts/mail-catcher.mjs`
- Modify: `README.md:114-146` (Hive operator setup), `docs/hive-agent-skill.md:47-58` (OTP sign-in alternative)

**Interfaces:**
- Consumes: nothing — Tasks 2–3 already removed every import of `otp-auth`.
- Produces: nothing.

- [ ] **Step 1: Delete the dead code**

```bash
git rm src/lib/cloud/otp-auth.ts scripts/mail-catcher.mjs
```

- [ ] **Step 2: Update README**

In `README.md`, the intro of the "Hive (cloud) — operator setup" section says
`Auth is **email one-time codes** — no Google Cloud, no OAuth client, no redirect URLs.`
Change that sentence to:

```
Auth is **email + password** — the first sign-in creates the account (the same
flow agents use); no Google Cloud, no OAuth client, no redirect URLs, no SMTP.
```

Replace step 2 (the whole "**Email codes:** … OTP for Hive"." block, lines 134–143) with:

```
2. **Sign-in:** members sign in with an email + password; the first sign-in
   creates the account. Nothing to provision — no SMTP, no email verification.
```

- [ ] **Step 3: Update the agent skill doc**

In `docs/hive-agent-skill.md`, delete the OTP alternative — from the line
`Or with an email one-time code (how the human UI signs in):` through the end
of its code block (the `auth-with-otp` curl). In its place add one line:

```
The human web/extension UI signs in the same way — email + password.
```

Keep the "(First-time members: create the account first …)" note that follows.

- [ ] **Step 4: Verify nothing references the removed pieces**

Run: `grep -rn "otp\|mail-catcher\|one-time" src web scripts README.md --include="*.ts" --include="*.tsx" --include="*.mjs" -i; grep -in "one-time\|otp\|smtp" README.md`
Expected: no hits in code; no OTP/SMTP mentions left in README.
(Older files under `docs/superpowers/` are historical records — leave them.)

- [ ] **Step 5: Full verification**

Run: `npm test && npm run build && npm run build:web`
Expected: all tests pass, both builds succeed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(hive): drop OTP/SMTP layer — mail catcher, otp-auth, SMTP docs"
```
