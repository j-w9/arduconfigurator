// Mode-switch exercise derived state, lifted out of App.tsx as the next
// bounded slice toward a ReceiverSection extract. Behavior-neutral move:
// the progress %, summary string and instruction list are computed
// exactly as they were inline (App.tsx used to keep the progress %
// near the top and the summary/instructions ~1800 lines later).

import {
  type ConfiguratorSnapshot,
  type ModeAssignment,
  type ModeSwitchEstimate,
  type ModeSwitchExerciseState,
  formatModeExerciseTargetLabel,
  formatModeSlotLabel
} from '@arduconfig/ardupilot-core'

export interface UseModeSwitchDerivationsResult {
  modeSwitchExerciseProgress: number
  modeSwitchExerciseSummary: string
  modeSwitchExerciseInstructions: string[]
}

/**
 * Derives the modeSwitchExercise family of values (percent / summary /
 * step-instructions). Inputs are the live snapshot (read for vehicle
 * class + rcInput.verified), the in-progress exercise state, the detected
 * mode-switch estimate, and the configured assignment list. Outputs are
 * byte-identical to the App.tsx originals.
 */
export function useModeSwitchDerivations(input: {
  snapshot: ConfiguratorSnapshot
  modeSwitchExercise: ModeSwitchExerciseState
  modeSwitchEstimate: ModeSwitchEstimate
  modeExerciseAssignments: ModeAssignment[]
}): UseModeSwitchDerivationsResult {
  const { snapshot, modeSwitchExercise, modeSwitchEstimate, modeExerciseAssignments } = input

  const modeSwitchExerciseProgress =
    modeSwitchExercise.targetSlots.length === 0
      ? 0
      : (modeSwitchExercise.visitedSlots.length / modeSwitchExercise.targetSlots.length) * 100

  const modeSwitchExerciseSummary = (() => {
    if (modeSwitchExercise.status === 'passed') {
      return `Observed all configured switch positions on CH${modeSwitchEstimate.channelNumber ?? '?'}.`
    }
    if (modeSwitchExercise.status === 'failed') {
      return modeSwitchExercise.failureReason ?? 'Mode switch exercise failed.'
    }
    if (modeSwitchExercise.status === 'running') {
      return modeSwitchExercise.currentTargetSlot === undefined
        ? 'All configured switch positions have been observed.'
        : `Move the configured flight-mode control to ${formatModeExerciseTargetLabel(snapshot, modeSwitchExercise.currentTargetSlot, snapshot.vehicle?.vehicle)}.`
    }
    if (!snapshot.liveVerification.rcInput.verified) {
      return 'Waiting for live RC telemetry before starting the switch exercise.'
    }
    if (modeExerciseAssignments.length < 2) {
      return 'At least two distinct configured flight-mode positions are needed for a useful switch exercise.'
    }
    return 'Start the switch exercise to walk through the configured flight-mode positions.'
  })()

  const modeSwitchExerciseInstructions =
    modeSwitchExercise.status === 'running'
      ? [
          `Current position: ${formatModeSlotLabel(snapshot, modeSwitchEstimate.estimatedSlot, snapshot.vehicle?.vehicle)}.`,
          `Visited ${modeSwitchExercise.visitedSlots.length} of ${modeSwitchExercise.targetSlots.length} configured positions.`
        ]
      : modeSwitchExercise.status === 'passed'
        ? ['The mode channel moved through every distinct configured flight-mode position that the app expected to see.']
        : modeSwitchExercise.status === 'failed'
          ? ['Check the radio mapping, `FLTMODE_CH`/`MODE_CH`, and switch endpoints, then run the exercise again.']
          : ['The app will watch the live mode channel and mark each distinct configured flight-mode position as it is observed.']

  return {
    modeSwitchExerciseProgress,
    modeSwitchExerciseSummary,
    modeSwitchExerciseInstructions
  }
}
