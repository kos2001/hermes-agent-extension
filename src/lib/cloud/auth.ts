import type { Session } from "@supabase/supabase-js";
import { supabase } from "./client";
import { parseTokensFromRedirect } from "./oauth";

/**
 * Sign in with Google via chrome.identity.launchWebAuthFlow. Asks Supabase for
 * an authorize URL (no browser redirect), runs the interactive flow, then sets
 * the captured session on the client.
 */
export async function signInWithGoogle(): Promise<Session> {
  const redirectUri = chrome.identity.getRedirectURL();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { skipBrowserRedirect: true, redirectTo: redirectUri },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("Supabase did not return an authorize URL");

  const redirect = await chrome.identity.launchWebAuthFlow({ url: data.url, interactive: true });
  if (!redirect) throw new Error("Sign-in was cancelled");

  const { accessToken, refreshToken } = parseTokensFromRedirect(redirect);
  const { data: sessionData, error: setErr } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (setErr) throw setErr;
  if (!sessionData.session) throw new Error("Failed to establish a session");
  return sessionData.session;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/** Subscribe to auth changes; returns an unsubscribe function. */
export function onAuthChange(cb: (session: Session | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}
