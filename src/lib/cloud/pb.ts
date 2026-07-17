import type PocketBase from "pocketbase";

/** The signed-in member's session, independent of the backing auth provider. */
export interface HiveSession {
  user: {
    id: string;
    email: string;
    /** Display name (defaults to the email prefix on first sign-in). */
    name: string | null;
  };
}

/** The current session from the client's auth store, or null when signed out. */
export function currentSession(pb: PocketBase): HiveSession | null {
  const r = pb.authStore.record;
  if (!pb.authStore.isValid || !r) return null;
  return {
    user: {
      id: r.id,
      email: (r.email as string | undefined) ?? "",
      name: (r.display_name as string | null | undefined) ?? null,
    },
  };
}

/** The signed-in user id, or null. Synchronous — PocketBase keeps it in the auth store. */
export function uid(pb: PocketBase): string | null {
  return pb.authStore.isValid ? (pb.authStore.record?.id ?? null) : null;
}

/** Quote + escape a value for a PocketBase filter expression. */
export function esc(value: string): string {
  return `'${String(value).replace(/'/g, "\\'")}'`;
}

/** `field = 'value'` filter clause. */
export function eq(field: string, value: string): string {
  return `${field} = ${esc(value)}`;
}

/** `field != 'value'` filter clause. */
export function neq(field: string, value: string): string {
  return `${field} != ${esc(value)}`;
}

/** OR-chain matching any of `values` (PocketBase has no IN operator). */
export function inList(field: string, values: string[]): string {
  return `(${values.map((v) => eq(field, v)).join(" || ")})`;
}

/** AND-combine non-empty clauses. */
export function and(...clauses: string[]): string {
  return clauses.filter(Boolean).join(" && ");
}

/** True for the "row already exists" failure of a create against a unique index. */
function isDuplicate(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { status?: number }).status === 400;
}

/** Create a record, treating a unique-constraint conflict as success (upsert-ish). */
export async function createIgnoringDuplicate(
  pb: PocketBase,
  collection: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await pb.collection(collection).create(data);
  } catch (e) {
    if (!isDuplicate(e)) throw e;
  }
}

/** Delete every record matching `filter` (PocketBase deletes by id only). */
export async function deleteWhere(pb: PocketBase, collection: string, filter: string): Promise<void> {
  const rows = await pb.collection(collection).getFullList({ filter, fields: "id" });
  for (const r of rows) await pb.collection(collection).delete(r.id);
}
