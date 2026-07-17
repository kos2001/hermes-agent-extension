import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import { listCommunityMessages, sendCommunityMessage } from "./community-chat";

describe("listCommunityMessages", () => {
  it("flattens the expanded poster into author", async () => {
    const items = [
      {
        id: "m1",
        community_id: "c1",
        user_id: "u1",
        author_kind: "human",
        body: "hi",
        created_at: "t",
        expand: { user_id: { display_name: "Kim", avatar_url: null } },
      },
    ];
    const getList = vi.fn(async (_p: number, _l: number, opts: { filter: string; sort: string; expand: string }) => {
      expect(opts).toMatchObject({ filter: "community_id = 'c1'", sort: "created_at", expand: "user_id" });
      return { items };
    });
    const pb = mockPb({ community_messages: { getList } });
    const out = await listCommunityMessages(pb, "c1");
    expect(out[0]).toMatchObject({ id: "m1", author: { display_name: "Kim" } });
    expect((out[0] as unknown as { expand?: unknown }).expand).toBeUndefined();
  });
});

describe("sendCommunityMessage", () => {
  it("creates a trimmed message from the current user", async () => {
    const create = vi.fn(async (r: unknown) => r);
    const pb = mockPb({ community_messages: { create } });
    await sendCommunityMessage(pb, "c1", "  hey  ");
    expect(create).toHaveBeenCalledWith({ community_id: "c1", user_id: "u1", body: "hey" });
  });

  it("rejects empty and signed-out", async () => {
    await expect(sendCommunityMessage(mockPb({}), "c1", "  ")).rejects.toThrow(/empty/i);
    await expect(sendCommunityMessage(mockPb({}, null), "c1", "hi")).rejects.toThrow(/signed in/i);
  });
});
