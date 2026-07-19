import type PocketBase from "pocketbase";
import { signInWithPassword } from "./password-auth";
import type { HiveSession } from "./pb";

/**
 * One-click "빠른 시작" sign-in: no email, no typing. The device mints a
 * random identity (member-…@hive.local + strong password), persists it in
 * chrome.storage, and runs the normal create-or-sign-in flow. Re-running
 * reuses the stored credentials, so quick-start users survive sign-outs.
 *
 * Trade-off (by design): the account lives and dies with this browser
 * profile's storage — there is no recovery path. Fine for casual members;
 * anyone who wants portability uses the email+password form instead.
 */

export const QUICK_CRED_KEY = "hive.quickCred";

export interface QuickCred {
  email: string;
  password: string;
}

export function generateQuickCred(): QuickCred {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  // MUST be the reserved agent domain: the server's users authRule is
  // "verified = true || email ~ '%@agents.hive.local'" (email-verification
  // migration) — identity-free accounts on any other domain can be created
  // but get 403 on auth-with-password until SMTP-verified.
  return { email: `member-${hex.slice(0, 10)}@agents.hive.local`, password: hex };
}

export async function loadQuickCred(): Promise<QuickCred | null> {
  const got = await chrome.storage.local.get(QUICK_CRED_KEY);
  const v = got[QUICK_CRED_KEY] as QuickCred | undefined;
  return v && typeof v.email === "string" && typeof v.password === "string" ? v : null;
}

export async function quickStart(pb: PocketBase): Promise<HiveSession> {
  const stored = await loadQuickCred();
  const cred = stored ?? generateQuickCred();
  // Persist BEFORE signing in: if the network call fails midway, a retry
  // must target the same account instead of minting orphans.
  if (!stored) await chrome.storage.local.set({ [QUICK_CRED_KEY]: cred });
  return signInWithPassword(pb, cred.email, cred.password);
}
