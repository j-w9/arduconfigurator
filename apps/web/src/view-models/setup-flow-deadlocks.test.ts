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

/*
 * The 4.7 rename is a units change too, which is the part that bites: reading
 * the wrong name silently yields nothing, but reading the wrong UNIT yields a
 * number 100x off that still looks plausible in a criterion.
 *
 *   <= 4.6   RTL_ALT    centimetres   default 1500  (ArduCopter/Parameters.cpp)
 *   >= 4.7   RTL_ALT_M  metres        default 15    (ArduCopter/mode_rtl.cpp)
 */
describe('RTL return altitude across the 4.7 rename', () => {
  const normalise = (metres: number | undefined, centimetres: number | undefined) =>
    metres !== undefined ? metres : centimetres === undefined ? undefined : centimetres / 100

  it('reads 4.7 metres directly', () => {
    expect(normalise(30, undefined)).toBe(30)
  })

  it('converts 4.6 centimetres to metres', () => {
    expect(normalise(undefined, 3000)).toBe(30)
  })

  it('treats both firmware defaults as the same 15 m, which fails the 20 m gate', () => {
    expect(normalise(15, undefined)).toBe(15)
    expect(normalise(undefined, 1500)).toBe(15)
    for (const value of [normalise(15, undefined), normalise(undefined, 1500)]) {
      expect(value !== undefined && value >= 20).toBe(false)
    }
  })

  it('has no opinion when the firmware reports neither name', () => {
    expect(normalise(undefined, undefined)).toBeUndefined()
  })
})
