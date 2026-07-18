import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import {
  createCommunity,
  isValidCommunityName,
  joinCommunity,
  myCommunityIds,
  normalizeCommunityName,
} from "./communities";

describe("normalizeCommunityName", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeCommunityName("  AI   Research ")).toBe("AI Research");
  });
});

describe("isValidCommunityName", () => {
  it("requires 2–40 chars after normalization", () => {
    expect(isValidCommunityName("a")).toBe(false);
    expect(isValidCommunityName("  a ")).toBe(false);
    expect(isValidCommunityName("AI")).toBe(true);
    expect(isValidCommunityName("x".repeat(40))).toBe(true);
    expect(isValidCommunityName("x".repeat(41))).toBe(false);
  });
});

describe("createCommunity", () => {
  it("creates the normalized name and auto-joins the creator", async () => {
    const createdCommunity = vi.fn(async (_d: Record<string, unknown>) => ({ id: "c1" }));
    const createdMember = vi.fn(async (r: unknown) => r);
    const pb = mockPb({
      communities: { create: createdCommunity },
      community_members: { create: createdMember },
    });
    const { id } = await createCommunity(pb, "  Deep   Learning ", "  papers  ");
    expect(id).toBe("c1");
    expect(createdCommunity.mock.calls[0][0]).toMatchObject({
      name: "Deep Learning",
      description: "papers",
      created_by: "u1",
    });
    expect(createdMember).toHaveBeenCalledWith({ community_id: "c1", user_id: "u1" });
  });

  it("rejects a too-short name before any request", async () => {
    const pb = mockPb({});
    await expect(createCommunity(pb, "x")).rejects.toThrow(/2.40|characters/i);
  });
});

describe("joinCommunity", () => {
  it("creates membership for the current user; duplicate join is a no-op", async () => {
    const create = vi.fn(async (r: unknown) => r);
    const pb = mockPb({ community_members: { create } });
    await joinCommunity(pb, "c1");
    expect(create).toHaveBeenCalledWith({ community_id: "c1", user_id: "u1" });

    const dup = vi.fn(async () => {
      throw { status: 400 };
    });
    const pb2 = mockPb({ community_members: { create: dup } });
    await expect(joinCommunity(pb2, "c1")).resolves.toBeUndefined();
  });
});

describe("myCommunityIds", () => {
  it("returns the joined ids; empty when signed out", async () => {
    const getFullList = vi.fn(async (opts: { filter: string }) => {
      expect(opts.filter).toBe("user_id = 'u1'");
      return [{ community_id: "c1" }];
    });
    const signedIn = mockPb({ community_members: { getFullList } });
    expect([...(await myCommunityIds(signedIn))]).toEqual(["c1"]);

    const signedOut = mockPb({}, null);
    expect((await myCommunityIds(signedOut)).size).toBe(0);
  });
});
