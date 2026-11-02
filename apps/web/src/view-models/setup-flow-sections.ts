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

import { resolveSetupConfirmationRecord } from './setup-confirmation-resolve'
import { accelerometerCalibrationVerdict } from './accel-calibration-state'
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
import { MAIDEN_MIN_AIRBORNE_S, STABILIZE_MODE, type MaidenFlightResult } from '@arduconfig/log-analysis'
import { MOT_THST_HOVER_DEFAULT, deriveHoverLearnState } from './hover-learn-stage'
import { deriveThrottleControllerGains } from './throttle-controller-from-hover'
import { buildNotchSetupPlan } from './notch-setup'
import { AUTOTUNE_AXES, compareAutotuneGains, type AutotuneGains } from './autotune-flight'
import type { NotchPlanFromLog } from '@arduconfig/log-analysis'
import type { RcDirectionResult } from './receiver-direction-check'
import { canRunGuidedAction, deriveCompassStepSkipReason, guidedActionButtonLabel } from '../guided-action-helpers'
import { readParameterValue, readRoundedParameter } from '../selectors/parameter-read'
import { buildSetupPortsEvidence, describeDuplicateRcin, describeUnconfiguredPort } from './setup-ports-evidence'
import { isReceiverSerialProtocol } from '../serial-port-helpers'
import { SPIN_MIN_MAX, describeSpinThresholdProblem } from './spin-threshold-wizard'
import { ARM_SWITCH_AIRMODE_OPTION_VALUE, ARM_SWITCH_OPTION_VALUE } from './arm-switch'
import { OUTPUTS_SPIN_WIZARD_ID } from '../setup-flow-helpers'
import {
  batteryHealthLabel,
  batteryHealthTone,
  describeBatteryMonitor,
  formatRemaining,
  formatVoltage
} from '../device-display'
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
  /** Receiver-page drafts (RCMAP / RCn_MIN/MAX/TRIM) staged but not written. */
  receiverDraftsPending?: boolean
  /** Snapshots in the operator's library (the Ready to Fly step asks for one). */
  savedSnapshotCount?: number
  /** The maiden hover's log, once the operator has read one in. */
  maidenFlight?: MaidenFlightResult
  /** The hover log's notch plan, once the operator has read one in. */
  notchPlan?: NotchPlanFromLog
  /** The gains the autotune flight started from, as the Autotune card recorded them. */
  autotuneFlight?: { axisMask: number; gains: AutotuneGains }
  setupFlowFollowUp: SetupFlowFollowUpDescriptor | undefined
  setupConfirmations: Record<string, SetupConfirmationRecord>
  setupConfirmationSignatures: Record<string, string>
  batteryFailsafe: number | undefined
  batteryMonitor: number | undefined
  boardOrientation: number | undefined
  busyAction: string | undefined
  throttleFailsafe: number | undefined
  /** RTL destination altitude, normalised to metres across the 4.7 rename. */
  rtlAltitudeMetres: number | undefined
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
    receiverDraftsPending = false,
    savedSnapshotCount = 0,
    maidenFlight,
    notchPlan,
    autotuneFlight,
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
    rcRangeExerciseSummary,
    rtlAltitudeMetres,
    // Was declared on the inputs interface and never destructured -- one of the
    // six dead inputs the audit found. It already computes the only distinction
    // that matters here: analog ESCs have endpoints to learn, digital ones do
    // not.
    escSetup
  } = inputs

  // Delegates to the shared resolver rather than re-implementing the check.
  //
  // The local copy had no parameterSyncComplete leniency, and every wizard
  // section went through it -- so the resolver, which exists precisely to hold
  // confirmations valid while the table is still streaming, never ran for the
  // wizard at all. Mid-sync every signature is a blob of undefineds, nothing
  // matched, and all nine confirmations vanished at once: after any reboot,
  // link drop, or F5 the flow snapped back to Airframe and yanked the operator
  // off whatever step they were on because it had just become locked. It
  // recovered when the sync finished, but the window is exactly when someone is
  // watching.
  function getSetupConfirmationRecord(sectionId: string): SetupConfirmationRecord | undefined {
    return resolveSetupConfirmationRecord({
      record: setupConfirmations[sectionId],
      signature: setupConfirmationSignatures[sectionId],
      parameterSyncComplete: snapshot.parameterStats.status === 'complete'
    })
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
      const panelAction = setupPanelActionForSection(section.id, panel)
      const actions: SetupFlowActionDescriptor[] = [panelAction]
      let summary = section.description
      let detail = section.notes[0] ?? `Continue in ${panel.panelLabel}.`
      let evidence: string[] = []
      let criteria: SetupFlowCriterion[] = []
      let confirmationOutcome: SetupSectionOutcome | undefined
      let blockingReason: string | undefined
      let nextStep: string | undefined

      switch (section.id) {
        case 'link':
          // A pending reboot / re-sync follow-up is NOT a Link criterion any
          // more. It used to be: the moment a compass calibration or a port
          // write asked for a reboot, step 1 went incomplete, every other step
          // locked, and the operator was yanked from the step they were on to
          // the top of the flow. The gate now rides on the CURRENT step (see
          // the lock pass below), which keeps the reboot where the work was.
          criteria = [
            {
              label: 'Vehicle detected',
              met: snapshot.connection.kind === 'connected' && snapshot.vehicle !== undefined
            },
            {
              label: 'Parameters synced',
              met: snapshot.parameterStats.status === 'complete'
            }
          ]
          summary =
            snapshot.connection.kind !== 'connected'
              ? 'Connect to the vehicle to pull its parameters.'
              : snapshot.parameterStats.status === 'complete'
                ? `Parameters synced, ${snapshot.parameterStats.downloaded}/${snapshot.parameterStats.total}.`
                : formatParameterSync(snapshot)
          detail =
            snapshot.connection.kind !== 'connected'
              ? 'Connect, then wait for the parameters to sync.'
              : 'Re-sync parameters any time you want a fresh copy.'
          nextStep = 'Next: set each serial port to what is wired to it.'
          evidence = [
            `Link: ${snapshot.connection.kind}`,
            `Sync: ${formatParameterSync(snapshot)}`,
            parameterFollowUp
              ? `Follow-up: ${parameterFollowUp.requiresReboot ? 'reboot and re-sync pending' : 're-sync pending'}`
              : 'Follow-up: none'
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
          // The operator's word that the wiring was reviewed. Not every
          // flagged port is a misconfiguration software can fix: a leftover
          // ESC-telemetry wire on a port deliberately set to -1, SBUS on a UART
          // that needs an inverter, a receiver left unlinked on the bench. With
          // no sign-off, each of those locked steps 3-11 until a wire was pulled.
          // The signature pins the port map and the flagged ports, so the
          // sign-off stops counting when either changes.
          const portsConfirmation = getSetupConfirmationRecord('ports')
          const portsReviewed = portsConfirmation?.outcome === 'not-applicable'
          criteria = [
            {
              label: 'Port settings synced',
              met: snapshot.parameterStats.status === 'complete'
            },
            {
              // Blocks on a DETECTED mismatch only. Absent counters (demo, or
              // a board that serves no uarts.txt) must not gate the flow —
              // a step that blocks on evidence it may never receive is a dead
              // end, not a safeguard. The summary says the check could not run
              // rather than claiming the ports are right.
              label: portsReviewed && portsMismatched
                ? 'Flagged wiring reviewed as intentional'
                : 'Port protocols match the wiring',
              met: !portsMismatched || portsReviewed
            }
          ]
          summary = portsDuplicateRcin
            ? `${portsEvidence.duplicateRcinPorts.length + 1} ports claim RC input — only the lowest-numbered one is used.`
            : portsMismatched
            ? `${portsEvidence.unconfigured.length} port${portsEvidence.unconfigured.length === 1 ? '' : 's'} carrying traffic the flight controller cannot read.`
            : portsEvidence.trafficUnknown
              ? 'No port traffic data. Check the assignments yourself.'
              : portsEvidence.decodeVerdictPending
                ? 'Port assignments look right. Waiting for a second traffic sample.'
                : 'Port protocols match the traffic seen.'
          detail = portsDuplicateRcin
            ? 'Only the lowest-numbered RC input port is used; a receiver on a higher one is ignored. Turn off RC input on the ports without the receiver.'
            : portsMismatched
            ? 'Something is wired to a port set to the wrong protocol, so it cannot work. Fix that port\u2019s protocol and baud first.'
            : 'Set each serial port to what is wired to it. The receiver, GPS and OSD steps depend on it.'
          evidence = [
            ...(portsDuplicateRcin ? [describeDuplicateRcin(portsEvidence.duplicateRcinPorts)] : []),
            ...portsEvidence.unconfigured.slice(0, 2).map(describeUnconfiguredPort),
            portsEvidence.trafficUnknown
              ? 'Port traffic: unknown'
              : `Ports carrying traffic: ${portsEvidence.ports.filter((port) => port.rxBytes > 0).length}`,
            // Said out loud rather than left as silence. Framing errors are
            // cumulative since boot while byte counts are per-read deltas, so
            // until a second sample of uarts.txt arrives there is no honest
            // decode verdict — and "no findings" would otherwise read as "all
            // ports check out".
            ...(portsEvidence.decodeVerdictPending
              ? ['Decode check: waiting for a second sample']
              : []),
            // No "Review: pending" pill — there is no confirm action on this
            // step, so promising a review would describe a control that does
            // not exist.
            ...section.notes
          ].slice(0, 4)
          // No plain confirm-step here: completion is driven by the traffic
          // check, and a sign-off that satisfies no criterion is a dead button.
          // The one sign-off is the wiring review above, offered only when a
          // mismatch is on screen (or already recorded, so it can be undone).
          if (portsMismatched && !portsConfirmation) {
            actions.push({
              kind: 'confirm-step',
              label: 'Wiring Reviewed — Continue',
              tone: 'secondary',
              sectionId: 'ports',
              confirmationOutcome: 'not-applicable',
              disabled: busyAction !== undefined
            })
          } else if (portsConfirmation) {
            actions.push({
              kind: 'clear-confirmation',
              label: 'Clear Wiring Review',
              tone: 'secondary',
              sectionId: 'ports'
            })
          }
          confirmationOutcome = portsConfirmation?.outcome
          nextStep = 'Next: confirm the frame and the board orientation.'
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
                    label: 'Frame class selected',
                    // FRAME_CLASS=0 IS a defined value, but it means "unset" /
                    // "Frame: UNSUPPORTED". The criterion needs to reflect the
                    // real signal (a chosen frame class), not just presence.
                    // Without this, the criterion ticked complete on every
                    // fresh FC even though calibrations were being refused.
                    met: airframe.frameClassValue !== undefined && airframe.frameClassValue !== 0
                  },
                  {
                    label: 'Frame type set, or not needed',
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
              label: 'Board orientation reported',
              met: boardOrientation !== undefined
            },
            {
              // Waived alongside the exercise below: both depend on the same
              // live ATTITUDE stream, so leaving this one hard would rebuild the
              // wall the waiver exists to remove.
              label: 'Attitude telemetry live',
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
                ? 'Orientation verified elsewhere'
                : 'Orientation check passed',
              met: orientationExercise.status === 'passed' || airframeOrientationWaived
            },
            {
              label: 'Airframe review confirmed',
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
            ? 'No frame class is set (FRAME_CLASS = 0), so the autopilot refuses every calibration. Pick one in Config ▸ Frame.'
            : airframeOrientationWaived
              ? 'Orientation was verified elsewhere. Run the orientation check any time to confirm it here.'
              : 'Check the frame matches the build, run the orientation check, then confirm. If you cannot tilt the aircraft here, sign orientation off as verified elsewhere.'
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
            `Review: ${airframeConfirmation ? `confirmed at ${formatConfirmationTime(airframeConfirmation.confirmedAtMs)}` : 'pending'}`
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
                : 'Clear Airframe Review'
              : 'Confirm Airframe Review',
            tone: 'secondary',
            sectionId: 'airframe',
            confirmationOutcome: 'complete',
            disabled: airframeFrameUnusable
          })
          // The escape hatch. Without it a vehicle that cannot be tilted past
          // ±12° (bench FC, large airframe, static attitude feed) leaves this
          // step permanently incomplete and every later step locked.
          // Offered while the exercise has not passed even when a plain
          // review confirmation exists: pressing "Confirm Airframe Review" on
          // a bench board used to remove this button, leaving the step at 4/5
          // with a disabled hero and the undo as the only visible move. The
          // waiver overwrites that record with the 'already-done' outcome.
          if (!airframeOrientationWaived && orientationExercise.status !== 'passed') {
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
            blockingReason = `${missingParamName} did not arrive in the sync (${snapshot.parameterStats.downloaded}/${snapshot.parameterStats.total}). Re-sync parameters, then confirm.`
            actions.push({
              kind: 'guided',
              label: guidedActionButtonLabel('request-parameters', snapshot, busyAction),
              tone: 'primary',
              actionId: 'request-parameters',
              disabled: busyAction !== undefined || !canRunGuidedAction(snapshot, 'request-parameters')
            })
          }
          confirmationOutcome = airframeConfirmation?.outcome
          nextStep = 'Next: check motor order and spin direction, props off.'
          break
        }
        case 'outputs':
          criteria = isCopterVehicle
            ? [
                {
                  // The protocol first: DShot/OneShot/PWM decides what every
                  // motor test below sends, and a build left on the default
                  // with DShot ESCs spins nothing.
                  label: 'ESC protocol set (MOT_PWM_TYPE)',
                  met: escSetup.pwmTypeValue !== undefined && (escSetup.pwmTypeValue !== 0 || outputsConfirmation !== undefined)
                },
                {
                  label: 'A motor output is mapped',
                  met: outputMapping.motorOutputs.length > 0
                },
                {
                  label: 'Motor count matches the frame',
                  met:
                    airframe.expectedMotorCount === undefined || outputMapping.motorOutputs.length === airframe.expectedMotorCount
                },
                {
                  label: 'No motors missing from the map',
                  met: !outputMapping.notes.some((note) => note.startsWith('Missing motor assignments:'))
                },
                {
                  // Motor order and spin direction are ArduPilot's own mandatory
                  // item 3, ahead of RC calibration, and they are the two bench
                  // errors that most reliably flip a multirotor on its first
                  // takeoff. The guided direction gate was dropped with the
                  // Motors-tab redesign and this confirmation was left to cover
                  // it -- but it only claimed the output MAP was reviewed, so an
                  // operator could complete the wizard having never spun a motor.
                  // The check itself lives in Motors (props-off gated, with the
                  // mixer diagram and per-motor spin); this says what signing off
                  // actually asserts. The signature below already pins the
                  // SERVOn_FUNCTION map, so a remap voids it.
                  label: 'Motor order and direction verified',
                  met: outputsConfirmation !== undefined
                },
                // ESC endpoint calibration lives on the Motor Range step now: the
                // all-at-once calibration uses the stick's maximum, so it comes
                // after Radio, as ArduPilot orders it.
              ]
            : [
                {
                  // Plane/Rover/Sub are not a quad motor matrix; the
                  // SERVOx_FUNCTION map is reviewed via the Outputs view +
                  // raw Parameters until per-vehicle output surfaces land.
                  label: `${airframe.frameClassLabel} outputs reviewed`,
                  met: outputsConfirmation !== undefined
                }
              ]
          summary = isCopterVehicle
            ? `${outputMapping.motorOutputs.length} motor outputs, ${outputMapping.configuredAuxOutputs.length} auxiliary outputs.`
            : `${configuredOutputs.length} configured ${airframe.frameClassLabel} outputs (SERVOx_FUNCTION).`
          detail =
            outputMapping.notes[0]
            ?? 'Check the output map, then spin each motor in Motors to check order and direction. Props off.'
          evidence = [
            ...outputMapping.notes.slice(0, 2),
            `Output review: ${outputsConfirmation ? `confirmed at ${formatConfirmationTime(outputsConfirmation.confirmedAtMs)}` : 'pending'}`
          ].slice(0, 4)
          actions.unshift({
            kind: outputsConfirmation ? 'clear-confirmation' : 'confirm-step',
            label: outputsConfirmation ? 'Clear Motor Order & Direction Review' : 'Confirm Motor Order & Direction Verified',
            tone: 'secondary',
            sectionId: 'outputs',
            disabled: isCopterVehicle
              ? outputMapping.motorOutputs.length === 0 ||
                outputMapping.notes.some((note) => note.startsWith('Missing motor assignments:')) ||
                (airframe.expectedMotorCount !== undefined && outputMapping.motorOutputs.length !== airframe.expectedMotorCount)
              : (snapshot.vehicle?.vehicle ?? 'Unknown') === 'Unknown'
          })
          // The guided motor-direction verification, ESC-range confirm, and
          // bench-test actions were retired with the Motors-tab redesign —
          // order/direction is now checked manually in Motors → Test / Motor
          // Setup. Replace the generic panel action with a jump there, found by
          // identity: replacing "the last action" clobbered "Open ESC
          // Calibration" on analog-ESC builds and kept the retired label.
          // Plane/Rover/Sub have no motor matrix to verify; their output map is
          // the Servos page.
          actions[actions.indexOf(panelAction)] = {
            kind: 'scroll',
            label: isCopterVehicle ? 'Open Motors' : 'Open Servos',
            panelId: isCopterVehicle ? panel.panelId : 'setup-panel-servos'
          }
          nextStep = isCopterVehicle ? 'Next: calibrate the accelerometer on a level surface.' : undefined
          break
        case 'motor-range': {
          // MOT_SPIN_ARM (idle when armed) and MOT_SPIN_MIN (the least the mixer
          // ever commands in flight). Too low a MIN stops a motor on a fast
          // descent; too high an ARM has the aircraft creeping on the bench.
          // Motors ▸ Motor Setup measures both on this build, props off.
          const motorRangeConfirmation = getSetupConfirmationRecord('motor-range')
          const motorRangeWaived = motorRangeConfirmation?.outcome === 'already-done'
          // Fractions of throttle (0.08, 0.12): rounding them would read 0.
          const spinArm = readParameterValue(snapshot, 'MOT_SPIN_ARM')
          const spinMin = readParameterValue(snapshot, 'MOT_SPIN_MIN')
          const spinProblem =
            spinArm !== undefined && spinMin !== undefined ? describeSpinThresholdProblem(spinArm, spinMin) : undefined
          const spinRangeValid = spinArm !== undefined && spinMin !== undefined && spinProblem === undefined
          const analogEscs = escSetup.calibrationPath === 'analog-calibration'
          criteria = [
            {
              label: 'Armed idle below the in-flight minimum',
              met: spinArm !== undefined && spinMin !== undefined && spinArm < spinMin
            },
            {
              label: `MOT_SPIN_MIN at or below ${SPIN_MIN_MAX}`,
              met: spinMin !== undefined && spinMin <= SPIN_MIN_MAX
            },
            // ESC endpoint calibration applies ONLY to analog output --
            // MOT_PWM_TYPE 0/1/2 (Normal PWM, OneShot, OneShot125). DShot,
            // brushed and the PWMRange/Angle types have no throttle endpoints
            // to learn, so on those builds it must not gate anything.
            ...(analogEscs
              ? [
                  {
                    label: 'ESC endpoints calibrated',
                    met: motorRangeConfirmation !== undefined
                  }
                ]
              : []),
            {
              label: motorRangeWaived
                ? 'Spin range measured elsewhere'
                : 'Spin range confirmed',
              met: motorRangeConfirmation !== undefined
            }
          ]
          summary =
            spinArm === undefined || spinMin === undefined
              ? 'Spin range not reported yet.'
              : `Armed idle ${spinArm.toFixed(2)}, minimum in flight ${spinMin.toFixed(2)}${spinProblem ? ` — ${spinProblem}` : '.'}`
          detail = spinProblem
            ? `${spinProblem} Props off, then run the spin wizard in Motors ▸ Motor Setup to measure both values.`
            : motorRangeWaived
              ? 'Spin range measured elsewhere. Run the spin wizard any time to measure it here.'
              : 'Props off. Run the spin wizard in Motors ▸ Motor Setup, then confirm the values it sets.'
          evidence = [
            `Spin range: ${spinArm === undefined ? '?' : spinArm.toFixed(2)} armed, ${spinMin === undefined ? '?' : spinMin.toFixed(2)} minimum`,
            `ESCs: ${analogEscs ? 'analog — calibrate the endpoints first' : 'digital — no endpoint calibration needed'}`,
            `Review: ${motorRangeConfirmation ? `confirmed at ${formatConfirmationTime(motorRangeConfirmation.confirmedAtMs)}` : 'pending'}`
          ]
          actions[actions.indexOf(panelAction)] = {
            kind: 'scroll',
            label: 'Open Spin Wizard',
            tone: 'primary',
            panelId: panel.panelId,
            targetElementId: OUTPUTS_SPIN_WIZARD_ID
          }
          actions.unshift({
            kind: motorRangeConfirmation ? 'clear-confirmation' : 'confirm-step',
            label: motorRangeConfirmation
              ? motorRangeWaived
                ? 'Clear Spin Range Waiver'
                : 'Clear Spin Range Review'
              : 'Confirm Spin Range Measured',
            tone: 'secondary',
            sectionId: 'motor-range',
            confirmationOutcome: 'complete',
            disabled: motorRangeConfirmation ? false : !spinRangeValid
          })
          if (analogEscs) {
            actions.push({
              kind: 'scroll',
              label: 'Open ESC Calibration',
              panelId: 'setup-panel-calibration'
            })
          }
          if (!motorRangeConfirmation) {
            actions.push({
              kind: 'confirm-step',
              label: 'Measured Elsewhere — Continue',
              tone: 'secondary',
              sectionId: 'motor-range',
              confirmationOutcome: 'already-done',
              disabled: busyAction !== undefined || !spinRangeValid
            })
          }
          confirmationOutcome = motorRangeConfirmation?.outcome
          nextStep = 'Next: the initial tune, from the prop size and the pack.'
          break
        }
        case 'initial-tune': {
          // The Initial Tune form (prop size, pack) stages the starting
          // values; the step judges what is on the vehicle: a gyro filter
          // chosen for the props (the 20 Hz default is nobody's choice), and
          // a battery voltage range so thrust scales with the pack.
          const initialTuneConfirmation = getSetupConfirmationRecord('initial-tune')
          const initialTuneWaived = initialTuneConfirmation?.outcome === 'already-done'
          const gyroFilter = readParameterValue(snapshot, 'INS_GYRO_FILTER')
          const gyroFilterSet = gyroFilter !== undefined && Math.abs(gyroFilter - 20) > 1e-6
          const voltMax = readParameterValue(snapshot, 'MOT_BAT_VOLT_MAX')
          const voltMin = readParameterValue(snapshot, 'MOT_BAT_VOLT_MIN')
          const batteryRangeSet = voltMax !== undefined && voltMax > 0 && voltMin !== undefined && voltMin > 0
          criteria = [
            {
              label: initialTuneWaived ? 'Initial tune set elsewhere' : 'Gyro filter set for the props (INS_GYRO_FILTER not the 20 Hz default)',
              met: gyroFilterSet || initialTuneWaived
            },
            {
              label: 'Battery voltage range set (MOT_BAT_VOLT_MAX / MIN)',
              met: batteryRangeSet || initialTuneWaived
            },
            {
              label: 'Initial tune confirmed',
              met: initialTuneConfirmation !== undefined
            }
          ]
          summary = initialTuneWaived
            ? 'Initial tune set elsewhere.'
            : gyroFilterSet && batteryRangeSet
              ? `Gyro filter ${gyroFilter} Hz, pack ${voltMin}–${voltMax} V.`
              : 'Starting values not set yet.'
          detail = initialTuneWaived
            ? 'Stage the starting values any time from the form below.'
            : 'Enter the prop size and the pack below. The form stages the gyro filter, the rate-loop filters, the acceleration limits, the thrust curve and the battery voltage range the first flight needs. Write them, then confirm.'
          evidence = [
            `INS_GYRO_FILTER: ${gyroFilter ?? '—'} Hz`,
            `MOT_BAT_VOLT: ${voltMin ?? '—'}–${voltMax ?? '—'} V`,
            `MOT_THST_EXPO: ${readParameterValue(snapshot, 'MOT_THST_EXPO') ?? '—'}`,
            `Review: ${initialTuneConfirmation ? `confirmed at ${formatConfirmationTime(initialTuneConfirmation.confirmedAtMs)}` : 'pending operator confirmation'}`
          ]
          actions[actions.indexOf(panelAction)] = { kind: 'scroll', label: 'Open Tuning', panelId: 'setup-panel-tuning' }
          actions.unshift({
            kind: initialTuneConfirmation ? 'clear-confirmation' : 'confirm-step',
            label: initialTuneConfirmation ? (initialTuneWaived ? 'Clear Initial Tune Waiver' : 'Clear Initial Tune Review') : 'Confirm Initial Tune',
            tone: 'primary',
            sectionId: 'initial-tune',
            confirmationOutcome: 'complete',
            disabled: initialTuneConfirmation ? false : !(gyroFilterSet && batteryRangeSet)
          })
          if (!initialTuneConfirmation) {
            actions.push({
              kind: 'confirm-step',
              label: 'Initial Tune Set Elsewhere — Continue',
              tone: 'secondary',
              sectionId: 'initial-tune',
              confirmationOutcome: 'already-done',
              disabled: busyAction !== undefined
            })
          }
          confirmationOutcome = initialTuneConfirmation?.outcome
          nextStep = 'Next: put Stabilize and AltHold on the mode switch.'
          break
        }
        case 'accelerometer': {
          const actionState = snapshot.guidedActions['calibrate-accelerometer']
          confirmationOutcome = accelerometerConfirmation?.outcome
          // The vehicle's own answer, read the way ArduPilot's pre-arm check
          // reads it. Without this the step recorded whether THIS APP had run
          // the calibration, so a vehicle calibrated in Mission Planner — or
          // one that just had its offsets restored from a snapshot — was told
          // to do the work again while the firmware was perfectly happy to arm.
          const accelerometerVerdict = accelerometerCalibrationVerdict(snapshot)
          const accelerometerCalibratedOnVehicle = accelerometerVerdict === 'calibrated'
          const accelerometerCalibrationRecorded =
            actionState.status === 'succeeded' ||
            accelerometerConfirmation !== undefined ||
            accelerometerCalibratedOnVehicle
          if (accelerometerConfirmation?.outcome === 'already-done') {
            criteria = [
              {
                label: 'Accelerometer calibrated elsewhere',
                met: true
              },
              // The firmware's own verdict outranks the waiver: an aircraft
              // whose offsets are all zero will not arm, whatever was signed.
              ...(accelerometerVerdict === 'not-calibrated'
                ? [
                    {
                      label: 'Accelerometer offsets stored on the vehicle',
                      met: false
                    }
                  ]
                : [])
            ]
            summary = 'Accelerometer calibrated elsewhere.'
            detail = 'Calibrated elsewhere. Run the calibration here any time.'
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
                label: 'Accelerometer calibrated',
                met:
                  actionState.status === 'succeeded' ||
                  (section.status === 'complete' && accelerometerVerdict !== 'not-calibrated') ||
                  accelerometerCalibratedOnVehicle
              },
              {
                label: 'Calibration recorded',
                met: accelerometerCalibrationRecorded
              }
            ]
            summary = actionState.summary
            detail =
              actionState.status === 'succeeded'
                ? 'Accelerometer calibrated. Reboot before flight.'
                : actionState.instructions[0] ?? 'Run the calibration and follow each pose prompt.'
            evidence = [
              ...actionState.statusTexts.slice(-2),
              ...section.notes,
              accelerometerConfirmation
                ? `Review: confirmed at ${formatConfirmationTime(accelerometerConfirmation.confirmedAtMs)}`
                : actionState.status === 'succeeded'
                  ? `Calibrated here at ${formatConfirmationTime(actionState.completedAtMs)}`
                  : accelerometerCalibratedOnVehicle
                    ? 'Calibration stored on the vehicle (INS_ACC*OFFS)'
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
                // An undo is never gated: guided actions reset to idle on every
                // reboot, which used to grey out the Clear button of a
                // confirmation the operator had just made.
                disabled: accelerometerConfirmation ? false : actionState.status !== 'succeeded'
              })
            }
            if (!accelerometerConfirmation && actionState.status !== 'succeeded') {
              // Withheld when the vehicle itself says it is not calibrated
              // (all-zero INS offsets -- the pre-arm "3D Accel calibration
              // needed" condition): a waiver cannot be truer than the firmware.
              const vehicleSaysNotCalibrated = accelerometerVerdict === 'not-calibrated'
              if (vehicleSaysNotCalibrated) {
                detail =
                  'The vehicle has no accelerometer calibration stored (INS_ACC*OFFS are zero), so it cannot be signed off. Run the calibration.'
              }
              actions.push({
                kind: 'confirm-step',
                label: 'Already Calibrated — Continue',
                tone: 'secondary',
                sectionId: 'accelerometer',
                confirmationOutcome: 'already-done',
                disabled: busyAction !== undefined || vehicleSaysNotCalibrated
              })
            }
          }
          nextStep = 'Next: level calibration, with the vehicle sitting flat.'
          break
        }
        case 'level': {
          // Board-level calibration — distinct from the 6-pose accel
          // cal. One-shot: operator sets the FC level, AP samples gravity
          // a few seconds and stores AHRS_TRIM_X/Y. No per-pose loop.
          const actionState = snapshot.guidedActions['calibrate-level']
          confirmationOutcome = levelConfirmation?.outcome
          nextStep = 'Next: compass calibration, or skip it on a build with no compass.'
          // Stored AHRS_TRIM_X/Y on the vehicle count as the record: guided
          // actions reset to idle on every reboot, so a level cal run in-app
          // and never explicitly confirmed un-completed the step after the
          // compass step's reboot and locked everything behind it.
          const levelCalRecorded =
            actionState.status === 'succeeded' || levelConfirmation !== undefined || section.status === 'complete'
          // "Already Calibrated — Continue" has to actually let you continue.
          //
          // Accelerometer and compass both collapse to a single met criterion
          // when the operator signs the step off as done elsewhere; level did
          // not, so its waiver satisfied only the "recorded" criterion and left
          // "completed successfully" pending forever. The step could not
          // complete — and the Clear button below is disabled unless the
          // in-app calibration succeeded, so the waiver could not be undone
          // either. A button promising continuation that strands you, with its
          // own undo greyed out.
          if (levelConfirmation?.outcome === 'already-done') {
            criteria = [
              {
                label: 'Level calibrated elsewhere',
                met: true
              }
            ]
            summary = 'Level calibrated elsewhere.'
            detail =
              'Calibrated elsewhere. Run level calibration here any time.'
            evidence = [
              `Outcome: ${formatSetupOutcome(levelConfirmation.outcome)}`,
              `Review: confirmed at ${formatConfirmationTime(levelConfirmation.confirmedAtMs)}`,
              ...section.notes
            ].slice(0, 4)
            actions.unshift({
              kind: 'clear-confirmation',
              label: 'Clear External Level Confirmation',
              tone: 'primary',
              sectionId: 'level'
            })
            actions.splice(1, 0, {
              kind: 'guided',
              label:
                actionState.status === 'idle'
                  ? 'Run Level Calibration Instead'
                  : guidedActionButtonLabel('calibrate-level', snapshot, busyAction),
              tone: 'secondary',
              actionId: 'calibrate-level',
              disabled: busyAction !== undefined || !canRunGuidedAction(snapshot, 'calibrate-level')
            })
            break
          }
          criteria = [
            {
              label: 'Level calibrated',
              met: actionState.status === 'succeeded' || section.status === 'complete'
            },
            {
              label: 'Calibration recorded',
              met: levelCalRecorded
            }
          ]
          summary = actionState.summary
          detail =
            actionState.status === 'succeeded'
              ? 'Level calibrated. Re-sync parameters if you want a fresh copy.'
              : actionState.instructions[0] ?? 'Set the vehicle on a flat surface, then run level calibration.'
          evidence = [
            ...actionState.statusTexts.slice(-2),
            ...section.notes,
            levelConfirmation
              ? `Review: confirmed at ${formatConfirmationTime(levelConfirmation.confirmedAtMs)}`
              : actionState.status === 'succeeded'
                ? `Calibrated here at ${formatConfirmationTime(actionState.completedAtMs)}`
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
              disabled: levelConfirmation ? false : actionState.status !== 'succeeded'
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
          nextStep = 'Next: bind the receiver and map the sticks.'
          const actionState = snapshot.guidedActions['calibrate-compass']
          const compassStepSkipReason = deriveCompassStepSkipReason(snapshot)
          confirmationOutcome = compassConfirmation?.outcome
          // Stored COMPASS_OFS* on the vehicle count as the record, for the same
          // reason as the level step: the in-app cal demands a reboot, and the
          // reboot resets the action state that used to be the only record.
          const compassCalibrationRecorded =
            actionState.status === 'succeeded' || compassConfirmation !== undefined || section.status === 'complete'
          // A live global position — from a real GPS fix or the synthetic
          // GPS_INPUT the "Set location (no GPS)" control streams. The ONBOARD
          // calibration (DO_START_MAG_CAL) does not need one: without a
          // location CompassCalibrator::fix_radius() logs "No location,
          // fix_radius skipped" and succeeds, and _start_calibration requires
          // GPS only when COMPASS_OPTIONS asks for it. So this is a hint for a
          // stalled run, not a criterion -- as a criterion it made an indoor
          // bench unable to complete a calibration the firmware had accepted.
          const hasCompassCalibrationPosition =
            snapshot.liveVerification.globalPosition.verified &&
            snapshot.liveVerification.globalPosition.latitudeDeg !== undefined &&
            snapshot.liveVerification.globalPosition.longitudeDeg !== undefined
          if (compassConfirmation?.outcome === 'not-applicable') {
            criteria = [
              {
                label: 'No compass enabled (COMPASS_USE)',
                met: compassSetupAvailability.enabledCompassCount === 0
              },
              {
                label: 'No compass on this build, confirmed',
                met: true
              }
            ]
            summary = 'Skipped: no compass enabled on this build.'
            detail = 'Skipped for this build. If you add a compass later, enable it and come back here.'
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
                label: 'Compass calibrated elsewhere',
                met: true
              }
            ]
            summary = 'Compass calibrated elsewhere.'
            detail = 'Calibrated elsewhere. Run compass calibration here any time.'
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
                    ? 'No compass enabled (COMPASS_USE)'
                    : 'Compass calibration unavailable on this build',
                met: true
              },
              {
                label: 'Compass calibration skipped',
                met: true
              }
            ]
            summary =
              compassStepSkipReason === 'unsupported'
                ? actionState.summary
                : 'No compass enabled on this build.'
            detail = 'Skipped for this build. If you add a compass later, enable it and come back here.'
            evidence = [
              ...(compassStepSkipReason === 'unsupported' ? [actionState.summary] : []),
              `GPS: ${compassSetupAvailability.gpsConfigured ? 'configured' : 'not detected'}`,
              `Enabled compasses: ${compassSetupAvailability.enabledCompassCount}`,
              ...section.notes,
              `Skip reason: ${compassStepSkipReason === 'unsupported' ? 'unsupported by the autopilot' : 'no compass enabled'}`
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
                label: 'No Compass — Continue',
                tone: 'secondary',
                sectionId: 'compass',
                confirmationOutcome: 'not-applicable',
                disabled: busyAction !== undefined
              })
            }
          } else {
            criteria = [
              {
                label: 'Compass calibrated',
                met: actionState.status === 'succeeded' || section.status === 'complete'
              },
              {
                label: 'Calibration recorded',
                met: compassCalibrationRecorded
              }
            ]
            summary = actionState.summary
            detail =
              actionState.status === 'succeeded'
                ? 'Compass calibrated. Reboot before flight.'
                : actionState.status === 'running' && !hasCompassCalibrationPosition
                  ? 'Rotate the vehicle through every axis. If progress stays at 0%, set a location below or move outdoors for a GPS fix.'
                  : actionState.instructions[0] ?? 'Power the vehicle fully, then run compass calibration.'
            evidence = [
              ...actionState.statusTexts.slice(-2),
              ...section.notes,
              compassConfirmation
                ? `Review: confirmed at ${formatConfirmationTime(compassConfirmation.confirmedAtMs)}`
                : actionState.status === 'succeeded'
                  ? `Calibrated here at ${formatConfirmationTime(actionState.completedAtMs)}`
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
                disabled: compassConfirmation ? false : actionState.status !== 'succeeded'
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
          // A Rover radio drives steering (RCMAP_ROLL) and throttle; pitch and
          // yaw never move, so asking for four correct axes could only be met
          // by the waiver. Copter/Plane/Sub keep all four.
          const isRover = snapshot.vehicle?.vehicle === 'ArduRover'
          const radioDirectionAxes = isRover ? (['roll', 'throttle'] as const) : (['roll', 'pitch', 'throttle', 'yaw'] as const)
          const radioAxisName = (axis: string): string => (isRover && axis === 'roll' ? 'steering' : axis)
          const radioDirectionsVerified = radioDirectionAxes.every((axis) => rcDirectionResults[axis] === 'correct')
          const radioReversedAxes = radioDirectionAxes.filter((axis) => rcDirectionResults[axis] === 'reversed')
          const radioDirectionsSummary = radioDirectionsVerified
            ? 'all axes correct'
            : radioReversedAxes.length > 0
              ? `reversed: ${radioReversedAxes.map(radioAxisName).join(', ')}`
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
              label: 'RC input live',
              met: snapshot.liveVerification.rcInput.verified || radioWaived
            },
            {
              label: isRover
                ? 'Sticks mapped: steering and throttle'
                : 'Sticks mapped: roll, pitch, throttle, yaw',
              met: rcMappingSession.status === 'ready' || radioWaived
            },
            {
              label: 'Stick range exercise passed',
              met: rcRangeExercise.status === 'passed' || radioWaived
            },
            {
              label: 'Endpoints captured',
              met: rcCalibrationSession.status === 'ready' || radioWaived
            },
            {
              label: radioWaived
                ? 'Stick directions verified elsewhere'
                : 'Stick directions correct',
              met: radioDirectionsVerified || radioWaived
            },
            {
              label: 'Radio review confirmed',
              met: radioConfirmation !== undefined
            }
          ]
          const radioExercisesDone =
            snapshot.liveVerification.rcInput.verified &&
            rcMappingSession.status === 'ready' &&
            rcRangeExercise.status === 'passed' &&
            rcCalibrationSession.status === 'ready' &&
            radioDirectionsVerified
          summary =
            rcMappingSession.status === 'running'
              ? rcMappingSummary
              : rcRangeExercise.status === 'running'
                ? rcRangeExerciseSummary
                : rcCalibrationSession.status === 'capturing'
                  ? rcCalibrationSummary
                  : rcRangeExercise.status === 'passed' && rcCalibrationSession.status === 'ready'
                    ? 'Mapping, stick range and endpoints done. Confirm the review.'
                : snapshot.liveVerification.rcInput.verified
                  ? 'RC input is live. Mapping and calibration still to do.'
                  : 'Waiting for RC input.'
          detail =
            rcMappingSession.status === 'failed'
              ? rcMappingSession.failureReason ?? 'RC mapping exercise failed.'
              : rcRangeExercise.status === 'failed'
                ? rcRangeExercise.failureReason ?? 'Stick range exercise failed.'
                : rcCalibrationSession.status === 'failed'
                  ? rcCalibrationSession.failureReason ?? 'RC endpoint capture failed.'
                  : radioWaived
                    ? 'Radio verified elsewhere. Run the exercises any time to check it here.'
                    : isRover
                  ? 'Map steering and throttle, check stick travel, capture endpoints, then confirm. A radio set up elsewhere can be signed off as verified elsewhere.'
                  : 'Run guided mapping, check stick travel, capture endpoints, then confirm. A radio already set up elsewhere can be signed off as verified elsewhere.'
          // Include directions + review: they're the two things most likely to
          // be the actual blocker, and the old 5-item .slice(0,4) always dropped
          // the Review pill and never surfaced directions at all.
          const describeExercise = (name: string, status: string): string =>
            `${name} ${status === 'ready' || status === 'passed' ? 'done' : status === 'idle' ? 'not run' : status}`
          evidence = [
            snapshot.liveVerification.rcInput.verified
              ? `${snapshot.liveVerification.rcInput.channelCount} RC channels live`
              : 'No RC input yet',
            `${describeExercise('Mapping', rcMappingSession.status)}, ${describeExercise('stick range', rcRangeExercise.status)}, ${describeExercise('endpoints', rcCalibrationSession.status)}`,
            `Directions: ${radioDirectionsSummary}`,
            `Review: ${radioConfirmation ? `confirmed at ${formatConfirmationTime(radioConfirmation.confirmedAtMs)}` : 'pending'}`
          ]
          actions.unshift({
            kind: 'rc-mapping-exercise',
            label: rcMappingSession.status === 'ready' ? 'Run Guided Mapping Again' : 'Start Guided Mapping',
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
            // hidden in the collapsed criteria list. Staged-but-unwritten RC
            // drafts gate it as well: the signature pins the LIVE values, so a
            // review confirmed over drafts went stale the moment they were
            // applied and relocked every step behind it. An undo (Clear) is
            // never gated -- that was the no-undo trap the waiver had.
            disabled: radioConfirmation ? false : !radioExercisesDone || receiverDraftsPending
          })
          if (!radioConfirmation && radioExercisesDone && receiverDraftsPending) {
            detail = 'Apply the staged receiver values first, then confirm the RC review.'
          }
          // ONE jump to the Receiver page, replacing the generic panel action
          // rather than sitting beside it: the step stacked eight buttons,
          // three of which opened the same page.
          actions[actions.indexOf(panelAction)] = {
            kind: 'scroll',
            label:
              rcCalibrationSession.status === 'ready'
                ? 'Open Receiver to Apply Endpoints'
                : rcMappingSession.status === 'ready'
                  ? 'Open Receiver for Endpoints'
                  : 'Open Receiver',
            panelId: panel.panelId
          }
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
                'No RC input, and no serial port is set to RC input. For a serial receiver (ELRS, CRSF, SBUS), open Ports, set its UART to RCIN (SERIALn_PROTOCOL = 23), write and reboot. A receiver on the RCIN pin needs no port change.'
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
          nextStep = 'Next: set the motor spin range, props off.'
          break
        }
        case 'failsafe': {
          // Each vehicle's failsafe is a different set of parameters, and the
          // Copter-shaped review let the others through on the wrong ones:
          //   Plane  THR_FAILSAFE=2 is "enabled, NO failsafe action" and ticked
          //          the box; FS_LONG_ACTN (where the failsafe goes) was never read.
          //   Rover  FS_THR_ENABLE defaults on, so a fresh Rover passed while
          //          FS_ACTION=0 ("Nothing") -- the dangerous one -- went unread.
          //   Sub    has FS_THR_ENABLE but defaults it to 0 and a tethered,
          //          joystick-driven ROV leaves it there, so the step could NEVER
          //          complete; its real failsafes are leak and surface link.
          // Copter (and an unrecognised vehicle) keep the original criteria.
          const failsafeVehicle =
            snapshot.vehicle?.vehicle === 'ArduPlane'
              ? 'plane'
              : snapshot.vehicle?.vehicle === 'ArduRover'
                ? 'rover'
                : snapshot.vehicle?.vehicle === 'ArduSub'
                  ? 'sub'
                  : 'copter'
          const planeThrottleFailsafe = readRoundedParameter(snapshot, 'THR_FAILSAFE')
          const planeLongAction = readRoundedParameter(snapshot, 'FS_LONG_ACTN')
          const roverAction = readRoundedParameter(snapshot, 'FS_ACTION')
          const subLeakFailsafe = readRoundedParameter(snapshot, 'FS_LEAK_ENABLE')
          const subGcsFailsafe = readRoundedParameter(snapshot, 'FS_GCS_ENABLE')
          const hasAction = (value: number | undefined): boolean => value !== undefined && value !== 0
          // BATT_MONITOR=0: ArduPilot does not even register BATT_FS_LOW_ACT, so
          // a build without a battery monitor could never satisfy (or confirm)
          // this step. Say so instead of asking for a parameter that does not
          // exist; the Power step is where a monitor gets configured.
          const noBatteryMonitor = batteryMonitor === 0
          const failsafeConfigMissing =
            failsafeVehicle === 'plane'
              ? planeThrottleFailsafe === undefined || planeLongAction === undefined
              : failsafeVehicle === 'rover'
                ? throttleFailsafe === undefined || roverAction === undefined
                : failsafeVehicle === 'sub'
                  ? subLeakFailsafe === undefined || subGcsFailsafe === undefined
                  : throttleFailsafe === undefined
          const failsafeConfirmDisabled = failsafeConfigMissing || (batteryFailsafe === undefined && !noBatteryMonitor)
          criteria = [
            ...(failsafeVehicle === 'plane'
              ? [
                  {
                    label: 'Throttle failsafe on (THR_FAILSAFE = 1)',
                    met: planeThrottleFailsafe === 1
                  },
                  {
                    label: 'Long failsafe has an action (FS_LONG_ACTN)',
                    met: hasAction(planeLongAction)
                  }
                ]
              : failsafeVehicle === 'rover'
                ? [
                    {
                      label: 'Throttle failsafe is enabled',
                      met: hasAction(throttleFailsafe)
                    },
                    {
                      label: 'Failsafe action is set (FS_ACTION)',
                      met: hasAction(roverAction)
                    }
                  ]
                : failsafeVehicle === 'sub'
                  ? [
                      {
                        label: 'Leak failsafe has an action (FS_LEAK_ENABLE)',
                        met: hasAction(subLeakFailsafe)
                      },
                      {
                        label: 'Surface-link failsafe has an action (FS_GCS_ENABLE)',
                        met: hasAction(subGcsFailsafe)
                      }
                    ]
                  : [
                      {
                        // Presence, not value, used to satisfy these -- so FS_THR_ENABLE=0
                        // (disabled) and BATT_FS_LOW_ACT=0 ("warn only") ticked the boxes and
                        // the step rendered complete on an aircraft with no RC failsafe and no
                        // battery failsafe at all. Firmware's own FS_THR_VALUE sanity check
                        // (AP_Arming_Copter.cpp:209) only runs when the throttle failsafe is
                        // enabled, so nothing else would have told the operator either.
                        label: 'Throttle failsafe is enabled',
                        met: hasAction(throttleFailsafe)
                      }
                    ]),
            noBatteryMonitor
              ? {
                  label: 'No battery monitor, so no battery failsafe',
                  met: true
                }
              : {
                  label: 'Battery failsafe has an action, not just a warning',
                  met: batteryFailsafe !== undefined && batteryFailsafe !== 0
                },
            // The step reviewed WHETHER the failsafe fires and never WHERE it
            // goes. FS_THR_ENABLE defaults to ALWAYS_RTL, so RTL is the default
            // response to a lost link, and RTL_ALT defaults to 15 m -- below the
            // treeline at most FPV spots, which turns a signal loss behind a tree
            // into a return INTO that tree. 20 m clears typical tree cover; the
            // operator can go lower deliberately, this only refuses the default
            // going unexamined.
            // Only for a vehicle that HAS a return altitude. A Rover's
            // failsafe does not fly home and a Sub's cannot; asserting an
            // altitude they never report made this criterion permanently
            // false, which blocked the failsafe step and every step behind it.
            // A Copter with no GPS configured cannot return: RTL without a
            // position falls through to LAND after a wait, so the honest
            // setting is FS_THR_ENABLE = 3 (Land) or 7 (Brake or Land).
            ...(isCopterVehicle && compassSetupAvailability.gpsConfigured === false
              ? [
                  {
                    label: 'Throttle failsafe lands (no GPS: FS_THR_ENABLE 3 or 7)',
                    met: throttleFailsafe === 3 || throttleFailsafe === 7
                  }
                ]
              : rtlAltitudeMetres !== undefined
                ? [
                    {
                      label: 'Return altitude above tree height (20 m)',
                      met: rtlAltitudeMetres >= 20
                    }
                  ]
                : []),
            // The Radio step owns RC presence. Requiring it again here, with no
            // waiver, meant a radio legitimately signed off as "verified
            // elsewhere" (receiver not yet bound, TX off) hit a wall two steps
            // later. A Sub has no RC receiver at all (joystick over MAVLink), so
            // it is not asked.
            ...(failsafeVehicle === 'sub'
              ? []
              : [
                  {
                    label: 'RC link seen, or radio verified elsewhere',
                    met:
                      snapshot.liveVerification.rcInput.verified ||
                      radioConfirmation?.outcome === 'already-done' ||
                      failsafeConfirmation !== undefined
                  }
                ]),
            {
              // Battery telemetry needs SYS_STATUS voltage > 1000 mV, i.e. a real
              // pack. On a bench board on USB with props off -- the posture this
              // wizard exists for -- it never arrives. This was a hard criterion AND
              // the confirm gate, and failsafe was the only step in the flow with no
              // waiver, so modes and power (both AFTER it) stayed locked forever.
              // Kept as evidence with an operator escape below.
              label: 'Battery telemetry live',
              met: snapshot.liveVerification.batteryTelemetry.verified || failsafeConfirmation !== undefined
            },
            {
              label: 'Failsafe review confirmed',
              met: failsafeConfirmation !== undefined
            }
          ]
          // failsafeActionLabel resolves the enum labels off the parameter
          // definition, so it needs whichever id this vehicle actually exposes --
          // Copter/Rover/Sub use FS_THR_ENABLE, Plane uses THR_FAILSAFE.
          const describeEnable = (value: number | undefined): string =>
            value === undefined ? 'not reported' : value === 0 ? 'disabled' : `action ${value}`
          const batterySummary = noBatteryMonitor
            ? 'no battery monitor'
            : `battery action ${failsafeActionLabel(snapshot, 'BATT_FS_LOW_ACT', batteryFailsafe, formatArducopterBatteryFailsafeAction)}`
          summary =
            failsafeVehicle === 'sub'
              ? `Leak failsafe ${failsafeActionLabel(snapshot, 'FS_LEAK_ENABLE', subLeakFailsafe, describeEnable)}, surface-link failsafe ${failsafeActionLabel(snapshot, 'FS_GCS_ENABLE', subGcsFailsafe, describeEnable)}, ${batterySummary}.`
              : failsafeVehicle === 'plane'
                ? `Throttle failsafe ${failsafeActionLabel(snapshot, 'THR_FAILSAFE', planeThrottleFailsafe, describeEnable)}, long failsafe ${failsafeActionLabel(snapshot, 'FS_LONG_ACTN', planeLongAction, describeEnable)}, ${batterySummary}.`
                : failsafeVehicle === 'rover'
                  ? `Throttle failsafe ${failsafeActionLabel(snapshot, 'FS_THR_ENABLE', throttleFailsafe, describeEnable)}, failsafe action ${failsafeActionLabel(snapshot, 'FS_ACTION', roverAction, describeEnable)}, ${batterySummary}.`
                  : `Throttle failsafe ${failsafeActionLabel(
                      snapshot,
                      readRoundedParameter(snapshot, 'FS_THR_ENABLE') !== undefined ? 'FS_THR_ENABLE' : 'THR_FAILSAFE',
                      throttleFailsafe,
                      formatArducopterThrottleFailsafe
                    )}, ${batterySummary}.`
          detail =
            snapshot.liveVerification.batteryTelemetry.verified && snapshot.liveVerification.rcInput.verified
              ? 'RC and battery are live. Review the failsafes.'
              : 'Keep RC and battery live while you review.'
          evidence = [
            rtlAltitudeMetres === undefined
              ? failsafeVehicle === 'rover' || failsafeVehicle === 'sub'
                ? 'RTL altitude: not applicable'
                : 'RTL altitude: not reported'
              : `RTL returns at ${rtlAltitudeMetres.toFixed(0)} m`,
            ...(failsafeVehicle === 'sub'
              ? []
              : [snapshot.liveVerification.rcInput.verified ? 'RC link live' : 'RC link: not seen']),
            snapshot.liveVerification.batteryTelemetry.verified ? 'Battery telemetry live' : 'Battery telemetry: not seen',
            `Review: ${failsafeConfirmation ? `confirmed at ${formatConfirmationTime(failsafeConfirmation.confirmedAtMs)}` : 'pending'}`
          ]
          actions.unshift({
            kind: failsafeConfirmation ? 'clear-confirmation' : 'confirm-step',
            label: failsafeConfirmation ? 'Clear Failsafe Review' : 'Confirm Failsafe Review',
            tone: 'primary',
            sectionId: 'failsafe',
            disabled: failsafeConfirmation ? false : failsafeConfirmDisabled
          })
          if (!failsafeConfirmation && !snapshot.liveVerification.batteryTelemetry.verified) {
            actions.push({
              kind: 'confirm-step',
              label: 'No Pack Connected — Review Later',
              tone: 'secondary',
              sectionId: 'failsafe',
              confirmationOutcome: 'already-done',
              // Same gate as the confirm: a waiver that records while the
              // step cannot complete hides the real blocker behind an undo.
              disabled: failsafeConfirmDisabled
            })
          }
          if (failsafeConfigMissing) {
            detail =
              failsafeVehicle === 'sub'
                ? 'FS_LEAK_ENABLE or FS_GCS_ENABLE has not been reported by the vehicle. Re-sync parameters, or check the firmware exposes them.'
                : 'Not all failsafe parameters have arrived. Re-sync parameters, or check the firmware has them.'
          }
          break
        }
        case 'modes': {
          // Modes previously had NO operator escape of any kind: the switch
          // exercise had to pass, full stop. On a build the exercise cannot
          // drive that left the final steps of the wizard unreachable.
          const modesConfirmation = getSetupConfirmationRecord('modes')
          const modesWaived = modesConfirmation?.outcome === 'already-done'
          // The first flights are flown in Stabilize, and hover-throttle
          // learning and Autotune need an altitude-holding mode. The step used
          // to count positions without reading what they were.
          const hasStabilize = modeExerciseAssignments.some((assignment) => assignment.value === 0)
          const hasAltHold = modeExerciseAssignments.some((assignment) => assignment.value === 2)
          criteria = [
            {
              label: 'Mode channel set',
              met: modeSwitchEstimate.channelNumber !== undefined || modesWaived
            },
            {
              label: 'Two or more switch positions assigned',
              met: modeExerciseAssignments.length >= 2 || modesWaived
            },
            ...(isCopterVehicle
              ? [
                  {
                    // The waiver covers it: "verified elsewhere" is the
                    // operator taking the mode choice on themselves (an
                    // acro-only build is a deliberate one).
                    label: 'Stabilize and AltHold on the switch',
                    met: (hasStabilize && hasAltHold) || modesWaived
                  }
                ]
              : []),
            {
              label: modesWaived
                ? 'Flight modes verified elsewhere'
                : 'Mode switch exercise passed',
              met: modeSwitchExercise.status === 'passed' || modesWaived
            }
          ]
          summary =
            modeSwitchExercise.status === 'passed'
              ? 'Switch exercise passed: every position seen.'
              : modeSwitchExercise.status === 'running'
                ? modeSwitchExercise.unexpectedSlots.length > 0
                  ? `${modeSwitchExerciseSummary} Position${modeSwitchExercise.unexpectedSlots.length > 1 ? 's' : ''} ${modeSwitchExercise.unexpectedSlots.join(', ')} ${modeSwitchExercise.unexpectedSlots.length > 1 ? 'have' : 'has'} no mode assigned.`
                  : modeSwitchExerciseSummary
                : modeSwitchEstimate.estimatedSlot !== undefined
                  ? modeSwitchEstimate.channelNumber === undefined
                    ? 'A switch is moving but no mode channel is set. Set it in Flight Modes, then run the exercise.'
                    : `Mode switch seen on CH${modeSwitchEstimate.channelNumber}. Run the switch exercise.`
                  : 'Waiting for a mode channel with live input.'
          detail =
            modeSwitchExercise.status === 'failed'
              ? modeSwitchExercise.failureReason ?? 'Mode switch exercise failed.'
              : 'Move the switch through every position.'
          evidence = [
            modeSwitchEstimate.channelNumber !== undefined ? `Mode channel: CH${modeSwitchEstimate.channelNumber}` : 'Mode channel: not set',
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
              'Flight modes verified elsewhere. Run the switch exercise any time to check them here.'
          }
          if (isCopterVehicle && !modesWaived && !(hasStabilize && hasAltHold)) {
            detail = `Put ${!hasStabilize && !hasAltHold ? 'Stabilize and AltHold' : !hasStabilize ? 'Stabilize' : 'AltHold'} on the switch: the first flight is flown in Stabilize, and the hover-throttle and Autotune flights need AltHold.`
          }
          confirmationOutcome = modesConfirmation?.outcome
          nextStep = 'Next: the battery monitor, with a pack plugged in.'
          break
        }
        case 'power': {
          // Two bench postures this step could not get past:
          //   - no pack on USB: telemetry never verifies (SYS_STATUS voltage
          //     stays ~0) and the "No Pack" waiver lived on Failsafe, one step
          //     LATER; a build with no battery monitor at all (BATT_MONITOR=0)
          //     had no route whatsoever;
          //   - ARMING_CHECK=0: the firmware computes no pre-arm verdict, so the
          //     criterion below was false while `healthy` read true, and the
          //     acknowledge button keyed on `!healthy` was never offered.
          // 'not-applicable' here = "no pack / no monitor -- review on battery
          // later"; it defers every live reading. 'already-done' stays the
          // pre-arm acknowledgement.
          const powerDeferred = powerConfirmation?.outcome === 'not-applicable'
          const batteryMonitorConfigured = batteryMonitor !== undefined && batteryMonitor > 0
          // Cell count from the live pack voltage (3.3–4.35 V per cell; an
          // ambiguous voltage gives up), then every non-zero threshold has to
          // make sense for that pack: 3S numbers on a 6S pack never trip.
          const packVoltage = snapshot.liveVerification.batteryTelemetry.verified
            ? snapshot.liveVerification.batteryTelemetry.voltageV
            : undefined
          const cellCandidates =
            packVoltage === undefined
              ? []
              : Array.from({ length: 13 }, (_, index) => index + 2).filter((cells) => {
                  const perCell = packVoltage / cells
                  return perCell >= 3.3 && perCell <= 4.35
                })
          const packCells = cellCandidates.length === 1 ? cellCandidates[0] : undefined
          const perCellWithin = (paramId: string, low: number, high: number): string | undefined => {
            const value = readParameterValue(snapshot, paramId)
            if (packCells === undefined || value === undefined || value === 0) {
              return undefined
            }
            const perCell = value / packCells
            return perCell >= low && perCell <= high ? undefined : `${paramId} ${value} is ${perCell.toFixed(2)} V per cell`
          }
          const thresholdProblems = [
            perCellWithin('BATT_ARM_VOLT', 3.0, 4.1),
            perCellWithin('BATT_LOW_VOLT', 3.0, 3.9),
            perCellWithin('BATT_CRT_VOLT', 2.8, 3.8),
            perCellWithin('MOT_BAT_VOLT_MAX', 4.0, 4.4),
            perCellWithin('MOT_BAT_VOLT_MIN', 2.8, 3.7)
          ].filter((problem): problem is string => problem !== undefined)
          criteria = [
            {
              label:
                batteryMonitor === 0 && powerDeferred
                  ? 'No battery monitor on this build (BATT_MONITOR = 0), acknowledged'
                  : 'Battery monitor is configured',
              met: batteryMonitorConfigured || (batteryMonitor === 0 && powerDeferred)
            },
            {
              label: powerDeferred ? 'Battery readings deferred until a pack is on' : 'Battery telemetry live',
              met: snapshot.liveVerification.batteryTelemetry.verified || powerDeferred
            },
            ...(packCells !== undefined
              ? [
                  {
                    label: `Battery thresholds match a ${packCells}S pack`,
                    met: thresholdProblems.length === 0
                  }
                ]
              : []),
            {
              label: 'Power review confirmed',
              met: powerConfirmation !== undefined
            }
            // The pre-arm verdict moved to the Ready to Fly step, where the pack
            // is on and the reasons mean something.
          ]
          summary = snapshot.liveVerification.batteryTelemetry.verified
            ? `${formatVoltage(snapshot.liveVerification.batteryTelemetry.voltageV)} and ${formatRemaining(
                snapshot.liveVerification.batteryTelemetry.remainingPercent
              )}.`
            : 'No battery telemetry yet.'
          detail =
            thresholdProblems.length > 0
              ? `The pack reads as ${packCells}S, but ${thresholdProblems.join('; ')}. Set the voltage thresholds for this pack in Config ▸ Battery and Failsafe.`
              : batteryHealthTone(snapshot) === 'success'
                ? 'Battery telemetry is live and healthy. Confirm the review.'
                : 'Plug a pack in, then check the battery monitor reads right.'
          evidence = [
            `Battery monitor: ${describeBatteryMonitor(batteryMonitor)}`,
            `Health: ${batteryHealthLabel(snapshot)}`,
            packCells !== undefined ? `Pack: ${packCells}S at ${formatVoltage(packVoltage)}` : 'Pack: not connected',
            `Review: ${powerConfirmation ? `confirmed at ${formatConfirmationTime(powerConfirmation.confirmedAtMs)}` : 'pending'}`
          ]
          actions.unshift({
            kind: 'guided',
            label: guidedActionButtonLabel('reboot-autopilot', snapshot, busyAction),
            tone: 'secondary',
            actionId: 'reboot-autopilot',
            disabled: busyAction !== undefined || !canRunGuidedAction(snapshot, 'reboot-autopilot')
          })
          if (!powerConfirmation && (!snapshot.liveVerification.batteryTelemetry.verified || batteryMonitor === 0)) {
            actions.push({
              kind: 'confirm-step',
              label: batteryMonitor === 0 ? 'No Battery Monitor — Continue' : 'No Pack Connected — Review Later',
              tone: 'secondary',
              sectionId: 'power',
              confirmationOutcome: 'not-applicable',
              disabled: busyAction !== undefined || batteryMonitor === undefined
            })
          }
          // BATT_VOLT_MULT / BATT_AMP_PERVLT are per-board, per-sensor values --
          // AP_BattMonitor_Analog derives its defaults from hwdef, falling back
          // to 10.1/17.0 or -1 on boards that define none. Every failsafe
          // threshold the next step reviews is denominated in that possibly-wrong
          // volt, so "telemetry is live" proves a number arrives, not that it is
          // right. The calibration cards for both live on the Calibration tab and
          // the flow had no route to them.
          actions.push({
            kind: 'scroll',
            label: 'Open Battery Calibration',
            panelId: 'setup-panel-calibration'
          })
          actions.unshift({
            kind: powerConfirmation ? 'clear-confirmation' : 'confirm-step',
            label: powerConfirmation
              ? powerDeferred
                ? 'Clear Power Deferral'
                : 'Clear Power Review'
              : 'Confirm Power Review',
            tone: 'primary',
            sectionId: 'power',
            disabled: powerConfirmation
              ? false
              : !batteryMonitorConfigured || !snapshot.liveVerification.batteryTelemetry.verified
          })
          confirmationOutcome = powerConfirmation?.outcome
          nextStep = 'Next: review the failsafes.'
          break
        }
        case 'readiness': {
          // The last look before props go on. These are the checks the wiki's
          // first-flight pages assume and nothing in the bench steps asked for.
          const readinessConfirmation = getSetupConfirmationRecord('readiness')
          const preArmAcknowledged = readinessConfirmation?.outcome === 'already-done'
          const armingSkip = readRoundedParameter(snapshot, 'ARMING_SKIPCHK')
          const armingCheck = readRoundedParameter(snapshot, 'ARMING_CHECK')
          // 4.7 inverted the parameter: ARMING_SKIPCHK lists checks to SKIP (0 =
          // skip none); before that ARMING_CHECK bit 0 means "all checks".
          const armingChecksAllOn =
            armingSkip !== undefined ? armingSkip === 0 : armingCheck !== undefined && (armingCheck & 1) === 1
          const logBitmask = readRoundedParameter(snapshot, 'LOG_BITMASK')
          const logBackend = readRoundedParameter(snapshot, 'LOG_BACKEND_TYPE')
          const loggingOn = logBitmask !== undefined && logBitmask !== 0 && (logBackend === undefined || logBackend !== 0)
          const armingRudder = readRoundedParameter(snapshot, 'ARMING_RUDDER')
          const armSwitchChannel = Array.from({ length: 16 }, (_, index) => index + 1).find((channel) => {
            const option = readRoundedParameter(snapshot, `RC${channel}_OPTION`)
            return option === ARM_SWITCH_OPTION_VALUE || option === ARM_SWITCH_AIRMODE_OPTION_VALUE
          })
          const armMethod = (armingRudder !== undefined && armingRudder !== 0) || armSwitchChannel !== undefined
          const liveCheck = snapshot.preArmStatus.liveCheck
          const preArmVerdictUsable = liveCheck?.present === true && liveCheck.enabled === true
          const preArmPassingWithPack =
            preArmVerdictUsable &&
            snapshot.vehicle?.armed !== true &&
            snapshot.preArmStatus.healthy &&
            snapshot.liveVerification.batteryTelemetry.verified
          const snapshotSaved = savedSnapshotCount > 0
          criteria = [
            {
              // No waiver: the wiki's one explicit "never do this".
              label: 'All arming checks on',
              met: armingChecksAllOn
            },
            {
              label: 'Logging on',
              met: loggingOn
            },
            {
              label: 'A way to arm: rudder or switch',
              met: armMethod
            },
            {
              label: preArmAcknowledged
                ? 'Pre-arm acknowledged, to clear at the field'
                : 'Pre-arm checks pass with the pack connected',
              met: preArmPassingWithPack || preArmAcknowledged
            },
            {
              label: 'Snapshot saved',
              met: snapshotSaved
            },
            {
              label: 'Ready to fly, confirmed',
              met: readinessConfirmation !== undefined
            }
          ]
          const unmetCount = criteria.filter((criterion) => !criterion.met).length
          summary = unmetCount === 0 ? 'Ready for the first flight.' : `${unmetCount} thing${unmetCount === 1 ? '' : 's'} to settle before props go on.`
          detail = !armingChecksAllOn
            ? 'Not every arming check is on. Turn every check back on in Config ▸ Arming before the first flight.'
            : !loggingOn
              ? 'Logging is off. Turn it on in Logs; every later step reads a flight log.'
              : !armMethod
                ? 'No way to arm. Set ARMING_RUDDER, or put Arm/Disarm on a switch in Receiver.'
                : !snapshotSaved
                  ? 'Save a snapshot in Snapshots before flying, so this setup can be restored.'
                  : !preArmPassingWithPack && !preArmAcknowledged
                    ? snapshot.liveVerification.batteryTelemetry.verified
                      ? 'Pre-arm is blocked. Read the reasons on Status & Info. If they are only GPS and position, acknowledge and check again at the field.'
                      : 'Plug a pack in to see the pre-arm result, or acknowledge and check it at the field.'
                    : 'Props on, pack on, clear area. First flight in Stabilize: arm, disarm, arm, lift a hand\u2019s width, set down, then a short hover.'
          evidence = [
            `Arming checks: ${armingChecksAllOn ? 'all on' : armingSkip !== undefined ? `ARMING_SKIPCHK ${armingSkip}` : `ARMING_CHECK ${armingCheck ?? '?'}`}`,
            `Logging: ${loggingOn ? 'on' : 'off'}`,
            `Arm: ${armSwitchChannel !== undefined ? `switch on CH${armSwitchChannel}` : armMethod ? 'rudder' : 'none'}`,
            snapshot.preArmStatus.healthy ? 'Pre-arm: clear' : `Pre-arm: ${snapshot.preArmStatus.issues.length ? `${snapshot.preArmStatus.issues.length} issue${snapshot.preArmStatus.issues.length === 1 ? '' : 's'}` : 'blocked'}`
          ]
          actions[actions.indexOf(panelAction)] = {
            kind: 'scroll',
            label: 'Open Arming Checks',
            panelId: 'setup-panel-arming'
          }
          actions.unshift({
            kind: readinessConfirmation ? 'clear-confirmation' : 'confirm-step',
            label: readinessConfirmation ? 'Clear Ready-to-Fly Review' : 'Confirm Ready to Fly',
            tone: 'primary',
            sectionId: 'readiness',
            confirmationOutcome: 'complete',
            disabled: readinessConfirmation ? false : !(armingChecksAllOn && loggingOn && armMethod && snapshotSaved)
          })
          if (!snapshotSaved) {
            actions.push({ kind: 'scroll', label: 'Open Snapshots', panelId: 'setup-panel-snapshots' })
          }
          if (!loggingOn) {
            actions.push({ kind: 'scroll', label: 'Open Logs', panelId: 'setup-panel-logs' })
          }
          if (!readinessConfirmation && !preArmPassingWithPack && preArmVerdictUsable) {
            actions.push({
              kind: 'confirm-step',
              label: 'Pre-arm Blocked on the Bench — Acknowledge',
              tone: 'secondary',
              sectionId: 'readiness',
              confirmationOutcome: 'already-done',
              disabled: !(armingChecksAllOn && loggingOn && armMethod && snapshotSaved)
            })
          }
          confirmationOutcome = readinessConfirmation?.outcome
          nextStep = 'Next: props on, pack on, the first flight in Stabilize. Bring the log back.'
          break
        }
        case 'maiden': {
          // Read from the log, not from a tick box. The first-flight page asks
          // the pilot to judge these by eye; the log answers them.
          const maidenConfirmation = getSetupConfirmationRecord('maiden')
          const maidenWaived = maidenConfirmation?.outcome === 'already-done'
          const flight = maidenFlight
          const flew = flight?.hasFlight === true
          const stabilize = flew && (flight.firstArmedMode === undefined || flight.firstArmedMode === STABILIZE_MODE)
          const hovered = flew && flight.airborneSeconds >= MAIDEN_MIN_AIRBORNE_S
          const noOscillation = flew && flight.limitCycle === undefined
          const vibrationOk = flew && (flight.vibe === undefined || flight.vibe.verdict === 'good')
          const nothingReported = flew && flight.warningTexts.length === 0
          criteria = [
            {
              label: maidenWaived ? 'First flight reviewed elsewhere' : 'First flight log read',
              met: flew || maidenWaived
            },
            {
              label: 'Armed in Stabilize',
              met: stabilize || maidenWaived
            },
            {
              label: 'Disarm rehearsed (arm, disarm, arm)',
              met: (flew && flight.rehearsedArmDisarm) || maidenWaived
            },
            {
              label: `Hovered ${MAIDEN_MIN_AIRBORNE_S} s or more`,
              met: hovered || maidenWaived
            },
            {
              label: 'No oscillation in the gyro',
              met: noOscillation || maidenWaived
            },
            {
              label: 'Vibration and clipping acceptable',
              met: vibrationOk || maidenWaived
            },
            {
              label: 'No thrust loss, yaw imbalance or crash reported',
              met: nothingReported || maidenWaived
            },
            {
              label: 'First flight confirmed',
              met: maidenConfirmation !== undefined
            }
          ]
          summary = !flew
            ? maidenWaived
              ? 'First flight reviewed elsewhere.'
              : 'Waiting for the first flight\u2019s log.'
            : flight.verdict === 'clean'
              ? `A clean first flight: ${flight.airborneSeconds.toFixed(0)} s in the air in ${flight.firstArmedModeName ?? 'Stabilize'}.`
              : `${flight.findings.length} thing${flight.findings.length === 1 ? '' : 's'} to look at from the first flight.`
          detail = !flew
            ? maidenWaived
              ? 'Read a log in any time to check the flight here.'
              : 'Props on, pack on, clear area, Stabilize. Arm, disarm, arm. Creep the throttle; if anything shakes, land. Lift a hand\u2019s width, set down, then a short hover. Land, disarm and read the log below.'
            : flight.findings.length > 0
              ? flight.findings.join(' ')
              : 'The log reads clean. Confirm, then on to the hover-throttle flight.'
          evidence = flew
            ? [
                `Armed in ${flight.firstArmedModeName ?? 'unknown mode'}, ${flight.armCycles} arm cycle${flight.armCycles === 1 ? '' : 's'}`,
                `Airborne ${flight.airborneSeconds.toFixed(0)} s`,
                flight.vibe ? `Vibration ${flight.vibe.verdict}, clips ${flight.vibe.clip.join('/')}` : 'Vibration: not logged',
                `Review: ${maidenConfirmation ? `confirmed at ${formatConfirmationTime(maidenConfirmation.confirmedAtMs)}` : 'pending'}`
              ]
            : [
                'Log: none read yet',
                `Review: ${maidenConfirmation ? `confirmed at ${formatConfirmationTime(maidenConfirmation.confirmedAtMs)}` : 'pending'}`
              ]
          actions[actions.indexOf(panelAction)] = { kind: 'scroll', label: 'Open Logs', panelId: 'setup-panel-logs' }
          actions.unshift({
            kind: maidenConfirmation ? 'clear-confirmation' : 'confirm-step',
            label: maidenConfirmation
              ? maidenWaived
                ? 'Clear First-Flight Waiver'
                : 'Clear First-Flight Review'
              : 'Confirm First Flight',
            tone: 'primary',
            sectionId: 'maiden',
            confirmationOutcome: 'complete',
            disabled: maidenConfirmation ? false : !(flew && stabilize && hovered && noOscillation && vibrationOk && nothingReported && flight.rehearsedArmDisarm)
          })
          if (!maidenConfirmation) {
            actions.push({
              kind: 'confirm-step',
              label: 'Flown Elsewhere — Continue',
              tone: 'secondary',
              sectionId: 'maiden',
              confirmationOutcome: 'already-done',
              disabled: busyAction !== undefined
            })
          }
          confirmationOutcome = maidenConfirmation?.outcome
          nextStep = 'Next: the hover-throttle flight, a steady hover in AltHold.'
          break
        }
        case 'hover': {
          // Flight two. MOT_THST_HOVER is the vertical feedforward; the firmware
          // learns it only in an altitude-holding hover (Copter::update_throttle_hover
          // returns early in Stabilize/Acro). Accepting freezes it
          // (MOT_HOVER_LEARN = 0); the vertical acceleration controller then
          // follows it (initial-tuning-flight.rst, "Test AltHold").
          const hoverConfirmation = getSetupConfirmationRecord('hover')
          const hoverWaived = hoverConfirmation?.outcome === 'already-done'
          const hoverState = deriveHoverLearnState(snapshot)
          const hoverThrottle = hoverState.hoverThrottle
          const hoverLearned = hoverThrottle !== undefined && Math.abs(hoverThrottle - MOT_THST_HOVER_DEFAULT) > 1e-6
          const hoverAccepted = hoverLearned && !hoverState.hoverLearnArmed
          const gains = hoverThrottle === undefined ? undefined : deriveThrottleControllerGains(hoverThrottle, (id) => readParameterValue(snapshot, id))
          criteria = [
            {
              label: hoverWaived ? 'Hover throttle set elsewhere' : 'Hover throttle learned (MOT_THST_HOVER not 0.35)',
              met: hoverLearned || hoverWaived
            },
            {
              label: 'Hover throttle accepted (MOT_HOVER_LEARN = 0)',
              met: hoverAccepted || hoverWaived
            },
            {
              label: 'Throttle controller set from the hover throttle',
              met: (gains?.matches ?? false) || hoverWaived
            },
            {
              label: 'Hover flight confirmed',
              met: hoverConfirmation !== undefined
            }
          ]
          summary = hoverWaived
            ? 'Hover throttle set elsewhere.'
            : !hoverLearned
              ? `MOT_THST_HOVER is still the ${MOT_THST_HOVER_DEFAULT} default: nothing has been learned yet.`
              : `Hover throttle ${hoverThrottle.toFixed(3)}${hoverAccepted ? ', accepted' : ', learning still on'}${gains ? gains.matches ? '; throttle controller follows it.' : '; throttle controller still at its defaults.' : '.'}`
          detail = hoverWaived
            ? 'Fly the hover any time to learn it here.'
            : !hoverLearned
              ? 'Props on, pack on. Take off in Stabilize, climb to about 5 m, switch to AltHold and hold a steady hover for 30 s. Land and disarm; the value saves on disarm. Stabilize or Acro learns nothing.'
              : !hoverAccepted
                ? 'A hover throttle was learned. If the hover was steady, accept it below to lock it in.'
                : gains && !gains.matches
                  ? 'Set the throttle controller from the hover throttle below, then write.'
                  : 'Hover throttle learned, accepted, and the throttle controller follows it. Confirm.'
          evidence = [
            `MOT_THST_HOVER: ${hoverThrottle === undefined ? 'not reported' : hoverThrottle.toFixed(3)}`,
            `Learning: ${hoverState.hoverLearnArmed ? 'on (MOT_HOVER_LEARN = 2)' : 'off'}`,
            gains ? `${gains.pParamId} ${gains.currentP ?? '—'} / ${gains.iParamId} ${gains.currentI ?? '—'} (targets ${gains.targetP} / ${gains.targetI})` : 'Throttle controller: not reported',
            `Review: ${hoverConfirmation ? `confirmed at ${formatConfirmationTime(hoverConfirmation.confirmedAtMs)}` : 'pending'}`
          ]
          actions[actions.indexOf(panelAction)] = { kind: 'scroll', label: 'Open Calibration ▸ Flight', panelId: 'setup-panel-calibration' }
          actions.unshift({
            kind: hoverConfirmation ? 'clear-confirmation' : 'confirm-step',
            label: hoverConfirmation ? (hoverWaived ? 'Clear Hover Waiver' : 'Clear Hover Review') : 'Confirm Hover Throttle',
            tone: 'primary',
            sectionId: 'hover',
            confirmationOutcome: 'complete',
            disabled: hoverConfirmation ? false : !(hoverLearned && hoverAccepted && (gains?.matches ?? false))
          })
          if (!hoverConfirmation) {
            actions.push({
              kind: 'confirm-step',
              label: 'Hover Throttle Set Elsewhere — Continue',
              tone: 'secondary',
              sectionId: 'hover',
              confirmationOutcome: 'already-done',
              disabled: busyAction !== undefined
            })
          }
          confirmationOutcome = hoverConfirmation?.outcome
          nextStep = 'Next: the harmonic notch, placed from a hover log.'
          break
        }
        case 'filters': {
          // The notch goes on before autotune: a tune made against motor noise
          // is a tune of the noise. Planned from the hover (ESC telemetry when
          // the build has it, throttle otherwise), judged against the vehicle.
          const filtersConfirmation = getSetupConfirmationRecord('filters')
          const filtersWaived = filtersConfirmation?.outcome === 'already-done'
          const notch = buildNotchSetupPlan({
            plan: notchPlan,
            liveEscTelemetry: snapshot.liveVerification.escTelemetry.escs.some((esc) => esc.rpm > 0),
            gyroFilterHz: readParameterValue(snapshot, 'INS_GYRO_FILTER'),
            hoverThrottle: readParameterValue(snapshot, 'MOT_THST_HOVER'),
            current: {
              enable: readRoundedParameter(snapshot, 'INS_HNTCH_ENABLE'),
              mode: readRoundedParameter(snapshot, 'INS_HNTCH_MODE'),
              ref: readParameterValue(snapshot, 'INS_HNTCH_REF'),
              freq: readParameterValue(snapshot, 'INS_HNTCH_FREQ'),
              bw: readParameterValue(snapshot, 'INS_HNTCH_BW'),
              harmonics: readRoundedParameter(snapshot, 'INS_HNTCH_HMNCS'),
              options: readRoundedParameter(snapshot, 'INS_HNTCH_OPTS')
            }
          })
          const notchMode = readRoundedParameter(snapshot, 'INS_HNTCH_MODE')
          criteria = [
            {
              label: filtersWaived ? 'Filters set elsewhere' : 'Harmonic notch on and tracking (INS_HNTCH_MODE)',
              met: notch.checks.enabled || filtersWaived
            },
            {
              label: notchMode === 1 ? 'Notch reference is the hover throttle (INS_HNTCH_REF)' : 'Notch reference is 1 (INS_HNTCH_REF)',
              met: (notch.checks.enabled && notch.checks.referenceRight) || filtersWaived
            },
            {
              label: notchMode === 3 ? 'Notch floor between the gyro filter and the hover peak (INS_HNTCH_FREQ)' : 'Notch centred on the motor peak (INS_HNTCH_FREQ)',
              met: (notch.checks.enabled && notch.checks.frequencySane) || filtersWaived
            },
            {
              label: 'Notch bandwidth half the frequency, or a quarter per motor (INS_HNTCH_BW)',
              met: (notch.checks.enabled && notch.checks.bandwidthSane) || filtersWaived
            },
            {
              label: 'Notch placed, confirmed',
              met: filtersConfirmation !== undefined
            }
          ]
          summary = filtersWaived ? 'Filters set elsewhere.' : notch.summary
          detail = filtersWaived
            ? 'Read a hover log any time to check the notch here.'
            : notch.source === 'unknown'
              ? 'Read the hover-throttle flight\u2019s log below. Without ESC telemetry, turn on Logs ▸ Logging for tuning before that flight.'
              : notch.blockers.length > 0
                ? notch.blockers.join(' ')
                : notch.checks.enabled && notch.checks.referenceRight && notch.checks.frequencySane && notch.checks.bandwidthSane
                  ? 'The notch is placed. Fly the same hover again to check the motor peak is gone, then confirm.'
                  : 'Set the notch from the hover below and write. It takes effect after a reboot.'
          evidence = [
            `Notch: ${notch.checks.enabled ? `mode ${notchMode}` : 'off'}, REF ${readParameterValue(snapshot, 'INS_HNTCH_REF') ?? '—'}, FREQ ${readParameterValue(snapshot, 'INS_HNTCH_FREQ') ?? '—'}, BW ${readParameterValue(snapshot, 'INS_HNTCH_BW') ?? '—'}`,
            `Source: ${notch.source === 'esc' ? 'ESC telemetry' : notch.source === 'throttle' ? 'throttle' : 'no log read yet'}`,
            `Gyro filter: ${readParameterValue(snapshot, 'INS_GYRO_FILTER') ?? '—'} Hz`,
            `Review: ${filtersConfirmation ? `confirmed at ${formatConfirmationTime(filtersConfirmation.confirmedAtMs)}` : 'pending'}`
          ]
          actions[actions.indexOf(panelAction)] = { kind: 'scroll', label: 'Open Tuning ▸ Notches', panelId: 'setup-panel-tuning' }
          actions.unshift({
            kind: filtersConfirmation ? 'clear-confirmation' : 'confirm-step',
            label: filtersConfirmation ? (filtersWaived ? 'Clear Filters Waiver' : 'Clear Filters Review') : 'Confirm Notch Placed',
            tone: 'primary',
            sectionId: 'filters',
            confirmationOutcome: 'complete',
            disabled: filtersConfirmation
              ? false
              : !(notch.checks.enabled && notch.checks.referenceRight && notch.checks.frequencySane && notch.checks.bandwidthSane)
          })
          if (!filtersConfirmation) {
            actions.push({
              kind: 'confirm-step',
              label: 'Filters Set Elsewhere — Continue',
              tone: 'secondary',
              sectionId: 'filters',
              confirmationOutcome: 'already-done',
              disabled: busyAction !== undefined
            })
          }
          confirmationOutcome = filtersConfirmation?.outcome
          nextStep = 'Next: autotune, one axis at a time, in AltHold on a calm day.'
          break
        }
        case 'autotune': {
          // Judged by the gains that moved since the flight was staged (the
          // Autotune card records them). Prerequisites are the ones the
          // autotune page opens with: a learned hover throttle, the notch on,
          // AltHold on the switch, an aggressiveness in range.
          const autotuneConfirmation = getSetupConfirmationRecord('autotune')
          const autotuneWaived = autotuneConfirmation?.outcome === 'already-done'
          const filtersWaivedBefore = getSetupConfirmationRecord('filters')?.outcome === 'already-done'
          const hoverLearnedForTune = (() => {
            const value = readParameterValue(snapshot, 'MOT_THST_HOVER')
            return value !== undefined && Math.abs(value - MOT_THST_HOVER_DEFAULT) > 1e-6
          })()
          const notchOn = (readRoundedParameter(snapshot, 'INS_HNTCH_ENABLE') ?? 0) !== 0 || filtersWaivedBefore
          const altHoldOnSwitch = [1, 2, 3, 4, 5, 6].some((slot) => readRoundedParameter(snapshot, `FLTMODE${slot}`) === 2)
          const aggressiveness = readParameterValue(snapshot, 'AUTOTUNE_AGGR')
          const aggressivenessOk = aggressiveness !== undefined && aggressiveness >= 0.05 - 1e-9 && aggressiveness <= 0.1 + 1e-9
          const tunedAxes = autotuneFlight ? compareAutotuneGains(autotuneFlight.gains, snapshot, autotuneFlight.axisMask).changedAxes : []
          const axisTuned = (label: string): boolean => tunedAxes.includes(label)
          const mainAxes = AUTOTUNE_AXES.filter((axis) => axis.label === 'Roll' || axis.label === 'Pitch' || axis.label === 'Yaw')
          const allTuned = mainAxes.every((axis) => axisTuned(axis.label))
          criteria = [
            { label: 'Hover throttle learned', met: hoverLearnedForTune || autotuneWaived },
            { label: 'Harmonic notch on', met: notchOn || autotuneWaived },
            { label: 'AltHold on the switch', met: altHoldOnSwitch || autotuneWaived },
            { label: 'AUTOTUNE_AGGR between 0.05 and 0.10', met: aggressivenessOk || autotuneWaived },
            ...mainAxes.map((axis) => ({
              label: autotuneWaived ? `${axis.label} tuned elsewhere` : `${axis.label} tuned (gains moved)`,
              met: axisTuned(axis.label) || autotuneWaived
            })),
            { label: 'Autotune confirmed', met: autotuneConfirmation !== undefined }
          ]
          const prerequisitesMet = hoverLearnedForTune && notchOn && altHoldOnSwitch && aggressivenessOk
          summary = autotuneWaived
            ? 'Tuned elsewhere.'
            : !prerequisitesMet
              ? 'Not ready to autotune yet.'
              : !autotuneFlight
                ? 'Ready to autotune.'
                : tunedAxes.length === 0
                  ? 'Flight staged; no gains have moved yet.'
                  : `Tuned: ${tunedAxes.join(', ')}${allTuned ? '.' : `; still to do: ${mainAxes.filter((axis) => !axisTuned(axis.label)).map((axis) => axis.label).join(', ')}.`}`
          detail = autotuneWaived
            ? 'Stage an autotune flight any time to tune here.'
            : !hoverLearnedForTune
              ? 'Learn the hover throttle first (Hover Throttle step): autotune flies in AltHold and needs it.'
              : !notchOn
                ? 'Place the harmonic notch first (Filters step): a tune made against motor noise is a tune of the noise.'
                : !altHoldOnSwitch
                  ? 'Put AltHold on the mode switch (Flight Modes step); autotune is entered from AltHold.'
                  : !aggressivenessOk
                    ? 'Set AUTOTUNE_AGGR between 0.05 and 0.10 (0.1 aggressive, 0.075 medium, 0.05 weak).'
                    : !autotuneFlight
                      ? 'Pick one axis below and stage the flight: it records the gains it starts from. Calm day, props on, pack on. Take off in AltHold, switch to AutoTune, let it twitch until it reports done, then land and disarm in AutoTune to keep the gains.'
                      : allTuned
                        ? 'Every axis moved. Fly it; if it is twitchy, lower the aggressiveness and tune again. Then confirm.'
                        : 'Fly the next axis the same way. An axis whose gains did not move was not saved: land and disarm while still in AutoTune.'
          evidence = [
            `AUTOTUNE_AGGR ${aggressiveness ?? '—'}`,
            autotuneFlight ? `Flight staged for ${AUTOTUNE_AXES.filter((axis) => (autotuneFlight.axisMask & axis.bit) !== 0).map((axis) => axis.label).join(', ') || 'no axis'}` : 'No flight staged',
            `Tuned: ${tunedAxes.length > 0 ? tunedAxes.join(', ') : 'none yet'}`,
            `Review: ${autotuneConfirmation ? `confirmed at ${formatConfirmationTime(autotuneConfirmation.confirmedAtMs)}` : 'pending operator confirmation'}`
          ]
          actions[actions.indexOf(panelAction)] = { kind: 'scroll', label: 'Open Tuning', panelId: 'setup-panel-tuning' }
          actions.unshift({
            kind: autotuneConfirmation ? 'clear-confirmation' : 'confirm-step',
            label: autotuneConfirmation ? (autotuneWaived ? 'Clear Autotune Waiver' : 'Clear Autotune Review') : 'Confirm Autotune',
            tone: 'primary',
            sectionId: 'autotune',
            confirmationOutcome: 'complete',
            disabled: autotuneConfirmation ? false : !(prerequisitesMet && allTuned)
          })
          if (!autotuneConfirmation) {
            actions.push({
              kind: 'confirm-step',
              label: 'Tuned Elsewhere — Continue',
              tone: 'secondary',
              sectionId: 'autotune',
              confirmationOutcome: 'already-done',
              disabled: busyAction !== undefined
            })
          }
          confirmationOutcome = autotuneConfirmation?.outcome
          nextStep = 'Next: fly it, then save a snapshot of the tuned aircraft on Snapshots.'
          break
        }
        default: {
          // Every section id the switch does not name -- 'sensors', 'verify',
          // 'drive', 'frame', 'controls' -- used to fall through with criteria = [],
          // and deriveSetupStatusFromCriteria([]) returns 'attention'. The step
          // could therefore never be complete, the sequential lock pass froze
          // everything behind it, and it rendered with no criteria and nothing to
          // click. Those ids are exactly the ones Plane, Rover and Sub declare, so
          // every non-Copter vehicle deadlocked in its first three steps.
          //
          // Build criteria from what the bundle itself declares, then give the
          // operator a sign-off. That is a real gate rather than a stub: a section
          // is not complete until its required parameters are present and it has
          // been reviewed.
          const declaredParams: string[] = section.definition?.requiredParameters ?? []
          const missingParams = declaredParams.filter(
            (paramId: string) => readRoundedParameter(snapshot, paramId) === undefined
          )
          const genericConfirmation = getSetupConfirmationRecord(section.id)
          criteria = [
            ...(declaredParams.length > 0
              ? [
                  {
                    label: 'All of this step\u2019s parameters reported',
                    met: missingParams.length === 0
                  }
                ]
              : []),
            {
              label: `${section.title} review confirmed`,
              met: genericConfirmation !== undefined
            }
          ]
          summary = section.description
          detail =
            missingParams.length > 0
              ? `${missingParams.length} parameters have not arrived: ${missingParams
                  .slice(0, 4)
                  .join(', ')}${missingParams.length > 4 ? '…' : ''}. Re-sync parameters, or check the firmware has them.`
              : 'Check this step on the vehicle, then confirm.'
          evidence = [
            declaredParams.length > 0
              ? `${declaredParams.length - missingParams.length}/${declaredParams.length} parameters present`
              : 'No parameters to check',
            `Review: ${genericConfirmation ? `confirmed at ${formatConfirmationTime(genericConfirmation.confirmedAtMs)}` : 'pending'}`
          ]
          actions.unshift({
            kind: genericConfirmation ? 'clear-confirmation' : 'confirm-step',
            label: genericConfirmation ? `Clear ${section.title} Review` : `Confirm ${section.title} Review`,
            tone: 'primary',
            sectionId: section.id
          })
          // The bundle declares what this step is FOR (calibrate-*, reboot) and
          // the step used to ignore it: a Plane's Sensors step was a lone
          // "Confirm Sensors Review" with no route to any calibration. Offer
          // the declared guided actions, and a jump to the page that does the
          // work (Calibration for the sensor cals; Tuning for drive/controls;
          // Parameters for a frame config the app has no editor for).
          const declaredActions = section.actions ?? []
          for (const actionId of declaredActions) {
            actions.push({
              kind: 'guided',
              label: guidedActionButtonLabel(actionId, snapshot, busyAction),
              tone: 'secondary',
              actionId,
              disabled: busyAction !== undefined || !canRunGuidedAction(snapshot, actionId)
            })
          }
          const genericPanel =
            declaredActions.some((actionId) => actionId.startsWith('calibrate-'))
              ? { panelId: 'setup-panel-calibration', label: 'Open Calibration' }
              : section.id === 'drive' || section.id === 'controls'
                ? { panelId: 'setup-panel-tuning', label: 'Open Tuning' }
                : section.id === 'frame'
                  ? { panelId: 'setup-panel-parameters', label: 'Open Parameters' }
                  : undefined
          if (genericPanel) {
            actions[actions.indexOf(panelAction)] = { kind: 'scroll', label: genericPanel.label, panelId: genericPanel.panelId }
          }
          break
        }
      }

      // The operator's override. No step may be a dead end: when a step offers
      // no enabled way to sign it off (a hard criterion the bench cannot meet,
      // a parameter the firmware never reported, a waiver that is itself
      // gated), "Override" completes it on the operator's word. It is loud --
      // every criterion reads "overridden", the summary says so, and Clear is
      // always there -- and it is offered only when nothing else is.
      const overrideRecord = getSetupConfirmationRecord(section.id)
      if (overrideRecord?.outcome === 'overridden') {
        criteria = criteria.map((criterion) => ({ ...criterion, label: `${criterion.label} (overridden)`, met: true }))
        summary = `Overridden by you at ${formatConfirmationTime(overrideRecord.confirmedAtMs)}.`
        detail = 'You overrode this step. Clear the override to judge it again.'
        confirmationOutcome = 'overridden'
        actions.splice(0, actions.length, {
          kind: 'clear-confirmation',
          label: 'Clear Override',
          tone: 'primary',
          sectionId: section.id
        }, ...actions.filter((action) => action.kind !== 'confirm-step' && action.kind !== 'clear-confirmation'))
      } else if (
        deriveSetupStatusFromCriteria(criteria) !== 'complete' &&
        !actions.some((action) => action.kind === 'confirm-step' && !action.disabled)
      ) {
        actions.push({
          kind: 'confirm-step',
          label: 'Override — Continue Anyway',
          tone: 'secondary',
          sectionId: section.id,
          confirmationOutcome: 'overridden',
          disabled: busyAction !== undefined
        })
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
        nextStep,
        actions
      }
    })

    // A pending reboot / re-sync follow-up gates the CURRENT step. When every
    // step is satisfied it gates the last one, so the flow does not report
    // complete over a board that still needs rebooting.
    const followUpPending = parameterFollowUp?.refreshRequired === true
    const firstIncompleteIndex = baseSections.findIndex((section) => section.status !== 'complete')
    const gateIndex =
      firstIncompleteIndex >= 0 ? firstIncompleteIndex : followUpPending ? baseSections.length - 1 : -1
    const bodyNextStep = (index: number): string | undefined => {
      const next = baseSections[index + 1]
      if (next) {
        return `Next: ${next.title}.`
      }
      // The end of the bench phase is a handoff, not a trophy.
      return isCopterVehicle
        ? 'Setup on the bench is done. Next: props on, pack on, a first flight in Stabilize. Then Calibration ▸ Flight for hover throttle and tuning.'
        : 'Setup on the bench is done. Next: a first careful test under power, in a safe area.'
    }

    let currentIncompleteSectionTitle: string | undefined

    return baseSections.map((section, index) => {
      const nextStep = section.nextStep ?? bodyNextStep(index)
      // A satisfied section reads complete wherever it sits: a compass already
      // calibrated on the vehicle three steps ahead of the current one is a
      // fact worth showing, and there is nothing to do in it. Only unsatisfied
      // sections past the current one are locked.
      if (section.status === 'complete' && index !== gateIndex) {
        return {
          ...section,
          sequenceState: 'complete',
          nextStep
        }
      }

      if (index === gateIndex) {
        currentIncompleteSectionTitle = section.title
        if (!followUpPending || !parameterFollowUp) {
          return {
            ...section,
            sequenceState: 'current',
            nextStep
          }
        }
        // The reboot (or re-sync) is a checkpoint owned by the step that
        // caused it: one more criterion, the action to satisfy it first, and
        // the follow-up's own text as the reason.
        const gateActionId = parameterFollowUp.requiresReboot ? 'reboot-autopilot' : 'request-parameters'
        const criteria = [
          ...section.criteria,
          {
            label: parameterFollowUp.requiresReboot
              ? 'Flight controller rebooted after the last change'
              : 'Parameters re-synced after the last change',
            met: false
          }
        ]
        return {
          ...section,
          sequenceState: 'current',
          status: deriveSetupStatusFromCriteria(criteria),
          criteria,
          criteriaMetCount: criteria.filter((criterion) => criterion.met).length,
          blockingReason: parameterFollowUp.text,
          nextStep: parameterFollowUp.requiresReboot
            ? 'Next: reboot the flight controller, then continue here.'
            : 'Next: re-sync parameters, then continue here.',
          actions: [
            {
              kind: 'guided',
              label: guidedActionButtonLabel(gateActionId, snapshot, busyAction),
              tone: 'primary',
              actionId: gateActionId,
              disabled: busyAction !== undefined || !canRunGuidedAction(snapshot, gateActionId)
            },
            ...section.actions.filter(
              (action) => !(action.kind === 'guided' && action.actionId === gateActionId)
            )
          ]
        }
      }

      // The sequence reason is the one the operator can act on ("go finish step
      // N"). A pending follow-up used to REPLACE it outright, so a locked step
      // reported e.g. "Reboot required" and never said which step was actually
      // holding the flow — and it clobbered any section-specific blocking copy
      // built above. Lead with the sequence reason and append the follow-up.
      const sequenceReason = `Finish ${currentIncompleteSectionTitle} before ${section.title}.`
      return {
        ...section,
        sequenceState: 'locked',
        nextStep,
        blockingReason: setupFlowFollowUp ? `${sequenceReason} ${setupFlowFollowUp.title}` : sequenceReason
      }
    })
}

