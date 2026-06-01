import { describe, expect, it, vi } from "vitest";
import { myOpinionVotes, opinionVoteCounts, unvoteOpinion, voteOpinion } from "./opinion-votes";

describe("voteOpinion", () => {
  it("upserts a vote for the current user keyed on (comment,user)", async () => {
    let upserted: unknown = null;
    let onConflict: unknown = null;
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
      from: vi.fn(() => ({
        upsert: vi.fn(async (row: unknown, opts: { onConflict: string }) => {
          upserted = row;
          onConflict = opts.onConflict;
          return { error: null };
        }),
      })),
    };
    await voteOpinion(client as never, "c1");
    expect(upserted).toEqual({ comment_id: "c1", user_id: "u1" });
    expect(onConflict).toBe("comment_id,user_id");
  });

  it("requires sign-in", async () => {
    const client = { auth: { getUser: vi.fn(async () => ({ data: { user: null } })) }, from: vi.fn() };
    await expect(voteOpinion(client as never, "c1")).rejects.toThrow(/signed in/i);
  });
});

describe("unvoteOpinion", () => {
  it("deletes the user's vote on the comment", async () => {
    const eqs: [string, string][] = [];
    const chain: Record<string, unknown> = {
      eq: vi.fn((k: string, v: string) => {
        eqs.push([k, v]);
        return chain;
      }),
      then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
    };
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
      from: vi.fn(() => ({ delete: vi.fn(() => chain) })),
    };
    await unvoteOpinion(client as never, "c1");
    expect(eqs).toEqual([
      ["comment_id", "c1"],
      ["user_id", "u1"],
    ]);
  });
});

describe("opinionVoteCounts", () => {
  it("tallies votes per comment", async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          in: vi.fn(async () => ({
            data: [{ comment_id: "a" }, { comment_id: "a" }, { comment_id: "b" }],
            error: null,
          })),
        })),
      })),
    };
    expect(await opinionVoteCounts(client as never, ["a", "b"])).toEqual({ a: 2, b: 1 });
  });

  it("short-circuits with no ids", async () => {
    const client = { from: vi.fn() };
    expect(await opinionVoteCounts(client as never, [])).toEqual({});
    expect(client.from).not.toHaveBeenCalled();
  });
});

describe("myOpinionVotes", () => {
  it("returns the set of comment ids the user voted", async () => {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ in: vi.fn(async () => ({ data: [{ comment_id: "a" }], error: null })) })),
        })),
      })),
    };
    const set = await myOpinionVotes(client as never, ["a", "b"]);
    expect(set.has("a")).toBe(true);
    expect(set.has("b")).toBe(false);
  });

  it("returns empty when signed out", async () => {
    const client = { auth: { getUser: vi.fn(async () => ({ data: { user: null } })) }, from: vi.fn() };
    expect((await myOpinionVotes(client as never, ["a"])).size).toBe(0);
  });
});
