import { describe, expect, it } from 'vitest'

import type { ParameterDraftEntry } from '@arduconfig/ardupilot-core'

import { orderDraftsByEnableGate } from './enable-gate-write-order'

// Minimal draft factory — only id + definition.enableGate matter to the sort.
function draft(id: string, enableGate = false): ParameterDraftEntry {
  return {
    id,
    status: 'staged',
    nextValue: 1,
    definition: enableGate ? { id, label: id, description: '', category: 'radio', enableGate: true } : undefined
  } as ParameterDraftEntry
}

const ids = (list: ParameterDraftEntry[]) => list.map((entry) => entry.id)

describe('orderDraftsByEnableGate', () => {
  it('leaves a batch with no enable-gate params untouched', () => {
    const input = [draft('ATC_RAT_RLL_P'), draft('ATC_RAT_RLL_I'), draft('INS_GYRO_FILTER')]
    expect(ids(orderDraftsByEnableGate(input))).toEqual(['ATC_RAT_RLL_P', 'ATC_RAT_RLL_I', 'INS_GYRO_FILTER'])
  })

  it('moves the RCL term FUNC gate ahead of its MIN/MAX/OPT/SRC dependents', () => {
    // The RC Mixer stages sub-params before FUNC — exactly the ordering that
    // times out because the term is still disabled when MIN/MAX are written.
    const input = [
      draft('RCL3_MIN'),
      draft('RCL3_MAX'),
      draft('RCL3_SRC'),
      draft('RCL3_FUNC', true),
      draft('RCL3_OPT')
    ]
    expect(ids(orderDraftsByEnableGate(input))).toEqual([
      'RCL3_FUNC',
      'RCL3_MIN',
      'RCL3_MAX',
      'RCL3_SRC',
      'RCL3_OPT'
    ])
  })

  it('keeps each gate ahead of its own dependents across two terms', () => {
    const input = [
      draft('RCL3_MIN'),
      draft('RCL4_MAX'),
      draft('RCL3_FUNC', true),
      draft('RCL4_FUNC', true),
      draft('RCL3_MAX'),
      draft('RCL4_MIN')
    ]
    const out = ids(orderDraftsByEnableGate(input))
    expect(out.indexOf('RCL3_FUNC')).toBeLessThan(out.indexOf('RCL3_MIN'))
    expect(out.indexOf('RCL3_FUNC')).toBeLessThan(out.indexOf('RCL3_MAX'))
    expect(out.indexOf('RCL4_FUNC')).toBeLessThan(out.indexOf('RCL4_MIN'))
    expect(out.indexOf('RCL4_FUNC')).toBeLessThan(out.indexOf('RCL4_MAX'))
  })

  it('does not confuse RCL1 with RCL10 (exact prefix, not substring)', () => {
    const input = [draft('RCL10_MIN'), draft('RCL1_FUNC', true), draft('RCL1_MAX')]
    const out = ids(orderDraftsByEnableGate(input))
    // RCL10_MIN is NOT a dependent of RCL1_FUNC, so it keeps its leading spot.
    expect(out).toEqual(['RCL10_MIN', 'RCL1_FUNC', 'RCL1_MAX'])
  })

  it('leaves a dependent alone when its gate is not part of this batch', () => {
    // FUNC already enabled on the FC (not staged) — MIN/MAX echo fine, no reorder.
    const input = [draft('RCL2_MIN'), draft('RCL2_MAX')]
    expect(ids(orderDraftsByEnableGate(input))).toEqual(['RCL2_MIN', 'RCL2_MAX'])
  })

  it('preserves the relative order of unrelated params outside the gate group', () => {
    const input = [
      draft('SERVO1_FUNCTION'),
      draft('RCL3_MIN'),
      draft('SERVO2_FUNCTION'),
      draft('RCL3_FUNC', true)
    ]
    const out = ids(orderDraftsByEnableGate(input))
    // Unrelated servo params stay in order; the gate precedes its dependent.
    expect(out.indexOf('SERVO1_FUNCTION')).toBeLessThan(out.indexOf('SERVO2_FUNCTION'))
    expect(out.indexOf('RCL3_FUNC')).toBeLessThan(out.indexOf('RCL3_MIN'))
  })
})
