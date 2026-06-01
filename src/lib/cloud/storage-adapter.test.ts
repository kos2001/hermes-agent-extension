import { beforeEach, describe, expect, it, vi } from "vitest";
import { chromeStorageAdapter } from "./storage-adapter";

function fakeChromeStorage() {
  const data: Record<string, unknown> = {};
  return {
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

describe("chromeStorageAdapter", () => {
  beforeEach(() => {
    (globalThis as unknown as { chrome: unknown }).chrome = fakeChromeStorage();
  });

  it("round-trips a value through get/set", async () => {
    await chromeStorageAdapter.setItem("k", "v");
    expect(await chromeStorageAdapter.getItem("k")).toBe("v");
  });

  it("returns null for a missing key", async () => {
    expect(await chromeStorageAdapter.getItem("nope")).toBeNull();
  });

  it("removes a key", async () => {
    await chromeStorageAdapter.setItem("k", "v");
    await chromeStorageAdapter.removeItem("k");
    expect(await chromeStorageAdapter.getItem("k")).toBeNull();
  });
});
