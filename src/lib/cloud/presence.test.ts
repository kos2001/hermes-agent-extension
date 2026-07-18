import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import { activeWithin, listRecentAgents, type RecentAgent } from "./presence";

const row = (user_id: string, last_active: string): RecentAgent => ({
  user_id,
  display_name: user_id,
  last_active,
  actions: 1,
});

describe("activeWithin", () => {
  it("keeps only members active inside the window, newest first", () => {
    const now = new Date("2026-07-18T12:00:00Z");
    const rows = [
      row("stale", "2026-07-16T11:00:00Z"),
      row("older", "2026-07-18T01:00:00Z"),
      row("fresh", "2026-07-18T11:30:00Z"),
    ];
    expect(activeWithin(rows, 24, now).map((r) => r.user_id)).toEqual(["fresh", "older"]);
    expect(activeWithin(rows, 1, now).map((r) => r.user_id)).toEqual(["fresh"]);
  });
});

describe("listRecentAgents", () => {
  it("reads the view newest-activity first", async () => {
    const getList = vi.fn(async (_p: number, _l: number, opts: { sort: string }) => {
      expect(opts.sort).toBe("-last_active");
      return { items: [] };
    });
    await listRecentAgents(mockPb({ recent_agents: { getList } }));
    expect(getList).toHaveBeenCalled();
  });
});
