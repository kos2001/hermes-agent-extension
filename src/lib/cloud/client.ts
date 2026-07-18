import PocketBase from "pocketbase";
import { chromeAuthStore } from "./storage-adapter";
import { loadHiveUrl } from "./config";

const envUrl = import.meta.env.VITE_POCKETBASE_URL as string | undefined;

/**
 * Shared PocketBase client. The auth token lives in chrome.storage so it is
 * shared across the service worker and the side panel and survives SW restarts.
 *
 * The server URL is runtime configuration (see `config.ts`): call `initHive()`
 * once per context before using `pb` — it reads the stored URL (falling back
 * to the build-time env default) and applies it here. Until then the client
 * points at a placeholder host.
 */
export const pb: PocketBase = new PocketBase(envUrl ?? "http://invalid.local", chromeAuthStore());
// Overlapping queries to the same collection are normal here (feed + activity
// + votes in parallel); the SDK's auto-cancellation would abort the earlier ones.
pb.autoCancellation(false);

/**
 * Apply the configured Hive server URL to the shared client and report whether
 * Hive is configured at all. Safe to call repeatedly (e.g. after the user
 * saves or clears the URL in Settings) — it just re-reads storage.
 */
export async function initHive(): Promise<boolean> {
  const url = await loadHiveUrl();
  pb.baseURL = url ?? "http://invalid.local";
  return Boolean(url);
}
