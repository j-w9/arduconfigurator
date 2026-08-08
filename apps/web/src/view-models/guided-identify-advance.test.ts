import { describe, expect, it } from 'vitest'

import { planGuidedIdentifyAdvance, type GuidedIdentifyAdvanceInput } from './guided-identify-advance'

// A four-motor quad on OUT1..OUT4, mid-run on the first output, everything
// acknowledged. Individual cases override only what they are about.
function input(overrides: Partial<GuidedIdentifyAdvanceInput> = {}): GuidedIdentifyAdvanceInput {
  return {
    active: true,
    advanceInFlight: false,
    step: 0,
    outputChannels: [1, 2, 3, 4],
    mapping: {},
    clickedMotorPosition: 3,
    autoSpin: true,
    safetyAcknowledged: true,
    ...overrides
  }
}

describe('planGuidedIdentifyAdvance', () => {
  it('records the pick and starts the next output behind the stop', () => {
    expect(planGuidedIdentifyAdvance(input())).toEqual({
      kind: 'advance',
      // OUT1 moved the motor at frame position 3.
      nextMapping: { 1: 3 },
      nextStep: 1,
      startStep: 1
    })
  })

  it('carries earlier picks forward without disturbing them', () => {
    expect(
      planGuidedIdentifyAdvance(input({ step: 2, mapping: { 1: 3, 2: 1 }, clickedMotorPosition: 4 }))
    ).toEqual({
      kind: 'advance',
      nextMapping: { 1: 3, 2: 1, 3: 4 },
      nextStep: 3,
      startStep: 3
    })
  })

  it('the LAST output completes the run and starts nothing', () => {
    // Nothing may spin after the final answer — the plan carries no start.
    const plan = planGuidedIdentifyAdvance(
      input({ step: 3, mapping: { 1: 3, 2: 1, 3: 4 }, clickedMotorPosition: 2 })
    )
    expect(plan).toEqual({ kind: 'complete', nextMapping: { 1: 3, 2: 1, 3: 4, 4: 2 } })
    expect('startStep' in plan).toBe(false)
  })

  it('a single-motor frame completes on the very first pick', () => {
    expect(planGuidedIdentifyAdvance(input({ outputChannels: [7], clickedMotorPosition: 1 }))).toEqual({
      kind: 'complete',
      nextMapping: { 7: 1 }
    })
  })

  it('still stops but does not start when auto-spin is off', () => {
    // The answered spin is pointless either way; only the follow-up start is
    // the operator's preference.
    expect(planGuidedIdentifyAdvance(input({ autoSpin: false }))).toEqual({
      kind: 'advance',
      nextMapping: { 1: 3 },
      nextStep: 1,
      startStep: undefined
    })
  })

  it('never starts the next motor once the safety ack is withdrawn', () => {
    expect(planGuidedIdentifyAdvance(input({ safetyAcknowledged: false }))).toMatchObject({
      kind: 'advance',
      startStep: undefined
    })
  })

  it('drops a second click while the previous stop/start pair is in flight', () => {
    // Two starts racing would spin an unexpected motor. This is the
    // double-click / impatient-repeat guard.
    expect(planGuidedIdentifyAdvance(input({ advanceInFlight: true }))).toEqual({
      kind: 'ignore',
      reason: 'advance-in-flight'
    })
  })

  it('ignores clicks when no identify run is active', () => {
    expect(planGuidedIdentifyAdvance(input({ active: false }))).toEqual({
      kind: 'ignore',
      reason: 'inactive'
    })
  })

  it('ignores a click when the step has no output (state raced away)', () => {
    expect(planGuidedIdentifyAdvance(input({ step: 4 }))).toEqual({
      kind: 'ignore',
      reason: 'no-current-output'
    })
  })

  it('refuses to reassign a position an earlier output already claimed', () => {
    // Overwriting a claimed position would drop a motor from the permutation.
    expect(planGuidedIdentifyAdvance(input({ step: 1, mapping: { 1: 3 }, clickedMotorPosition: 3 }))).toEqual({
      kind: 'ignore',
      reason: 'position-already-picked'
    })
  })

  it('a full run over every output yields a bijective mapping and exactly one completion', () => {
    // Walk the whole sequence the way App.tsx does, asserting that exactly
    // the last pick completes and every intermediate pick advances by one.
    let mapping = {}
    let step = 0
    const positions = [3, 1, 4, 2]
    const completions: number[] = []
    positions.forEach((clickedMotorPosition, index) => {
      const plan = planGuidedIdentifyAdvance(input({ step, mapping, clickedMotorPosition }))
      if (plan.kind === 'complete') {
        completions.push(index)
        mapping = plan.nextMapping
        return
      }
      expect(plan.kind).toBe('advance')
      if (plan.kind !== 'advance') {
        return
      }
      expect(plan.nextStep).toBe(step + 1)
      expect(plan.startStep).toBe(step + 1)
      mapping = plan.nextMapping
      step = plan.nextStep
    })
    expect(completions).toEqual([3])
    expect(mapping).toEqual({ 1: 3, 2: 1, 3: 4, 4: 2 })
  })
})
