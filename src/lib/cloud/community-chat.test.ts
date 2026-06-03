import { describe, expect, it, vi } from "vitest";
import { listCommunityMessages, sendCommunityMessage } from "./community-chat";

describe("listCommunityMessages", () => {
  it("flattens the joined poster into author", async () => {
    const rows = [
      { id: "m1", community_id: "c1", user_id: "u1", author_kind: "human", body: "hi", created_at: "t", profiles: { display_name: "Kim", avatar_url: null } },
    ];
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ order: vi.fn(() => ({ limit: vi.fn(async () => ({ data: rows, error: null })) })) })),
        })),
      })),
    };
    const out = await listCommunityMessages(client as never, "c1");
    expect(out[0]).toMatchObject({ id: "m1", author: { display_name: "Kim" } });
    expect((out[0] as unknown as { profiles?: unknown }).profiles).toBeUndefined();
  });
});

describe("sendCommunityMessage", () => {
  it("inserts a trimmed message from the current user", async () => {
    let inserted: unknown = null;
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) },
      from: vi.fn(() => ({ insert: vi.fn(async (r: unknown) => ((inserted = r), { error: null })) })),
    };
    await sendCommunityMessage(client as never, "c1", "  hey  ");
    expect(inserted).toEqual({ community_id: "c1", user_id: "u1", body: "hey" });
  });

  it("rejects empty and signed-out", async () => {
    const signedIn = { auth: { getUser: vi.fn(async () => ({ data: { user: { id: "u1" } } })) }, from: vi.fn() };
    await expect(sendCommunityMessage(signedIn as never, "c1", "  ")).rejects.toThrow(/empty/i);
    const out = { auth: { getUser: vi.fn(async () => ({ data: { user: null } })) }, from: vi.fn() };
    await expect(sendCommunityMessage(out as never, "c1", "hi")).rejects.toThrow(/signed in/i);
  });
});
