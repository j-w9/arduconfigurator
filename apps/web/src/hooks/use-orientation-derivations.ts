// Orientation-exercise derived state, lifted out of App.tsx as another
// bounded slice toward a SetupSection extract. Same parallel shape as
// useRcRangeDerivations / useModeSwitchDerivations / useRcCalibrationDerivations:
// IIFE summary + instruction list, byte-identical to the App.tsx original.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import type { OrientationExerciseState } from '../app-types'
import { orientationStepInstruction } from '../setup-exercise-helpers'

export interface UseOrientationDerivationsResult {
  orientationExerciseSummary: string
  orientationExerciseInstructions: string[]
}

/**
 * Derives the orientationExercise summary string + instruction list.
 * Inputs are the live snapshot (read for attitudeTelemetry.verified)
 * and the in-progress orientation exercise state.
 */
export function useOrientationDerivations(input: {
  snapshot: ConfiguratorSnapshot
  orientationExercise: OrientationExerciseState
}): UseOrientationDerivationsResult {
  const { snapshot, orientationExercise } = input

  const orientationExerciseSummary = (() => {
    if (orientationExercise.status === 'passed') {
      return 'Level, pitch forward and roll right all matched the live horizon.'
    }
    if (orientationExercise.status === 'failed') {
      return orientationExercise.failureReason ?? 'Orientation exercise failed.'
    }
    if (orientationExercise.status === 'running') {
      return orientationStepInstruction(orientationExercise.currentTargetStep)
    }
    if (!snapshot.liveVerification.attitudeTelemetry.verified) {
      return 'Waiting for attitude data from the vehicle.'
    }
    return 'Run the check, then tilt the vehicle; the horizon on screen should follow.'
  })()

  const orientationExerciseInstructions =
    orientationExercise.status === 'running'
      ? [
          orientationStepInstruction(orientationExercise.currentTargetStep),
          `Completed ${orientationExercise.completedSteps.length} of ${orientationExercise.targetSteps.length} orientation checks.`
        ]
      : orientationExercise.status === 'passed'
        ? ['Level, pitch forward and roll right all matched.']
        : orientationExercise.status === 'failed'
          ? ['Check AHRS_ORIENTATION and how the board is mounted, then run the check again.']
          : ['Level, pitch forward, roll right: each pose is checked against the live horizon.']

  return { orientationExerciseSummary, orientationExerciseInstructions }
}
