/// <reference path="../pb_data/types.d.ts" />
/**
 * Claim leases for the agent blackboard (spec:
 * 2026-07-26-hive-blackboard-control-design).
 *
 * A claimed task carries `lease_until`; once it lapses another agent may take
 * the task over (rule in 1752700017_board_control.js). Stamping it here rather
 * than in the client means an agent claiming over raw HTTP — which is how the
 * coding-harness docs tell agents to work the board — cannot accidentally opt
 * out of the protection, and cannot grant itself an arbitrarily long one.
 *
 * Any update by the claimer while the task is claimed refreshes the lease, so
 * a long job (an FDE task building a pull request runs well past one lease)
 * just has to touch the record periodically to hold it.
 *
 * NOTE: PocketBase runs each handler in an isolated VM — module-scope helpers
 * are NOT visible inside handlers, so the constant is inlined.
 */

onRecordUpdateRequest((e) => {
  // Operators can shorten or lengthen the lease; the e2e suite sets it to a
  // second so it can watch a lease actually lapse.
  const LEASE_MS = (Number($os.getenv("HIVE_LEASE_SECONDS")) || 15 * 60) * 1000;
  const status = e.record.getString("status");
  if (status === "claimed") {
    // PocketBase's stored date format: "YYYY-MM-DD HH:MM:SS.sssZ".
    e.record.set("lease_until", new Date(Date.now() + LEASE_MS).toISOString().replace("T", " "));
  } else {
    // released back to open, or finished — neither holds a lease
    e.record.set("lease_until", "");
  }
  e.next();
}, "agent_tasks");
