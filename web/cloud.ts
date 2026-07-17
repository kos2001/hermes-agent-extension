import PocketBase from "pocketbase";
import type { HiveSession } from "@/lib/cloud/pb";
import * as otp from "@/lib/cloud/otp-auth";

export type { HiveSession };

const url = import.meta.env.VITE_POCKETBASE_URL as string | undefined;

/** True when the build was configured with a PocketBase server URL. */
export const cloudConfigured = Boolean(url);

/**
 * Web PocketBase client with localStorage session persistence (the SDK
 * default). Auth is email one-time codes — identical flow to the extension.
 */
export const pb: PocketBase = new PocketBase(url ?? "http://invalid.local");
// The app issues overlapping queries to the same collections (feed + activity
// + reactions at mount); the SDK's per-endpoint auto-cancellation would abort
// the earlier ones, so it stays off.
pb.autoCancellation(false);

/** Step 1: send a code to the address. */
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

export function onAuthChange(cb: (session: HiveSession | null) => void): () => void {
  return otp.onAuthChange(pb, cb);
}
