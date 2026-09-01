// Setup-exercise state machines (orientation check, RC range calibration, RC
// mapping, motor verification), extracted from App.tsx as part of its
// decomposition. Pure functions that build/advance/fail the exercise session
// state the guided-setup UI drives. No React, no app state.

import {
  formatRcAxisLabel,
  RC_MAPPING_DELTA_THRESHOLD_US,
  RC_MAPPING_DOMINANCE_MARGIN_US,
  RC_MAPPING_THROTTLE_DELTA_THRESHOLD_US,
  type ConfiguratorSnapshot,
  type RcAxisId,
  type RcAxisObservation,
  type RcMappingCandidate,
  type ServoOutputAssignment
} from '@arduconfig/ardupilot-core'

import type { StatusTone } from './status-tone'
import type {
  MotorVerificationState,
  OrientationExerciseState,
  OrientationExerciseStepId,
  RcCalibrationAxisCapture,
  RcCalibrationSessionState,
  RcMappingAxisCapture,
  RcMappingSessionState,
  RcSwitchCapture
} from './app-types'

export const ORIENTATION_EXERCISE_ORDER: OrientationExerciseStepId[] = ['level', 'pitch-forward', 'roll-right']
export const RC_CALIBRATION_AXIS_ORDER: RcAxisId[] = ['roll', 'pitch', 'throttle', 'yaw']
/** Non-axis RC switch channels captured alongside the four control axes during
 *  endpoint calibration. These are NOT RCMAP axes — they're plain channels the
 *  operator flicks high/low so RCn_MIN/MAX get real endpoints. Optional: they
 *  never gate completion (a 4-channel radio has none). */
export const RC_CALIBRATION_SWITCH_CHANNELS = [5, 6]
/** A switch is "low"/"high" once its PWM is seen at/below or at/above these. */
export const RC_SWITCH_LOW_PWM = 1300
export const RC_SWITCH_HIGH_PWM = 1700
/** How long (ms) a stable mapping candidate must hold before the RC-mapping
 *  exercise auto-captures it. Used by the rcMapping derivations hook AND by
 *  an effect in App.tsx that ticks the accumulator. */
export const RC_MAPPING_AUTO_CAPTURE_MS = 1800

export function createIdleOrientationExerciseState(): OrientationExerciseState {
  return {
    status: 'idle',
    targetSteps: [],
    completedSteps: []
  }
}

export function createOrientationExerciseState(snapshot: ConfiguratorSnapshot): OrientationExerciseState {
  if (!snapshot.liveVerification.attitudeTelemetry.verified) {
    return failOrientationExerciseState(createIdleOrientationExerciseState(), 'Live attitude telemetry is not available yet.')
  }

  return {
    status: 'running',
    targetSteps: ORIENTATION_EXERCISE_ORDER,
    completedSteps: [],
    currentTargetStep: ORIENTATION_EXERCISE_ORDER[0],
    startedAtMs: Date.now()
  }
}

export function advanceOrientationExerciseState(
  current: OrientationExerciseState,
  snapshot: ConfiguratorSnapshot
): OrientationExerciseState {
  if (current.status !== 'running') {
    return current
  }

  if (!snapshot.liveVerification.attitudeTelemetry.verified) {
    return failOrientationExerciseState(current, 'Lost live attitude telemetry before the orientation exercise completed.')
  }

  const currentTargetStep = current.currentTargetStep
  if (!currentTargetStep) {
    return current
  }

  if (!orientationStepSatisfied(currentTargetStep, snapshot)) {
    return current
  }

  const completedSteps = [...current.completedSteps, currentTargetStep]
  const nextStep = current.targetSteps.find((step) => !completedSteps.includes(step))

  if (!nextStep) {
    return {
      ...current,
      status: 'passed',
      completedSteps,
      currentTargetStep: undefined,
      completedAtMs: Date.now(),
      failureReason: undefined
    }
  }

  return {
    ...current,
    completedSteps,
    currentTargetStep: nextStep
  }
}

export function failOrientationExerciseState(current: OrientationExerciseState, reason: string): OrientationExerciseState {
  return {
    ...current,
    status: 'failed',
    failureReason: reason,
    completedAtMs: Date.now()
  }
}

export function orientationStepLabel(step: OrientationExerciseStepId): string {
  switch (step) {
    case 'level':
      return 'Level'
    case 'pitch-forward':
      return 'Pitch forward'
    case 'roll-right':
      return 'Roll right'
    default:
      return step
  }
}

export function orientationStepInstruction(step: OrientationExerciseStepId | undefined): string {
  switch (step) {
    // These state the thresholds the code actually tests below (8 deg level,
    // 12 deg tilt). They used to say "near zero" and quote the telemetry sign
    // convention -- "pitch should move negative" -- which tells the operator
    // nothing about what to DO, and left someone tilting 8 degrees watching
    // nothing happen with no idea whether to tilt further or whether their
    // board orientation was wrong.
    case 'level':
      return 'Set the aircraft down level and hold it still, within about 8 degrees of level.'
    case 'pitch-forward':
      return 'Tilt the nose down at least 15 degrees and hold it. The horizon should pitch down with the aircraft — if it pitches up, the board orientation is wrong.'
    case 'roll-right':
      return 'Roll the aircraft right at least 15 degrees and hold it. The horizon should roll right with the aircraft — if it rolls left, the board orientation is wrong.'
    default:
      return 'Start the orientation exercise to verify live horizon behavior.'
  }
}

export function orientationStepSatisfied(step: OrientationExerciseStepId, snapshot: ConfiguratorSnapshot): boolean {
  const rollDeg = snapshot.liveVerification.attitudeTelemetry.rollDeg
  const pitchDeg = snapshot.liveVerification.attitudeTelemetry.pitchDeg
  if (rollDeg === undefined || pitchDeg === undefined) {
    return false
  }

  switch (step) {
    case 'level':
      return Math.abs(rollDeg) <= 8 && Math.abs(pitchDeg) <= 8
    case 'pitch-forward':
      return pitchDeg <= -12
    case 'roll-right':
      return rollDeg >= 12
    default:
      return false
  }
}

export function createIdleMotorVerificationState(): MotorVerificationState {
  return {
    status: 'idle',
    targetOutputs: [],
    verifiedOutputs: []
  }
}

export function sortMotorOutputsByMotorNumber(left: ServoOutputAssignment, right: ServoOutputAssignment): number {
  return (left.motorNumber ?? Number.MAX_SAFE_INTEGER) - (right.motorNumber ?? Number.MAX_SAFE_INTEGER)
}

export function createIdleRcCalibrationSessionState(observations: RcAxisObservation[] = []): RcCalibrationSessionState {
  const observationMap = new Map(observations.map((observation) => [observation.axisId, observation]))
  return {
    status: 'idle',
    captures: Object.fromEntries(
      RC_CALIBRATION_AXIS_ORDER.map((axisId) => {
        const observation = observationMap.get(axisId)
        return [
          axisId,
          {
            axisId,
            label: observation?.label ?? formatRcAxisLabel(axisId),
            channelNumber: observation?.channelNumber ?? 0,
            observedMin: observation?.pwm,
            observedMax: observation?.pwm,
            trimPwm: axisId === 'throttle' ? undefined : observation?.pwm,
            lowObserved: observation?.lowDetected ?? false,
            highObserved: observation?.highDetected ?? false,
            centeredObserved: axisId === 'throttle' ? false : observation?.centeredDetected ?? false
          }
        ]
      })
    ) as Record<RcAxisId, RcCalibrationAxisCapture>,
    switchCaptures: Object.fromEntries(
      RC_CALIBRATION_SWITCH_CHANNELS.map((channelNumber) => [
        channelNumber,
        {
          channelNumber,
          label: `CH${channelNumber}`,
          lowObserved: false,
          highObserved: false
        } satisfies RcSwitchCapture
      ])
    )
  }
}

export function rcSwitchCaptureComplete(capture: RcSwitchCapture): boolean {
  return capture.lowObserved && capture.highObserved
}

export function createIdleRcMappingSessionState(): RcMappingSessionState {
  return {
    status: 'idle',
    baselineChannels: [],
    captures: Object.fromEntries(
      RC_CALIBRATION_AXIS_ORDER.map((axisId) => [
        axisId,
        {
          axisId,
          label: formatRcAxisLabel(axisId)
        }
      ])
    ) as Record<RcAxisId, RcMappingAxisCapture>
  }
}

export function createRcMappingSessionState(snapshot: ConfiguratorSnapshot): RcMappingSessionState {
  if (!snapshot.liveVerification.rcInput.verified) {
    return failRcMappingSessionState(createIdleRcMappingSessionState(), 'Live RC telemetry is not available yet.')
  }

  return {
    ...createIdleRcMappingSessionState(),
    status: 'running',
    baselineChannels: [...snapshot.liveVerification.rcInput.channels],
    currentTargetAxis: RC_CALIBRATION_AXIS_ORDER[0],
    startedAtMs: Date.now()
  }
}

export function rcMappingTargetPrompt(axisId: RcAxisId): { title: string; detail: string } {
  switch (axisId) {
    case 'roll':
      return {
        title: 'Move Roll Only',
        detail: 'Move the roll stick through left and right, then briefly hold it to let the app lock onto the channel. Keep pitch and yaw centered and leave throttle low.'
      }
    case 'pitch':
      return {
        title: 'Move Pitch Only',
        detail: 'Move the pitch stick forward and back, then briefly hold it to let the app lock onto the channel. Keep roll and yaw centered and leave throttle low.'
      }
    case 'throttle':
      return {
        title: 'Move Throttle Only',
        detail: 'Sweep throttle through most of its travel — it has no centering spring, so it can start anywhere — then briefly hold it so the app can lock onto the throttle channel.'
      }
    case 'yaw':
      return {
        title: 'Move Yaw Only',
        detail: 'Move the yaw stick left and right, then briefly hold it to let the app lock onto the channel. Keep roll and pitch centered and leave throttle low.'
      }
    default:
      return {
        title: 'Move One Axis Only',
        detail: 'Move only the requested control until one receiver channel clearly dominates.'
      }
  }
}

export function rcMappingConfidenceLabel(deltaUs: number | undefined): { label: string; tone: StatusTone } {
  if (deltaUs === undefined) {
    return { label: 'Waiting', tone: 'neutral' }
  }

  if (deltaUs >= 280) {
    return { label: 'Strong', tone: 'success' }
  }

  if (deltaUs >= 180) {
    return { label: 'Good', tone: 'warning' }
  }

  return { label: 'Weak', tone: 'neutral' }
}

export function deriveRcMappingLiveCandidates(
  channels: number[],
  baselineChannels: number[],
  excludedChannelNumbers: number[] = []
): RcMappingCandidate[] {
  const excluded = new Set(excludedChannelNumbers)

  return channels
    .map((livePwm, index) => {
      const channelNumber = index + 1
      const baselinePwm = baselineChannels[index]
      if (
        excluded.has(channelNumber) ||
        !Number.isFinite(livePwm) ||
        !Number.isFinite(baselinePwm) ||
        livePwm < 800 ||
        baselinePwm < 800
      ) {
        return undefined
      }

      return {
        channelNumber,
        deltaUs: Math.abs(livePwm - baselinePwm),
        baselinePwm,
        livePwm
      }
    })
    .filter((candidate): candidate is RcMappingCandidate => candidate !== undefined)
    .sort((left, right) => right.deltaUs - left.deltaUs)
}

/**
 * Why the capture refused, in words the operator can act on.
 *
 * detectDominantRcChannelChange has three refusal paths -- delta under the
 * threshold, the dominance margin (top two channels within 35us of each other),
 * and the axis filter -- but this only ever saw the raw candidate, which is
 * itself undefined for the first two. So the only refusal it could explain was
 * the off-centre baseline, and everything else fell through to a generic "keep
 * moving only that control".
 *
 * That generic line is actively wrong for the dominance case: the operator IS
 * moving only that control, and their radio is driving a second channel from it
 * -- a mix, a Y-lead, expo on a 4-in-1. Telling them to do harder what they are
 * already doing correctly is worse than saying nothing.
 *
 * `liveCandidates` is the ranked list, so the two cases the raw candidate cannot
 * express are recoverable here.
 */
export function describeRcMappingRejectedCandidate(
  targetAxis: RcAxisId,
  candidate: RcMappingCandidate | undefined,
  liveCandidates: readonly RcMappingCandidate[] = []
): string | undefined {
  const axisLabel = formatRcAxisLabel(targetAxis).toLowerCase()

  // Two channels moving together: neither can be called dominant.
  const [strongest, next] = liveCandidates
  if (
    strongest &&
    next &&
    strongest.deltaUs >= RC_MAPPING_DELTA_THRESHOLD_US &&
    strongest.deltaUs - next.deltaUs < RC_MAPPING_DOMINANCE_MARGIN_US
  ) {
    return `CH${strongest.channelNumber} and CH${next.channelNumber} are moving together, so neither one is clearly ${axisLabel}. Check for a mix or a shared lead on this stick, or move ${axisLabel} further than the other channel.`
  }

  // Moved, but not far enough to be deliberate.
  if (strongest && strongest.deltaUs < RC_MAPPING_DELTA_THRESHOLD_US) {
    return `That movement is too small to identify a channel. Move ${axisLabel} all the way to one end and hold it there.`
  }

  if (!candidate) {
    return undefined
  }

  if (targetAxis === 'throttle') {
    // Throttle accepts either direction from any baseline (no centering
    // spring — see RC_MAPPING_THROTTLE_DELTA_THRESHOLD_US in
    // @arduconfig/ardupilot-core); the only throttle-specific rejection
    // is a swing too small to clear the raised threshold.
    if (candidate.deltaUs < RC_MAPPING_THROTTLE_DELTA_THRESHOLD_US) {
      return 'That movement is too small for throttle capture. Sweep throttle through most of its travel and hold it there.'
    }
    return undefined
  }

  if (candidate.baselinePwm < 1300 || candidate.baselinePwm > 1700) {
    return `That movement looks more like throttle or another switch channel, not ${axisLabel}. Re-centre the sticks, leave throttle low, and move only ${axisLabel}.`
  }

  return undefined
}

export function failRcMappingSessionState(current: RcMappingSessionState, reason: string): RcMappingSessionState {
  return {
    ...current,
    status: 'failed',
    failureReason: reason,
    completedAtMs: Date.now()
  }
}

export function rcCalibrationCaptureComplete(capture: RcCalibrationAxisCapture): boolean {
  return capture.axisId === 'throttle'
    ? capture.lowObserved && capture.highObserved
    : capture.lowObserved && capture.highObserved && capture.centeredObserved && capture.trimPwm !== undefined
}
