/**
 * Runtime Hive server configuration (spec: 2026-07-18-hive-easy-setup).
 *
 * The PocketBase server URL lives in `chrome.storage.local` so any build of
 * the extension can be pointed at a Hive server by pasting one URL — no
 * rebuild, no `.env`. A `VITE_POCKETBASE_URL` baked at build time (operator
 * builds) acts only as the default when nothing is stored.
 *
 * Pure storage/fetch helpers — no PocketBase import; `client.ts#initHive()`
 * is the glue that applies the URL to the shared `pb` singleton. `chrome.*`
 * is only touched inside function bodies (web builds never call these).
 */

export const HIVE_URL_KEY = "hive.serverUrl";

const ENV_URL = (import.meta.env?.VITE_POCKETBASE_URL as string | undefined) || undefined;

/**
 * Canonical form of a user-pasted server URL: trims, prepends `https://` when
 * the scheme is missing, strips trailing slashes. Returns null when the input
 * can't be a server URL.
 */
export function normalizeHiveUrl(raw: string): string | null {
  let s = (raw || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  // A hostname with spaces or no dot/port/localhost is a paste error, not a server.
  if (/\s/.test(raw.trim())) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

/** Stored URL, else the build-time default, else null (Hive off). */
export async function loadHiveUrl(): Promise<string | null> {
  const got = await chrome.storage.local.get(HIVE_URL_KEY);
  const v = got[HIVE_URL_KEY];
  if (typeof v === "string" && v) return v;
  return ENV_URL ?? null;
}

/** Normalize and persist the server URL; throws on unusable input. */
export async function saveHiveUrl(raw: string): Promise<string> {
  const url = normalizeHiveUrl(raw);
  if (!url) throw new Error(`Not a valid server URL: "${raw}"`);
  await chrome.storage.local.set({ [HIVE_URL_KEY]: url });
  return url;
}

/** Forget the server URL — turns every Hive entry point back off. */
export async function clearHiveUrl(): Promise<void> {
  await chrome.storage.local.remove(HIVE_URL_KEY);
}

/** True when `url` answers PocketBase's health endpoint. */
export async function probeHive(url: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/health`, { signal });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Subscribe to server-URL changes (any context: side panel, options, SW).
 * The callback gets the new URL or null when cleared. Returns unsubscribe.
 */
export function onHiveUrlChange(cb: (url: string | null) => void): () => void {
  const listener = (
    changes: Record<string, { newValue?: unknown }>,
    area: string,
  ) => {
    if (area !== "local" || !(HIVE_URL_KEY in changes)) return;
    const next = changes[HIVE_URL_KEY].newValue;
    cb(typeof next === "string" && next ? next : null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
