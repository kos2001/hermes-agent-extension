import { pb } from "./client";
import type { HiveSession } from "./pb";
import * as otp from "./otp-auth";

export type { HiveSession };

/**
 * Email one-time-code sign-in. Step 1: send a code to the address. No external
 * OAuth provider, no redirect — works the same in the extension and the web app.
 */
export async function sendEmailOtp(email: string): Promise<void> {
  await otp.sendEmailOtp(pb, email);
}

/** Step 2: verify the emailed code and establish the session. */
export async function verifyEmailOtp(email: string, token: string): Promise<HiveSession> {
  return otp.verifyEmailOtp(pb, email, token);
}

export async function signOut(): Promise<void> {
  otp.signOut(pb);
}

export async function getSession(): Promise<HiveSession | null> {
  return otp.getSession(pb);
}

/** Subscribe to auth changes; returns an unsubscribe function. */
export function onAuthChange(cb: (session: HiveSession | null) => void): () => void {
  return otp.onAuthChange(pb, cb);
}
