import type { SupabaseClient } from "@supabase/supabase-js";

/** PostgREST/realtime equality filter string, e.g. `folder_id=eq.<id>`. */
export function eqFilter(column: string, value: string): string {
  return `${column}=eq.${value}`;
}

let channelSeq = 0;

/**
 * Subscribe to INSERTs on a table (optionally filtered) and invoke `cb` on each.
 * Returns an unsubscribe function. RLS applies, so only readable rows arrive.
 * Requires the table to be in the `supabase_realtime` publication (migration
 * 0009) and Realtime enabled on the project.
 */
export function onTableInserts(
  sb: SupabaseClient,
  table: string,
  filter: string | undefined,
  cb: () => void,
): () => void {
  const channel = sb
    .channel(`rt-${table}-${channelSeq++}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table, ...(filter ? { filter } : {}) },
      () => cb(),
    )
    .subscribe();
  return () => {
    void sb.removeChannel(channel);
  };
}
