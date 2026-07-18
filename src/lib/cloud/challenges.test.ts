import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import {
  avgRating,
  judgeChallenge,
  listChallenges,
  listReviews,
  pickOpenChallenge,
  postChallenge,
  reviewSubmission,
  submitSolution,
  type Challenge,
  type ChallengeSubmission,
} from "./challenges";

const challenge = (over: Partial<Challenge>): Challenge => ({
  id: "c1",
  poster_id: "u1",
  title: "t",
  brief: "b",
  category: "general",
  bounty: 10,
  deadline: "",
  objective_id: "",
  effort_mm: 0,
  impact: 0,
  status: "open",
  winner_id: "",
  winner_submission_id: "",
  created_at: "2026-07-18T00:00:00Z",
  updated_at: "2026-07-18T00:00:00Z",
  ...over,
});

describe("pickOpenChallenge", () => {
  const rows = [
    challenge({ id: "mine", poster_id: "me" }),
    challenge({ id: "entered" }),
    challenge({ id: "judged", status: "judged" }),
    challenge({ id: "code", category: "coding", created_at: "2026-07-18T02:00:00Z" }),
    challenge({ id: "old-general", created_at: "2026-07-17T00:00:00Z" }),
  ];

  it("skips my own, already-entered, and judged challenges; oldest first", () => {
    expect(pickOpenChallenge(rows, new Set(["entered"]), "me")?.id).toBe("old-general");
  });

  it("respects declared categories", () => {
    expect(pickOpenChallenge(rows, new Set(["entered"]), "me", ["coding"])?.id).toBe("code");
    expect(pickOpenChallenge(rows, new Set(["entered"]), "me", ["data"])).toBeNull();
  });

  it("never picks an expired challenge", () => {
    const now = new Date("2026-07-19T00:00:00Z");
    const expired = challenge({ id: "late", deadline: "2026-07-18T00:00:00Z", created_at: "2026-07-16T00:00:00Z" });
    expect(pickOpenChallenge([expired, ...rows], new Set(["entered"]), "me", undefined, now)?.id).toBe("old-general");
  });
});

describe("postChallenge", () => {
  it("creates an open challenge with the bounty", async () => {
    const create = vi.fn(async (_d: Record<string, unknown>) => ({ id: "c-new" }));
    const pb = mockPb({ challenges: { create } });
    const id = await postChallenge(pb, " 과제 ", " 설명 ", 50, "data");
    expect(id).toBe("c-new");
    expect(create).toHaveBeenCalledWith({
      poster_id: "u1",
      title: "과제",
      brief: "설명",
      category: "data",
      bounty: 50,
      deadline: "",
      status: "open",
    });
  });

  it("rejects non-positive or fractional bounties", async () => {
    await expect(postChallenge(mockPb({}), "t", "b", 0)).rejects.toThrow(/positive/i);
    await expect(postChallenge(mockPb({}), "t", "b", 1.5)).rejects.toThrow(/positive/i);
  });
});

describe("submitSolution", () => {
  it("creates my entry when I have none", async () => {
    const getList = vi.fn(async () => ({ items: [] }));
    const create = vi.fn(async (_d: Record<string, unknown>) => ({}));
    const pb = mockPb({ challenge_submissions: { getList, create } });
    await submitSolution(pb, "c1", " 풀이 ", { kind: "agent", label: "Codex" });
    expect(create).toHaveBeenCalledWith({
      challenge_id: "c1",
      user_id: "u1",
      author_kind: "agent",
      author_label: "Codex",
      body: "풀이",
    });
  });

  it("refines my existing entry instead of duplicating it", async () => {
    const getList = vi.fn(async () => ({ items: [{ id: "s9" }] }));
    const create = vi.fn();
    const update = vi.fn(async (_id: string, _d: Record<string, unknown>) => ({}));
    const pb = mockPb({ challenge_submissions: { getList, create, update } });
    await submitSolution(pb, "c1", "더 나은 풀이", { kind: "agent", label: "Codex" });
    expect(update).toHaveBeenCalledWith("s9", { body: "더 나은 풀이" });
    expect(create).not.toHaveBeenCalled();
  });
});

describe("judgeChallenge", () => {
  it("marks the winner and closes the challenge", async () => {
    const update = vi.fn(async (_id: string, _d: Record<string, unknown>) => ({}));
    const pb = mockPb({ challenges: { update } });
    const sub = { id: "s1", user_id: "u2" } as ChallengeSubmission;
    await judgeChallenge(pb, "c1", sub);
    expect(update).toHaveBeenCalledWith("c1", {
      status: "judged",
      winner_id: "u2",
      winner_submission_id: "s1",
    });
  });
});

describe("reviews", () => {
  it("avgRating rounds to one decimal and is null without reviews", () => {
    expect(avgRating([])).toBeNull();
    expect(avgRating([{ rating: 4 }, { rating: 5 }, { rating: 4 }])).toBe(4.3);
  });

  it("listReviews short-circuits on no submissions and OR-filters ids", async () => {
    expect(await listReviews(mockPb({}), [])).toEqual([]);
    const getFullList = vi.fn(async (opts: { filter: string }) => {
      expect(opts.filter).toBe("(submission_id = 's1' || submission_id = 's2')");
      return [];
    });
    await listReviews(mockPb({ submission_reviews: { getFullList } }), ["s1", "s2"]);
    expect(getFullList).toHaveBeenCalled();
  });

  it("creates my review, or updates it when I already reviewed", async () => {
    const getList = vi.fn(async () => ({ items: [] }));
    const create = vi.fn(async (_d: Record<string, unknown>) => ({}));
    const pb = mockPb({ submission_reviews: { getList, create } });
    await reviewSubmission(pb, "s1", 4, " 근거가 탄탄함 ", { kind: "agent", label: "Codex" });
    expect(create).toHaveBeenCalledWith({
      submission_id: "s1",
      user_id: "u1",
      author_kind: "agent",
      author_label: "Codex",
      rating: 4,
      body: "근거가 탄탄함",
    });

    const update = vi.fn(async (_id: string, _d: Record<string, unknown>) => ({}));
    const pb2 = mockPb({
      submission_reviews: { getList: vi.fn(async () => ({ items: [{ id: "r9" }] })), create, update },
    });
    await reviewSubmission(pb2, "s1", 5, "수정", { kind: "agent", label: "Codex" });
    expect(update).toHaveBeenCalledWith("r9", { rating: 5, body: "수정" });
  });

  it("rejects out-of-range ratings and empty bodies", async () => {
    await expect(reviewSubmission(mockPb({}), "s1", 0, "x", { kind: "human", label: "" })).rejects.toThrow(/1-5/);
    await expect(reviewSubmission(mockPb({}), "s1", 6, "x", { kind: "human", label: "" })).rejects.toThrow(/1-5/);
    await expect(reviewSubmission(mockPb({}), "s1", 3, "  ", { kind: "human", label: "" })).rejects.toThrow(/empty/i);
  });
});

describe("listChallenges", () => {
  it("joins the poster and floats open challenges to the top", async () => {
    const getList = vi.fn(async () => ({
      items: [
        { id: "done", status: "judged", expand: { poster_id: { display_name: "Kim" } } },
        { id: "live", status: "open" },
      ],
    }));
    const pb = mockPb({ challenges: { getList } });
    const out = await listChallenges(pb);
    expect(out.map((c) => c.id)).toEqual(["live", "done"]);
    expect(out[1].poster).toEqual({ display_name: "Kim" });
  });
});
