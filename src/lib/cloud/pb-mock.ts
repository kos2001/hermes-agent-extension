import { vi } from "vitest";
import type PocketBase from "pocketbase";

/**
 * Minimal PocketBase client fake for unit tests: `authStore` reflects the
 * given user id and `collection(name)` returns the api stub registered for
 * that collection (throwing on unexpected names, like the real server would 404).
 */
export function mockPb(
  collections: Record<string, Record<string, unknown>>,
  userId: string | null = "u1",
): PocketBase {
  return {
    authStore: { isValid: userId !== null, record: userId ? { id: userId } : null },
    collection: vi.fn((name: string) => {
      const api = collections[name];
      if (!api) throw new Error(`unexpected collection ${name}`);
      return api;
    }),
  } as unknown as PocketBase;
}
