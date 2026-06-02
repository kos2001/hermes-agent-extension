import { describe, expect, it, vi } from "vitest";
import { extractMentionTokens, postMentions, resolveMentions } from "./mentions";

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
  it("upserts a row per mentioned user, excluding self", async () => {
    let rows: unknown = null;
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "me" } } })) },
      from: vi.fn(() => ({ upsert: vi.fn(async (r: unknown) => ((rows = r), { error: null })) })),
    };
    await postMentions(client as never, "c1", ["u1", "me", "u2"]);
    expect(rows).toEqual([
      { comment_id: "c1", mentioned_user: "u1", by_user: "me" },
      { comment_id: "c1", mentioned_user: "u2", by_user: "me" },
    ]);
  });

  it("no-ops on empty / self-only", async () => {
    const client = { auth: { getUser: vi.fn(async () => ({ data: { user: { id: "me" } } })) }, from: vi.fn() };
    await postMentions(client as never, "c1", []);
    await postMentions(client as never, "c1", ["me"]);
    expect(client.from).not.toHaveBeenCalled();
  });
});
