import { describe, expect, it } from 'vitest'

import { isOutputAssignmentParamId } from './param-review'

/**
 * param-review.ts decides which parameter ids belong to which tab's edit scope.
 * A scope that is too narrow does not error — the edit is just silently dropped
 * from that tab's Apply batch — so these predicates need pinning.
 */
describe('isOutputAssignmentParamId', () => {
  it('covers all 32 outputs the app supports, not just the first 16', () => {
    // DEFAULT_MAX_SERVO_OUTPUTS is 32 and the metadata curates 32 channels, but
    // this predicate stopped at 16 — so on a board with more, SERVO17-32 never
    // entered effectiveMotorOutputs (motor test, reorder, guided identify) and
    // edits to them vanished from the Outputs Apply batch.
    for (const channel of [1, 9, 16, 17, 24, 32]) {
      expect(isOutputAssignmentParamId(`SERVO${channel}_FUNCTION`)).toBe(true)
    }
  })

  it('covers every sibling in the scope, so one Apply commits a coherent batch', () => {
    for (const suffix of ['FUNCTION', 'MIN', 'MAX', 'TRIM', 'REVERSED']) {
      expect(isOutputAssignmentParamId(`SERVO20_${suffix}`)).toBe(true)
    }
  })

  it('stops at 32 and does not match near-misses', () => {
    expect(isOutputAssignmentParamId('SERVO33_FUNCTION')).toBe(false)
    expect(isOutputAssignmentParamId('SERVO0_FUNCTION')).toBe(false)
    // Not a per-channel param: SERVO_BLH_* would drag the ESC scope into the
    // output-assignment batch.
    expect(isOutputAssignmentParamId('SERVO_BLH_MASK')).toBe(false)
    expect(isOutputAssignmentParamId('SERVO1_FUNCTIONX')).toBe(false)
  })
})
