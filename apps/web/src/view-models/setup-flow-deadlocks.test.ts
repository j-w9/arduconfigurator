import { describe, expect, it } from 'vitest'

import { deriveSetupStatusFromCriteria } from '../setup-flow-helpers'

/*
 * Regression tests for the three deadlocks found in the 2026-09 guided-setup
 * audit. Each one made some step permanently unreachable, which froze every
 * step behind it via the sequential lock pass.
 */
describe('guided setup deadlocks', () => {
  it('a step with no criteria is never silently complete', () => {
    // This is the mechanism behind the non-Copter deadlock: section ids the
    // switch does not name fell through with criteria = [], and 'attention'
    // can never satisfy the sequence. The guard stays -- what changed is that
    // the default branch now BUILDS criteria instead of leaving them empty.
    expect(deriveSetupStatusFromCriteria([])).toBe('attention')
  })

  it('a reviewed step with its parameters present completes', () => {
    expect(
      deriveSetupStatusFromCriteria([
        { label: 'Every parameter this step covers is present', met: true },
        { label: 'Operator reviewed sensors', met: true }
      ])
    ).toBe('complete')
  })

  it('a reviewed step with a missing parameter does not complete', () => {
    expect(
      deriveSetupStatusFromCriteria([
        { label: 'Every parameter this step covers is present', met: false },
        { label: 'Operator reviewed sensors', met: true }
      ])
    ).toBe('in-progress')
  })
})
