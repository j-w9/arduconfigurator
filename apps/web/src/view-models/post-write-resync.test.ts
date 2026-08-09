import { describe, expect, it } from 'vitest'

import { decidePostWriteResync } from './post-write-resync'

const base = { totalBefore: 1345, totalAfter: 1345, rebootRequiredCount: 0, appliedCount: 3 }

describe('decidePostWriteResync', () => {
  it('skips the re-sync when the table is the same size afterwards', () => {
    // The EK3_SRC case: several values written, no sub-tree opened, nothing to
    // discover. The writes are already verified by readback.
    expect(decidePostWriteResync(base)).toEqual({ resync: false, reason: 'table-unchanged' })
  })

  it('re-syncs when the write opened a sub-tree', () => {
    // The TCAL case: enabling an AP_PARAM_FLAG_ENABLE gate makes params appear
    // that the local snapshot has never seen, so the count rises.
    expect(decidePostWriteResync({ ...base, totalAfter: 1372 })).toEqual({
      resync: true,
      reason: 'table-changed'
    })
  })

  it('re-syncs when a write removed params too, not only when it added them', () => {
    // Disabling a subsystem hides its sub-tree; the stale entries must go.
    expect(decidePostWriteResync({ ...base, totalAfter: 1318 })).toEqual({
      resync: true,
      reason: 'table-changed'
    })
  })

  it('leaves a reboot-required batch to the reboot prompt', () => {
    // Unchanged behaviour: re-reading now would race the still-old firmware.
    expect(decidePostWriteResync({ ...base, rebootRequiredCount: 1, totalAfter: 1372 })).toEqual({
      resync: false,
      reason: 'awaiting-reboot'
    })
  })

  it('does nothing when no write was verified', () => {
    expect(decidePostWriteResync({ ...base, appliedCount: 0 })).toEqual({
      resync: false,
      reason: 'nothing-applied'
    })
  })

  it('falls back to re-syncing when the count is unknown', () => {
    // Skipping must never rest on a number we do not actually have; an unknown
    // total keeps the old always-refresh behaviour.
    expect(decidePostWriteResync({ ...base, totalBefore: 0 })).toEqual({
      resync: true,
      reason: 'total-unknown'
    })
    expect(decidePostWriteResync({ ...base, totalAfter: 0 })).toEqual({
      resync: true,
      reason: 'total-unknown'
    })
  })
})
