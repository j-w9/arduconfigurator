// Whether a verified batch write needs the whole parameter table pulled again.
//
// Re-syncing ~1300 params over MAVLink is the slowest thing the Apply path does,
// and most batches do not need it. Writes are already verified individually —
// each PARAM_SET is confirmed by its PARAM_VALUE echo — so the written values
// are known to be correct without any re-read. What a re-sync catches is a write
// that changed the parameter TABLE ITSELF: ArduPilot hides a sub-tree behind an
// AP_PARAM_FLAG_ENABLE gate, so enabling one makes params appear that the local
// snapshot has never seen.
//
// The firmware tells us when that happened, which is better than us guessing
// from a curated list. Writing an enable-flagged param calls
// AP_Param::invalidate_count() (GCS_Param.cpp handle_param_set), and every
// PARAM_VALUE carries AP_Param::count_parameters(), which recomputes
// synchronously when the marker moved. So the echo of the very write that opened
// a sub-tree already reports the new total.
//
// Note this detects a change in table SIZE, not a side effect on some other
// param's value. That is the deliberate trade: the params actually written are
// verified by readback either way.

export interface PostWriteResyncInput {
  /** FC-reported parameter total before the batch. 0 when not yet known. */
  totalBefore: number
  /** FC-reported parameter total after the batch. 0 when not yet known. */
  totalAfter: number
  /** How many written params are marked reboot-required. */
  rebootRequiredCount: number
  /** How many writes were actually verified. */
  appliedCount: number
}

export type PostWriteResyncDecision =
  | { resync: false; reason: 'nothing-applied' | 'awaiting-reboot' | 'table-unchanged' }
  | { resync: true; reason: 'table-changed' | 'total-unknown' }

export function decidePostWriteResync(input: PostWriteResyncInput): PostWriteResyncDecision {
  if (input.appliedCount === 0) {
    return { resync: false, reason: 'nothing-applied' }
  }
  if (input.rebootRequiredCount > 0) {
    // Unchanged from before: re-reading now would race the still-old running
    // firmware, so the operator is asked to reboot and refresh instead.
    return { resync: false, reason: 'awaiting-reboot' }
  }
  if (input.totalBefore <= 0 || input.totalAfter <= 0) {
    // No usable count to compare — fall back to the old always-refresh
    // behaviour rather than skip on the strength of a number we do not have.
    return { resync: true, reason: 'total-unknown' }
  }
  if (input.totalBefore !== input.totalAfter) {
    return { resync: true, reason: 'table-changed' }
  }
  return { resync: false, reason: 'table-unchanged' }
}
