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
import { buildSetupPortsEvidence, describeDuplicateRcin, describeUnconfiguredPort } from './setup-ports-evidence'
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
      let blockingReason: string | undefined

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
        case 'ports': {
          // Ports is the step that unblocks every peripheral after it. The
          // failure it exists to prevent: a receiver wired to a pad whose
          // SERIALn_PROTOCOL is still 2 (MAVLink2), which cannot work and
          // which nothing else in the flow explains — the Radio step just
          // never completes. uarts.txt already carries the evidence, so name
          // the mismatch rather than leave it to be found with a scope.
          const portsEvidence = buildSetupPortsEvidence({
            rawText: snapshot.hardware.uartsFile?.rawText,
            previousRawText: snapshot.hardware.uartsFile?.previousRawText,
            protocolByPort: Object.fromEntries(
              Array.from({ length: 10 }, (_, port) => [
                port,
                readRoundedParameter(snapshot, `SERIAL${port}_PROTOCOL`)
              ])
            )
          })
          const portsDuplicateRcin = portsEvidence.duplicateRcinPorts.length > 0
          const portsMismatched = portsEvidence.unconfigured.length > 0 || portsDuplicateRcin
          criteria = [
            {
              label: 'Serial port protocols are synced from the flight controller',
              met: snapshot.parameterStats.status === 'complete'
            },
            {
              // Blocks on a DETECTED mismatch only. Absent counters (demo, or
              // a board that serves no uarts.txt) must not gate the flow —
              // a step that blocks on evidence it may never receive is a dead
              // end, not a safeguard. The summary says the check could not run
              // rather than claiming the ports are right.
              label: 'Every port carrying traffic can decode it, and only one port claims RC input',
              met: !portsMismatched
            }
          ]
          summary = portsDuplicateRcin
            ? `${portsEvidence.duplicateRcinPorts.length + 1} ports claim RC input — only the lowest-numbered one is used.`
            : portsMismatched
            ? `${portsEvidence.unconfigured.length} port(s) carrying traffic the flight controller cannot use.`
            : portsEvidence.trafficUnknown
              ? 'Port traffic counters are unavailable — review the assignments manually.'
              : 'Configured port protocols match the ports that are carrying traffic.'
          detail = portsDuplicateRcin
            ? 'ArduPilot accepts only one RC input port: the lowest-numbered one wins and the others are refused at boot, so a receiver on a later port is silently ignored. Disable RC input on the ports that are not carrying the receiver.'
            : portsMismatched
            ? 'A peripheral is talking on a port the flight controller cannot decode it on, so whatever is wired there cannot work. Fix that port\u2019s protocol and baud before setting up the receiver, GPS or OSD that depends on it.'
            : 'Set each serial port to whatever is physically wired to it. Do this before the receiver, GPS and OSD steps — they configure peripherals that only work once their port is right.'
          evidence = [
            ...(portsDuplicateRcin ? [describeDuplicateRcin(portsEvidence.duplicateRcinPorts)] : []),
            ...portsEvidence.unconfigured.slice(0, 2).map(describeUnconfiguredPort),
            portsEvidence.trafficUnknown
              ? 'Port traffic: counters unavailable'
              : `Ports carrying traffic: ${portsEvidence.ports.filter((port) => port.rxBytes > 0).length}`,
            // Said out loud rather than left as silence. Framing errors are
            // cumulative since boot while byte counts are per-read deltas, so
            // until a second sample of uarts.txt arrives there is no honest
            // decode verdict — and "no findings" would otherwise read as "all
            // ports check out".
            ...(portsEvidence.decodeVerdictPending
              ? ['Decode check: waiting for a second port-counter sample']
              : []),
            // No "Review: pending" pill — there is no confirm action on this
            // step, so promising a review would describe a control that does
            // not exist.
            ...section.notes
          ].slice(0, 4)
          // No confirm-step action here. Completion is driven entirely by the
          // traffic check, so a sign-off button would record a confirmation
          // that satisfies no criterion and changes nothing on screen — it
          // read as a dead button promoted to "do this now". When a mismatch
          // IS found the remedy is to fix the port protocol, which is what the
          // generic panel action already offers; that action is left as the
          // step's own navigation rather than adding a second one beside it.
          break
        }
        case 'airframe': {
          // An 'already-done' airframe sign-off is the orientation waiver: the
          // operator is asserting the frame geometry AND the horizon behaviour
          // were verified outside the configurator. A plain 'complete' sign-off
          // still requires the exercise to pass.
          const airframeOrientationWaived = airframeConfirmation?.outcome === 'already-done'
          // FRAME_CLASS=0 is present-but-unset. The completion criterion below
          // requires it non-zero, so letting the operator "confirm" at zero
          // produced a button that ticked nothing and explained nothing.
          const airframeFrameUnusable =
            isCopterVehicle
              ? airframe.frameClassValue === undefined ||
                airframe.frameClassValue === 0 ||
                (!airframe.frameTypeIgnored && airframe.frameTypeValue === undefined)
              : (snapshot.vehicle?.vehicle ?? 'Unknown') === 'Unknown'
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
              // Waived alongside the exercise below: both depend on the same
              // live ATTITUDE stream, so leaving this one hard would rebuild the
              // wall the waiver exists to remove.
              label: 'Live attitude telemetry is present',
              met: snapshot.liveVerification.attitudeTelemetry.verified || airframeOrientationWaived
            },
            {
              // The orientation check needs the operator to physically tilt the
              // aircraft past ±12°. That is not always possible (a bench FC, a
              // large airframe, a static demo/replay feed with a level attitude
              // stream), and this criterion gates the WHOLE wizard: without a
              // waiver every later step stays sequenceState 'locked' with its
              // rail button disabled and no way forward. So it accepts an
              // explicit operator waiver, exactly like the calibration steps'
              // "Already Calibrated — Continue".
              label: airframeOrientationWaived
                ? 'Orientation verified outside the configurator'
                : 'Orientation exercise passed',
              met: orientationExercise.status === 'passed' || airframeOrientationWaived
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
            : airframeOrientationWaived
              ? 'Orientation was signed off as verified outside the configurator, so the tilt exercise is not required for this build. Run the orientation check any time you want to confirm the horizon behavior in-app.'
              : 'Confirm the detected frame geometry, verify the live horizon behavior against the board orientation, then explicitly sign off before moving on to output review or motor testing. If the aircraft cannot be tilted here, sign the orientation off as verified elsewhere.'
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
            label: airframeConfirmation
              ? airframeOrientationWaived
                ? 'Clear Orientation Waiver'
                : 'Clear Review Confirmation'
              : 'Confirm Airframe Review',
            tone: 'secondary',
            sectionId: 'airframe',
            confirmationOutcome: 'complete',
            disabled: airframeFrameUnusable
          })
          // The escape hatch. Without it a vehicle that cannot be tilted past
          // ±12° (bench FC, large airframe, static attitude feed) leaves this
          // step permanently incomplete and every later step locked.
          if (!airframeConfirmation && orientationExercise.status !== 'passed') {
            actions.push({
              kind: 'confirm-step',
              label: 'Orientation Verified Elsewhere — Continue',
              tone: 'secondary',
              sectionId: 'airframe',
              confirmationOutcome: 'already-done',
              disabled: busyAction !== undefined || airframeFrameUnusable
            })
          }
          // FRAME_CLASS/FRAME_TYPE always exist on a connected Copter, so a
          // missing value here is never a real misconfiguration — it's a param
          // the sync never received (a dropped frame under a lossy link). Left
          // unexplained this reads as a dead "Confirm Airframe Review" button
          // with no path forward, so name the missing param and offer a re-sync
          // instead of silently gating the step. (Non-Copter "Unknown vehicle"
          // is an identity/link problem, handled by its own copy elsewhere.)
          if (
            isCopterVehicle &&
            (airframe.frameClassValue === undefined || (!airframe.frameTypeIgnored && airframe.frameTypeValue === undefined))
          ) {
            const missingParamName = airframe.frameClassValue === undefined ? 'FRAME_CLASS' : 'FRAME_TYPE'
            blockingReason = `${missingParamName} has not reached the configurator (parameter sync ${snapshot.parameterStats.downloaded}/${snapshot.parameterStats.total}). The frame is set on the vehicle, but the value was dropped during sync, so this step cannot be confirmed yet. Re-sync parameters, then confirm the review.`
            actions.push({
              kind: 'guided',
              label: guidedActionButtonLabel('request-parameters', snapshot, busyAction),
              tone: 'primary',
              actionId: 'request-parameters',
              disabled: busyAction !== undefined || !canRunGuidedAction(snapshot, 'request-parameters')
            })
          }
          confirmationOutcome = airframeConfirmation?.outcome
          break
        }
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
          // A live global position — from a real GPS fix or the synthetic
          // GPS_INPUT the "Set location (no GPS)" control streams. Either
          // satisfies the EKF; the cal cannot complete without one.
          const hasCompassCalibrationPosition =
            snapshot.liveVerification.globalPosition.verified &&
            snapshot.liveVerification.globalPosition.latitudeDeg !== undefined &&
            snapshot.liveVerification.globalPosition.longitudeDeg !== undefined
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
              // Compass calibration needs the EKF to have a position to finish
              // yaw alignment. Without a fix it starts and then silently never
              // progresses — the reported "doesn't progress in guided setup,
              // works in the Calibration tab", where a fake-GPS control exists.
              // Naming it as a criterion makes a stalled cal explain itself
              // instead of just sitting at 0%.
              {
                label: 'Vehicle has a position (GPS fix, or a location set below) for yaw alignment',
                met: hasCompassCalibrationPosition
              },
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
        case 'radio': {
          const radioDirectionAxes = ['roll', 'pitch', 'throttle', 'yaw'] as const
          const radioDirectionsVerified = radioDirectionAxes.every((axis) => rcDirectionResults[axis] === 'correct')
          const radioReversedAxes = radioDirectionAxes.filter((axis) => rcDirectionResults[axis] === 'reversed')
          const radioDirectionsSummary = radioDirectionsVerified
            ? 'all axes correct'
            : radioReversedAxes.length > 0
              ? `reversed: ${radioReversedAxes.join(', ')}`
              : 'not checked yet'
          // Same waiver shape as the airframe orientation check and the
          // calibration steps: an 'already-done' sign-off means the radio was
          // mapped, ranged and direction-checked outside the configurator. It
          // exists so a build the in-app exercises cannot drive (no live stick
          // feed, a radio already set up in Mission Planner) does not leave this
          // step permanently incomplete and every later step locked.
          const radioWaived = radioConfirmation?.outcome === 'already-done'
          criteria = [
            {
              label: 'Live RC telemetry is present',
              met: snapshot.liveVerification.rcInput.verified || radioWaived
            },
            {
              label: 'RC mapping exercise captured roll, pitch, throttle, and yaw',
              met: rcMappingSession.status === 'ready' || radioWaived
            },
            {
              label: 'Stick range exercise passed',
              met: rcRangeExercise.status === 'passed' || radioWaived
            },
            {
              label: 'RC endpoint capture completed',
              met: rcCalibrationSession.status === 'ready' || radioWaived
            },
            {
              label: radioWaived
                ? 'RC channel directions verified outside the configurator'
                : 'RC channel directions verified — no axis reads backwards',
              met: radioDirectionsVerified || radioWaived
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
                  : radioWaived
                    ? 'The radio was signed off as mapped, ranged and direction-checked outside the configurator, so the in-app exercises are not required for this build. Run them any time you want to reconfirm the channel directions here.'
                    : 'Use the guided one-axis-at-a-time receiver mapping first, then verify stick travel, capture endpoints, and sign off the full radio review. If this radio was already set up and direction-checked elsewhere, sign it off as verified elsewhere instead.'
          // Include directions + review: they're the two things most likely to
          // be the actual blocker, and the old 5-item .slice(0,4) always dropped
          // the Review pill and never surfaced directions at all.
          evidence = [
            snapshot.liveVerification.rcInput.verified
              ? `${snapshot.liveVerification.rcInput.channelCount} RC channels live`
              : 'No live RC telemetry yet',
            `Mapping ${rcMappingSession.status}, ranges ${rcRangeExercise.status}, endpoints ${rcCalibrationSession.status}`,
            `Directions: ${radioDirectionsSummary}`,
            `Review: ${radioConfirmation ? `confirmed at ${formatConfirmationTime(radioConfirmation.confirmedAtMs)}` : 'pending operator confirmation'}`
          ]
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
            label: radioConfirmation ? (radioWaived ? 'Clear RC Waiver' : 'Clear RC Review') : 'Confirm RC Review',
            tone: 'secondary',
            sectionId: 'radio',
            confirmationOutcome: 'complete',
            // Gate on directions too: without this the operator could "Confirm RC
            // Review" (ticking the confirmation) while the step stays incomplete
            // because the directions criterion is unmet, with the real blocker
            // hidden in the collapsed criteria list.
            disabled:
              !snapshot.liveVerification.rcInput.verified ||
              rcMappingSession.status !== 'ready' ||
              rcRangeExercise.status !== 'passed' ||
              rcCalibrationSession.status !== 'ready' ||
              !radioDirectionsVerified
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
          // The escape hatch. Deliberately worded so the operator knows exactly
          // what they are asserting — a reversed throttle or pitch axis is a
          // flyaway hazard, so this must never read as a generic "skip".
          if (!radioConfirmation && !radioDirectionsVerified) {
            actions.push({
              kind: 'confirm-step',
              label: 'Radio Verified Elsewhere — Continue',
              tone: 'secondary',
              sectionId: 'radio',
              confirmationOutcome: 'already-done',
              disabled: busyAction !== undefined
            })
          }
          confirmationOutcome = radioConfirmation?.outcome
          break
        }
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
        case 'modes': {
          // Modes previously had NO operator escape of any kind: the switch
          // exercise had to pass, full stop. On a build the exercise cannot
          // drive that left the final steps of the wizard unreachable.
          const modesConfirmation = getSetupConfirmationRecord('modes')
          const modesWaived = modesConfirmation?.outcome === 'already-done'
          criteria = [
            {
              label: 'Mode channel is configured',
              met: modeSwitchEstimate.channelNumber !== undefined || modesWaived
            },
            {
              label: 'At least two distinct flight-mode positions are assigned',
              met: modeExerciseAssignments.length >= 2 || modesWaived
            },
            {
              label: modesWaived
                ? 'Flight modes verified outside the configurator'
                : 'Mode switch exercise passed',
              met: modeSwitchExercise.status === 'passed' || modesWaived
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
          if (modesConfirmation) {
            actions.push({
              kind: 'clear-confirmation',
              label: 'Clear Flight Mode Waiver',
              tone: 'secondary',
              sectionId: 'modes'
            })
          } else if (modeSwitchExercise.status !== 'passed') {
            actions.push({
              kind: 'confirm-step',
              label: 'Flight Modes Verified Elsewhere — Continue',
              tone: 'secondary',
              sectionId: 'modes',
              confirmationOutcome: 'already-done',
              disabled: busyAction !== undefined
            })
          }
          if (modesWaived) {
            detail =
              'Flight modes were signed off as verified outside the configurator, so the in-app switch exercise is not required for this build. Run it any time you want to reconfirm every switch position here.'
          }
          confirmationOutcome = modesConfirmation?.outcome
          break
        }
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
            // `healthy` now follows the live SYS_STATUS pre-arm bit, which can
            // report a failure before the vehicle has sent any reason text
            // (it batches those every 30s) — so an unhealthy verdict with an
            // empty issue list is a real state, and "0 issue(s)" would read as
            // a pass.
            snapshot.preArmStatus.healthy
              ? 'Pre-arm: clear'
              : snapshot.preArmStatus.issues.length === 0
                ? 'Pre-arm: blocked (reason not yet reported)'
                : `Pre-arm: ${snapshot.preArmStatus.issues.length} issue(s)`,
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
        blockingReason,
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

      // The sequence reason is the one the operator can act on ("go finish step
      // N"). A pending follow-up used to REPLACE it outright, so a locked step
      // reported e.g. "Reboot required" and never said which step was actually
      // holding the flow — and it clobbered any section-specific blocking copy
      // built above. Lead with the sequence reason and append the follow-up.
      const sequenceReason = `Complete ${currentIncompleteSectionTitle} before moving on to ${section.title}.`
      return {
        ...section,
        sequenceState: 'locked',
        blockingReason: setupFlowFollowUp ? `${sequenceReason} ${setupFlowFollowUp.title}` : sequenceReason
      }
    })
}

