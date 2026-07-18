import { AsyncAuthStore } from "pocketbase";

const KEY = "hive.pb.auth";

/**
 * PocketBase auth store backed by `chrome.storage.local` so a session is shared
 * across the side panel and the service worker and survives SW restarts.
 */
export function chromeAuthStore(): AsyncAuthStore {
  return new AsyncAuthStore({
    save: async (serialized: string) => {
      await chrome.storage.local.set({ [KEY]: serialized });
    },
    clear: async () => {
      await chrome.storage.local.remove(KEY);
    },
    initial: chrome.storage.local.get(KEY).then((got) => {
      const v = got[KEY];
      return typeof v === "string" ? v : "";
    }),
  });
}
