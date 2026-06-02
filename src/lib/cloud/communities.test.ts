import { describe, expect, it, vi } from "vitest";
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
  it("inserts the normalized name and auto-joins the creator", async () => {
    const inserts: Record<string, unknown[]> = {};
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
      from: vi.fn((table: string) => {
        if (table === "communities") {
          return {
            insert: vi.fn((row: unknown) => {
              inserts.communities = [row];
              return { select: () => ({ single: async () => ({ data: { id: "c1" }, error: null }) }) };
            }),
          };
        }
        return {
          insert: vi.fn(async (row: unknown) => {
            inserts.members = [row];
            return { error: null };
          }),
        };
      }),
    };
    const { id } = await createCommunity(client as never, "  Deep   Learning ", "  papers  ");
    expect(id).toBe("c1");
    expect(inserts.communities[0]).toMatchObject({ name: "Deep Learning", description: "papers", created_by: "u1" });
    expect(inserts.members[0]).toEqual({ community_id: "c1", user_id: "u1" });
  });

  it("rejects a too-short name before any insert", async () => {
    const client = { auth: { getUser: vi.fn() }, from: vi.fn() };
    await expect(createCommunity(client as never, "x")).rejects.toThrow(/2.40|characters/i);
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("joinCommunity", () => {
  it("upserts membership for the current user", async () => {
    let upserted: unknown = null;
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
      from: vi.fn(() => ({ upsert: vi.fn(async (r: unknown) => ((upserted = r), { error: null })) })),
    };
    await joinCommunity(client as never, "c1");
    expect(upserted).toEqual({ community_id: "c1", user_id: "u1" });
  });
});

describe("myCommunityIds", () => {
  it("returns the joined ids; empty when signed out", async () => {
    const signedIn = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(async () => ({ data: [{ community_id: "c1" }], error: null })) })) })),
    };
    expect([...(await myCommunityIds(signedIn as never))]).toEqual(["c1"]);

    const signedOut = { auth: { getUser: vi.fn(async () => ({ data: { user: null } })) }, from: vi.fn() };
    expect((await myCommunityIds(signedOut as never)).size).toBe(0);
  });
});
