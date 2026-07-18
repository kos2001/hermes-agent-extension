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
