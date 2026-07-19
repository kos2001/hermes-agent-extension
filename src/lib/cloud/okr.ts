import type PocketBase from "pocketbase";
import { eq, uid } from "./pb";

/**
 * OKR layer: long-term objectives with measurable key results, plus a
 * value formula for work items — value density = impact ÷ effort_mm
 * ("impact per man-month"), the single number used to rank tasks.
 */
export interface Objective {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  period: string;
  status: "active" | "done" | "dropped";
  created_at: string;
  updated_at: string;
  owner?: { display_name: string | null };
}

export interface KeyResult {
  id: string;
  objective_id: string;
  title: string;
  unit: string;
  target: number;
  current: number;
  created_at: string;
  updated_at: string;
}

/** One KR's progress in [0,1]. Pure. */
export function krProgress(kr: Pick<KeyResult, "target" | "current">): number {
  if (kr.target <= 0) return 0;
  return Math.min(1, Math.max(0, (kr.current || 0) / kr.target));
}

/** An objective's progress = mean of its KRs' progress, [0,1]. Pure. */
export function objectiveProgress(krs: Pick<KeyResult, "target" | "current">[]): number {
  if (!krs.length) return 0;
  return krs.reduce((s, kr) => s + krProgress(kr), 0) / krs.length;
}

/**
 * Value density of a work item: impact ÷ effort_mm, rounded to one decimal
 * ("how much impact per man-month"). Null when either input is missing —
 * unvalued work sorts last, it doesn't fake a score. Pure.
 */
export function valueScore(impact: number | null | undefined, effortMm: number | null | undefined): number | null {
  if (!impact || !effortMm || effortMm <= 0) return null;
  return Math.round((impact / effortMm) * 10) / 10;
}

/** Objectives, active first then newest, with the owner joined. */
export async function listObjectives(pb: PocketBase, status?: Objective["status"]): Promise<Objective[]> {
  const result = await pb.collection("objectives").getList(1, 50, {
    sort: "-created_at",
    expand: "owner_id",
    ...(status ? { filter: eq("status", status) } : {}),
  });
  const rows = result.items.map((row) => {
    const { expand, ...o } = row as Record<string, unknown> & {
      expand?: { owner_id?: { display_name: string | null } };
    };
    return { ...o, owner: { display_name: expand?.owner_id?.display_name ?? null } } as Objective;
  });
  return rows.sort((a, b) => (a.status === b.status ? 0 : a.status === "active" ? -1 : 1));
}

/** All key results of one objective, oldest first. */
export async function listKeyResults(pb: PocketBase, objectiveId: string): Promise<KeyResult[]> {
  return (await pb
    .collection("key_results")
    .getFullList({ filter: eq("objective_id", objectiveId), sort: "created_at" })) as unknown as KeyResult[];
}

/** Create a long-term objective; returns its id. */
export async function createObjective(pb: PocketBase, title: string, description: string, period: string): Promise<string> {
  const cleanTitle = title.trim();
  if (!cleanTitle) throw new Error("Title must not be empty");
  const userId = uid(pb);
  if (!userId) throw new Error("Must be signed in");
  const created = await pb.collection("objectives").create({
    owner_id: userId,
    title: cleanTitle,
    description: description.trim(),
    period: period.trim(),
    status: "active",
  });
  return created.id;
}

/** Add a measurable key result (owner only — server-enforced). */
export async function addKeyResult(pb: PocketBase, objectiveId: string, title: string, target: number, unit: string): Promise<void> {
  const cleanTitle = title.trim();
  if (!cleanTitle) throw new Error("Title must not be empty");
  if (!(target > 0)) throw new Error("Target must be positive");
  await pb.collection("key_results").create({
    objective_id: objectiveId,
    title: cleanTitle,
    unit: unit.trim(),
    target,
    current: 0,
  });
}

/** Report progress: set a KR's current value (owner only — server-enforced). */
export async function updateKeyResult(pb: PocketBase, krId: string, current: number): Promise<void> {
  if (!(current >= 0)) throw new Error("Current must be >= 0");
  await pb.collection("key_results").update(krId, { current });
}

/** Close out an objective (owner only — server-enforced). */
export async function setObjectiveStatus(pb: PocketBase, objectiveId: string, status: Objective["status"]): Promise<void> {
  await pb.collection("objectives").update(objectiveId, { status });
}
