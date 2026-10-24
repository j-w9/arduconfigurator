import { describe, expect, it } from 'vitest'

import { LOG_BITMASK_RAW_IMU_BIT, buildTuningLogSetupPlan } from './tuning-log-setup'

describe('buildTuningLogSetupPlan', () => {
  it('stages the batch mask, pre-filter options and the Raw IMU bit on a stock board', () => {
    const plan = buildTuningLogSetupPlan({ batchMask: 0, batchOptions: 0, logBitmask: 0xfffb })
    expect(plan.drafts).toEqual({ INS_LOG_BAT_MASK: '1', LOG_BITMASK: String((0xfffb | (1 << LOG_BITMASK_RAW_IMU_BIT)) >>> 0) })
    expect(plan.steps).toEqual(['batch-log the first IMU', 'turn on the Raw IMU log bit'])
    expect(plan.rebootNeeded).toBe(true)
  })

  it('leaves a board that is already set up alone', () => {
    const plan = buildTuningLogSetupPlan({ batchMask: 1, batchOptions: 0, logBitmask: 1 << LOG_BITMASK_RAW_IMU_BIT })
    expect(plan.drafts).toEqual({})
    expect(plan.rebootNeeded).toBe(false)
  })

  it('clears post-filter options so the samples are pre-filter, without touching a set mask', () => {
    const plan = buildTuningLogSetupPlan({ batchMask: 2, batchOptions: 2, logBitmask: 1 << LOG_BITMASK_RAW_IMU_BIT })
    expect(plan.drafts).toEqual({ INS_LOG_BAT_OPT: '0' })
    expect(plan.rebootNeeded).toBe(false)
  })
})
