import { describe, expect, it } from 'vitest'

import type { ParameterState } from '@arduconfig/ardupilot-core'
import { buildProposalReview, resolveWriteBlockReason } from './ai-assistant-proposal'

const param = (id: string, value: number, definition?: Partial<ParameterState['definition']>): ParameterState => ({
  id,
  value,
  index: 0,
  count: 1,
  definition: definition ? { id, label: id, description: '', category: 'tuning', ...definition } : undefined
})

const params: ParameterState[] = [
  param('ATC_RAT_PIT_P', 0.135, { label: 'Pitch P Gain', minimum: 0, maximum: 1.5 }),
  param('BATT_LOW_VOLT', 14.0, { label: 'Low battery voltage', unit: 'V', minimum: 0, maximum: 60 }),
  param('COMPASS_USE', 1, { label: 'Use compass', options: [{ value: 0, label: 'Off' }, { value: 1, label: 'On' }] })
]

describe('buildProposalReview', () => {
  it('stages an in-range change with its delta and the model reason', () => {
    const review = buildProposalReview(params, [{ paramId: 'ATC_RAT_PIT_P', value: 0.145, reason: 'crisper pitch' }])
    expect(review.stagedCount).toBe(1)
    expect(review.invalidCount).toBe(0)
    expect(review.canApply).toBe(true)
    const entry = review.entries[0]
    expect(entry.currentValue).toBe(0.135)
    expect(entry.nextValue).toBe(0.145)
    expect(entry.why).toBe('crisper pitch')
    expect(entry.unit).toBeUndefined()
  })

  it('flags an out-of-range change invalid and blocks apply', () => {
    const review = buildProposalReview(params, [{ paramId: 'ATC_RAT_PIT_P', value: 9.9 }])
    expect(review.invalidCount).toBe(1)
    expect(review.canApply).toBe(false)
    expect(review.entries[0].status).toBe('invalid')
    expect(review.entries[0].reason).toMatch(/maximum/i)
  })

  it('flags an unknown parameter invalid', () => {
    const review = buildProposalReview(params, [{ paramId: 'NOPE_PARAM', value: 1 }])
    expect(review.invalidCount).toBe(1)
    expect(review.canApply).toBe(false)
    expect(review.entries[0].reason).toMatch(/not present/i)
  })

  it('flags an enum-mismatch invalid', () => {
    const review = buildProposalReview(params, [{ paramId: 'COMPASS_USE', value: 5 }])
    expect(review.invalidCount).toBe(1)
    expect(review.canApply).toBe(false)
  })

  it('marks a no-op change unchanged and does not allow apply on it alone', () => {
    const review = buildProposalReview(params, [{ paramId: 'BATT_LOW_VOLT', value: 14.0 }])
    expect(review.unchangedCount).toBe(1)
    expect(review.stagedCount).toBe(0)
    expect(review.canApply).toBe(false)
  })

  it('blocks apply if any single change is invalid, even alongside valid ones', () => {
    const review = buildProposalReview(params, [
      { paramId: 'ATC_RAT_PIT_P', value: 0.145 },
      { paramId: 'BATT_LOW_VOLT', value: 999 }
    ])
    expect(review.stagedCount).toBe(1)
    expect(review.invalidCount).toBe(1)
    expect(review.canApply).toBe(false)
  })

  it('carries the unit through for display', () => {
    const review = buildProposalReview(params, [{ paramId: 'BATT_LOW_VOLT', value: 13.5 }])
    expect(review.entries[0].unit).toBe('V')
  })
})

describe('resolveWriteBlockReason', () => {
  it('blocks when disconnected', () => {
    expect(resolveWriteBlockReason({ connectionKind: 'disconnected', armed: false, syncStatus: 'complete' })).toMatch(/Connect/)
  })
  it('blocks when armed', () => {
    expect(resolveWriteBlockReason({ connectionKind: 'connected', armed: true, syncStatus: 'complete' })).toMatch(/disarm/i)
  })
  it('blocks when sync incomplete', () => {
    expect(resolveWriteBlockReason({ connectionKind: 'connected', armed: false, syncStatus: 'streaming' })).toMatch(/download/i)
  })
  it('allows when connected, disarmed, and synced', () => {
    expect(resolveWriteBlockReason({ connectionKind: 'connected', armed: false, syncStatus: 'complete' })).toBeUndefined()
  })
})
