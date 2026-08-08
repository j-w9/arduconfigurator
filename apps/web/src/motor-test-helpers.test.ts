import { describe, expect, it } from 'vitest'

import {
  ALL_MOTOR_TEST_OUTPUT,
  ALL_MOTOR_TEST_OUTPUT_SIMULTANEOUS,
  buildMotorTestRequest
} from './motor-test-helpers'

/**
 * buildMotorTestRequest turns two sentinel numbers into the difference between
 * "spin one motor", "sweep them one at a time" and "spin ALL of them at once".
 * A comparison slip here spins every motor when the operator picked one, and
 * the module had no test at all.
 */
describe('buildMotorTestRequest', () => {
  it('maps a real channel to a single-output test', () => {
    expect(buildMotorTestRequest(3, 10, 2)).toEqual({
      outputChannel: 3,
      runAllOutputs: false,
      runAllOutputsSimultaneous: false,
      throttlePercent: 10,
      durationSeconds: 2
    })
  })

  it('maps the sequential sentinel to a sweep, with no output channel', () => {
    const request = buildMotorTestRequest(ALL_MOTOR_TEST_OUTPUT, 10, 2)
    expect(request.runAllOutputs).toBe(true)
    expect(request.runAllOutputsSimultaneous).toBe(false)
    // Must be undefined, not 0: a 0 here would read as a real channel.
    expect(request.outputChannel).toBeUndefined()
  })

  it('maps the simultaneous sentinel to an all-at-once run, with no output channel', () => {
    const request = buildMotorTestRequest(ALL_MOTOR_TEST_OUTPUT_SIMULTANEOUS, 10, 2)
    expect(request.runAllOutputsSimultaneous).toBe(true)
    expect(request.runAllOutputs).toBe(false)
    expect(request.outputChannel).toBeUndefined()
  })

  it('keeps the two sentinels distinct and non-colliding with real channels', () => {
    // Output channels are 1-based, so the sentinels must never be a valid one.
    expect(ALL_MOTOR_TEST_OUTPUT).not.toBe(ALL_MOTOR_TEST_OUTPUT_SIMULTANEOUS)
    expect(ALL_MOTOR_TEST_OUTPUT_SIMULTANEOUS).toBeLessThan(1)
    expect(ALL_MOTOR_TEST_OUTPUT).toBeLessThan(1)
  })

  it('selects nothing when no output is chosen', () => {
    const request = buildMotorTestRequest(undefined, 10, 2)
    expect(request.outputChannel).toBeUndefined()
    expect(request.runAllOutputs).toBe(false)
    expect(request.runAllOutputsSimultaneous).toBe(false)
  })
})
