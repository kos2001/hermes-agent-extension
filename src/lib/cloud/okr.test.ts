import { describe, expect, it, vi } from "vitest";
import { mockPb } from "./pb-mock";
import {
  addKeyResult,
  createObjective,
  krProgress,
  listObjectives,
  objectiveProgress,
  updateKeyResult,
  valueScore,
} from "./okr";

describe("progress math", () => {
  it("krProgress clamps to [0,1] and survives zero targets", () => {
    expect(krProgress({ target: 10, current: 5 })).toBe(0.5);
    expect(krProgress({ target: 10, current: 15 })).toBe(1);
    expect(krProgress({ target: 10, current: 0 })).toBe(0);
    expect(krProgress({ target: 0, current: 5 })).toBe(0);
  });

  it("objectiveProgress averages KRs (0 without any)", () => {
    expect(objectiveProgress([])).toBe(0);
    expect(
      objectiveProgress([
        { target: 10, current: 10 },
        { target: 4, current: 1 },
      ]),
    ).toBe(0.625);
  });
});

describe("valueScore (impact ÷ effort_mm)", () => {
  it("computes impact per man-month, one decimal", () => {
    expect(valueScore(7, 0.5)).toBe(14);
    expect(valueScore(8, 3)).toBe(2.7);
  });

  it("is null for unvalued work — no fake scores", () => {
    expect(valueScore(null, 1)).toBeNull();
    expect(valueScore(5, 0)).toBeNull();
    expect(valueScore(undefined, undefined)).toBeNull();
  });
});

describe("objectives api", () => {
  it("creates an active objective from the current user", async () => {
    const create = vi.fn(async (_d: Record<string, unknown>) => ({ id: "o-new" }));
    const pb = mockPb({ objectives: { create } });
    const id = await createObjective(pb, " 에이전트 자동화 ", " 설명 ", " 2026 H2 ");
    expect(id).toBe("o-new");
    expect(create).toHaveBeenCalledWith({
      owner_id: "u1",
      title: "에이전트 자동화",
      description: "설명",
      period: "2026 H2",
      status: "active",
    });
  });

  it("floats active objectives to the top", async () => {
    const getList = vi.fn(async () => ({
      items: [
        { id: "done", status: "done", expand: { owner_id: { display_name: "Kim" } } },
        { id: "live", status: "active" },
      ],
    }));
    const out = await listObjectives(mockPb({ objectives: { getList } }));
    expect(out.map((o) => o.id)).toEqual(["live", "done"]);
  });

  it("KRs start at 0 and report progress via current", async () => {
    const create = vi.fn(async (_d: Record<string, unknown>) => ({}));
    const update = vi.fn(async (_id: string, _d: Record<string, unknown>) => ({}));
    const pb = mockPb({ key_results: { create, update } });
    await addKeyResult(pb, "o1", "가입 에이전트 수", 20, "명");
    expect(create).toHaveBeenCalledWith({ objective_id: "o1", title: "가입 에이전트 수", unit: "명", target: 20, current: 0 });
    await updateKeyResult(pb, "kr1", 7);
    expect(update).toHaveBeenCalledWith("kr1", { current: 7 });
    await expect(addKeyResult(pb, "o1", "x", 0, "")).rejects.toThrow(/positive/i);
    await expect(updateKeyResult(pb, "kr1", -1)).rejects.toThrow(/>= 0/);
  });
});
