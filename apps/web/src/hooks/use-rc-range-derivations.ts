// Stick-range exercise derived state, lifted out of App.tsx as the next
// bounded slice toward a ReceiverSection extract. Behavior-neutral move:
// the count, progress %, summary string and instruction list are all
// computed exactly as they were inline, just relocated into one hook so
// the Receiver block can consume one named bag.

import {
  type ConfiguratorSnapshot,
  type RcAxisExerciseProgress,
  type RcRangeExerciseState,
  formatRcAxisLabel
} from '@arduconfig/ardupilot-core'

export interface UseRcRangeDerivationsResult {
  rcRangeExerciseCompletedCount: number
  rcRangeExerciseProgress: number
  rcRangeExerciseSummary: string
  rcRangeExerciseInstructions: string[]
}

/**
 * Derives the rcRangeExercise family of values (counter / percent /
 * summary / step-instructions). Inputs are the in-progress exercise state
 * from useRcExercises and the live snapshot (only the rcInput.verified
 * flag is read). Outputs are byte-identical to the App.tsx originals.
 */
export function useRcRangeDerivations(input: {
  snapshot: ConfiguratorSnapshot
  rcRangeExercise: RcRangeExerciseState
}): UseRcRangeDerivationsResult {
  const { snapshot, rcRangeExercise } = input

  const rcRangeExerciseCompletedCount = (
    Object.values(rcRangeExercise.axisProgress) as RcAxisExerciseProgress[]
  ).filter((axis) => axis.completed).length
  const rcRangeExerciseProgress =
    rcRangeExercise.targetAxes.length === 0
      ? 0
      : (rcRangeExerciseCompletedCount / rcRangeExercise.targetAxes.length) * 100

  const rcRangeExerciseSummary = (() => {
    if (rcRangeExercise.status === 'passed') {
      return 'Observed the expected min/max stick travel, plus center return on roll, pitch, and yaw.'
    }
    if (rcRangeExercise.status === 'failed') {
      return rcRangeExercise.failureReason ?? 'Stick range exercise failed.'
    }
    if (rcRangeExercise.status === 'running') {
      return rcRangeExercise.currentTargetAxis === undefined
        ? 'All primary stick axes have satisfied their expected movement checks.'
        : `Move ${formatRcAxisLabel(rcRangeExercise.currentTargetAxis)} through its required range.`
    }
    if (!snapshot.liveVerification.rcInput.verified) {
      return 'Waiting for live RC telemetry before starting the stick range exercise.'
    }
    return 'Run the stick range exercise to verify low/high travel on roll, pitch, yaw, and throttle.'
  })()

  const rcRangeExerciseInstructions =
    rcRangeExercise.status === 'running'
      ? [
          rcRangeExercise.currentTargetAxis === 'throttle'
            ? 'Move throttle fully low, then fully high.'
            : `Move ${formatRcAxisLabel(rcRangeExercise.currentTargetAxis ?? 'roll')} fully low, fully high, then back to center.`,
          `Completed ${rcRangeExerciseCompletedCount} of ${rcRangeExercise.targetAxes.length} axis checks.`
        ]
      : rcRangeExercise.status === 'passed'
        ? ['All four primary control axes were exercised against live receiver input.']
      : rcRangeExercise.status === 'failed'
          ? ['Check receiver mapping, stick endpoints, trims, and calibration values, then rerun the exercise.']
          : ['The app will watch each primary control axis and mark it complete after the expected movements are observed.']

  return {
    rcRangeExerciseCompletedCount,
    rcRangeExerciseProgress,
    rcRangeExerciseSummary,
    rcRangeExerciseInstructions
  }
}
