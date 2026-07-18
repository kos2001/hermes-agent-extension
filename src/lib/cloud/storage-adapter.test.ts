import { beforeEach, describe, expect, it, vi } from "vitest";
import { chromeAuthStore } from "./storage-adapter";

function fakeChromeStorage() {
  const data: Record<string, unknown> = {};
  return {
    data,
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
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("chromeAuthStore", () => {
  let fake: ReturnType<typeof fakeChromeStorage>;
  beforeEach(() => {
    fake = fakeChromeStorage();
    (globalThis as unknown as { chrome: unknown }).chrome = fake;
  });

  it("persists a saved token to chrome.storage", async () => {
    const store = chromeAuthStore();
    store.save("tok-123", { id: "u1" } as never);
    await flush();
    const stored = Object.values(fake.data)[0] as string;
    expect(stored).toContain("tok-123");
  });

  it("clears the persisted value on clear()", async () => {
    const store = chromeAuthStore();
    store.save("tok-123", { id: "u1" } as never);
    await flush();
    store.clear();
    await flush();
    expect(Object.keys(fake.data)).toHaveLength(0);
  });

  it("loads the initial state from chrome.storage", async () => {
    const store = chromeAuthStore();
    store.save("tok-abc", { id: "u1" } as never);
    await flush();
    const revived = chromeAuthStore();
    await flush();
    expect(revived.token).toBe("tok-abc");
  });
});
