// Motor-test request builder + the magic-output sentinel used to drive
// the "all motors" path on a MotorTestSliders selection. Kept off App
// so the small constant and the request mapping can be referenced from
// any UI that wires a motor-test call.

import type { MotorTestRequest } from '@arduconfig/ardupilot-core'

/**
 * Sentinel output value meaning "test every motor in the configured
 * sequence". The MotorTestSliders surfaces it as the "All motors" tile;
 * the runtime turns it into a `runAllOutputs: true` request that the
 * MotorTestService sweeps one motor at a time with the FC's per-motor
 * timeout.
 */
export const ALL_MOTOR_TEST_OUTPUT = 0 as const
/**
 * Sentinel meaning "spin every mapped motor at the SAME time" (Mission
 * Planner's "Test all motors"). Distinct from ALL_MOTOR_TEST_OUTPUT,
 * which sweeps them one at a time. Negative so it can never collide with
 * a real 1-based output channel.
 */
export const ALL_MOTOR_TEST_OUTPUT_SIMULTANEOUS = -1 as const

/**
 * Build a partial MotorTestRequest from the operator's UI selections.
 * Returns a Partial because the App layer threads the safety acks
 * (props removed / vehicle restrained / cleared area) at the runtime
 * boundary; this helper covers only the output/throttle/duration triple.
 */
export function buildMotorTestRequest(
  selectedOutput: number | undefined,
  throttlePercent: number,
  durationSeconds: number
): Partial<MotorTestRequest> {
  const isSequentialAll = selectedOutput === ALL_MOTOR_TEST_OUTPUT
  const isSimultaneousAll = selectedOutput === ALL_MOTOR_TEST_OUTPUT_SIMULTANEOUS
  return {
    outputChannel:
      selectedOutput !== undefined && !isSequentialAll && !isSimultaneousAll ? selectedOutput : undefined,
    runAllOutputs: isSequentialAll,
    runAllOutputsSimultaneous: isSimultaneousAll,
    throttlePercent,
    durationSeconds
  }
}
