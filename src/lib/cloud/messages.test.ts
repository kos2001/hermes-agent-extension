import { describe, expect, it, vi } from "vitest";
import { buildConversations, sendMessage } from "./messages";
import type { DirectMessage } from "./types";

function dm(over: Partial<DirectMessage>): DirectMessage {
  return {
    id: Math.random().toString(36),
    sender_id: "x",
    recipient_id: "me",
    body: "hi",
    created_at: "2026-01-01T00:00:00Z",
    read_at: null,
    ...over,
  };
}

describe("buildConversations", () => {
  it("groups by counterpart with last message + unread, newest first", () => {
    const msgs: DirectMessage[] = [
      dm({ sender_id: "a", recipient_id: "me", body: "hello from a", created_at: "2026-01-01T01:00:00Z" }),
      dm({ sender_id: "me", recipient_id: "a", body: "reply to a", created_at: "2026-01-01T02:00:00Z", read_at: "x" }),
      dm({ sender_id: "b", recipient_id: "me", body: "newer from b", created_at: "2026-01-01T03:00:00Z" }),
    ];
    const convos = buildConversations(msgs, "me");
    expect(convos.map((c) => c.otherId)).toEqual(["b", "a"]); // b newer
    const a = convos.find((c) => c.otherId === "a")!;
    expect(a.lastBody).toBe("reply to a"); // latest in the pair
    expect(a.unread).toBe(1); // the unread "hello from a"
    expect(convos.find((c) => c.otherId === "b")!.unread).toBe(1);
  });

  it("counts only unread messages addressed to me", () => {
    const msgs = [
      dm({ sender_id: "me", recipient_id: "a", read_at: null }), // mine, not unread-to-me
      dm({ sender_id: "a", recipient_id: "me", read_at: "seen" }), // read
    ];
    expect(buildConversations(msgs, "me")[0].unread).toBe(0);
  });
});

describe("sendMessage", () => {
  it("inserts a message from me to the recipient", async () => {
    let inserted: unknown = null;
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "me" } } })) },
      from: vi.fn(() => ({ insert: vi.fn(async (r: unknown) => ((inserted = r), { error: null })) })),
    };
    await sendMessage(client as never, "other", "  hey  ");
    expect(inserted).toEqual({ sender_id: "me", recipient_id: "other", body: "hey" });
  });

  it("rejects empty body and self-messaging", async () => {
    const client = {
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: "me" } } })) },
      from: vi.fn(),
    };
    await expect(sendMessage(client as never, "other", "  ")).rejects.toThrow(/empty/i);
    await expect(sendMessage(client as never, "me", "hi")).rejects.toThrow(/yourself/i);
  });
});
