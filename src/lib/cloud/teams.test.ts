import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import { concludeTeam, createTeam, isValidTeamName, normalizeTeamName, sendTeamMessage } from "./teams";

describe("normalizeTeamName / isValidTeamName", () => {
  it("collapses whitespace and enforces 2–140 chars", () => {
    expect(normalizeTeamName("  Latency   SWAT ")).toBe("Latency SWAT");
    expect(isValidTeamName(" a ")).toBe(false);
    expect(isValidTeamName("ok")).toBe(true);
    expect(isValidTeamName("x".repeat(141))).toBe(false);
  });
});

describe("createTeam", () => {
  it("creates an open team owned by the current user", async () => {
    const create = vi.fn(async (d: Record<string, unknown>) => ({ id: "tm1", ...d }));
    const pb = mockPb({ teams: { create } }, "me");
    const id = await createTeam(pb, { name: "  Latency  SWAT ", topic: "perf", problem: " cut p95 " });
    expect(id).toBe("tm1");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ owner_id: "me", name: "Latency SWAT", topic: "perf", problem: "cut p95", status: "open" }),
    );
  });
  it("rejects a too-short name and an empty problem", async () => {
    const pb = mockPb({ teams: { create: vi.fn() } }, "me");
    await expect(createTeam(pb, { name: "a", problem: "x" })).rejects.toThrow(/name/i);
    await expect(createTeam(pb, { name: "ok team", problem: "  " })).rejects.toThrow(/problem/i);
  });
  it("requires sign-in", async () => {
    const pb = mockPb({ teams: { create: vi.fn() } }, null);
    await expect(createTeam(pb, { name: "ok team", problem: "x" })).rejects.toThrow(/signed in/i);
  });
});

describe("concludeTeam", () => {
  it("marks solved with the outcome", async () => {
    const update = vi.fn(async () => ({}));
    const pb = mockPb({ teams: { update } }, "me");
    await concludeTeam(pb, "tm1", "  shipped the fix  ");
    expect(update).toHaveBeenCalledWith("tm1", { status: "solved", outcome: "shipped the fix" });
  });
  it("requires an outcome", async () => {
    const pb = mockPb({ teams: { update: vi.fn() } }, "me");
    await expect(concludeTeam(pb, "tm1", " ")).rejects.toThrow(/outcome/i);
  });
});

describe("sendTeamMessage", () => {
  it("posts as the current human member", async () => {
    const create = vi.fn(async () => ({}));
    const pb = mockPb({ team_messages: { create } }, "me");
    await sendTeamMessage(pb, "tm1", " hi team ");
    expect(create).toHaveBeenCalledWith({ team_id: "tm1", user_id: "me", author_kind: "human", body: "hi team" });
  });
  it("rejects an empty message", async () => {
    const pb = mockPb({ team_messages: { create: vi.fn() } }, "me");
    await expect(sendTeamMessage(pb, "tm1", "  ")).rejects.toThrow(/empty/i);
  });
});
