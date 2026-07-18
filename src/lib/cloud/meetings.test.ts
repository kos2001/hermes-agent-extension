import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import { conclude, convene, listMeetings, listTurns, shouldSpeak, speak } from "./meetings";

describe("shouldSpeak", () => {
  it("speaks into silence and after others, but never twice in a row", () => {
    expect(shouldSpeak([], "me")).toBe(true);
    expect(shouldSpeak([{ user_id: "other" }], "me")).toBe(true);
    expect(shouldSpeak([{ user_id: "me" }, { user_id: "other" }], "me")).toBe(true);
    expect(shouldSpeak([{ user_id: "other" }, { user_id: "me" }], "me")).toBe(false);
  });
});

describe("listMeetings", () => {
  it("joins the convener and floats open meetings to the top", async () => {
    const getList = vi.fn(async (_p: number, _l: number, opts: { sort: string; expand: string }) => {
      expect(opts).toMatchObject({ sort: "-created_at", expand: "convener_id" });
      return {
        items: [
          { id: "m-done", status: "concluded", expand: { convener_id: { display_name: "Kim" } } },
          { id: "m-open", status: "open" },
        ],
      };
    });
    const pb = mockPb({ meetings: { getList } });
    const out = await listMeetings(pb);
    expect(out.map((m) => m.id)).toEqual(["m-open", "m-done"]);
    expect(out[1].convener).toEqual({ display_name: "Kim" });
  });

  it("filters by status when asked", async () => {
    const getList = vi.fn(async (_p: number, _l: number, opts: { filter?: string }) => {
      expect(opts.filter).toBe("status = 'open'");
      return { items: [] };
    });
    await listMeetings(mockPb({ meetings: { getList } }), "open");
  });
});

describe("listTurns", () => {
  it("reads a meeting's turns oldest-first", async () => {
    const getFullList = vi.fn(async (opts: { filter: string; sort: string }) => {
      expect(opts).toEqual({ filter: "meeting_id = 'm1'", sort: "created_at" });
      return [];
    });
    await listTurns(mockPb({ meeting_turns: { getFullList } }), "m1");
    expect(getFullList).toHaveBeenCalled();
  });
});

describe("convene / speak / conclude", () => {
  it("convene creates an open meeting from the current user", async () => {
    const create = vi.fn(async (_d: Record<string, unknown>) => ({ id: "m-new" }));
    const pb = mockPb({ meetings: { create } });
    const id = await convene(pb, " 제목 ", " 안건 ");
    expect(id).toBe("m-new");
    expect(create).toHaveBeenCalledWith({ convener_id: "u1", title: "제목", agenda: "안건", status: "open" });
  });

  it("speak posts one turn as the current user", async () => {
    const create = vi.fn(async (_d: Record<string, unknown>) => ({}));
    const pb = mockPb({ meeting_turns: { create } });
    await speak(pb, "m1", " 의견 ", { kind: "agent", label: "Claude Code" });
    expect(create).toHaveBeenCalledWith({
      meeting_id: "m1",
      user_id: "u1",
      author_kind: "agent",
      author_label: "Claude Code",
      body: "의견",
    });
  });

  it("conclude closes the meeting with the summary", async () => {
    const update = vi.fn(async (_id: string, _d: Record<string, unknown>) => ({}));
    const pb = mockPb({ meetings: { update } });
    await conclude(pb, "m1", "결론입니다");
    expect(update).toHaveBeenCalledWith("m1", { status: "concluded", conclusion: "결론입니다" });
  });

  it("rejects empties and signed-out writes", async () => {
    await expect(convene(mockPb({}), " ", "a")).rejects.toThrow(/empty/i);
    await expect(convene(mockPb({}, null), "t", "a")).rejects.toThrow(/signed in/i);
    await expect(speak(mockPb({}), "m1", "  ", { kind: "human", label: "" })).rejects.toThrow(/empty/i);
    await expect(conclude(mockPb({}), "m1", " ")).rejects.toThrow(/empty/i);
  });
});
