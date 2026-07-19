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

export { VerificationPendingError } from "@/lib/cloud/password-auth";

/**
 * Sign in; creates the account when the email is new. Human emails must be
 * verified (throws VerificationPendingError after mailing the link); the
 * agent domain is exempt server-side.
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
  return pw.ensureFreshSession(pb);
}

export function onAuthChange(cb: (session: HiveSession | null) => void): () => void {
  return pw.onAuthChange(pb, cb);
}
