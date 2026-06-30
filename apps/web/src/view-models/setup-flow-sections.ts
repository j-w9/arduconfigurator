// Setup-flow section descriptors for the guided Setup view.
//
// Part of the App.tsx view-model decomposition. The guided-setup section
// list — per-section criteria, summaries, evidence, action descriptors, and
// sequence/lock state — was built inline in a ~870-line useMemo. It is a
// pure derivation over the snapshot, the airframe/output/ESC summaries, the
// RC/mode/motor exercise states, and the operator confirmations, so it is
// lifted verbatim into buildSetupFlowSections. App.tsx passes those inputs in
// and keeps the same memo dependencies. Behavior-preserving — the action
// descriptors are kind/actionId data dispatched later by handleSetupFlowAction,
// so no handler closures move with it.

import {
  deriveAirframe,
  deriveCompassSetupAvailability,
  deriveEscSetupSummary,
  deriveOutputMappingSummary
} from '@arduconfig/ardupilot-core'
import type {
  ConfiguratorSnapshot,
  ModeAssignment,
  ModeSwitchEstimate,
  RcAxisId,
  RcRangeExerciseState
} from '@arduconfig/ardupilot-core'
import { formatArducopterBatteryFailsafeAction, formatArducopterThrottleFailsafe } from '@arduconfig/param-metadata'
import type {
  ModeSwitchExerciseState,
  MotorVerificationState,
  OrientationExerciseState,
  RcCalibrationSessionState,
  RcMappingSessionState,
  SetupConfirmationRecord,
  SetupFlowActionDescriptor,
  SetupFlowCriterion,
  SetupFlowFollowUpDescriptor,
  SetupFlowSectionDescriptor,
  SetupSectionOutcome
} from '../app-types'
import type { ParameterFollowUp } from '../hooks/use-parameter-feedback'
import type { RcDirectionResult } from './receiver-direction-check'
import { canRunGuidedAction, deriveCompassStepSkipReason, guidedActionButtonLabel } from '../guided-action-helpers'
import { readRoundedParameter } from '../selectors/parameter-read'
import { isReceiverSerialProtocol } from '../serial-port-helpers'
import { batteryHealthLabel, describeBatteryMonitor, formatRemaining, formatVoltage } from '../device-display'
import { failsafeActionLabel } from '../modes-failsafe-helpers'
import { formatConfirmationTime, formatOrientationLabel, formatSetupOutcome } from '../setup-format-helpers'
import { formatParameterSync } from '../status-formatters'
import {
  deriveSetupStatusFromCriteria,
  panelAnchorForSetupSection,
  setupPanelActionForSection
} from '../setup-flow-helpers'

export interface SetupFlowSectionsInputs {
  snapshot: ConfiguratorSnapshot
  airframe: ReturnType<typeof deriveAirframe>
  outputMapping: ReturnType<typeof deriveOutputMappingSummary>
  configuredOutputs: ReturnType<typeof deriveOutputMappingSummary>['motorOutputs']
  escSetup: ReturnType<typeof deriveEscSetupSummary>
  compassSetupAvailability: ReturnType<typeof deriveCompassSetupAvailability>
  isCopterVehicle: boolean
  modeSwitchExercise: ModeSwitchExerciseState
  modeSwitchEstimate: ModeSwitchEstimate
  modeExerciseAssignments: ModeAssignment[]
  motorVerification: MotorVerificationState
  orientationExercise: OrientationExerciseState
  rcCalibrationSession: RcCalibrationSessionState
  rcMappingSession: RcMappingSessionState
  rcRangeExercise: RcRangeExerciseState
  rcDirectionResults: Record<RcAxisId, RcDirectionResult>
  parameterFollowUp: ParameterFollowUp | undefined
  setupFlowFollowUp: SetupFlowFollowUpDescriptor | undefined
  setupConfirmations: Record<string, SetupConfirmationRecord>
  setupConfirmationSignatures: Record<string, string>
  batteryFailsafe: number | undefined
  batteryMonitor: number | undefined
  boardOrientation: number | undefined
  busyAction: string | undefined
  throttleFailsafe: number | undefined
  canRunGuidedMotorTest: boolean
  canRunModeSwitchExercise: boolean
  canRunMotorVerification: boolean
  canRunOrientationExercise: boolean
  canRunRcMappingExercise: boolean
  canRunRcRangeExercise: boolean
  currentMotorTestSucceeded: boolean
  currentMotorVerificationLabel: string | undefined
  modeSwitchExerciseSummary: string
  rcCalibrationSummary: string
  rcMappingSummary: string
  rcRangeExerciseSummary: string
}

export function buildSetupFlowSections(inputs: SetupFlowSectionsInputs): SetupFlowSectionDescriptor[] {
  const {
    snapshot,
    airframe,
    outputMapping,
    configuredOutputs,
    compassSetupAvailability,
    isCopterVehicle,
    modeSwitchExercise,
    modeSwitchEstimate,
    modeExerciseAssignments,
    orientationExercise,
    rcCalibrationSession,
    rcMappingSession,
    rcRangeExercise,
    rcDirectionResults,
    parameterFollowUp,
    setupFlowFollowUp,
    setupConfirmations,
    setupConfirmationSignatures,
    batteryFailsafe,
    batteryMonitor,
    boardOrientation,
    busyAction,
    throttleFailsafe,
    canRunModeSwitchExercise,
    canRunOrientationExercise,
    canRunRcMappingExercise,
    canRunRcRangeExercise,
    modeSwitchExerciseSummary,
    rcCalibrationSummary,
    rcMappingSummary,
    rcRangeExerciseSummary
  } = inputs

  function getSetupConfirmationRecord(sectionId: string): SetupConfirmationRecord | undefined {
    const record = setupConfirmations[sectionId]
    const signature = setupConfirmationSignatures[sectionId]
    if (!record || signature === undefined || record.signature !== signature) {
      return undefined
    }

    return record
  }

    const airframeConfirmation = getSetupConfirmationRecord('airframe')
    const outputsConfirmation = getSetupConfirmationRecord('outputs')
    const accelerometerConfirmation = getSetupConfirmationRecord('accelerometer')
    const levelConfirmation = getSetupConfirmationRecord('level')
    const compassConfirmation = getSetupConfirmationRecord('compass')
    const radioConfirmation = getSetupConfirmationRecord('radio')
    const failsafeConfirmation = getSetupConfirmationRecord('failsafe')
    const powerConfirmation = getSetupConfirmationRecord('power')

    const baseSections = snapshot.setupSections.map((section) => {
      const panel = panelAnchorForSetupSection(section.id)
      const actions: SetupFlowActionDescriptor[] = [setupPanelActionForSection(section.id, panel)]
      let summary = section.description
      let detail = section.notes[0] ?? `Use the ${panel.panelLabel} panel to continue this part of setup.`
      let evidence: string[] = []
      let criteria: SetupFlowCriterion[] = []
      let confirmationOutcome: SetupSectionOutcome | undefined

      switch (section.id) {
        case 'link':
          criteria = [
            {
              label: 'Heartbeat and vehicle identity detected',
              met: snapshot.connection.kind === 'connected' && snapshot.vehicle !== undefined
            },
            {
              label: 'Initial parameter snapshot synced',
              met: snapshot.parameterStats.status === 'complete'
            },
            {
              label: 'No pending reboot or refresh follow-up',
              met: !parameterFollowUp?.refreshRequired
            }
          ]
          summary = parameterFollowUp
            ? parameterFollowUp.requiresReboot
              ? 'A reboot and fresh parameter pull are required before setup can continue.'
              : 'Pull parameters again to confirm the controller state before moving on.'
            : snapshot.connection.kind !== 'connected'
              ? 'Connect to the vehicle and request the first parameter snapshot.'
              : snapshot.parameterStats.status === 'complete'
                ? `Initial sync complete at ${snapshot.parameterStats.downloaded}/${snapshot.parameterStats.total}.`
                : formatParameterSync(snapshot)
          detail = parameterFollowUp?.text
            ?? (snapshot.connection.kind !== 'connected'
              ? 'Use the header session strip first, then wait for heartbeat and the initial parameter sync.'
              : 'Re-run parameter sync whenever you need a fresh snapshot before continuing guided setup.')
          evidence = [
            `Link: ${snapshot.connection.kind}`,
            `Sync: ${formatParameterSync(snapshot)}`,
            parameterFollowUp
              ? `Follow-up: ${parameterFollowUp.requiresReboot ? 'reboot + refresh pending' : 'refresh pending'}`
              : 'Follow-up: clear'
          ]
          actions.unshift({
            kind: 'guided',
            label: guidedActionButtonLabel('request-parameters', snapshot, busyAction),
            tone: 'primary',
            actionId: 'request-parameters',
            disabled: busyAction !== undefined || !canRunGuidedAction(snapshot, 'request-parameters')
          })
          break
        case 'airframe':
          criteria = [
            ...(isCopterVehicle
              ? [
                  {
                    label: 'Frame class set to a valid value (FRAME_CLASS != 0)',
                    // FRAME_CLASS=0 IS a defined value, but it means "unset" /
                    // "Frame: UNSUPPORTED". The criterion needs to reflect the
                    // real signal (a chosen frame class), not just presence.
                    // Without this, the criterion ticked complete on every
                    // fresh FC even though calibrations were being refused.
                    met: airframe.frameClassValue !== undefined && airframe.frameClassValue !== 0
                  },
                  {
                    label: 'Frame type identified or intentionally ignored for this frame class',
                    met: airframe.frameTypeIgnored || airframe.frameTypeValue !== undefined
                  }
                ]
              : [
                  {
                    label: `${airframe.frameClassLabel} airframe detected`,
                    met: (snapshot.vehicle?.vehicle ?? 'Unknown') !== 'Unknown'
                  }
                ]),
            {
              label: 'Board orientation parameter is present',
              met: boardOrientation !== undefined
            },
            {
              label: 'Live attitude telemetry is present',
              met: snapshot.liveVerification.attitudeTelemetry.verified
            },
            {
              label: 'Orientation exercise passed',
              met: orientationExercise.status === 'passed'
            },
            {
              label: 'Operator confirmed the detected frame geometry matches the build',
              met: airframeConfirmation !== undefined
            }
          ]
          summary = isCopterVehicle
            ? `${airframe.frameClassLabel} / ${airframe.frameTypeLabel}`
            : airframe.frameClassLabel
          // FRAME_CLASS=0 is the cascade-of-cal-failures killer. When that
          // specific gate is the blocker, override the generic guidance with
          // the actionable next step instead of leaving the operator to scan
          // the criteria list for what's wrong.
          detail = isCopterVehicle && airframe.frameClassValue === 0
            ? 'FRAME_CLASS is unset (0) — set a valid frame class in Motors → ESC & Protocol (Frame) or Config → Frame before continuing. The autopilot reports "Frame: UNSUPPORTED" and will refuse every calibration command in this state.'
            : 'Confirm the detected frame geometry, verify the live horizon behavior against the board orientation, then explicitly sign off before moving on to output review or motor testing.'
          evidence = [
            ...(isCopterVehicle
              ? [
                  `Expected motors: ${airframe.expectedMotorCount ?? 'specialized frame'}`,
                  `Mapped motors: ${outputMapping.motorOutputs.length}`
                ]
              : [
                  `Airframe: ${airframe.frameClassLabel}`,
                  `Configured outputs: ${configuredOutputs.length}`
                ]),
            `Orientation: ${formatOrientationLabel(boardOrientation)}`,
            `Review: ${airframeConfirmation ? `confirmed at ${formatConfirmationTime(airframeConfirmation.confirmedAtMs)}` : 'pending operator confirmation'}`
          ]
          actions.unshift({
            kind: 'orientation-exercise',
            label:
              orientationExercise.status === 'passed'
                ? 'Run Orientation Check Again'
                : orientationExercise.status === 'failed'
                  ? 'Retry Orientation Check'
                  : orientationExercise.status === 'running'
                    ? 'Orientation Check Running'
                    : 'Run Orientation Check',
            tone: 'primary',
            disabled:
              orientationExercise.status === 'running' ||
              (!canRunOrientationExercise && orientationExercise.status !== 'failed' && orientationExercise.status !== 'passed')
          })
          actions.splice(1, 0, {
            kind: airframeConfirmation ? 'clear-confirmation' : 'confirm-step',
            label: airframeConfirmation ? 'Clear Review Confirmation' : 'Confirm Airframe Review',
            tone: 'secondary',
            sectionId: 'airframe',
            disabled: isCopterVehicle
              ? airframe.frameClassValue === undefined || (!airframe.frameTypeIgnored && airframe.frameTypeValue === undefined)
              : (snapshot.vehicle?.vehicle ?? 'Unknown') === 'Unknown'
          })
          break
        case 'outputs':
          criteria = isCopterVehicle
            ? [
                {
                  label: 'At least one motor output is mapped',
                  met: outputMapping.motorOutputs.length > 0
                },
                {
                  label: 'Motor output count matches the expected frame geometry',
                  met:
                    airframe.expectedMotorCount === undefined || outputMapping.motorOutputs.length === airframe.expectedMotorCount
                },
                {
                  label: 'No missing motor assignments are reported in the current mapping',
                  met: !outputMapping.notes.some((note) => note.startsWith('Missing motor assignments:'))
                },
                {
                  label: 'Operator reviewed the output map before any props-on activity',
                  met: outputsConfirmation !== undefined
                }
                // (Motor-order/direction verification and the separate ESC-range
                // confirmation gates were removed with the Motors-tab redesign —
                // direction is now checked manually in Motors -> Test / Motor
                // Setup, so the operator-review confirmation is the gate here.)
              ]
            : [
                {
                  // Plane/Rover/Sub are not a quad motor matrix; the
                  // SERVOx_FUNCTION map is reviewed via the Outputs view +
                  // raw Parameters until per-vehicle output surfaces land.
                  label: `${airframe.frameClassLabel} output assignments reviewed before any powered testing`,
                  met: outputsConfirmation !== undefined
                }
              ]
          summary = isCopterVehicle
            ? `${outputMapping.motorOutputs.length} mapped motor outputs, ${outputMapping.configuredAuxOutputs.length} configured auxiliary outputs.`
            : `${configuredOutputs.length} configured ${airframe.frameClassLabel} outputs (SERVOx_FUNCTION).`
          detail =
            outputMapping.notes[0]
            ?? 'Review the output map, then check motor order/direction manually in Motors → Test / Motor Setup before any props-on activity.'
          evidence = [
            ...outputMapping.notes.slice(0, 2),
            `Output review: ${outputsConfirmation ? `confirmed at ${formatConfirmationTime(outputsConfirmation.confirmedAtMs)}` : 'pending operator confirmation'}`
          ].slice(0, 4)
          actions.unshift({
            kind: outputsConfirmation ? 'clear-confirmation' : 'confirm-step',
            label: outputsConfirmation ? 'Clear Output Review' : 'Confirm Output Review',
            tone: 'secondary',
            sectionId: 'outputs',
            disabled: isCopterVehicle
              ? outputMapping.motorOutputs.length === 0 ||
                outputMapping.notes.some((note) => note.startsWith('Missing motor assignments:')) ||
                (airframe.expectedMotorCount !== undefined && outputMapping.motorOutputs.length !== airframe.expectedMotorCount)
              : (snapshot.vehicle?.vehicle ?? 'Unknown') === 'Unknown'
          })
          if (isCopterVehicle) {
            // The guided motor-direction verification, ESC-range confirm, and
            // bench-test actions were retired with the Motors-tab redesign —
            // order/direction is now checked manually in Motors → Test / Motor
            // Setup. Replace the generic panel action with a jump there.
            actions[actions.length - 1] = {
              kind: 'scroll',
              label: 'Open Motors',
              panelId: panel.panelId
            }
          }
          break
        case 'accelerometer': {
          const actionState = snapshot.guidedActions['calibrate-accelerometer']
          confirmationOutcome = accelerometerConfirmation?.outcome
          const accelerometerCalibrationRecorded =
            actionState.status === 'succeeded' || accelerometerConfirmation !== undefined
          if (accelerometerConfirmation?.outcome === 'already-done') {
            criteria = [
              {
                label: 'Operator marked accelerometer calibration as already completed externally',
                met: true
              }
            ]
            summary = 'Accelerometer calibration marked as already completed outside the configurator.'
            detail = 'This step was resolved from known-good external setup rather than rerun here. Re-run the calibration in ArduConfigurator any time you want to reconfirm it in-app.'
            evidence = [
              `Outcome: ${formatSetupOutcome(accelerometerConfirmation.outcome)}`,
              `Review: confirmed at ${formatConfirmationTime(accelerometerConfirmation.confirmedAtMs)}`,
              ...section.notes
            ].slice(0, 4)
            actions.unshift({
              kind: 'clear-confirmation',
              label: 'Clear External Calibration Confirmation',
              tone: 'primary',
              sectionId: 'accelerometer'
            })
            actions.splice(1, 0, {
              kind: 'guided',
              label: actionState.status === 'idle' ? 'Run Calibration Instead' : guidedActionButtonLabel('calibrate-accelerometer', snapshot, busyAction),
              tone: 'secondary',
              actionId: 'calibrate-accelerometer',
              disabled: busyAction !== undefined || !canRunGuidedAction(snapshot, 'calibrate-accelerometer')
            })
          } else {
            criteria = [
              {
                label: 'Accelerometer calibration completed successfully',
                met: actionState.status === 'succeeded' || section.status === 'complete'
              },
              {
                label: 'Calibration was recorded in-app or confirmed from prior review',
                met: accelerometerCalibrationRecorded
              }
            ]
            summary = actionState.summary
            detail =
              actionState.status === 'succeeded'
                ? 'Accelerometer calibration completed successfully in the shared runtime. Guided setup now counts this step as complete, and you can rerun it any time to verify it again.'
                : actionState.instructions[0] ?? 'Run the accelerometer calibration and follow each posture prompt in order.'
            evidence = [
              ...actionState.statusTexts.slice(-2),
              ...section.notes,
              accelerometerConfirmation
                ? `Review: confirmed at ${formatConfirmationTime(accelerometerConfirmation.confirmedAtMs)}`
                : actionState.status === 'succeeded'
                  ? `Recorded from in-app calibration at ${formatConfirmationTime(actionState.completedAtMs)}`
                  : 'Review: pending calibration'
            ].slice(0, 4)
            actions.unshift({
              kind: 'guided',
              label: guidedActionButtonLabel('calibrate-accelerometer', snapshot, busyAction),
              tone: 'primary',
              actionId: 'calibrate-accelerometer',
              disabled: busyAction !== undefined || !canRunGuidedAction(snapshot, 'calibrate-accelerometer')
            })
            if (actionState.status === 'requested' || actionState.status === 'running') {
              // A stranded 'running' cal write-blocks the whole session —
              // always give the operator a way out that isn't a reboot.
              actions.splice(1, 0, {
                kind: 'cancel-guided',
                label: 'Cancel Calibration',
                tone: 'secondary',
                actionId: 'calibrate-accelerometer'
              })
            }
            if (accelerometerConfirmation || actionState.status !== 'succeeded') {
              actions.splice(1, 0, {
                kind: accelerometerConfirmation ? 'clear-confirmation' : 'confirm-step',
                label: accelerometerConfirmation ? 'Clear Calibration Confirmation' : 'Confirm Calibration Complete',
                tone: 'secondary',
                sectionId: 'accelerometer',
                confirmationOutcome: 'complete',
                disabled: actionState.status !== 'succeeded'
              })
            }
            if (!accelerometerConfirmation && actionState.status !== 'succeeded') {
              actions.push({
                kind: 'confirm-step',
                label: 'Already Calibrated — Continue',
                tone: 'secondary',
                sectionId: 'accelerometer',
                confirmationOutcome: 'already-done',
                disabled: busyAction !== undefined
              })
            }
          }
          break
        }
        case 'level': {
          // Board-level calibration — distinct from the 6-pose accel
          // cal. One-shot: operator sets the FC level, AP samples gravity
          // a few seconds and stores AHRS_TRIM_X/Y. No per-pose loop.
          const actionState = snapshot.guidedActions['calibrate-level']
          confirmationOutcome = levelConfirmation?.outcome
          const levelCalRecorded = actionState.status === 'succeeded' || levelConfirmation !== undefined
          criteria = [
            {
              label: 'Board-level calibration completed successfully',
              met: actionState.status === 'succeeded' || section.status === 'complete'
            },
            {
              label: 'Calibration was recorded in-app or confirmed from prior review',
              met: levelCalRecorded
            }
          ]
          summary = actionState.summary
          detail =
            actionState.status === 'succeeded'
              ? 'AHRS_TRIM_X and AHRS_TRIM_Y were updated. Re-pull parameters if you want a clean post-cal snapshot.'
              : actionState.instructions[0] ?? 'Run the board-level calibration with the vehicle on a flat surface.'
          evidence = [
            ...actionState.statusTexts.slice(-2),
            ...section.notes,
            levelConfirmation
              ? `Review: confirmed at ${formatConfirmationTime(levelConfirmation.confirmedAtMs)}`
              : actionState.status === 'succeeded'
                ? `Recorded from in-app calibration at ${formatConfirmationTime(actionState.completedAtMs)}`
                : 'Review: pending calibration'
          ].slice(0, 4)
          actions.unshift({
            kind: 'guided',
            label: guidedActionButtonLabel('calibrate-level', snapshot, busyAction),
            tone: 'primary',
            actionId: 'calibrate-level',
            disabled: busyAction !== undefined || !canRunGuidedAction(snapshot, 'calibrate-level')
          })
          if (levelConfirmation || actionState.status !== 'succeeded') {
            actions.splice(1, 0, {
              kind: levelConfirmation ? 'clear-confirmation' : 'confirm-step',
              label: levelConfirmation ? 'Clear Calibration Confirmation' : 'Confirm Calibration Complete',
              tone: 'secondary',
              sectionId: 'level',
              confirmationOutcome: 'complete',
              disabled: actionState.status !== 'succeeded'
            })
          }
          if (!levelConfirmation && actionState.status !== 'succeeded') {
            actions.push({
              kind: 'confirm-step',
              label: 'Already Calibrated — Continue',
              tone: 'secondary',
              sectionId: 'level',
              confirmationOutcome: 'already-done',
              disabled: busyAction !== undefined
            })
          }
          break
        }
        case 'compass': {
          const actionState = snapshot.guidedActions['calibrate-compass']
          const compassStepSkipReason = deriveCompassStepSkipReason(snapshot)
          confirmationOutcome = compassConfirmation?.outcome
          const compassCalibrationRecorded =
            actionState.status === 'succeeded' || compassConfirmation !== undefined
          if (compassConfirmation?.outcome === 'not-applicable') {
            criteria = [
              {
                label: 'No enabled compass was detected on COMPASS_USE settings',
                met: compassSetupAvailability.enabledCompassCount === 0
              },
              {
                label: 'Operator confirmed this aircraft has no compass and can skip this step',
                met: true
              }
            ]
            summary = 'Compass step skipped because this aircraft is configured without an enabled compass.'
            detail = 'The guided flow will not block on compass calibration for this build. If compass hardware is added later, enable it and return to this step.'
            evidence = [
              `Outcome: ${formatSetupOutcome(compassConfirmation.outcome)}`,
              `GPS: ${compassSetupAvailability.gpsConfigured ? 'configured' : 'not detected'}`,
              `Enabled compasses: ${compassSetupAvailability.enabledCompassCount}`,
              `Review: confirmed at ${formatConfirmationTime(compassConfirmation.confirmedAtMs)}`
            ].slice(0, 4)
            actions.unshift({
              kind: 'clear-confirmation',
              label: 'Clear No-Compass Confirmation',
              tone: 'primary',
              sectionId: 'compass'
            })
            actions.splice(1, 0, {
              kind: 'guided',
              label: actionState.status === 'idle' ? 'Run Compass Calibration Instead' : guidedActionButtonLabel('calibrate-compass', snapshot, busyAction),
              tone: 'secondary',
              actionId: 'calibrate-compass',
              disabled: busyAction !== undefined || !canRunGuidedAction(snapshot, 'calibrate-compass')
            })
          } else if (compassConfirmation?.outcome === 'already-done') {
            criteria = [
              {
                label: 'Operator marked compass calibration as already completed externally',
                met: true
              }
            ]
            summary = 'Compass calibration marked as already completed outside the configurator.'
            detail = 'This step was resolved from known-good external setup rather than rerun here. Re-run compass calibration here any time you want to reconfirm it in-app.'
            evidence = [
              `Outcome: ${formatSetupOutcome(compassConfirmation.outcome)}`,
              `Review: confirmed at ${formatConfirmationTime(compassConfirmation.confirmedAtMs)}`,
              ...section.notes
            ].slice(0, 4)
            actions.unshift({
              kind: 'clear-confirmation',
              label: 'Clear External Compass Confirmation',
              tone: 'primary',
              sectionId: 'compass'
            })
            actions.splice(1, 0, {
              kind: 'guided',
              label: actionState.status === 'idle' ? 'Run Compass Calibration Instead' : guidedActionButtonLabel('calibrate-compass', snapshot, busyAction),
              tone: 'secondary',
              actionId: 'calibrate-compass',
              disabled: busyAction !== undefined || !canRunGuidedAction(snapshot, 'calibrate-compass')
            })
          } else if (compassStepSkipReason !== undefined && actionState.status !== 'succeeded') {
            criteria = [
              {
                label:
                  compassStepSkipReason === 'no-enabled-compass'
                    ? 'No enabled compass was detected on COMPASS_USE settings'
                    : 'Compass calibration is unsupported or no usable compass was detected on this build',
                met: true
              },
              {
                label:
                  compassStepSkipReason === 'no-enabled-compass'
                    ? 'This build can skip compass calibration until compass hardware is added or enabled'
                    : 'The flight controller reported that compass calibration is unavailable on this build',
                met: true
              }
            ]
            summary =
              compassStepSkipReason === 'unsupported'
                ? actionState.summary
                : 'No enabled compass was detected on this build.'
            detail =
              compassStepSkipReason === 'unsupported'
                ? 'Guided setup will not block on compass calibration for this aircraft. If compass hardware is later fitted or enabled, return to this step and run calibration again.'
                : 'Guided setup will skip compass calibration for this aircraft unless compass hardware is later added or enabled.'
            evidence = [
              ...(compassStepSkipReason === 'unsupported' ? [actionState.summary] : []),
              `GPS: ${compassSetupAvailability.gpsConfigured ? 'configured' : 'not detected'}`,
              `Enabled compasses: ${compassSetupAvailability.enabledCompassCount}`,
              ...section.notes,
              `Skip reason: ${compassStepSkipReason === 'unsupported' ? 'autopilot reported unsupported' : 'no enabled compass detected'}`
            ].slice(0, 4)
            actions.unshift({
              kind: 'guided',
              label:
                actionState.status === 'idle'
                  ? 'Run Compass Calibration Instead'
                  : guidedActionButtonLabel('calibrate-compass', snapshot, busyAction),
              tone: 'secondary',
              actionId: 'calibrate-compass',
              disabled: busyAction !== undefined || !canRunGuidedAction(snapshot, 'calibrate-compass')
            })
            if (compassStepSkipReason === 'no-enabled-compass') {
              actions.push({
                kind: 'confirm-step',
                label: 'Record No-Compass Skip',
                tone: 'secondary',
                sectionId: 'compass',
                confirmationOutcome: 'not-applicable',
                disabled: busyAction !== undefined
              })
            }
          } else {
            criteria = [
              {
                label: 'Compass calibration completed successfully',
                met: actionState.status === 'succeeded' || section.status === 'complete'
              },
              {
                label: 'Calibration was recorded in-app or confirmed from operator review',
                met: compassCalibrationRecorded
              }
            ]
            summary = actionState.summary
            detail =
              actionState.status === 'succeeded'
                ? 'Compass calibration completed successfully in the shared runtime. Guided setup now counts this step as complete, and you can rerun it any time to verify it again.'
                : actionState.instructions[0] ?? 'Run compass calibration when the vehicle is fully powered and magnetometer hardware is available.'
            evidence = [
              ...actionState.statusTexts.slice(-2),
              ...section.notes,
              compassConfirmation
                ? `Review: confirmed at ${formatConfirmationTime(compassConfirmation.confirmedAtMs)}`
                : actionState.status === 'succeeded'
                  ? `Recorded from in-app calibration at ${formatConfirmationTime(actionState.completedAtMs)}`
                  : 'Review: pending calibration'
            ].slice(0, 4)
            actions.unshift({
              kind: 'guided',
              label: guidedActionButtonLabel('calibrate-compass', snapshot, busyAction),
              tone: 'primary',
              actionId: 'calibrate-compass',
              disabled: busyAction !== undefined || !canRunGuidedAction(snapshot, 'calibrate-compass')
            })
            if (actionState.status === 'requested' || actionState.status === 'running') {
              // A stranded 'running' cal write-blocks the whole session —
              // always give the operator a way out that isn't a reboot.
              actions.splice(1, 0, {
                kind: 'cancel-guided',
                label: 'Cancel Calibration',
                tone: 'secondary',
                actionId: 'calibrate-compass'
              })
            }
            if (compassConfirmation || actionState.status !== 'succeeded') {
              actions.splice(1, 0, {
                kind: compassConfirmation ? 'clear-confirmation' : 'confirm-step',
                label: compassConfirmation ? 'Clear Calibration Confirmation' : 'Confirm Calibration Complete',
                tone: 'secondary',
                sectionId: 'compass',
                confirmationOutcome: 'complete',
                disabled: actionState.status !== 'succeeded'
              })
            }
            if (!compassConfirmation && actionState.status !== 'succeeded') {
              actions.push({
                kind: 'confirm-step',
                label: 'Already Calibrated — Continue',
                tone: 'secondary',
                sectionId: 'compass',
                confirmationOutcome: 'already-done',
                disabled: busyAction !== undefined
              })
            }
          }
          break
        }
        case 'radio':
          criteria = [
            {
              label: 'Live RC telemetry is present',
              met: snapshot.liveVerification.rcInput.verified
            },
            {
              label: 'RC mapping exercise captured roll, pitch, throttle, and yaw',
              met: rcMappingSession.status === 'ready'
            },
            {
              label: 'Stick range exercise passed',
              met: rcRangeExercise.status === 'passed'
            },
            {
              label: 'RC endpoint capture completed',
              met: rcCalibrationSession.status === 'ready'
            },
            {
              label: 'RC channel directions verified — no axis reads backwards',
              met: (['roll', 'pitch', 'throttle', 'yaw'] as const).every(
                (axis) => rcDirectionResults[axis] === 'correct'
              )
            },
            {
              label: 'Operator reviewed RC mapping and calibration values',
              met: radioConfirmation !== undefined
            }
          ]
          summary =
            rcMappingSession.status === 'running'
              ? rcMappingSummary
              : rcRangeExercise.status === 'running'
                ? rcRangeExerciseSummary
                : rcCalibrationSession.status === 'capturing'
                  ? rcCalibrationSummary
                  : rcRangeExercise.status === 'passed' && rcCalibrationSession.status === 'ready'
                    ? 'RC mapping, stick range, and endpoint capture are ready for operator review.'
                : snapshot.liveVerification.rcInput.verified
                  ? 'Live RC telemetry is present, but the full mapping and calibration flow still needs to complete.'
                  : 'Waiting for live RC telemetry before the RC mapping flow can start.'
          detail =
            rcMappingSession.status === 'failed'
              ? rcMappingSession.failureReason ?? 'RC mapping exercise failed.'
              : rcRangeExercise.status === 'failed'
                ? rcRangeExercise.failureReason ?? 'Stick range exercise failed.'
                : rcCalibrationSession.status === 'failed'
                  ? rcCalibrationSession.failureReason ?? 'RC endpoint capture failed.'
                  : 'Use the guided one-axis-at-a-time receiver mapping first, then verify stick travel, capture endpoints, and sign off the full radio review.'
          evidence = [
            snapshot.liveVerification.rcInput.verified
              ? `${snapshot.liveVerification.rcInput.channelCount} RC channels live`
              : 'No live RC telemetry yet',
            `Mapping: ${rcMappingSession.status}`,
            `Ranges: ${rcRangeExercise.status}`,
            `Endpoints: ${rcCalibrationSession.status}`,
            `Review: ${radioConfirmation ? `confirmed at ${formatConfirmationTime(radioConfirmation.confirmedAtMs)}` : 'pending operator confirmation'}`
          ].slice(0, 4)
          actions.unshift({
            kind: 'rc-mapping-exercise',
            label: rcMappingSession.status === 'ready' ? 'Run Guided Mapping Again' : 'Begin Guided Mapping',
            tone: 'primary',
            disabled: !canRunRcMappingExercise || rcMappingSession.status === 'running'
          })
          actions.unshift({
            kind: 'rc-range-exercise',
            label: rcRangeExercise.status === 'passed' ? 'Run Stick Exercise Again' : 'Start Stick Exercise',
            tone: 'secondary',
            disabled: !canRunRcRangeExercise || rcRangeExercise.status === 'running'
          })
          actions.splice(1, 0, {
            kind: radioConfirmation ? 'clear-confirmation' : 'confirm-step',
            label: radioConfirmation ? 'Clear RC Review' : 'Confirm RC Review',
            tone: 'secondary',
            sectionId: 'radio',
            disabled:
              !snapshot.liveVerification.rcInput.verified ||
              rcMappingSession.status !== 'ready' ||
              rcRangeExercise.status !== 'passed' ||
              rcCalibrationSession.status !== 'ready'
          })
          actions.splice(1, 0, {
            kind: 'scroll',
            label:
              rcCalibrationSession.status === 'ready'
                ? 'Stage RC Calibration'
                : rcMappingSession.status === 'ready'
                  ? 'Run RC Calibration'
                  : 'Open Guided RC Mapping',
            panelId: panel.panelId
          })
          // RCIN preflight: no live RC telemetry AND no UART assigned to RC
          // input. On serial-receiver builds (ELRS/CRSF/SBUS on a UART — the
          // common FPV case) the step used to just say "waiting for live RC
          // telemetry", leaving the operator to discover the Ports detour on
          // their own. Receivers on the dedicated RCIN pin don't need a port,
          // so this only points at Ports, it doesn't gate on it.
          if (!snapshot.liveVerification.rcInput.verified) {
            const hasReceiverSerialPort = Array.from({ length: 9 }, (_, portNumber) =>
              readRoundedParameter(snapshot, `SERIAL${portNumber}_PROTOCOL`)
            ).some((protocolValue) => isReceiverSerialProtocol(protocolValue))
            if (!hasReceiverSerialPort) {
              detail =
                'No live RC telemetry, and no serial port is assigned to RC input. If this build uses a serial receiver (ELRS/CRSF/SBUS on a UART), open Ports, set that UART to RCIN (SERIALn_PROTOCOL = 23), write, then reboot — guided-setup progress is preserved across the reboot. Receivers on the dedicated RCIN pin need no port change.'
              evidence = ['No serial port set to RC input (RCIN)', ...evidence].slice(0, 4)
              actions.unshift({
                kind: 'scroll',
                label: 'Open Ports — Assign RCIN',
                tone: 'primary',
                panelId: 'setup-panel-ports'
              })
            }
          }
          break
        case 'failsafe':
          criteria = [
            {
              label: 'Throttle failsafe setting is present',
              met: throttleFailsafe !== undefined
            },
            {
              label: 'Battery failsafe action is present',
              met: batteryFailsafe !== undefined
            },
            {
              label: 'Live RC link is verified during review',
              met: snapshot.liveVerification.rcInput.verified
            },
            {
              label: 'Live battery telemetry is verified during review',
              met: snapshot.liveVerification.batteryTelemetry.verified
            },
            {
              label: 'Operator reviewed the configured failsafe behavior',
              met: failsafeConfirmation !== undefined
            }
          ]
          summary = `Throttle failsafe ${failsafeActionLabel(
            snapshot,
            'FS_THR_ENABLE',
            throttleFailsafe,
            formatArducopterThrottleFailsafe
          )}, battery action ${failsafeActionLabel(
            snapshot,
            'BATT_FS_LOW_ACT',
            batteryFailsafe,
            formatArducopterBatteryFailsafeAction
          )}.`
          detail =
            snapshot.liveVerification.batteryTelemetry.verified && snapshot.liveVerification.rcInput.verified
              ? 'Failsafe settings are visible with live RC and battery telemetry present.'
              : 'Keep both RC and battery telemetry live while reviewing the failsafe configuration.'
          evidence = [
            snapshot.liveVerification.rcInput.verified ? 'RC link live' : 'RC link not yet verified',
            snapshot.liveVerification.batteryTelemetry.verified ? 'Battery telemetry live' : 'Battery telemetry not yet verified',
            `Review: ${failsafeConfirmation ? `confirmed at ${formatConfirmationTime(failsafeConfirmation.confirmedAtMs)}` : 'pending operator confirmation'}`
          ]
          actions.unshift({
            kind: failsafeConfirmation ? 'clear-confirmation' : 'confirm-step',
            label: failsafeConfirmation ? 'Clear Failsafe Review' : 'Confirm Failsafe Review',
            tone: 'primary',
            sectionId: 'failsafe',
            disabled:
              throttleFailsafe === undefined ||
              batteryFailsafe === undefined ||
              !snapshot.liveVerification.rcInput.verified ||
              !snapshot.liveVerification.batteryTelemetry.verified
          })
          break
        case 'modes':
          criteria = [
            {
              label: 'Mode channel is configured',
              met: modeSwitchEstimate.channelNumber !== undefined
            },
            {
              label: 'At least two distinct flight-mode positions are assigned',
              met: modeExerciseAssignments.length >= 2
            },
            {
              label: 'Mode switch exercise passed',
              met: modeSwitchExercise.status === 'passed'
            }
          ]
          summary =
            modeSwitchExercise.status === 'passed'
              ? 'Mode switch exercise passed with all distinct configured positions observed.'
              : modeSwitchExercise.status === 'running'
                ? modeSwitchExerciseSummary
                : modeSwitchEstimate.estimatedSlot !== undefined
                  ? `Live mode switch detected on CH${modeSwitchEstimate.channelNumber ?? '?'}, but the full switch exercise still needs to pass.`
                  : 'Waiting for a configured live mode channel before starting the switch exercise.'
          detail =
            modeSwitchExercise.status === 'failed'
              ? modeSwitchExercise.failureReason ?? 'Mode switch exercise failed.'
              : 'Walk through every configured flight-mode position and confirm the app observes each slot.'
          evidence = [
            modeSwitchEstimate.channelNumber !== undefined ? `Mode channel: CH${modeSwitchEstimate.channelNumber}` : 'Mode channel not configured',
            `Exercise: ${modeSwitchExercise.status}`
          ]
          actions.unshift({
            kind: 'mode-switch-exercise',
            label: modeSwitchExercise.status === 'passed' ? 'Run Switch Exercise Again' : 'Start Switch Exercise',
            tone: 'primary',
            disabled: !canRunModeSwitchExercise || modeSwitchExercise.status === 'running'
          })
          break
        case 'power':
          criteria = [
            {
              label: 'Battery monitor is configured',
              met: batteryMonitor !== undefined && batteryMonitor > 0
            },
            {
              label: 'Live battery telemetry is present',
              met: snapshot.liveVerification.batteryTelemetry.verified
            },
            {
              label: 'Operator confirmed the power and battery readings were reviewed',
              met: powerConfirmation !== undefined
            },
            {
              label: 'No active pre-arm safety issues are present',
              met: snapshot.preArmStatus.healthy
            }
          ]
          summary = snapshot.liveVerification.batteryTelemetry.verified
            ? `${formatVoltage(snapshot.liveVerification.batteryTelemetry.voltageV)} and ${formatRemaining(
                snapshot.liveVerification.batteryTelemetry.remainingPercent
              )}.`
            : 'Battery telemetry has not been verified yet.'
          detail =
            batteryHealthLabel(snapshot) === 'Battery healthy'
              ? 'Power telemetry is live and currently healthy. Reboot is available here when setup changes require it.'
              : 'Use the power panel to verify the battery monitor, remaining estimate, and any required reboot/refresh steps.'
          evidence = [
            `Battery monitor: ${describeBatteryMonitor(batteryMonitor)}`,
            `Health: ${batteryHealthLabel(snapshot)}`,
            snapshot.preArmStatus.healthy ? 'Pre-arm: clear' : `Pre-arm: ${snapshot.preArmStatus.issues.length} issue(s)`,
            `Review: ${powerConfirmation ? `confirmed at ${formatConfirmationTime(powerConfirmation.confirmedAtMs)}` : 'pending operator confirmation'}`
          ]
          actions.unshift({
            kind: 'guided',
            label: guidedActionButtonLabel('reboot-autopilot', snapshot, busyAction),
            tone: 'secondary',
            actionId: 'reboot-autopilot',
            disabled: busyAction !== undefined || !canRunGuidedAction(snapshot, 'reboot-autopilot')
          })
          actions.unshift({
            kind: powerConfirmation ? 'clear-confirmation' : 'confirm-step',
            label: powerConfirmation ? 'Clear Power Review' : 'Confirm Power Review',
            tone: 'primary',
            sectionId: 'power',
            disabled: batteryMonitor === undefined || batteryMonitor <= 0 || !snapshot.liveVerification.batteryTelemetry.verified
          })
          break
        default:
          break
      }

      const status = deriveSetupStatusFromCriteria(criteria)
      const criteriaMetCount = criteria.filter((criterion) => criterion.met).length

      return {
        id: section.id,
        title: section.title,
        status,
        sequenceState: 'locked',
        summary,
        detail,
        evidence,
        criteria,
        criteriaMetCount,
        panelId: panel.panelId,
        panelLabel: panel.panelLabel,
        confirmationOutcome,
        actions
      }
    })

    let currentIncompleteSectionTitle: string | undefined

    return baseSections.map((section) => {
      if (section.status === 'complete') {
        return {
          ...section,
          sequenceState: 'complete'
        }
      }

      if (!currentIncompleteSectionTitle) {
        currentIncompleteSectionTitle = section.title
        return {
          ...section,
          sequenceState: 'current'
        }
      }

      return {
        ...section,
        sequenceState: 'locked',
        blockingReason: setupFlowFollowUp
          ? setupFlowFollowUp.title
          : `Complete ${currentIncompleteSectionTitle} before moving on to ${section.title}.`
      }
    })
}

