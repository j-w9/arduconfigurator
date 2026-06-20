// Receiver workbench task-card cluster, lifted out of App.tsx as the
// largest bounded slice yet toward a ReceiverSection extract. Pure
// behavior-neutral move: every IIFE / useMemo body + dep array is
// byte-identical to the App.tsx original. The cluster covers:
//   - receiverEndpointTask     (Endpoints card value/detail/tone)
//   - receiverFlightModesTask  (Flight Modes card value/detail/tone)
//   - recommendedReceiverTaskId (which task the Receiver workflow should
//                                land on by default, given the live state)
//   - activeReceiverTaskId     (override-or-recommended)
//   - receiverTaskCards        (the 5-card list rendered by ReceiverView)
//   - activeReceiverTask       (the card matching activeReceiverTaskId)

import { useMemo } from 'react'

import type {
  ConfiguratorSnapshot,
  ModeAssignment,
  ModeSwitchEstimate,
  RcRangeExerciseState
} from '@arduconfig/ardupilot-core'

import type {
  ModeSwitchExerciseState,
  RcCalibrationSessionState,
  RcMappingSessionState
} from '../app-types'
import { RC_CALIBRATION_AXIS_ORDER } from '../setup-exercise-helpers'
import type { SerialPortViewModel } from '../serial-port-helpers'
import type { StatusTone } from '../status-tone'
import { toneForModeSwitchExercise } from '../tone-helpers'
import type { ReceiverTaskId } from '../views/Receiver'

export interface ReceiverTaskCard {
  id: ReceiverTaskId
  label: string
  value: string
  detail: string
  tone: StatusTone
}

interface ReceiverEndpointOrFlightModesTask {
  tone: StatusTone
  value: string
  detail: string
}

export interface UseReceiverTasksResult {
  receiverEndpointTask: ReceiverEndpointOrFlightModesTask
  receiverFlightModesTask: ReceiverEndpointOrFlightModesTask
  recommendedReceiverTaskId: ReceiverTaskId
  activeReceiverTaskId: ReceiverTaskId
  receiverTaskCards: ReceiverTaskCard[]
  activeReceiverTask: ReceiverTaskCard
}

/**
 * Computes the Receiver workbench's 5 task cards (Mapping / Endpoints /
 * Flight Modes / Signal Setup / Review) plus the "which one should be
 * active right now?" recommendation. Inputs are exercise states from
 * useRcExercises, the derived summary strings from the per-cluster
 * derivation hooks (rcRange / rcCalibration / modeSwitch / rcMapping),
 * the receiver-link port view models, the Receiver workflow draft +
 * invalid counts, and the active-task override from view state.
 */
export function useReceiverTasks(input: {
  snapshot: ConfiguratorSnapshot
  rcRangeExercise: RcRangeExerciseState
  rcCalibrationSession: RcCalibrationSessionState
  modeSwitchExercise: ModeSwitchExerciseState
  modeSwitchEstimate: ModeSwitchEstimate
  modeExerciseAssignments: ModeAssignment[]
  rcMappingSession: RcMappingSessionState
  rcRangeExerciseCompletedCount: number
  rcRangeExerciseSummary: string
  rcCalibrationSummary: string
  modeSwitchExerciseSummary: string
  rcMappingSummary: string
  rcMappingCapturedCount: number
  receiverWorkflowDraftCount: number
  receiverWorkflowInvalidCount: number
  receiverAdvancedDraftCount: number
  receiverAdvancedInvalidCount: number
  receiverLinkPorts: SerialPortViewModel[]
  receiverTaskOverride: ReceiverTaskId | undefined
}): UseReceiverTasksResult {
  const {
    snapshot,
    rcRangeExercise,
    rcCalibrationSession,
    modeSwitchExercise,
    modeSwitchEstimate,
    modeExerciseAssignments,
    rcMappingSession,
    rcRangeExerciseCompletedCount,
    rcRangeExerciseSummary,
    rcCalibrationSummary,
    modeSwitchExerciseSummary,
    rcMappingSummary,
    rcMappingCapturedCount,
    receiverWorkflowDraftCount,
    receiverWorkflowInvalidCount,
    receiverAdvancedDraftCount,
    receiverAdvancedInvalidCount,
    receiverLinkPorts,
    receiverTaskOverride
  } = input

  const receiverEndpointTask: ReceiverEndpointOrFlightModesTask = (() => {
    if (rcRangeExercise.status === 'failed' || rcCalibrationSession.status === 'failed') {
      return {
        tone: 'danger' as const,
        value: 'Needs attention',
        detail:
          rcRangeExercise.failureReason ??
          rcCalibrationSession.failureReason ??
          'Stick range or endpoint capture needs attention before the radio setup is complete.'
      }
    }
    if (rcRangeExercise.status === 'running' || rcCalibrationSession.status === 'capturing') {
      return {
        tone: 'warning' as const,
        value: 'In progress',
        detail:
          rcRangeExercise.status === 'running'
            ? rcRangeExerciseSummary
            : rcCalibrationSummary
      }
    }
    if (rcRangeExercise.status === 'passed' && rcCalibrationSession.status === 'ready') {
      return {
        tone: 'success' as const,
        value: 'Ready',
        detail: 'Stick travel and endpoint capture both completed successfully.'
      }
    }
    if (!snapshot.liveVerification.rcInput.verified) {
      return {
        tone: 'warning' as const,
        value: 'Waiting',
        detail: 'Live RC telemetry is still needed before endpoint work can start.'
      }
    }
    return {
      tone: 'neutral' as const,
      value: `${rcRangeExerciseCompletedCount}/4 axes checked`,
      detail: 'Verify stick travel first, then capture the calibrated min, center, and max values.'
    }
  })()
  const receiverFlightModesTask: ReceiverEndpointOrFlightModesTask = (() => {
    if (modeSwitchExercise.status === 'failed') {
      return {
        tone: 'danger' as const,
        value: 'Needs attention',
        detail: modeSwitchExercise.failureReason ?? 'The current flight-mode switch setup needs review.'
      }
    }
    if (modeSwitchExercise.status === 'running') {
      return {
        tone: 'warning' as const,
        value: 'Exercising',
        detail: modeSwitchExerciseSummary
      }
    }
    if (modeSwitchEstimate.channelNumber === undefined) {
      return {
        tone: 'warning' as const,
        value: 'Set channel',
        detail: 'Choose which receiver channel ArduPilot should interpret as the flight-mode switch.'
      }
    }
    if (modeSwitchExercise.status === 'passed') {
      return {
        tone: 'success' as const,
        value: `${modeExerciseAssignments.length} positions`,
        detail: 'The configured flight-mode switch positions were exercised successfully.'
      }
    }
    return {
      tone: 'neutral' as const,
      value: modeExerciseAssignments.length > 0 ? `${modeExerciseAssignments.length} configured` : 'Review',
      detail: 'Assign the mode channel, confirm the slot map, then exercise the switch positions.'
    }
  })()
  const recommendedReceiverTaskId = useMemo<ReceiverTaskId>(() => {
    if (receiverWorkflowInvalidCount > 0) {
      return 'review'
    }
    if (receiverAdvancedInvalidCount > 0) {
      return 'advanced'
    }
    if (rcMappingSession.status === 'running' || rcMappingSession.status === 'failed' || rcMappingSession.status !== 'ready') {
      return 'mapping'
    }
    if (
      rcRangeExercise.status === 'running' ||
      rcRangeExercise.status === 'failed' ||
      rcCalibrationSession.status === 'capturing' ||
      rcCalibrationSession.status === 'failed' ||
      rcRangeExercise.status !== 'passed' ||
      rcCalibrationSession.status !== 'ready'
    ) {
      return 'endpoints'
    }
    if (modeSwitchExercise.status === 'running' || modeSwitchExercise.status === 'failed' || modeSwitchExercise.status !== 'passed') {
      return 'flight-modes'
    }
    // DELIBERATELY no "staged > 0 → review/advanced" auto-route here.
    // Typing a small RC tweak used to yank the operator into Review or
    // Signal Setup mid-edit; the persistent staged-changes chip already
    // surfaces the pending count, so the operator can step over to those
    // tasks on their own. Invalid drafts still route (above), since
    // those are blocking write and worth pulling attention.
    return 'mapping'
  }, [
    modeSwitchExercise.status,
    rcCalibrationSession.status,
    rcMappingSession.status,
    rcRangeExercise.status,
    receiverAdvancedInvalidCount,
    receiverWorkflowInvalidCount
  ])
  const activeReceiverTaskId = receiverTaskOverride ?? recommendedReceiverTaskId
  const receiverTaskCards = useMemo<ReceiverTaskCard[]>(
    () => [
      {
        id: 'mapping' as const,
        label: 'Mapping',
        value:
          rcMappingSession.status === 'ready'
            ? 'Ready'
            : rcMappingSession.status === 'running'
              ? `Step ${Math.min(rcMappingCapturedCount + 1, RC_CALIBRATION_AXIS_ORDER.length)}/${RC_CALIBRATION_AXIS_ORDER.length}`
              : rcMappingSession.status === 'failed'
                ? 'Needs attention'
                : snapshot.liveVerification.rcInput.verified
                  ? 'Not started'
                  : 'Waiting',
        detail: rcMappingSummary,
        tone: toneForModeSwitchExercise(
          rcMappingSession.status === 'ready' ? 'passed' : rcMappingSession.status === 'running' ? 'running' : rcMappingSession.status === 'failed' ? 'failed' : 'idle'
        )
      },
      {
        id: 'endpoints' as const,
        label: 'Endpoints',
        value: receiverEndpointTask.value,
        detail: receiverEndpointTask.detail,
        tone: receiverEndpointTask.tone
      },
      {
        id: 'flight-modes' as const,
        label: 'Flight Modes',
        value: receiverFlightModesTask.value,
        detail: receiverFlightModesTask.detail,
        tone: receiverFlightModesTask.tone
      },
      {
        id: 'advanced' as const,
        label: 'Signal Setup',
        value:
          receiverAdvancedInvalidCount > 0
            ? `${receiverAdvancedInvalidCount} invalid`
            : receiverAdvancedDraftCount > 0
              ? `${receiverAdvancedDraftCount} staged`
              : 'In sync',
        detail:
          receiverLinkPorts.length > 0
            ? `Receiver link on ${receiverLinkPorts.map((port) => port.label).join(', ')}. RSSI and extra receiver settings are available here.`
            : 'RSSI setup and additional receiver settings remain available here when you need them.',
        tone:
          receiverAdvancedInvalidCount > 0
            ? 'danger'
            : receiverAdvancedDraftCount > 0
              ? 'warning'
              : 'neutral'
      },
      {
        id: 'review' as const,
        label: 'Review',
        value:
          receiverWorkflowInvalidCount > 0
            ? `${receiverWorkflowInvalidCount} invalid`
            : receiverWorkflowDraftCount > 0
              ? `${receiverWorkflowDraftCount} staged`
              : 'In sync',
        detail:
          receiverWorkflowDraftCount > 0
            ? 'Receiver mapping, calibration, or mode changes are staged and ready for final review.'
            : receiverWorkflowInvalidCount > 0
              ? 'Some receiver changes need attention before they can be applied safely.'
              : 'Receiver workflow changes are currently in sync with the controller.',
        tone:
          receiverWorkflowInvalidCount > 0
            ? 'danger'
            : receiverWorkflowDraftCount > 0
              ? 'warning'
              : 'success'
      }
    ],
    [
      rcMappingCapturedCount,
      rcMappingSession.status,
      rcMappingSummary,
      receiverEndpointTask.detail,
      receiverEndpointTask.tone,
      receiverEndpointTask.value,
      receiverFlightModesTask.detail,
      receiverFlightModesTask.tone,
      receiverFlightModesTask.value,
      receiverAdvancedDraftCount,
      receiverAdvancedInvalidCount,
      receiverLinkPorts,
      receiverWorkflowDraftCount,
      receiverWorkflowInvalidCount,
      snapshot.liveVerification.rcInput.verified
    ]
  )
  const activeReceiverTask = receiverTaskCards.find((task) => task.id === activeReceiverTaskId) ?? receiverTaskCards[0]

  return {
    receiverEndpointTask,
    receiverFlightModesTask,
    recommendedReceiverTaskId,
    activeReceiverTaskId,
    receiverTaskCards,
    activeReceiverTask
  }
}
