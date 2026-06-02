import { describe, expect, it, vi } from "vitest";
import { eqFilter, onTableInserts } from "./realtime";

describe("eqFilter", () => {
  it("builds an equality filter string", () => {
    expect(eqFilter("folder_id", "abc")).toBe("folder_id=eq.abc");
  });
});

describe("onTableInserts", () => {
  it("subscribes to INSERTs with the filter and unsubscribes via removeChannel", () => {
    let onArgs: unknown[] = [];
    const channel = {
      on: vi.fn(function (this: unknown, ...args: unknown[]) {
        onArgs = args;
        return this;
      }),
      subscribe: vi.fn(function (this: unknown) {
        return this;
      }),
    };
    const sb = { channel: vi.fn(() => channel), removeChannel: vi.fn() };
    const cb = vi.fn();

    const off = onTableInserts(sb as never, "comments", "folder_id=eq.f1", cb);
    expect(onArgs[0]).toBe("postgres_changes");
    expect(onArgs[1]).toMatchObject({ event: "INSERT", schema: "public", table: "comments", filter: "folder_id=eq.f1" });
    // invoking the registered handler triggers the callback
    (onArgs[2] as () => void)();
    expect(cb).toHaveBeenCalledOnce();

    off();
    expect(sb.removeChannel).toHaveBeenCalledWith(channel);
  });

  it("omits the filter key when none is given", () => {
    let cfg: Record<string, unknown> = {};
    const channel = {
      on: vi.fn(function (this: unknown, _e: unknown, c: Record<string, unknown>) {
        cfg = c;
        return this;
      }),
      subscribe: vi.fn(function (this: unknown) {
        return this;
      }),
    };
    const sb = { channel: vi.fn(() => channel), removeChannel: vi.fn() };
    onTableInserts(sb as never, "shared_folders", undefined, vi.fn());
    expect("filter" in cfg).toBe(false);
  });
});
