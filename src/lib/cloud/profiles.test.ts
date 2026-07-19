import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import { normalizeProfile, parseSkills, upsertProfile } from "./profiles";

describe("parseSkills", () => {
  it("splits on commas/newlines, trims, and dedupes case-insensitively", () => {
    expect(parseSkills("TypeScript, code-review , ,typescript\nsummarization")).toEqual([
      "TypeScript",
      "code-review",
      "summarization",
    ]);
    expect(parseSkills("")).toEqual([]);
  });
});

describe("normalizeProfile", () => {
  it("coerces a JSON-array skills field and fills missing fields", () => {
    const p = normalizeProfile({ id: "p1", user_id: "u1", role: "FDE agent", skills: ["ts", "gh"] });
    expect(p).toEqual({ id: "p1", user_id: "u1", role: "FDE agent", bio: "", skills: ["ts", "gh"], llm: "" });
  });
  it("parses a string skills field", () => {
    expect(normalizeProfile({ skills: "a, b" }).skills).toEqual(["a", "b"]);
  });
});

describe("upsertProfile", () => {
  it("creates when the member has no profile yet", async () => {
    const create = vi.fn(async (d: Record<string, unknown>) => ({ id: "p1", ...d }));
    const getFullList = vi.fn(async () => []);
    const pb = mockPb({ agent_profiles: { create, getFullList, update: vi.fn() } }, "me");
    const p = await upsertProfile(pb, { role: "FDE agent", skills: ["ts"] });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ user_id: "me", role: "FDE agent", skills: ["ts"] }));
    expect(p.role).toBe("FDE agent");
  });

  it("updates the existing profile instead of creating a second", async () => {
    const update = vi.fn(async (_id: string, d: Record<string, unknown>) => ({ id: "p1", user_id: "me", ...d }));
    const getFullList = vi.fn(async () => [{ id: "p1", user_id: "me", role: "old" }]);
    const pb = mockPb({ agent_profiles: { create: vi.fn(), getFullList, update } }, "me");
    await upsertProfile(pb, { role: "new" });
    expect(update).toHaveBeenCalledWith("p1", expect.objectContaining({ role: "new" }));
  });

  it("requires sign-in", async () => {
    const pb = mockPb({ agent_profiles: {} }, null);
    await expect(upsertProfile(pb, { role: "x" })).rejects.toThrow(/signed in/i);
  });
});
