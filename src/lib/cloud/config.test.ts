import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HIVE_URL_KEY,
  loadHiveUrl,
  normalizeHiveUrl,
  onHiveUrlChange,
  probeHive,
  saveHiveUrl,
  clearHiveUrl,
} from "./config";

type ChangeListener = (
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
  area: string,
) => void;

function fakeChrome() {
  const data: Record<string, unknown> = {};
  const listeners: ChangeListener[] = [];
  return {
    data,
    listeners,
    storage: {
      local: {
        get: vi.fn(async (k: string) => ({ [k]: data[k] })),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          Object.assign(data, obj);
        }),
        remove: vi.fn(async (k: string) => {
          delete data[k];
        }),
      },
      onChanged: {
        addListener: vi.fn((l: ChangeListener) => listeners.push(l)),
        removeListener: vi.fn((l: ChangeListener) => {
          const i = listeners.indexOf(l);
          if (i >= 0) listeners.splice(i, 1);
        }),
      },
    },
  };
}

let fake: ReturnType<typeof fakeChrome>;
beforeEach(() => {
  fake = fakeChrome();
  (globalThis as unknown as { chrome: unknown }).chrome = fake;
});

describe("normalizeHiveUrl", () => {
  it("accepts an https URL and strips trailing slashes", () => {
    expect(normalizeHiveUrl("https://hive.example.com/")).toBe("https://hive.example.com");
  });

  it("prepends https:// when the scheme is missing", () => {
    expect(normalizeHiveUrl("hive.example.com")).toBe("https://hive.example.com");
  });

  it("keeps an explicit http scheme (local servers)", () => {
    expect(normalizeHiveUrl("http://127.0.0.1:8090")).toBe("http://127.0.0.1:8090");
  });

  it("rejects empty and non-URL input", () => {
    expect(normalizeHiveUrl("   ")).toBeNull();
    expect(normalizeHiveUrl("not a url at all")).toBeNull();
  });
});

describe("save / load / clear", () => {
  it("saveHiveUrl stores the normalized URL and loadHiveUrl returns it", async () => {
    await saveHiveUrl("https://hive.example.com/");
    expect(fake.data[HIVE_URL_KEY]).toBe("https://hive.example.com");
    expect(await loadHiveUrl()).toBe("https://hive.example.com");
  });

  it("saveHiveUrl rejects an invalid URL", async () => {
    await expect(saveHiveUrl("   ")).rejects.toThrow();
  });

  it("loadHiveUrl returns null when nothing is stored (no env default in tests)", async () => {
    expect(await loadHiveUrl()).toBeNull();
  });

  it("clearHiveUrl removes the stored URL", async () => {
    await saveHiveUrl("https://hive.example.com");
    await clearHiveUrl();
    expect(await loadHiveUrl()).toBeNull();
  });
});

describe("probeHive", () => {
  it("returns true when /api/health responds ok", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    expect(await probeHive("https://hive.example.com")).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://hive.example.com/api/health", expect.anything());
  });

  it("returns false on a non-ok response or network failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as Response));
    expect(await probeHive("https://hive.example.com")).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }));
    expect(await probeHive("https://hive.example.com")).toBe(false);
  });
});

describe("onHiveUrlChange", () => {
  it("fires with the new URL when the stored key changes, and unsubscribes", () => {
    const seen: (string | null)[] = [];
    const off = onHiveUrlChange((url) => seen.push(url));
    fake.listeners[0]({ [HIVE_URL_KEY]: { newValue: "https://a.example" } }, "local");
    fake.listeners[0]({ other: { newValue: "x" } }, "local"); // unrelated key — ignored
    fake.listeners[0]({ [HIVE_URL_KEY]: { newValue: undefined } }, "local"); // cleared
    expect(seen).toEqual(["https://a.example", null]);
    off();
    expect(fake.listeners).toHaveLength(0);
  });
});
