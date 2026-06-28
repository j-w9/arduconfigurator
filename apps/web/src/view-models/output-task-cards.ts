// Output task-card summaries for the Outputs / Servos views.
//
// The per-task summary cards (Motor Setup, Direction & Test, ESC & Protocol,
// Servo Functions, Peripherals & Alerts, Review). The card value/detail/tone
// logic is a pure derivation over a handful of draft counts, exercise
// statuses, and pre-derived summaries; `buildOutputTaskCards` takes those
// inputs and returns the cards.

import type { ModeSwitchExerciseStatus, OrientationExerciseStatus, OutputTaskId } from '../app-types'
import type { StatusTone } from '../status-tone'
import { toneForModeSwitchExercise } from '../tone-helpers'
import { escCalibrationPathLabel } from '../setup-flow-helpers'

export interface OutputTaskCard {
  id: OutputTaskId
  label: string
  value: string
  detail: string
  tone: StatusTone
}

export interface OutputTaskCardInputs {
  outputAssignmentInvalidCount: number
  outputAssignmentStagedCount: number
  expectedMotorCount: number | undefined
  motorOutputCount: number
  configuredAuxOutputCount: number
  orientationExerciseStatus: OrientationExerciseStatus
  orientationExerciseSummary: string
  motorMixerSummary: string
  motorVerificationStatus: ModeSwitchExerciseStatus
  motorDirectionSummary: string
  outputReviewInvalidCount: number
  outputReviewStagedCount: number
  escReviewConfirmed: boolean
  escCalibrationPath: Parameters<typeof escCalibrationPathLabel>[0]
  escReviewSummary: string
  servoMappingRowCount: number
  outputPeripheralInvalidDraftCount: number
  outputPeripheralStagedDraftCount: number
  hasNotificationLedTypes: boolean
  hasNotificationBuzzTypes: boolean
  outputAdditionalGroupCount: number
  totalOutputInvalidDrafts: number
  totalOutputStagedDrafts: number
}

export interface RecommendedOutputTaskInputs {
  outputAssignmentInvalidCount: number
  orientationExerciseStatus: OrientationExerciseStatus
  motorVerificationStatus: ModeSwitchExerciseStatus
  outputReviewInvalidCount: number
  outputPeripheralInvalidDraftCount: number
  motorOutputCount: number
  expectedMotorCount: number | undefined
  escReviewConfirmed: boolean
  isCopterVehicle: boolean
}

/**
 * Picks which output task card to surface by default. Pure derivation over
 * the same draft/exercise inputs as the cards themselves.
 */
export function recommendOutputTaskId(inputs: RecommendedOutputTaskInputs): OutputTaskId {
  const {
    outputAssignmentInvalidCount,
    orientationExerciseStatus,
    motorVerificationStatus,
    outputReviewInvalidCount,
    outputPeripheralInvalidDraftCount,
    motorOutputCount,
    expectedMotorCount,
    escReviewConfirmed,
    isCopterVehicle
  } = inputs

  if (outputAssignmentInvalidCount > 0 || orientationExerciseStatus === 'running' || orientationExerciseStatus === 'failed') {
    return 'motor-setup'
  }
  if (motorVerificationStatus === 'running' || motorVerificationStatus === 'failed') {
    return 'direction-test'
  }
  if (outputReviewInvalidCount > 0) {
    return 'esc-protocol'
  }
  if (outputPeripheralInvalidDraftCount > 0) {
    return 'peripherals'
  }
  // ESC calibration / motor-direction verification are multirotor steps (their
  // cards are Copter-gated). A non-Copter vehicle has no default reason to land
  // on esc-protocol / direction-test, so it opens on its output overview.
  if (!isCopterVehicle) {
    return 'motor-setup'
  }
  // Deliberately no "staged > 0 → review" auto-route here: typing a
  // small ESC change would yank the operator straight into the Review
  // task mid-edit (Tuning opts out of the same pattern). The persistent
  // staged-changes chip already surfaces the pending count; the operator
  // can step over to Review on their own when they want. Invalid drafts
  // still route (above), since those block writes and are worth pulling
  // attention.
  if (
    motorOutputCount === 0 ||
    (expectedMotorCount !== undefined && motorOutputCount !== expectedMotorCount)
  ) {
    return 'motor-setup'
  }
  if (!escReviewConfirmed) {
    return 'esc-protocol'
  }
  if (motorVerificationStatus !== 'passed') {
    return 'direction-test'
  }
  return 'motor-setup'
}

export function buildOutputTaskCards(inputs: OutputTaskCardInputs): OutputTaskCard[] {
  const {
    outputAssignmentInvalidCount,
    outputAssignmentStagedCount,
    expectedMotorCount,
    motorOutputCount,
    configuredAuxOutputCount,
    orientationExerciseStatus,
    orientationExerciseSummary,
    motorMixerSummary,
    motorVerificationStatus,
    motorDirectionSummary,
    outputReviewInvalidCount,
    outputReviewStagedCount,
    escCalibrationPath,
    escReviewSummary,
    servoMappingRowCount,
    outputPeripheralInvalidDraftCount,
    outputPeripheralStagedDraftCount,
    hasNotificationLedTypes,
    hasNotificationBuzzTypes,
    outputAdditionalGroupCount,
    totalOutputInvalidDrafts,
    totalOutputStagedDrafts
  } = inputs

  return [
    {
      id: 'motor-setup' as const,
      label: 'Motor Setup',
      value:
        outputAssignmentInvalidCount > 0
          ? `${outputAssignmentInvalidCount} invalid`
          : outputAssignmentStagedCount > 0
            ? `${outputAssignmentStagedCount} staged`
            : expectedMotorCount !== undefined
              ? `${motorOutputCount}/${expectedMotorCount} mapped`
              : `${motorOutputCount} mapped`,
      detail:
        orientationExerciseStatus === 'running' || orientationExerciseStatus === 'failed'
          ? orientationExerciseSummary
          : motorMixerSummary,
      tone:
        outputAssignmentInvalidCount > 0
          ? 'danger'
          : outputAssignmentStagedCount > 0
            ? 'warning'
            : motorOutputCount === 0 ||
                (expectedMotorCount !== undefined && motorOutputCount !== expectedMotorCount)
              ? 'warning'
              : orientationExerciseStatus === 'passed'
                ? 'success'
                : 'neutral'
    },
    {
      id: 'direction-test' as const,
      label: 'Direction & Test',
      value:
        motorVerificationStatus === 'passed'
          ? 'Passed'
          : motorVerificationStatus === 'running'
            ? 'Running'
            : motorVerificationStatus === 'failed'
              ? 'Needs attention'
              : 'Ready',
      detail: motorDirectionSummary,
      tone: toneForModeSwitchExercise(motorVerificationStatus)
    },
    {
      id: 'esc-protocol' as const,
      label: 'ESC & Protocol',
      value:
        outputReviewInvalidCount > 0
          ? `${outputReviewInvalidCount} invalid`
          : outputReviewStagedCount > 0
            ? `${outputReviewStagedCount} staged`
            : escCalibrationPathLabel(escCalibrationPath),
      detail: escReviewSummary,
      tone:
        outputReviewInvalidCount > 0
          ? 'danger'
          : outputReviewStagedCount > 0
            ? 'warning'
            : escCalibrationPath === 'manual-review'
              ? 'warning'
              : 'neutral'
    },
    {
      // Servo function mapping — the headline card on the Servos
      // nav tab. Reuses the outputAssignmentDrafts scope so the same
      // SERVOn_FUNCTION drafts can be staged from either the
      // motor-setup row (legacy) or this table.
      id: 'servo-mapping' as const,
      label: 'Servo Functions',
      value:
        outputAssignmentInvalidCount > 0
          ? `${outputAssignmentInvalidCount} invalid`
          : outputAssignmentStagedCount > 0
            ? `${outputAssignmentStagedCount} staged`
            : `${servoMappingRowCount} channel${servoMappingRowCount === 1 ? '' : 's'}`,
      detail:
        'Assign each SERVOn output to a function — motor, control-surface, aux servo, or pass-through — directly from a per-channel table.',
      tone:
        outputAssignmentInvalidCount > 0
          ? 'danger'
          : outputAssignmentStagedCount > 0
            ? 'warning'
            : servoMappingRowCount > 0
              ? 'neutral'
              : 'warning'
    },
    {
      id: 'peripherals' as const,
      label: 'Peripherals & Alerts',
      value:
        outputPeripheralInvalidDraftCount > 0
          ? `${outputPeripheralInvalidDraftCount} invalid`
          : outputPeripheralStagedDraftCount > 0
            ? `${outputPeripheralStagedDraftCount} staged`
            : `${configuredAuxOutputCount} aux`,
      detail:
        hasNotificationLedTypes || hasNotificationBuzzTypes || outputAdditionalGroupCount > 0
          ? 'Output-role editing, notifications, LEDs, buzzer configuration, and additional output settings stay grouped here.'
          : 'No notification or auxiliary-output settings are currently exposed on this vehicle.',
      tone:
        outputPeripheralInvalidDraftCount > 0
          ? 'danger'
          : outputPeripheralStagedDraftCount > 0
            ? 'warning'
            : configuredAuxOutputCount > 0
              ? 'success'
              : 'neutral'
    },
    {
      id: 'review' as const,
      label: 'Review',
      value:
        totalOutputInvalidDrafts > 0
          ? `${totalOutputInvalidDrafts} invalid`
          : totalOutputStagedDrafts > 0
            ? `${totalOutputStagedDrafts} staged`
            : 'In sync',
      detail:
        totalOutputStagedDrafts > 0
          ? 'Output changes are staged locally. Review the grouped draft list before applying each scope.'
          : totalOutputInvalidDrafts > 0
            ? 'Some output changes still need attention before they can be applied safely.'
            : 'Output assignments, ESC settings, and notification settings are currently in sync with the controller.',
      tone:
        totalOutputInvalidDrafts > 0
          ? 'danger'
          : totalOutputStagedDrafts > 0
            ? 'warning'
            : 'success'
    }
  ]
}
