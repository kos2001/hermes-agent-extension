import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromeStorageAdapter } from "./storage-adapter";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True when the build was configured with Supabase credentials. */
export const cloudConfigured = Boolean(url && anonKey);

/**
 * Shared Supabase client. Uses the implicit OAuth flow (tokens arrive in the
 * redirect fragment, which suits chrome.identity.launchWebAuthFlow) and stores
 * the session in chrome.storage so it is shared across SW + side panel.
 */
export const supabase: SupabaseClient = createClient(url ?? "http://invalid.local", anonKey ?? "anon", {
  auth: {
    flowType: "implicit",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: chromeStorageAdapter,
  },
});
