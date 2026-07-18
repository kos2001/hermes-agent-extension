/**
 * Minimal chrome.* stub so the side panel runs in a plain browser page for UI
 * smoke tests. storage.local.set/remove dispatch onChanged AFTER the write
 * commits (like real Chrome) so runtime-config gating (hive.serverUrl, theme,
 * lang) can be exercised live. Seed `data` below for view-specific fixtures
 * (market reports, bookmark tree responses, …).
 */

type ChangeListener = (changes: Record<string, unknown>, area: string) => void;

const data: Record<string, unknown> = {};
const changeListeners: ChangeListener[] = [];
const emit = (changes: Record<string, unknown>) => {
  for (const l of [...changeListeners]) l(changes, "local");
};

const listeners = () => ({ addListener: (_: unknown) => {}, removeListener: (_: unknown) => {} });

(globalThis as any).chrome = {
  storage: {
    local: {
      get: async (keys?: unknown) => {
        const wanted = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(data);
        const out: Record<string, unknown> = {};
        for (const k of wanted as string[]) if (k in data) out[k] = data[k];
        return out;
      },
      set: async (items: Record<string, unknown>) => {
        const changes: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: data[k], newValue: v };
          data[k] = v;
        }
        emit(changes);
      },
      remove: async (key: string) => {
        const oldValue = data[key];
        delete data[key]; // real Chrome fires onChanged after the write commits
        emit({ [key]: { oldValue, newValue: undefined } });
      },
    },
    onChanged: {
      addListener: (l: ChangeListener) => changeListeners.push(l),
      removeListener: (l: ChangeListener) => {
        const i = changeListeners.indexOf(l);
        if (i >= 0) changeListeners.splice(i, 1);
      },
    },
  },
  runtime: {
    sendMessage: (_msg: unknown, cb?: (res: unknown) => void) => {
      setTimeout(() => cb?.({ ok: false }), 0);
    },
    openOptionsPage: () => {},
    onMessage: listeners(),
    lastError: undefined,
    id: "stub-extension-id",
  },
  tabs: {
    query: async () => [],
    create: async (o: unknown) => {
      ((window as any).__calls ??= []).push(["tabs.create", o]);
    },
    onActivated: listeners(),
    onUpdated: listeners(),
  },
  scripting: { executeScript: async () => [{ result: null }] },
  bookmarks: {
    getTree: async () => [],
    getChildren: async () => [],
    remove: async (id: string) => {
      ((window as any).__calls ??= []).push(["bookmarks.remove", id]);
    },
    move: async (id: string, dest: unknown) => {
      ((window as any).__calls ??= []).push(["bookmarks.move", id, dest]);
    },
    create: async () => ({ id: "999" }),
  },
  alarms: { create: () => {}, clear: async () => true, get: async () => undefined, onAlarm: listeners() },
  notifications: { create: () => {} },
  downloads: { download: async () => 1 },
  permissions: { contains: async () => true, request: async () => true },
};

window.confirm = () => true;

// Route probe-style fetches to fakes as needed (e.g. Hive /api/health).
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = String(input);
  if (u === "https://hive.test.example/api/health") return new Response("{}", { status: 200 });
  return realFetch(input as never, init);
}) as typeof fetch;

export {};
