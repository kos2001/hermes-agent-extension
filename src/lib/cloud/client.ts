import PocketBase from "pocketbase";
import { chromeAuthStore } from "./storage-adapter";

const url = import.meta.env.VITE_POCKETBASE_URL as string | undefined;

/** True when the build was configured with a PocketBase server URL. */
export const cloudConfigured = Boolean(url);

/**
 * Master switch for the Hive (collective bookmarks) feature. Held OFF until the
 * feature stabilizes — this hides every Hive entry point (feed icon, sign-in,
 * share-to-Hive) without removing the code. Flip to `true` to re-enable.
 */
export const HIVE_ENABLED: boolean = false;

/**
 * Shared PocketBase client. The auth token lives in chrome.storage so it is
 * shared across the service worker and the side panel and survives SW restarts.
 */
export const pb: PocketBase = new PocketBase(url ?? "http://invalid.local", chromeAuthStore());
// Overlapping queries to the same collection are normal here (feed + activity
// + votes in parallel); the SDK's auto-cancellation would abort the earlier ones.
pb.autoCancellation(false);
