import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import { myOpinionVotes, opinionVoteCounts, unvoteOpinion, voteOpinion } from "./opinion-votes";

describe("voteOpinion", () => {
  it("creates a vote for the current user", async () => {
    const create = vi.fn(async (r: unknown) => r);
    const pb = mockPb({ opinion_votes: { create } });
    await voteOpinion(pb, "c1");
    expect(create).toHaveBeenCalledWith({ comment_id: "c1", user_id: "u1" });
  });

  it("treats a duplicate vote as success", async () => {
    const create = vi.fn(async () => {
      throw { status: 400 };
    });
    const pb = mockPb({ opinion_votes: { create } });
    await expect(voteOpinion(pb, "c1")).resolves.toBeUndefined();
  });

  it("requires sign-in", async () => {
    const pb = mockPb({}, null);
    await expect(voteOpinion(pb, "c1")).rejects.toThrow(/signed in/i);
  });
});

describe("unvoteOpinion", () => {
  it("deletes the user's vote on the comment", async () => {
    const getFullList = vi.fn(async (opts: { filter: string }) => {
      expect(opts.filter).toBe("comment_id = 'c1' && user_id = 'u1'");
      return [{ id: "v1" }];
    });
    const del = vi.fn(async () => true);
    const pb = mockPb({ opinion_votes: { getFullList, delete: del } });
    await unvoteOpinion(pb, "c1");
    expect(del).toHaveBeenCalledWith("v1");
  });
});

describe("opinionVoteCounts", () => {
  it("tallies votes per comment", async () => {
    const getFullList = vi.fn(async (_opts: { filter: string }) => [{ comment_id: "a" }, { comment_id: "a" }, { comment_id: "b" }]);
    const pb = mockPb({ opinion_votes: { getFullList } });
    expect(await opinionVoteCounts(pb, ["a", "b"])).toEqual({ a: 2, b: 1 });
    expect(getFullList.mock.calls[0][0]).toMatchObject({ filter: "(comment_id = 'a' || comment_id = 'b')" });
  });

  it("short-circuits with no ids", async () => {
    const pb = mockPb({});
    expect(await opinionVoteCounts(pb, [])).toEqual({});
  });
});

describe("myOpinionVotes", () => {
  it("returns the set of comment ids the user voted", async () => {
    const getFullList = vi.fn(async (opts: { filter: string }) => {
      expect(opts.filter).toContain("user_id = 'u1'");
      return [{ comment_id: "a" }];
    });
    const pb = mockPb({ opinion_votes: { getFullList } });
    const set = await myOpinionVotes(pb, ["a", "b"]);
    expect(set.has("a")).toBe(true);
    expect(set.has("b")).toBe(false);
  });

  it("returns empty when signed out", async () => {
    const pb = mockPb({}, null);
    expect((await myOpinionVotes(pb, ["a"])).size).toBe(0);
  });
});
