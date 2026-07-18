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
