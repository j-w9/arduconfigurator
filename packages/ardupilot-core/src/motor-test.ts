import type { ConfiguratorSnapshot, MotorTestRequest } from './types.js'
import { deriveOutputMappingSummary, type ServoOutputAssignment } from './airframe-outputs.js'

// Full DO_MOTOR_TEST percent range, matching Mission Planner / Betaflight.
// Many ESCs won't spin below ~10-20%, so a low cap read as "motors not
// spinning"; the props-removed / area-clear / USB-bench acknowledgements
// gate the actual spin. The web slider keeps a conservative default.
export const MAX_MOTOR_TEST_THROTTLE_PERCENT = 100
// Default duration ceiling (5 s) covers Mission Planner / Betaflight's
// usual "spin one motor to identify it" workflow and the configurator's
// guided-identify path (which spins each motor for 2.5 s). The previous
// 2-second cap rejected the 2.5 s identify request as ineligible, which
// is why the reorder dialog "didn't spin" — the request was thrown out
// before it ever reached the FC.
export const MAX_MOTOR_TEST_DURATION_SECONDS = 5
// Expert ceiling (30 s) matches Mission Planner's longest motor-test
// soak. The caller passes expertMode=true to evaluateMotorTestEligibility
// (or motorTestGuardReasons) to unlock it. The acknowledgements + the
// rest of the eligibility checks still gate the actual spin.
export const EXPERT_MAX_MOTOR_TEST_DURATION_SECONDS = 30
export const MIN_MOTOR_TEST_DURATION_SECONDS = 0.1
// ArduPilot ARMS the motors for the duration of a DO_MOTOR_TEST, so the
// heartbeat reports armed=true while OUR OWN test runs and for a moment
// after it ends (1 Hz heartbeat lag past the FC-side disarm). Field
// report: during guided identify, the next motor's test was rejected
// with "the vehicle reports armed=true" — armed by the PREVIOUS test.
// Within this grace window after our own test completes, armed=true is
// the expected motor-test state, not a flyable-vehicle hazard.
export const MOTOR_TEST_ARMED_GRACE_MS = 5000

export interface MotorTestEligibility {
  allowed: boolean
  reasons: string[]
  selectedOutput?: ServoOutputAssignment
  selectedOutputs: ServoOutputAssignment[]
}

export interface MotorTestEligibilityOptions {
  /** When true, the duration cap rises to {@link EXPERT_MAX_MOTOR_TEST_DURATION_SECONDS}.
   *  Expert mode is the operator's opt-in for longer motor-test soaks (matches
   *  Mission Planner's expert ceiling); the props-off / test-area / arming
   *  checks all still apply. */
  expertMode?: boolean
}

export function evaluateMotorTestEligibility(
  snapshot: ConfiguratorSnapshot,
  request: Partial<MotorTestRequest> = {},
  options: MotorTestEligibilityOptions = {}
): MotorTestEligibility {
  const reasons: string[] = []
  const maxDurationSeconds = options.expertMode
    ? EXPERT_MAX_MOTOR_TEST_DURATION_SECONDS
    : MAX_MOTOR_TEST_DURATION_SECONDS

  if (snapshot.connection.kind !== 'connected') {
    reasons.push('The transport is not connected.')
  }

  if (!snapshot.vehicle) {
    reasons.push('No vehicle heartbeat has been identified yet.')
  }

  // Armed gate — but NOT when the armed state is our own motor test's
  // doing (running now, or completed within the grace window; ArduPilot
  // arms for the test and the 1 Hz heartbeat lags the disarm).
  const ownTestActive = snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running'
  const ownTestJustEnded =
    snapshot.motorTest.completedAtMs !== undefined &&
    Date.now() - snapshot.motorTest.completedAtMs < MOTOR_TEST_ARMED_GRACE_MS
  if (snapshot.vehicle?.armed && !ownTestActive && !ownTestJustEnded) {
    reasons.push('The vehicle reports armed=true.')
  }

  if (snapshot.parameterStats.status !== 'complete') {
    reasons.push('Parameter sync is not complete yet.')
  }

  const hasRunningGuidedAction = Object.values(snapshot.guidedActions).some(
    (action) => action.status === 'requested' || action.status === 'running'
  )
  if (hasRunningGuidedAction) {
    reasons.push('Wait for the current guided action to finish before running a motor test.')
  }

  if (snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running') {
    reasons.push('A motor test is already in progress.')
  }

  const outputMapping = deriveOutputMappingSummary(snapshot, snapshot.vehicle?.vehicle)
  if (outputMapping.motorOutputs.length === 0) {
    reasons.push('No mapped motor outputs were found in the current SERVO function range.')
  }

  let selectedOutput: ServoOutputAssignment | undefined
  const selectedOutputs = outputMapping.motorOutputs

  if (request.runAllOutputs || request.runAllOutputsSimultaneous) {
    if (!hasContiguousMotorSequence(selectedOutputs)) {
      reasons.push('All-motor tests require a contiguous motor sequence starting at M1. Fix the motor mapping or use an individual motor slider.')
    }
  } else {
    if (request.outputChannel === undefined) {
      reasons.push('Select a mapped motor output.')
    } else {
      selectedOutput = selectedOutputs.find((output) => output.channelNumber === request.outputChannel)
      if (!selectedOutput) {
        reasons.push(`OUT${request.outputChannel} is not mapped as a motor output.`)
      }
    }
  }

  if (request.throttlePercent === undefined || Number.isNaN(request.throttlePercent)) {
    reasons.push(`Throttle must be set between 1 and ${MAX_MOTOR_TEST_THROTTLE_PERCENT} percent.`)
  } else if (request.throttlePercent < 1 || request.throttlePercent > MAX_MOTOR_TEST_THROTTLE_PERCENT) {
    reasons.push(`Throttle must stay between 1 and ${MAX_MOTOR_TEST_THROTTLE_PERCENT} percent.`)
  }

  if (request.durationSeconds === undefined || Number.isNaN(request.durationSeconds)) {
    reasons.push(`Duration must be set between ${MIN_MOTOR_TEST_DURATION_SECONDS} and ${maxDurationSeconds} seconds.`)
  } else if (
    request.durationSeconds < MIN_MOTOR_TEST_DURATION_SECONDS ||
    request.durationSeconds > maxDurationSeconds
  ) {
    reasons.push(`Duration must stay between ${MIN_MOTOR_TEST_DURATION_SECONDS} and ${maxDurationSeconds} seconds.`)
  }

  return {
    allowed: reasons.length === 0,
    reasons,
    selectedOutput,
    selectedOutputs,
  }
}

/** The operator's physical-safety confirmations for a motor test. */
export interface MotorTestAcknowledgements {
  /** All propellers are removed. */
  propsRemoved: boolean
  /** The vehicle is restrained and the test area is clear. */
  testAreaClear: boolean
}

export const MOTOR_TEST_PROPS_REMOVED_REASON =
  'Confirm that all propellers are removed before enabling a motor test.'
export const MOTOR_TEST_AREA_CLEAR_REASON =
  'Confirm the vehicle is restrained and the test area is clear.'

/**
 * The complete set of reasons a motor test must NOT run: the
 * connection / arming / param-sync / mapped-motor / running-action
 * eligibility reasons from {@link evaluateMotorTestEligibility} PLUS the
 * operator's physical-safety acknowledgements (props removed, test area
 * clear).
 *
 * This is the single source of truth for "is it safe to spin this motor".
 * The UI keys the run control's enabled state on this list being empty AND
 * re-checks it immediately before sending the command — both must use this
 * function so the displayed gate and the enforced gate can never diverge.
 */
export function motorTestGuardReasons(
  snapshot: ConfiguratorSnapshot,
  request: Partial<MotorTestRequest>,
  acknowledgements: MotorTestAcknowledgements,
  options: MotorTestEligibilityOptions = {}
): string[] {
  return [
    ...evaluateMotorTestEligibility(snapshot, request, options).reasons,
    ...(acknowledgements.propsRemoved ? [] : [MOTOR_TEST_PROPS_REMOVED_REASON]),
    ...(acknowledgements.testAreaClear ? [] : [MOTOR_TEST_AREA_CLEAR_REASON])
  ]
}

export function motorTestInstructions(
  request: MotorTestRequest,
  selectedOutput?: ServoOutputAssignment,
  selectedOutputs: ServoOutputAssignment[] = []
): string[] {
  if (request.runAllOutputsSimultaneous) {
    return [
      'Remove all propellers before running any motor test.',
      'Keep the vehicle restrained and the test area clear of people, tools, and loose objects.',
      `This spins ALL ${selectedOutputs.length} mapped motors at the same time at ${request.throttlePercent}% for ${request.durationSeconds.toFixed(1)} seconds, then stops.`,
      'Every motor runs together — props off and a firm restraint are essential.',
    ]
  }

  if (request.runAllOutputs) {
    return [
      'Remove all propellers before running any motor test.',
      'Keep the vehicle restrained and the test area clear of people, tools, and loose objects.',
      `This request spins all ${selectedOutputs.length} mapped motors in sequence at ${request.throttlePercent}% for ${request.durationSeconds.toFixed(1)} seconds per motor.`,
      'ArduPilot runs the ALL test one motor at a time in sequence, not all motors simultaneously.',
    ]
  }

  return [
    'Remove all propellers before running any motor test.',
    'Keep the vehicle restrained and the test area clear of people, tools, and loose objects.',
    `This request spins ${selectedOutput ? `OUT${selectedOutput.channelNumber}${selectedOutput.motorNumber !== undefined ? ` / M${selectedOutput.motorNumber}` : ''}` : 'the selected output'} at ${request.throttlePercent}% for ${request.durationSeconds.toFixed(1)} seconds and then stops automatically.`,
  ]
}

function hasContiguousMotorSequence(outputs: ServoOutputAssignment[]): boolean {
  return outputs.every((output, index) => output.motorNumber === index + 1)
}
