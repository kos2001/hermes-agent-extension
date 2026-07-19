import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import { activeMention, applyMention, extractMentionTokens, matchCandidates, pickMentionToAnswer, postMentions, resolveMentions, type AnswerableMention } from "./mentions";

describe("activeMention", () => {
  it("returns the partial token before the caret", () => {
    expect(activeMention("hey @ad", 7)).toBe("ad");
    expect(activeMention("@", 1)).toBe("");
  });
  it("is null when not in a mention", () => {
    expect(activeMention("hey @ad bo", 10)).toBeNull(); // space ended it
    expect(activeMention("plain", 5)).toBeNull();
  });
});

describe("applyMention", () => {
  it("replaces the active query with @name and a trailing space", () => {
    const r = applyMention("hey @ad", 7, "Ada");
    expect(r.text).toBe("hey @Ada ");
    expect(r.caret).toBe(9);
  });
  it("inserts mid-text and keeps the tail", () => {
    const r = applyMention("hi @a!", 5, "Ada"); // caret after 'a' (index 5)
    expect(r.text).toBe("hi @Ada !");
  });
});

describe("matchCandidates", () => {
  const cands = [
    { id: "1", name: "Ada" },
    { id: "2", name: "Adam" },
    { id: "3", name: "Bo" },
    { id: "4", name: "" },
  ];
  it("prefix/substring matches, skips empties, caps", () => {
    expect(matchCandidates("ad", cands).map((c) => c.id)).toEqual(["1", "2"]);
    expect(matchCandidates("", cands).map((c) => c.id)).toEqual(["1", "2", "3"]);
    expect(matchCandidates("ad", cands, 1).map((c) => c.id)).toEqual(["1"]);
  });
});

describe("extractMentionTokens", () => {
  it("finds unique @tokens", () => {
    expect(extractMentionTokens("hi @ada and @Bo, also @ada again")).toEqual(["ada", "Bo"]);
  });
  it("returns [] when none", () => {
    expect(extractMentionTokens("no mentions here")).toEqual([]);
  });
});

describe("resolveMentions", () => {
  const candidates = [
    { id: "u1", name: "Ada Lovelace" },
    { id: "u2", name: "김오석" },
  ];
  it("matches full name (case-insensitive) and first word", () => {
    expect(resolveMentions(["ada"], candidates)).toEqual(["u1"]); // first word
    expect(resolveMentions(["김오석"], candidates)).toEqual(["u2"]);
  });
  it("ignores unknown tokens and dedupes", () => {
    expect(resolveMentions(["ada", "nobody", "ada"], candidates)).toEqual(["u1"]);
  });
});

describe("postMentions", () => {
  it("creates a row per mentioned user, excluding self", async () => {
    const create = vi.fn(async (r: unknown) => r);
    const pb = mockPb({ mentions: { create } }, "me");
    await postMentions(pb, "c1", ["u1", "me", "u2"]);
    expect(create.mock.calls.map((c) => c[0])).toEqual([
      { comment_id: "c1", mentioned_user: "u1", by_user: "me" },
      { comment_id: "c1", mentioned_user: "u2", by_user: "me" },
    ]);
  });

  it("no-ops on empty / self-only", async () => {
    const create = vi.fn();
    const pb = mockPb({ mentions: { create } }, "me");
    await postMentions(pb, "c1", []);
    await postMentions(pb, "c1", ["me"]);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("pickMentionToAnswer", () => {
  const m = (comment_id: string, created: string): AnswerableMention => ({ comment_id, folder_id: "f1", created });

  it("returns the oldest mention I haven't replied to", () => {
    const mentions = [m("c-new", "2026-07-19T02:00:00Z"), m("c-old", "2026-07-19T01:00:00Z")];
    expect(pickMentionToAnswer(mentions, new Set())?.comment_id).toBe("c-old");
  });

  it("skips mentions whose comment I already replied to", () => {
    const mentions = [m("c-old", "2026-07-19T01:00:00Z"), m("c-new", "2026-07-19T02:00:00Z")];
    expect(pickMentionToAnswer(mentions, new Set(["c-old"]))?.comment_id).toBe("c-new");
  });

  it("returns null when every mention is answered", () => {
    const mentions = [m("c1", "2026-07-19T01:00:00Z")];
    expect(pickMentionToAnswer(mentions, new Set(["c1"]))).toBeNull();
    expect(pickMentionToAnswer([], new Set())).toBeNull();
  });
});
