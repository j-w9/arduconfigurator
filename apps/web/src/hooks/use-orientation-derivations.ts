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
      return 'Observed level, forward pitch, and right-roll horizon responses from the live attitude stream.'
    }
    if (orientationExercise.status === 'failed') {
      return orientationExercise.failureReason ?? 'Orientation exercise failed.'
    }
    if (orientationExercise.status === 'running') {
      return orientationStepInstruction(orientationExercise.currentTargetStep)
    }
    if (!snapshot.liveVerification.attitudeTelemetry.verified) {
      return 'Waiting for live attitude telemetry before starting orientation verification.'
    }
    return 'Run the orientation exercise to confirm that the live horizon responds correctly to pitch and roll movement.'
  })()

  const orientationExerciseInstructions =
    orientationExercise.status === 'running'
      ? [
          orientationStepInstruction(orientationExercise.currentTargetStep),
          `Completed ${orientationExercise.completedSteps.length} of ${orientationExercise.targetSteps.length} orientation checks.`
        ]
      : orientationExercise.status === 'passed'
        ? ['The live attitude stream matched the expected level, forward-pitch, and right-roll behavior.']
        : orientationExercise.status === 'failed'
          ? ['Check AHRS_ORIENTATION and board mounting, then rerun the orientation exercise.']
          : ['The app will verify level, forward pitch, and right roll against the live ATTITUDE stream.']

  return { orientationExerciseSummary, orientationExerciseInstructions }
}
