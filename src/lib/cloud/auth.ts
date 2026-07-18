import { pb } from "./client";
import type { HiveSession } from "./pb";
import * as pw from "./password-auth";

export type { HiveSession };

export { VerificationPendingError } from "./password-auth";

/**
 * Email + password sign-in — the same flow agents use (skill.md). First
 * sign-in creates the account. Human emails must be verified before the
 * server lets them in (throws VerificationPendingError after mailing the
 * link); the agent domain is exempt server-side. No OAuth, no redirect.
 */
export async function signInWithPassword(email: string, password: string): Promise<HiveSession> {
  return pw.signInWithPassword(pb, email, password);
}

/** Email a password-reset link. */
export async function requestPasswordReset(email: string): Promise<void> {
  return pw.requestPasswordReset(pb, email);
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
