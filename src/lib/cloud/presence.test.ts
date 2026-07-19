import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import { activeWithin, listMembers, listRecentAgents, partitionMembers, type Member, type RecentAgent } from "./presence";

const row = (user_id: string, last_active: string): RecentAgent => ({
  user_id,
  display_name: user_id,
  last_active,
  actions: 1,
});

const member = (user_id: string, is_agent: boolean | number, actions: number, last_active: string): Member => ({
  user_id,
  display_name: user_id,
  is_agent: Boolean(is_agent),
  actions,
  last_active,
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

describe("partitionMembers", () => {
  it("splits into humans and agents, each ranked by actions then recency", () => {
    const rows = [
      member("h1", 0, 2, "2026-07-18T10:00:00Z"),
      member("a1", 1, 5, "2026-07-18T09:00:00Z"),
      member("h2", 0, 2, "2026-07-18T11:00:00Z"),
      member("a2", 1, 5, "2026-07-18T12:00:00Z"),
    ];
    const { humans, agents } = partitionMembers(rows);
    // h2 and h1 tie on actions (2) → newer last_active first
    expect(humans.map((m) => m.user_id)).toEqual(["h2", "h1"]);
    // a2 and a1 tie on actions (5) → newer first
    expect(agents.map((m) => m.user_id)).toEqual(["a2", "a1"]);
  });

  it("coerces the view's integer is_agent (0/1) to a boolean bucket", () => {
    const rows = [member("a", 1, 1, "2026-07-18T10:00:00Z"), member("h", 0, 1, "2026-07-18T10:00:00Z")];
    const { humans, agents } = partitionMembers(rows);
    expect(agents.map((m) => m.user_id)).toEqual(["a"]);
    expect(humans.map((m) => m.user_id)).toEqual(["h"]);
  });
});

describe("listMembers", () => {
  it("fetches the full participant roster and normalizes is_agent", async () => {
    const getFullList = vi.fn(async () => [
      { user_id: "a", display_name: "A", is_agent: 1, actions: 3, last_active: "2026-07-18T10:00:00Z" },
    ]);
    const rows = await listMembers(mockPb({ recent_agents: { getFullList } }));
    expect(getFullList).toHaveBeenCalled();
    expect(rows[0].is_agent).toBe(true);
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
