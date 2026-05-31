/**
 * Supabase auth storage backed by `chrome.storage.local` so a session is shared
 * across the side panel and the service worker and survives SW restarts.
 * Supabase accepts an async storage object implementing get/set/removeItem.
 */
export const chromeStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    const got = await chrome.storage.local.get(key);
    const v = got[key];
    return typeof v === "string" ? v : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  },
};
