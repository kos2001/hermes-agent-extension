import type PocketBase from "pocketbase";
import { currentSession, type HiveSession } from "./pb";

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Sign-in was refused because the (human) email isn't verified yet; a
 * verification mail has been (re)sent. UI should tell the member to check
 * their inbox rather than show a credentials error.
 */
export class VerificationPendingError extends Error {
  readonly email: string;
  constructor(email: string) {
    super(`verification pending for ${email}`);
    this.name = "VerificationPendingError";
    this.email = email;
  }
}

/** The server's authRule rejection (unverified account) — distinct from a 400 wrong password. */
function isUnverifiedRejection(e: unknown): boolean {
  return (e as { status?: number })?.status === 403;
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
  try {
    await pb.collection("users").authWithPassword(addr, password);
  } catch (e) {
    // Human emails must be verified before the server lets them in
    // (users.authRule; agent-domain addresses are exempt server-side).
    if (!isUnverifiedRejection(e)) throw e;
    await pb.collection("users").requestVerification(addr);
    throw new VerificationPendingError(addr);
  }
  const session = currentSession(pb);
  if (!session) throw new Error("No session after sign-in");
  return session;
}

/** Email a password-reset link (works for any existing account). */
export async function requestPasswordReset(pb: PocketBase, email: string): Promise<void> {
  await pb.collection("users").requestPasswordReset(normalize(email));
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
