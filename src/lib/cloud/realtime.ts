import type PocketBase from "pocketbase";

/** A column-equals-value predicate applied client-side to realtime events. */
export interface RealtimeFilter {
  column: string;
  value: string;
}

export function eqFilter(column: string, value: string): RealtimeFilter {
  return { column, value };
}

/**
 * Subscribe to record creations in a collection (optionally filtered) and
 * invoke `cb` on each. Returns an unsubscribe function. API rules apply, so
 * only readable records arrive.
 */
export function onTableInserts(
  pb: PocketBase,
  collection: string,
  filter: RealtimeFilter | undefined,
  cb: () => void,
): () => void {
  let unsub: (() => void) | null = null;
  let cancelled = false;
  pb.collection(collection)
    .subscribe("*", (e) => {
      if (e.action !== "create") return;
      if (filter && String((e.record as Record<string, unknown>)[filter.column]) !== filter.value) return;
      cb();
    })
    .then((u) => {
      if (cancelled) u();
      else unsub = u;
    })
    .catch(() => {
      // realtime unavailable — the app still works, just without live refresh
    });
  return () => {
    cancelled = true;
    if (unsub) void unsub();
  };
}
