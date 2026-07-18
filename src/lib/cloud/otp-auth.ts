import type PocketBase from "pocketbase";
import { currentSession, type HiveSession } from "./pb";

/** Pending OTP request ids, keyed by normalized email (verify needs the id). */
const otpIds = new Map<string, string>();

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/** Display name for a brand-new member: the email prefix. Pure. */
export function defaultDisplayName(email: string): string {
  return normalize(email).split("@")[0] ?? "member";
}

/**
 * Email one-time-code sign-in, step 1: make sure the account exists (first
 * sign-in creates it with a throwaway password — the emailed code is the real
 * credential) and ask PocketBase to email a code.
 */
export async function sendEmailOtp(pb: PocketBase, email: string): Promise<void> {
  const addr = normalize(email);
  try {
    // one UUID (36 chars) — PocketBase caps passwords at 71 chars
    const pw = crypto.randomUUID();
    await pb.collection("users").create({
      email: addr,
      password: pw,
      passwordConfirm: pw,
      display_name: defaultDisplayName(addr),
    });
  } catch (e) {
    // "email already exists" is fine (we only need the account to exist);
    // anything else would leave the user code-less, so surface it
    const emailErr = (e as { data?: { data?: { email?: { code?: string } } } })?.data?.data?.email?.code;
    if (emailErr !== "validation_not_unique") throw e;
  }
  const req = await pb.collection("users").requestOTP(addr);
  otpIds.set(addr, req.otpId);
}

/** Step 2: verify the emailed code and establish the session. */
export async function verifyEmailOtp(pb: PocketBase, email: string, code: string): Promise<HiveSession> {
  const addr = normalize(email);
  const otpId = otpIds.get(addr);
  if (!otpId) throw new Error("Request a code first");
  await pb.collection("users").authWithOTP(otpId, code.trim());
  otpIds.delete(addr);
  const session = currentSession(pb);
  if (!session) throw new Error("No session after verification");
  return session;
}

export function signOut(pb: PocketBase): void {
  pb.authStore.clear();
}

export function getSession(pb: PocketBase): HiveSession | null {
  return currentSession(pb);
}

/** Subscribe to auth changes; returns an unsubscribe function. */
export function onAuthChange(pb: PocketBase, cb: (session: HiveSession | null) => void): () => void {
  return pb.authStore.onChange(() => cb(currentSession(pb)));
}
