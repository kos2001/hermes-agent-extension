import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import { eqFilter, onTableInserts } from "./realtime";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("eqFilter", () => {
  it("builds a column/value predicate", () => {
    expect(eqFilter("folder_id", "abc")).toEqual({ column: "folder_id", value: "abc" });
  });
});

describe("onTableInserts", () => {
  it("fires on matching creations only, and unsubscribes", async () => {
    let handler: ((e: { action: string; record: Record<string, unknown> }) => void) | null = null;
    const unsub = vi.fn();
    const subscribe = vi.fn(async (topic: string, h: typeof handler) => {
      expect(topic).toBe("*");
      handler = h;
      return unsub;
    });
    const pb = mockPb({ comments: { subscribe } });
    const cb = vi.fn();

    const off = onTableInserts(pb, "comments", eqFilter("folder_id", "f1"), cb);
    await tick();

    handler!({ action: "create", record: { folder_id: "f1" } });
    expect(cb).toHaveBeenCalledTimes(1);
    handler!({ action: "create", record: { folder_id: "other" } }); // filtered out
    handler!({ action: "update", record: { folder_id: "f1" } }); // not a creation
    expect(cb).toHaveBeenCalledTimes(1);

    off();
    expect(unsub).toHaveBeenCalled();
  });

  it("fires on any creation when no filter is given", async () => {
    let handler: ((e: { action: string; record: Record<string, unknown> }) => void) | null = null;
    const subscribe = vi.fn(async (_t: string, h: typeof handler) => {
      handler = h;
      return vi.fn();
    });
    const pb = mockPb({ shared_folders: { subscribe } });
    const cb = vi.fn();
    onTableInserts(pb, "shared_folders", undefined, cb);
    await tick();
    handler!({ action: "create", record: { id: "x" } });
    expect(cb).toHaveBeenCalledOnce();
  });

  it("unsubscribes even when off() is called before the subscription resolves", async () => {
    const unsub = vi.fn();
    let resolve: (u: () => void) => void = () => {};
    const subscribe = vi.fn(() => new Promise<() => void>((r) => (resolve = r)));
    const pb = mockPb({ comments: { subscribe } });
    const off = onTableInserts(pb, "comments", undefined, vi.fn());
    off(); // before resolution
    resolve(unsub);
    await tick();
    expect(unsub).toHaveBeenCalled();
  });
});
