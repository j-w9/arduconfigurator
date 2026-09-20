// OutputsSection — the OutputsView invocation for the `motors` and `servos`
// views, building the output-overview, task-body, and review-dock slots for
// motor setup / direction-test / ESC protocol / servo mapping / peripherals /
// review. The internal `activeViewId === 'motors'` / `'servos'` branching
// drives the title, subtitle, filtered task cards, and whether the overview
// sidebar renders.
//
// The output hook results are passed as grouped props typed via
// `ReturnType<typeof useX>` so the prop shapes are inferred from the hooks and
// cannot drift. Each group is destructured back into the flat variable names
// the JSX reads at the top of the component body. Scalar derivations and
// handler bodies are threaded through via the `derived` and `handlers` bags.
// The motor-test + motor-verification + guided-reorder state machines live in
// the parent; only their current values and the handlers that advance them
// are passed in.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type {
  ConfiguratorSnapshot,
  ParameterDraftEntry,
  ParameterState,
  deriveAirframe,
  deriveEscSetupSummary,
  deriveOutputMappingSummary,
  evaluateMotorTestEligibility
} from '@arduconfig/ardupilot-core'
import { MAX_MOTOR_TEST_THROTTLE_PERCENT } from '@arduconfig/ardupilot-core'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { useMotorManagement } from '../hooks/use-motor-management'
import type { useMotorOutputAssignments } from '../hooks/use-motor-output-assignments'
import type { useMotorTestConfig } from '../hooks/use-motor-test-config'
import type { useOutputAssignmentVisibility } from '../hooks/use-output-assignment-visibility'
import type { useSafetyAcks } from '../hooks/use-safety-acks'
import type { ParameterDraftValues } from '../hooks/use-parameter-drafts'
import type { buildVehicleOutputSummary } from '../view-models/vehicle-output-summary'
import type { createMotorPreviewNodes } from '../view-models/motor-preview'
import { outputKindLabel, toneForOutputKind } from '../device-display'
import { ALL_MOTOR_TEST_OUTPUT, ALL_MOTOR_TEST_OUTPUT_SIMULTANEOUS } from '../motor-test-helpers'
import { MotorTestSliders } from '../motor-test-sliders'
import {
  type SpinWizardState,
  confirmSpinWizard,
  createIdleSpinWizardState,
  deriveSpinThresholds,
  describeSpinThresholdProblem,
  formatSpinValue,
  spinValueToThrottlePercent,
  setSpinWizardValue,
  spinCeilingReason,
  startSpinWizard,
  SPIN_ARM_MAX,
  SPIN_WIZARD_KEEPALIVE_MS,
  SPIN_WIZARD_TRACK_HEIGHT,
  SPIN_WIZARD_START,
  SPIN_WIZARD_WATCHDOG_SECONDS
} from '../view-models/spin-threshold-wizard'
import { MotorMixerDiagram } from '../views/MotorMixerDiagram'
import { formatParameterValue } from '../parameter-format'
import { readRoundedParameter, selectParameterById } from '../selectors/parameter-read'
import { QUADPLANE_ESC_PARAM_IDS } from '../param-groups'
import { buildPlaneControlSurfaces } from '../view-models/plane-control-surfaces'
import {
  MOTORS_SAFETY_ACK_ID,
  OUTPUTS_BENCH_TARGET_ID,
  OUTPUTS_MOTOR_START_BUTTON_ID,
  OUTPUTS_MOTOR_TEST_BUTTON_ID,
  escCalibrationInstructions,
  escCalibrationPathLabel
} from '../setup-flow-helpers'
import {
  toneForMotorTestStatus,
  toneForParameterDraftStatus,
  toneForScopedDraftReview
} from '../tone-helpers'
import { OutputsView } from '../views/Outputs'
import { EscRpmReadout } from '../views/EscRpmReadout'
import { buildEscRpmReadoutViewModel } from '../view-models/esc-rpm-readout'
import type { OutputsTaskId, OutputsViewProps } from '../views/Outputs'
import { ScopedField, ScopedSelectField } from '../views/ScopedField'
import { ServoFunctionMappingView } from '../views/ServoFunctionMapping'
import type { ServoFunctionMappingViewProps } from '../views/ServoFunctionMapping'

type OutputMappingSummary = ReturnType<typeof deriveOutputMappingSummary>
type ConfiguredOutput = OutputMappingSummary['motorOutputs'][number]

export interface OutputsSectionDerived {
  airframe: ReturnType<typeof deriveAirframe>
  outputMapping: OutputMappingSummary
  escSetup: ReturnType<typeof deriveEscSetupSummary>
  vehicleOutputSummary: ReturnType<typeof buildVehicleOutputSummary>
  motorPreviewNodes: ReturnType<typeof createMotorPreviewNodes>
  motorPreviewCount: number
  motorPreviewGeometryMode: string
  /** False until FRAME_CLASS/FRAME_TYPE are known — the diagram shows a prompt. */
  motorPreviewFrameKnown: boolean
  motorTestEligibility: ReturnType<typeof evaluateMotorTestEligibility>
  isCopterVehicle: boolean
  configuredOutputs: readonly ConfiguredOutput[]
  visibleDisabledOutputs: readonly ConfiguredOutput[]
  frameConfigEditable: boolean
  frameClassParameter: ParameterState | undefined
  frameTypeParameter: ParameterState | undefined
  frameDraftEntries: readonly ParameterDraftEntry[]
  frameStagedDrafts: readonly ParameterDraftEntry[]
  frameInvalidDrafts: readonly ParameterDraftEntry[]
  escReviewConfirmation: import('../app-types').SetupConfirmationRecord | undefined
  escReviewSummary: string
  motorMixerSummary: string
  motorDirectionSummary: string
  currentMotorTestSucceeded: boolean
  currentMotorVerificationLabel: string | undefined
  selectedMotorTestOutputLabel: string | undefined
  selectedMotorTestOutputMotorNumber: number | undefined
  motorTestSliderTargets: Array<{ value: number; label: string }>
  motorTestGuardReasons: readonly string[]
  motorTestOverUsb: boolean
  canRunMotorTest: boolean
  canRunMotorVerification: boolean
  outputReviewParameters: readonly ParameterState[]
  outputAssignmentParameters: readonly ParameterState[]
  showAllOutputAssignments: boolean
  outputAssignmentReviewLabel: string
  servoMappingRows: ServoFunctionMappingViewProps['rows']
  outputAssignmentDraftEntries: ParameterDraftEntry[]
  outputAssignmentStagedDrafts: ParameterDraftEntry[]
  outputAssignmentInvalidDrafts: ParameterDraftEntry[]
  outputReviewDraftEntries: ParameterDraftEntry[]
  outputReviewStagedDrafts: ParameterDraftEntry[]
  outputReviewInvalidDrafts: ParameterDraftEntry[]
  outputAdditionalGroups: import('../view-models/peripherals').AdditionalSettingsGroup[]
  outputAdditionalDraftEntries: ParameterDraftEntry[]
  outputAdditionalStagedDrafts: ParameterDraftEntry[]
  outputAdditionalInvalidDrafts: ParameterDraftEntry[]
  outputReviewDraftSummaries: ReadonlyArray<{ taskId: OutputsTaskId; groupLabel: string; entry: ParameterDraftEntry }>
  outputPeripheralStagedDraftCount: number
  outputPeripheralInvalidDraftCount: number
  totalOutputStagedDrafts: number
  totalOutputInvalidDrafts: number
  outputHasPendingReview: boolean
  outputTaskCards: OutputsViewProps['taskCards']
  activeOutputTaskId: OutputsTaskId
  activeOutputTask: OutputsViewProps['activeTask']
  /**
   * Optional "enable the CAN bus for DroneCAN" offer rendered at the top of the
   * Peripherals task, above the metadata sections. Supplied by App.tsx ONLY when
   * a DroneCAN optical-flow sensor (FLOW_TYPE = 6) is selected while CAN bus 1
   * is off — the trap that makes a correctly wired flow sensor look dead. A
   * ReactNode slot (the established pattern for complex sub-surfaces here) so
   * this section keeps no runtime wiring of its own.
   */
}

export interface OutputsSectionHandlers {
  handleApplyScopedParameterDrafts: (
    drafts: readonly ParameterDraftEntry[],
    busyKey: string,
    scopeLabel: string
  ) => void | Promise<void>
  handleDiscardScopedParameterDrafts: (paramIds: readonly string[], scopeLabel: string) => void
  handleOpenMotorReorderDialog: () => void
  /** Expert-only surfaces. The spin-threshold wizard spins every motor, so it
   *  stays behind the same opt-in as the rest of the expert tooling. */
  isExpertMode: boolean
  /** Resolves with the guard reasons that REFUSED the request, or an empty
   *  array when it ran. Callers driving their own test UI must surface them;
   *  a silent refusal is indistinguishable from a broken button. */
  handleRunMotorTest: (
    override?: {
      outputChannel?: number
      throttlePercent?: number
      durationSeconds?: number
      replaceRunningTest?: boolean
    }
  ) => Promise<string[]>
  handleStopMotorTest: () => void | Promise<void>
  handleStartMotorVerification: (preferredOutputChannel?: number) => void
  handleConfirmMotorVerification: () => void
  handleFailMotorVerification: () => void
  handleResetMotorVerification: () => void
  confirmSetupSection: (sectionId: string, outcome?: import('../app-types').SetupSectionOutcome) => void
  clearSetupSectionConfirmation: (sectionId: string) => void
  renderMetadataParameterField: (parameter: ParameterState) => ReactNode
  renderAdditionalSettingsCard: (
    title: string,
    description: string,
    groups: import('../view-models/peripherals').AdditionalSettingsGroup[],
    draftEntries: ParameterDraftEntry[],
    stagedDrafts: ParameterDraftEntry[],
    invalidDrafts: ParameterDraftEntry[],
    applyActionId: string,
    applyLabel: string,
    discardScope: string
  ) => ReactNode
  setDraft: (paramId: string, value: string) => void
  setShowAllOutputAssignments: (updater: (current: boolean) => boolean) => void
  setOutputTaskOverride: (taskId: OutputsTaskId) => void
}

export interface OutputsSectionProps {
  activeViewId: 'motors' | 'servos'
  snapshot: ConfiguratorSnapshot
  /** The inline motor reorder/direction panel rendered as the Motor Setup tab. */
  motorSetupSlot: ReactNode
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  editedValues: ParameterDraftValues
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  motorOutputAssignments: ReturnType<typeof useMotorOutputAssignments>
  outputAssignmentVisibility: ReturnType<typeof useOutputAssignmentVisibility>
  motorTestConfig: ReturnType<typeof useMotorTestConfig>
  motorManagement: ReturnType<typeof useMotorManagement>
  safetyAcks: ReturnType<typeof useSafetyAcks>
  derived: OutputsSectionDerived
  handlers: OutputsSectionHandlers
  /** Upper bound for the motor-test Duration input. App.tsx picks the
   *  expert ceiling when product-mode is 'expert' so a longer soak is
   *  allowed; basic mode keeps the 5-second cap. */
  motorTestMaxDurationSeconds: number
}

/**
 * One field of the Peripherals & Alerts (LED & buzzer) card plus the shared
 * per-parameter "i". The card is curated: it shows "LED drivers" / "Buzzer
 * volume", never NTF_LED_TYPES / NTF_BUZZ_VOLUME, so without this an operator
 * had no route from the friendly name to the parameter they'd have to search
 * for in Parameters or look up in the reference.
 *
 * The bubble is a SIBLING of the editor, never a child: these editors wrap
 * their control in a <label>, and the bubble contains the wiki anchor — an
 * anchor inside a <label> is invalid markup and the label's click handling
 * swallows it.
 */
/**
 * Pole-count reference for SERVO_BLH_POLES.
 *
 * The field on its own is a number with no way to check it, and getting it
 * wrong is silent: ArduPilot computes RPM = eRPM * 200 / poles
 * (AP_BLHeli.cpp:1544, and the identical line in AP_IOMCU.cpp:442), so a wrong
 * pole count produces RPM telemetry, notch tuning and logs that are all wrong
 * by exactly the same factor and never look broken.
 *
 * Deliberately short on per-motor tables. "12N14P" covers essentially the whole
 * FPV size range, and beyond it the honest answer is to count magnets rather
 * than to trust a lookup that would go stale — so that is what this says.
 */
function MotorPoleReference(): ReactElement {
  return (
    <details className="motor-pole-reference" data-testid="motor-pole-reference">
      <summary>How many poles does my motor have?</summary>
      <p>
        Poles are the <strong>magnets in the bell</strong>, not the stator slots. Almost every FPV
        multirotor motor — roughly 1103 through 2810 — uses the 12N14P layout: 12 stator slots and{' '}
        <strong>14 poles</strong>. That is also ArduPilot&apos;s default, so if you are running a
        normal 2&quot;–7&quot; quad, 14 is already right.
      </p>
      <p>
        If you are not sure, look inside the bell and count the magnets. That count is the number to
        enter. Large heavy-lift and X-class motors often use more than 14 — do not assume there.
      </p>
      <p>
        To check it after the fact: with bidirectional DShot running, ArduPilot reports{' '}
        <code>RPM = eRPM × 200 ÷ poles</code>. Unloaded at full throttle a motor turns at roughly its
        KV × pack voltage, so if reported RPM is consistently double or half what you expect, the
        pole count is wrong by that same factor.
      </p>
    </details>
  )
}

export function OutputsSection(props: OutputsSectionProps): ReactElement {
  const {
    activeViewId,
    snapshot,
    motorSetupSlot,
    canApplyDraftParameters,
    busyAction,
    editedValues,
    parameterDraftById,
    motorTestConfig,
    motorManagement,
    safetyAcks,
    derived,
    handlers,
    motorTestMaxDurationSeconds
  } = props




  const {
    motorTestOutput,
    setMotorTestOutput,
    motorTestThrottlePercent,
    setMotorTestThrottlePercent,
    motorTestDurationSeconds,
    setMotorTestDurationSeconds
  } = motorTestConfig

  const { motorVerification } = motorManagement

  const {
    propsRemovedAcknowledged,
    setPropsRemovedAcknowledged,
    testAreaAcknowledged,
    setTestAreaAcknowledged,
    usbBenchAcknowledged,
    setUsbBenchAcknowledged
  } = safetyAcks

  const {
    airframe,
    outputMapping,
    escSetup,
    vehicleOutputSummary,
    motorPreviewNodes,
    motorPreviewGeometryMode,
    motorPreviewFrameKnown,
    frameClassParameter,
    frameTypeParameter,
    frameDraftEntries,
    frameStagedDrafts,
    motorTestEligibility,
    isCopterVehicle,
    escReviewSummary,
    currentMotorTestSucceeded,
    motorTestSliderTargets,
    motorTestGuardReasons,
    motorTestOverUsb,
    canRunMotorTest,
    outputReviewParameters,
    servoMappingRows,
    outputAssignmentDraftEntries,
    outputAssignmentStagedDrafts,
    outputAssignmentInvalidDrafts,
    outputReviewDraftEntries,
    outputReviewStagedDrafts,
    outputReviewInvalidDrafts,
    outputAdditionalGroups,
    outputAdditionalDraftEntries,
    outputAdditionalStagedDrafts,
    outputAdditionalInvalidDrafts,
    outputReviewDraftSummaries,
    outputPeripheralStagedDraftCount,
    outputPeripheralInvalidDraftCount,
    totalOutputStagedDrafts,
    totalOutputInvalidDrafts,
    outputHasPendingReview,
    outputTaskCards,
    activeOutputTaskId,
    activeOutputTask,
  } = derived

  const {
    handleApplyScopedParameterDrafts,
    handleDiscardScopedParameterDrafts,
    isExpertMode,
    handleRunMotorTest,
    handleStopMotorTest,
    renderAdditionalSettingsCard,
    setDraft,
    setOutputTaskOverride
  } = handlers

  // MOT_SPIN_ARM / MOT_SPIN_MIN by measurement. Drives the existing motor test
  // (all motors at once) up a 0.01 staircase until the operator says every motor
  // is turning, then adds margin twice -- once so ARM clears the break-away
  // point, again so MIN clears ARM, which is the ordering firmware requires.
  const [spinWizard, setSpinWizard] = useState<SpinWizardState>(createIdleSpinWizardState)
  const [spinWizardOpen, setSpinWizardOpen] = useState(false)
  // The reason the last command was refused, if it was. Shown in the popout.
  const [spinWizardRefusal, setSpinWizardRefusal] = useState<string | undefined>(undefined)

  // The safety acknowledgements the wizard needs before it may spin anything.
  //
  // One expression, used by BOTH the launcher and Start, so the two cannot
  // disagree about what is required. The USB acknowledgement was previously
  // missing from Start: over a USB link handleRunMotorTest refuses the command
  // anyway, so an operator could tick the props box, press an enabled-looking
  // Start, and get a refusal instead of motors. The gate now matches the one
  // the command itself applies.
  const spinWizardAckMissing =
    !propsRemovedAcknowledged ||
    !testAreaAcknowledged ||
    (motorTestOverUsb && !usbBenchAcknowledged)
  const [spinArmDraft, setSpinArmDraft] = useState<string>('')
  const [spinMinDraft, setSpinMinDraft] = useState<string>('')
  const spinThresholdProblem =
    spinWizard.status === 'ready'
      ? describeSpinThresholdProblem(Number(spinArmDraft), Number(spinMinDraft))
      : undefined

  // Live throttle control.
  //
  // The operator scales up until the motors break away, so the motors have to
  // FOLLOW the slider -- sampling it for a few seconds per release told them
  // nothing about where the edge is. Holding them live means re-commanding
  // continuously, which is what ArduPilot expects: a DO_MOTOR_TEST while a
  // test runs updates the throttle in place rather than starting a second one.
  //
  // The link is the thing to protect. Each simultaneous update is one
  // ACK-waited command per motor, so commanding on every pointermove queued
  // minutes of work behind busyAction and left the app disabled -- the
  // "configurator stopped responding" report. This sender keeps exactly one
  // update in flight and collapses everything that arrives while it is busy
  // down to the latest value: the rate self-limits to the round-trip time, and
  // intermediate positions the slider merely passed through are never sent.
  const spinLiveValue = useRef<number>(SPIN_WIZARD_START)
  const spinSendBusy = useRef(false)
  const spinSendDirty = useRef(false)

  const sendSpinCommand = useCallback(async () => {
    if (spinSendBusy.current) {
      spinSendDirty.current = true
      return
    }
    spinSendBusy.current = true
    try {
      do {
        spinSendDirty.current = false
        const refusedFor = await handleRunMotorTest({
          outputChannel: ALL_MOTOR_TEST_OUTPUT_SIMULTANEOUS,
          throttlePercent: spinValueToThrottlePercent(spinLiveValue.current),
          // A deadman, not a run length: the keepalive below refreshes it, so
          // motors stop on their own if this page stops sending.
          durationSeconds: SPIN_WIZARD_WATCHDOG_SECONDS,
          // Updating our own running test, not starting a second one.
          replaceRunningTest: true
        })
        setSpinWizardRefusal(refusedFor.length > 0 ? refusedFor[0] : undefined)
      } while (spinSendDirty.current)
    } finally {
      spinSendBusy.current = false
    }
  }, [handleRunMotorTest])

  const runSpinWizardAt = useCallback(
    (value: number) => {
      spinLiveValue.current = value
      // Mirrored into state so the guardrail card and sliders agree, but the
      // command carries its own values -- state is not readable this tick.
      setMotorTestOutput(ALL_MOTOR_TEST_OUTPUT_SIMULTANEOUS)
      setMotorTestThrottlePercent(spinValueToThrottlePercent(value))
      void sendSpinCommand()
    },
    [sendSpinCommand, setMotorTestOutput, setMotorTestThrottlePercent]
  )

  // Keepalive. Without it the motors stop as soon as the operator stops moving
  // the slider -- which is exactly when they are staring at them deciding
  // whether that counts as movement.
  //
  // Reached through a ref on purpose. handleRunMotorTest is redefined on every
  // App render, so sendSpinCommand is a new function every render too; an
  // effect depending on it tears the interval down and builds a new one each
  // time, and with live telemetry re-rendering faster than the interval, it
  // never fires at all. Measured: motors ran out their 2s watchdog and stopped
  // while the wizard sat there claiming to hold them. Depending only on the
  // status keeps one stable interval that always calls the latest sender.
  const sendSpinCommandRef = useRef(sendSpinCommand)
  useEffect(() => {
    sendSpinCommandRef.current = sendSpinCommand
  }, [sendSpinCommand])

  useEffect(() => {
    if (spinWizard.status !== 'stepping') {
      return
    }
    const timer = setInterval(() => {
      void sendSpinCommandRef.current()
    }, SPIN_WIZARD_KEEPALIVE_MS)
    return () => clearInterval(timer)
  }, [spinWizard.status])

  // Closing the popout must not leave motors turning: the wizard commands real
  // motor tests, and dismissing a dialog is not a reason for a quad on the
  // bench to keep spinning. Stop first, then reset, then close.
  const closeSpinWizard = useCallback(() => {
    void handleStopMotorTest()
    setSpinWizard(createIdleSpinWizardState())
    setSpinWizardOpen(false)
  }, [handleStopMotorTest])

  // QuadPlane lift-motor ESC range (Q_M_*), the plane-side mirror of the Copter
  // MOT_* ESC surface. Only meaningful when VTOL is enabled (Q_ENABLE=1); built
  // from the existing draft machinery so edits stage/apply like the copter card.
  const isQuadPlane = !isCopterVehicle && readRoundedParameter(snapshot, 'Q_ENABLE') === 1
  const quadplaneEscParameters = isQuadPlane
    ? QUADPLANE_ESC_PARAM_IDS.map((id) => selectParameterById(snapshot, id)).filter(
        (parameter): parameter is ParameterState => parameter !== undefined
      )
    : []
  const quadplaneEscDraftEntries = QUADPLANE_ESC_PARAM_IDS.map((id) => parameterDraftById.get(id)).filter(
    (entry): entry is ParameterDraftEntry => entry !== undefined
  )
  const quadplaneEscStagedDrafts = quadplaneEscDraftEntries.filter((entry) => entry.status === 'staged')
  const quadplaneEscInvalidDrafts = quadplaneEscDraftEntries.filter((entry) => entry.status === 'invalid')

  // Fixed-wing control-surface checklist (Plane/QuadPlane): per-surface channel,
  // reversal, and L/R pairing — the things to verify before flight.
  const planeControlSurfaces = isCopterVehicle
    ? { surfaces: [], mappedCount: 0, incompleteCount: 0 }
    : buildPlaneControlSurfaces(
        outputMapping.outputs,
        (channelNumber) => readRoundedParameter(snapshot, `SERVO${channelNumber}_REVERSED`) === 1
      )

  // Both Motors and Servos are single pages now. Servos kept sub-tabs while it
  // hosted four unrelated subsystems; with the gimbal, flow/lidar, notification
  // hardware and relays moved to the Peripherals tab it has one job left — the
  // output map, plus the metadata-backed output settings that extend it — so a
  // tab strip over two cards was navigation for its own sake.
  const showAllMotorTasks = activeViewId === 'motors'
  const showAllServoTasks = activeViewId === 'servos'
  const singlePageOutputs = showAllMotorTasks || showAllServoTasks

  return (
    <>
      <OutputsView
        // Motors tab: motor verification flow (everything except aux
        // servo peripherals). Servos tab: aux peripheral assignments
        // only. The underlying task-body render blocks below are still
        // gated by activeOutputTaskId so unfiltered task IDs simply
        // won't render — no duplicate UI between tabs.
        // Motors is one page, not three sub-tabs.
        //
        // ESC & Protocol, Motor Setup and Direction & Test were mutually
        // exclusive, so setting a protocol meant leaving the page you needed to
        // check the result on -- and the ESC page had room to spare, half its
        // rows empty. They render together now in the order a build is actually
        // worked through: pick the protocol, map the motors, then spin them. The
        // task strip stays as in-page navigation rather than a filter, so every
        // existing route into a specific task still lands somewhere real.
        //
        // Servos keeps its sub-tabs: the output map, notification hardware and
        // relays are genuinely separate jobs, not three views of one.
        taskCards={
          activeViewId === 'motors'
            ? // Motors is three sub-tabs in a fixed order: ESC & protocol,
              // Motor setup, Direction & test (the consolidated 'review' task is
              // dropped — each sub-tab applies its own drafts).
              (['esc-protocol', 'motor-setup', 'direction-test'] as const)
                .map((id) => outputTaskCards.find((card) => card.id === id))
                .filter((card): card is (typeof outputTaskCards)[number] => card !== undefined)
            : // Servos, in the order a build is worked through: the output map
              // first, then what hangs off the outputs. Gimbal and Flow & Lidar
              // left for the Peripherals tab — a gimbal is a peripheral that
              // happens to use a servo output, not servo setup, and a
              // rangefinder usually has no servo output at all.
              (['servo-mapping', 'peripherals', 'relays'] as const)
                .map((id) => outputTaskCards.find((card) => card.id === id))
                .filter((card): card is (typeof outputTaskCards)[number] => card !== undefined)
        }
        title={activeViewId === 'motors' ? 'Motors' : 'Servos'}
        subtitle={
          activeViewId === 'motors'
            ? 'Frame class, output map, direction & test, ESC protocol, and verification review for propulsion motors.'
            // Short on purpose: the table below says what it is, and the tab
            // is called Servos. The long version restated the heading.
            : 'Assign a function to each output and set its PWM range, trim and direction.'
        }
        activeTaskId={activeOutputTaskId}
        activeTask={activeOutputTask}
        onSelectTask={(taskId) => {
          setOutputTaskOverride(taskId)
          // On Motors every task is on the page, so selecting one scrolls to it
          // rather than swapping the body out. Keeping setOutputTaskOverride as
          // well means the strip still marks where you are, and every existing
          // route that jumps straight to a task (the guided setup's "Open
          // Motors", the reorder notice) still lands on the right section.
          if (showAllMotorTasks) {
            requestAnimationFrame(() => {
              document
                .querySelector(`[data-outputs-task="${taskId}"]`)
                ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
            })
          }
        }}
        // Motors is one page: no task strip, and the denser one-page rhythm.
        singlePage={singlePageOutputs}
        singleColumn={showAllServoTasks}
        // The output overview panel was removed as part of the Motors/Outputs
        // declutter — the task surfaces below carry the per-output detail.
        overviewSlot={undefined}
        taskBodySlot={
          <>
              {showAllMotorTasks || activeOutputTaskId === 'esc-protocol' ? (
                <div className="outputs-task-panel outputs-task-panel--stack" data-outputs-task="esc-protocol">
                  {!isCopterVehicle ? (
                    <section className="bf-gui-box">
                      <div className="bf-gui-box__titlebar">
                        <strong>ESC &amp; Protocol</strong>
                      </div>
                      <div className="bf-gui-box__body">
                        {isQuadPlane && quadplaneEscParameters.length > 0 ? (
                          <div className="scoped-review-card scoped-review-card--compact" data-testid="quadplane-esc-card">
                            <div className="switch-exercise-card__header">
                              <div>
                                <strong>QuadPlane lift-motor ESC &amp; range</strong>
                                <p>
                                  Protocol and spin/PWM range for the VTOL lift motors (Q_M_*) — the
                                  plane-side equivalent of a multirotor&apos;s ESC setup.
                                </p>
                              </div>
                              <StatusBadge tone={toneForScopedDraftReview(quadplaneEscStagedDrafts.length, quadplaneEscInvalidDrafts.length)}>
                                {quadplaneEscInvalidDrafts.length > 0
                                  ? `${quadplaneEscInvalidDrafts.length} invalid`
                                  : quadplaneEscStagedDrafts.length > 0
                                    ? `${quadplaneEscStagedDrafts.length} staged`
                                    : 'in sync'}
                              </StatusBadge>
                            </div>

                            <div className="scoped-editor-grid">
                              {quadplaneEscParameters.map((parameter) => {
                                const hasOptions = (parameter.definition?.options ?? []).length > 0
                                return hasOptions ? (
                                  <ScopedSelectField
                                    key={parameter.id}
                                    parameter={parameter}
                                    liveValue={parameter.value}
                                    editedValues={editedValues}
                                    onChange={(paramId, value) => setDraft(paramId, value)}
                                    draftStatusById={parameterDraftById}
                                  />
                                ) : (
                                  <ScopedField
                                    key={parameter.id}
                                    parameter={parameter}
                                    liveValue={parameter.value}
                                    editedValues={editedValues}
                                    onChange={(paramId, value) => setDraft(paramId, value)}
                                    draftStatusById={parameterDraftById}
                                    stepFallback={parameter.definition?.step ?? 0.01}
                                  />
                                )
                              })}
                            </div>

                            <div className="switch-exercise-controls">
                              <button
                                style={buttonStyle('primary')}
                                onClick={() =>
                                  void handleApplyScopedParameterDrafts(quadplaneEscDraftEntries, 'outputs:apply', 'QuadPlane ESC')
                                }
                                disabled={
                                  busyAction !== undefined ||
                                  quadplaneEscStagedDrafts.length === 0 ||
                                  quadplaneEscInvalidDrafts.length > 0 ||
                                  !canApplyDraftParameters
                                }
                              >
                                {busyAction === 'outputs:apply'
                                  ? 'Applying…'
                                  : `Apply ESC Changes (${quadplaneEscStagedDrafts.length})`}
                              </button>
                              <button
                                style={buttonStyle()}
                                onClick={() =>
                                  handleDiscardScopedParameterDrafts(quadplaneEscDraftEntries.map((entry) => entry.id), 'QuadPlane ESC')
                                }
                                disabled={busyAction !== undefined || quadplaneEscDraftEntries.length === 0}
                              >
                                Discard ESC Changes
                              </button>
                            </div>

                            <p className="bf-note">
                              Fixed-wing throttle and control-surface output stays on SERVOx_FUNCTION (Servos
                              tab); these Q_M_* values size the multirotor lift motors only.
                            </p>
                          </div>
                        ) : (
                          <p className="bf-note" data-testid="esc-protocol-noncopter-note">
                            ESC calibration and the motor spin/PWM range (MOT_PWM_*, MOT_SPIN_*) are a
                            multirotor concept. {airframe.frameClassLabel} throttle/ESC output is configured
                            per vehicle via SERVOx_FUNCTION (Servos tab); enable VTOL (Q_ENABLE) to expose the
                            QuadPlane lift-motor ESC range here.
                          </p>
                        )}
                      </div>
                    </section>
                  ) : (
                  <div className="esc-review-card">
                    {frameClassParameter ? (
                      <div className="scoped-review-card scoped-review-card--compact" data-testid="esc-frame-card">
                        <div className="switch-exercise-card__header">
                          <div>
                            <strong>Frame</strong>
                            <p>Airframe class + layout. Changing these restructures the motor outputs — reboot and re-verify motor order/spin afterwards.</p>
                          </div>
                          <StatusBadge tone={toneForScopedDraftReview(frameStagedDrafts.length, 0)}>
                            {frameStagedDrafts.length > 0 ? `${frameStagedDrafts.length} staged` : 'in sync'}
                          </StatusBadge>
                        </div>
                        <div className="scoped-editor-grid">
                          <ScopedSelectField
                            parameter={frameClassParameter}
                            liveValue={frameClassParameter.value}
                            editedValues={editedValues}
                            onChange={(paramId, value) => setDraft(paramId, value)}
                            draftStatusById={parameterDraftById}
                          />
                          {frameTypeParameter ? (
                            <ScopedSelectField
                              parameter={frameTypeParameter}
                              liveValue={frameTypeParameter.value}
                              editedValues={editedValues}
                              onChange={(paramId, value) => setDraft(paramId, value)}
                              draftStatusById={parameterDraftById}
                            />
                          ) : null}
                        </div>
                        <div className="switch-exercise-controls">
                          <button
                            style={buttonStyle('primary')}
                            data-testid="esc-frame-apply"
                            onClick={() => void handleApplyScopedParameterDrafts(frameDraftEntries, 'frame:apply', 'Frame')}
                            disabled={busyAction !== undefined || frameStagedDrafts.length === 0 || !canApplyDraftParameters}
                          >
                            {frameStagedDrafts.length > 0 ? `Apply Frame (${frameStagedDrafts.length})` : 'Apply Frame'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <div className="switch-exercise-card__header">
                      <div>
                        <strong>ESC calibration & motor range</strong>
                        <p>{escReviewSummary}</p>
                      </div>
                      <StatusBadge tone={escSetup.calibrationPath === 'manual-review' ? 'warning' : 'neutral'}>
                        {escCalibrationPathLabel(escSetup.calibrationPath)}
                      </StatusBadge>
                    </div>

                    <div className="scoped-review-card scoped-review-card--compact">
                      <div className="switch-exercise-card__header">
                        <div>
                          <strong>ESC & output settings</strong>
                          <p>Adjust the key motor protocol and spin-threshold values directly from Outputs.</p>
                        </div>
                        <StatusBadge tone={toneForScopedDraftReview(outputReviewStagedDrafts.length, outputReviewInvalidDrafts.length)}>
                          {outputReviewInvalidDrafts.length > 0
                            ? `${outputReviewInvalidDrafts.length} invalid`
                            : outputReviewStagedDrafts.length > 0
                              ? `${outputReviewStagedDrafts.length} staged`
                              : 'in sync'}
                        </StatusBadge>
                      </div>

                      <div className="scoped-editor-grid">
                        {/* Shared ScopedSelectField / ScopedNumberField so float
                          * params like MOT_SPIN_ARM don't display 32-bit mantissa
                          * noise (0.07999999821186066 → 0.08) and the "was X" line
                          * only renders on actually-staged drafts instead of
                          * duplicating what the editor already shows. */}
                        {outputReviewParameters.map((parameter) => {
                          const hasOptions = (parameter.definition?.options ?? []).length > 0
                          return hasOptions ? (
                            <ScopedSelectField
                              key={parameter.id}
                              parameter={parameter}
                              liveValue={parameter.value}
                              editedValues={editedValues}
                              onChange={(paramId, value) => setDraft(paramId, value)}
                              draftStatusById={parameterDraftById}
                            />
                          ) : (
                            <ScopedField
                              key={parameter.id}
                              parameter={parameter}
                              liveValue={parameter.value}
                              editedValues={editedValues}
                              onChange={(paramId, value) => setDraft(paramId, value)}
                              draftStatusById={parameterDraftById}
                              stepFallback={parameter.definition?.step ?? 0.01}
                            />
                          )
                        })}
                      </div>

                      {/* Only when the board actually reported the parameter —
                          a firmware built without AP_BLHeli has no pole count to
                          explain. */}
                      {outputReviewParameters.some((parameter) => parameter.id === 'SERVO_BLH_POLES') ? (
                        <MotorPoleReference />
                      ) : null}

                      <div className="switch-exercise-controls">
                        <button
                          style={buttonStyle('primary')}
                          onClick={() =>
                            void handleApplyScopedParameterDrafts(outputReviewDraftEntries, 'outputs:apply', 'Outputs')
                          }
                          disabled={
                            busyAction !== undefined ||
                            outputReviewStagedDrafts.length === 0 ||
                            outputReviewInvalidDrafts.length > 0 ||
                            !canApplyDraftParameters
                          }
                        >
                          {busyAction === 'outputs:apply' ? 'Applying…' : `Apply Output Changes (${outputReviewStagedDrafts.length})`}
                        </button>
                        <button
                          style={buttonStyle()}
                          onClick={() =>
                            handleDiscardScopedParameterDrafts(outputReviewDraftEntries.map((entry) => entry.id), 'output')
                          }
                          disabled={busyAction !== undefined || outputReviewDraftEntries.length === 0}
                        >
                          Discard Output Changes
                        </button>
                      </div>
                    </div>

                    {escCalibrationInstructions(escSetup).length > 0 ? (
                      <ol className="switch-exercise-instructions">
                        {escCalibrationInstructions(escSetup).map((instruction) => (
                          <li key={instruction}>{instruction}</li>
                        ))}
                      </ol>
                    ) : null}

                  </div>
                  )}
                </div>
              ) : null}
              {showAllMotorTasks || activeOutputTaskId === 'motor-setup' ? (
                isCopterVehicle ? (
                  <div
                    className="outputs-task-panel outputs-task-panel--stack"
                    data-outputs-task="motor-setup"
                    // The guided wizard's "Open Motor Verification" has always
                    // scrolled to this id -- which nothing rendered, so it
                    // silently landed the operator at the top of Motors. The
                    // order/direction work IS the motor verification, so the
                    // panel that holds it carries the anchor.
                    id={OUTPUTS_MOTOR_START_BUTTON_ID}
                  >
                    {motorSetupSlot}
                    {isExpertMode ? (
                      <div className="spin-wizard-launcher" data-testid="spin-threshold-wizard-launcher">
                        <div>
                          <strong>Spin thresholds</strong>
                          <p>
                            Measure where your motors actually break away instead of trusting the library
                            defaults, then stage <code>MOT_SPIN_ARM</code> and <code>MOT_SPIN_MIN</code> from it.
                          </p>
                        </div>
                        <StatusBadge tone={spinWizard.status === 'ready' ? 'success' : spinWizard.status === 'failed' ? 'danger' : 'neutral'}>
                          {spinWizard.status === 'idle'
                            ? 'not measured'
                            : spinWizard.status === 'stepping'
                              ? `testing ${formatSpinValue(spinWizard.currentValue)}`
                              : spinWizard.status === 'ready'
                                ? 'measured'
                                : 'failed'}
                        </StatusBadge>
                        <button
                          type="button"
                          style={buttonStyle('primary')}
                          data-testid="spin-wizard-open"
                          // Greyed until the acknowledgements on this same page
                          // are ticked. The wizard spins every motor at once,
                          // so opening it to find a dead Start button inside
                          // was the wrong place to learn the gate exists.
                          disabled={spinWizardAckMissing}
                          title={
                            spinWizardAckMissing
                              ? motorTestOverUsb && !usbBenchAcknowledged && propsRemovedAcknowledged && testAreaAcknowledged
                                ? 'Confirm the craft is on the bench (USB connection detected) before measuring.'
                                : 'Confirm props are off and the vehicle is restrained before measuring.'
                              : undefined
                          }
                          onClick={() => setSpinWizardOpen(true)}
                        >
                          Measure Spin Thresholds
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="outputs-task-panel outputs-task-panel--stack">
                        <div className="vehicle-output-summary" data-testid="vehicle-output-summary">
                          <div className="vehicle-output-summary__header">
                            <div>
                              <strong>{vehicleOutputSummary.title}</strong>
                              <p>{vehicleOutputSummary.description}</p>
                            </div>
                            <StatusBadge tone={vehicleOutputSummary.configuredCount > 0 ? 'success' : 'warning'}>
                              {vehicleOutputSummary.configuredCount} configured
                            </StatusBadge>
                          </div>
                          {vehicleOutputSummary.groups.length === 0 ? (
                            <p className="bf-note">
                              No outputs are assigned yet. Map functions to the SERVOn outputs in the Servos tab.
                            </p>
                          ) : (
                            vehicleOutputSummary.groups.map((group) => (
                              <section
                                key={group.id}
                                className="vehicle-output-group"
                                data-testid={`vehicle-output-group-${group.id}`}
                              >
                                <header className="vehicle-output-group__header">{group.label}</header>
                                <div className="vehicle-output-group__rows">
                                  {group.outputs.map((output) => (
                                    <div
                                      key={output.channelNumber}
                                      className={`vehicle-output-row vehicle-output-row--${output.kind}`}
                                      data-testid={`vehicle-output-row-${output.channelNumber}`}
                                    >
                                      <strong>OUT{output.channelNumber}</strong>
                                      <span>{output.functionLabel}</span>
                                      <StatusBadge tone={toneForOutputKind(output.kind)}>{outputKindLabel(output.kind)}</StatusBadge>
                                    </div>
                                  ))}
                                </div>
                              </section>
                            ))
                          )}
                          {planeControlSurfaces.surfaces.length > 0 ? (
                            <section className="vehicle-output-group" data-testid="plane-control-surfaces">
                              <header className="vehicle-output-group__header">
                                {`Control surfaces · ${planeControlSurfaces.mappedCount} mapped${
                                  planeControlSurfaces.incompleteCount > 0
                                    ? ` · ${planeControlSurfaces.incompleteCount} incomplete`
                                    : ''
                                }`}
                              </header>
                              <div className="vehicle-output-group__rows">
                                {planeControlSurfaces.surfaces.map((surface) => (
                                  <div
                                    key={surface.key}
                                    className="vehicle-output-row vehicle-output-row--control-surface"
                                    data-testid={`plane-surface-${surface.key}`}
                                  >
                                    <strong>{surface.label}</strong>
                                    <span>
                                      {surface.channels
                                        .map(
                                          (channel) =>
                                            `OUT${channel.channelNumber}${channel.side ? ` ${channel.side}` : ''}${
                                              channel.reversed ? ' (rev)' : ''
                                            }`
                                        )
                                        .join(', ')}
                                    </span>
                                    <StatusBadge tone={surface.status === 'incomplete' ? 'warning' : 'success'}>
                                      {surface.note ?? 'mapped'}
                                    </StatusBadge>
                                  </div>
                                ))}
                              </div>
                            </section>
                          ) : null}
                          <ul className="output-note-list">
                            <li>Edit any assignment, PWM range, trim, or reverse in the Servos tab.</li>
                            <li>Powered output movement tests for {airframe.frameClassLabel} (control-surface sweeps, steering/throttle, thrusters) are a guarded follow-up — use the transmitter on the bench meanwhile.</li>
                          </ul>
                        </div>
                  </div>
                )
              ) : null}
              {showAllMotorTasks || activeOutputTaskId === 'direction-test' ? (
                <div className="outputs-task-panel outputs-task-panel--stack" data-outputs-task="direction-test">
                  {!isCopterVehicle ? (
                    <section className="bf-gui-box" id={OUTPUTS_BENCH_TARGET_ID}>
                      <div className="bf-gui-box__titlebar">
                        <strong>Test</strong>
                      </div>
                      <div className="bf-gui-box__body">
                        <p className="bf-note">
                          Motor-direction and prop-spin verification is a multirotor procedure.
                          {' '}
                          For {airframe.frameClassLabel}, review the configured outputs in the
                          Motor Setup task above (grouped by role) and edit assignments in the
                          Servos tab. Powered output movement tests (control-surface sweeps,
                          steering/throttle, thrusters) are a guarded follow-up — exercise them
                          with the transmitter on the bench meanwhile.
                        </p>
                      </div>
                    </section>
                  ) : (
                  <section className="bf-gui-box" id={OUTPUTS_BENCH_TARGET_ID}>
                    <div className="bf-gui-box__titlebar">
                      <strong>Test</strong>
                    </div>
                    <div className="bf-gui-box__body">
                      <div className="motor-test-acknowledgments">
                        {/* Props-off is the load-bearing safety ack — promote it
                         *  visually so an operator who's eye-skimmed past it
                         *  can't miss its unchecked state. Other acks stay in
                         *  the muted style; only the prop guarantee gets the
                         *  danger-toned card treatment until it's checked. */}
                        {/* One combined safety ack — props off AND the craft
                         *  restrained/clear — instead of two redundant boxes.
                         *  Drives both underlying acknowledgments together.
                         *
                         *  Only rendered when the Motor Setup panel is NOT on
                         *  the page. On Motors everything renders at once and
                         *  that panel pins the same ack (same state, same
                         *  wording) at the top, so a second copy here was pure
                         *  duplication. Where this panel is the only one on
                         *  screen it is also the only ack, and the motor test
                         *  must not be reachable without one. */}
                        {showAllMotorTasks ? null : (
                        <label
                          className={`motor-test-acknowledgments__props-off${propsRemovedAcknowledged && testAreaAcknowledged ? ' is-acknowledged' : ''}`}
                          data-testid="motor-test-props-off-ack"
                        >
                          <input
                            type="checkbox"
                            checked={propsRemovedAcknowledged && testAreaAcknowledged}
                            onChange={(event) => {
                              setPropsRemovedAcknowledged(event.target.checked)
                              setTestAreaAcknowledged(event.target.checked)
                            }}
                            disabled={busyAction !== undefined || snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running'}
                          />
                          <span>Props are off and the vehicle is restrained with the test area clear.</span>
                        </label>
                        )}
                        {motorTestOverUsb ? (
                          <label className="motor-test-acknowledgments__usb" data-testid="motor-test-usb-ack">
                            <input
                              type="checkbox"
                              checked={usbBenchAcknowledged}
                              onChange={(event) => setUsbBenchAcknowledged(event.target.checked)}
                              disabled={busyAction !== undefined || snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running'}
                            />
                            <span>USB connection detected — I confirm the craft is on the bench and will not arm/spin a flight-ready aircraft.</span>
                          </label>
                        ) : null}
                      </div>
                      <div className="motor-direction-layout">
                        <div className="motor-direction-layout__sliders">
                         <div className="motor-test-sliders-row">
                          <MotorTestSliders
                            targets={motorTestSliderTargets}
                            selectedOutput={motorTestOutput}
                            throttlePercent={motorTestThrottlePercent}
                            onSelectOutput={(output) => setMotorTestOutput(output)}
                            onThrottleChange={(percent) => setMotorTestThrottlePercent(percent)}
                            onTest={() => void handleRunMotorTest()}
                            testDisabled={busyAction !== undefined || !motorTestEligibility.allowed || motorTestOutput === undefined}
                            onStop={() => void handleStopMotorTest()}
                            stopEnabled={snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running'}
                            masterEnabled
                            testId="motor-test-sliders"
                          />
                          {/* Small read-only motor map beside the sliders so the
                              operator can see which OUTx/spin each Mn is — drawn
                              from the vehicle's real FRAME_CLASS/FRAME_TYPE. Until
                              the frame is known (or for non-matrix frames with no
                              layout), prompt rather than draw a guessed shape. */}
                          {motorPreviewFrameKnown && motorPreviewNodes.length > 0 ? (
                            <MotorMixerDiagram
                              nodes={motorPreviewNodes}
                              geometryMode={motorPreviewGeometryMode}
                              outputLabelByMotor={Object.fromEntries(
                                outputMapping.motorOutputs
                                  .filter((output) => output.motorNumber !== undefined)
                                  .map((output) => [output.motorNumber as number, `OUT${output.channelNumber}`])
                              )}
                              className="motor-mixer-preview--test"
                              testId="motor-test-diagram"
                            />
                          ) : (
                            <div className="motor-mixer-preview motor-mixer-preview--test motor-mixer-preview--empty" data-testid="motor-test-diagram-empty">
                              <p>
                                {motorPreviewFrameKnown
                                  ? 'No motor map for this frame class — the layout diagram covers the multirotor matrix frames.'
                                  : 'Connect to the flight controller to read FRAME_CLASS / FRAME_TYPE and draw your frame’s motor layout and spin directions.'}
                              </p>
                            </div>
                          )}
                         </div>
                         {/* Whether the motor actually turned, and how fast.
                             Without this the tab could only report what it had
                             commanded, leaving the operator to judge by eye. */}
                         <EscRpmReadout
                           model={buildEscRpmReadoutViewModel({
                             escTelemetry: snapshot.liveVerification.escTelemetry,
                             motors: outputMapping.motorOutputs.map((output) => ({
                               channelNumber: output.channelNumber,
                               motorNumber: output.motorNumber
                             })),
                             nowMs: Date.now()
                           })}
                         />
                        </div>

                        <div className="motor-test-card motor-test-card--embedded">
                          <div className="switch-exercise-card__header">
                            <div>
                              <strong>Motor Test Guardrails</strong>
                              <p>{snapshot.motorTest.summary}</p>
                            </div>
                            <StatusBadge tone={toneForMotorTestStatus(snapshot.motorTest.status)}>{snapshot.motorTest.status}</StatusBadge>
                          </div>

                          <div className="motor-test-grid">
                            <label>
                              <span>Output</span>
                              <select
                                value={motorTestOutput ?? ''}
                                onChange={(event) => setMotorTestOutput(event.target.value ? Number(event.target.value) : undefined)}
                                disabled={busyAction !== undefined || snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running'}
                              >
                                <option value="">Select output</option>
                                <option value={ALL_MOTOR_TEST_OUTPUT}>All mapped motors (sequence)</option>
                                <option value={ALL_MOTOR_TEST_OUTPUT_SIMULTANEOUS}>All mapped motors (at once)</option>
                                {outputMapping.motorOutputs.map((output) => (
                                  <option key={output.paramId} value={output.channelNumber}>
                                    OUT{output.channelNumber}
                                    {output.motorNumber !== undefined ? ` / M${output.motorNumber}` : ''} · {output.functionLabel}
                                  </option>
                                ))}
                              </select>
                            </label>

                            <label>
                              <span>Throttle %</span>
                              <input
                                type="number"
                                min={1}
                                max={MAX_MOTOR_TEST_THROTTLE_PERCENT}
                                step={1}
                                value={motorTestThrottlePercent}
                                onChange={(event) => setMotorTestThrottlePercent(Number(event.target.value))}
                                disabled={busyAction !== undefined || snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running'}
                              />
                            </label>

                            <label>
                              <span>Duration (s)</span>
                              <input
                                type="number"
                                min={0.1}
                                max={motorTestMaxDurationSeconds}
                                step={0.1}
                                value={motorTestDurationSeconds}
                                onChange={(event) => setMotorTestDurationSeconds(Number(event.target.value))}
                                disabled={busyAction !== undefined || snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running'}
                              />
                            </label>
                          </div>


                          {/* Reasons the test is currently blocked always show --
                           *  they are the only place the operator learns WHY the
                           *  Run button will not fire. The generic standing
                           *  instructions ("props removed", "vehicle restrained")
                           *  are the same two sentences as the safety ack pinned
                           *  at the top of the Motors page, so on that one-page
                           *  layout they are dropped rather than printed twice.
                           *  Anywhere the ack is not on screen, they stay. */}
                          {motorTestGuardReasons.length > 0 ? (
                            <>
                            <ul className="output-note-list">
                              {motorTestGuardReasons.map((reason) => <li key={reason}>{reason}</li>)}
                            </ul>
                            {/* The single safety ack lives at the top of the
                             *  page now, and on a wide screen this panel is a
                             *  sticky column beside it -- so the control that
                             *  unblocks the button can be off-screen above the
                             *  operator while they read why it is blocked.
                             *  Take them to it rather than describing it. */}
                            {showAllMotorTasks && (!propsRemovedAcknowledged || !testAreaAcknowledged) ? (
                              <button
                                type="button"
                                style={buttonStyle()}
                                data-testid="motor-test-goto-ack"
                                onClick={() =>
                                  document
                                    .getElementById(MOTORS_SAFETY_ACK_ID)
                                    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                                }
                              >
                                Go to the safety acknowledgement
                              </button>
                            ) : null}
                            </>
                          ) : showAllMotorTasks ? null : (
                            <ul className="output-note-list">
                              {snapshot.motorTest.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}
                            </ul>
                          )}

                          <div className="switch-exercise-controls">
                            <button
                              id={OUTPUTS_MOTOR_TEST_BUTTON_ID}
                              type="button"
                              className={
                                motorVerification.status === 'running' && !currentMotorTestSucceeded && canRunMotorTest
                                  ? 'guided-action-pulse'
                                  : undefined
                              }
                              style={buttonStyle('secondary')}
                              onClick={() => void handleRunMotorTest()}
                              disabled={!canRunMotorTest || busyAction !== undefined || snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running'}
                            >
                              {busyAction === 'motor-test' ? 'Sending…' : 'Run Motor Test'}
                            </button>
                          </div>
                        </div>
                      </div>

                    </div>
                  </section>
                  )}
                </div>
              ) : null}

              {showAllServoTasks || activeOutputTaskId === 'servo-mapping' ? (
                <div className="outputs-task-panel outputs-task-panel--stack" data-testid="servo-mapping-task-body">
                  <ServoFunctionMappingView
                    rows={servoMappingRows}
                    editedValues={editedValues}
                    onEditChange={(paramId, value) => setDraft(paramId, value)}
                    draftStatusById={parameterDraftById}
                    stagedCount={outputAssignmentStagedDrafts.length}
                    invalidCount={outputAssignmentInvalidDrafts.length}
                    draftCount={outputAssignmentDraftEntries.length}
                    canApply={canApplyDraftParameters}
                    isApplying={busyAction === 'outputs:assignments'}
                    isBusy={busyAction !== undefined}
                    onApply={() => void handleApplyScopedParameterDrafts(outputAssignmentDraftEntries, 'outputs:assignments', 'Output assignments')}
                    onRevert={() => handleDiscardScopedParameterDrafts(outputAssignmentDraftEntries.map((entry) => entry.id), 'output assignments')}
                  />
                </div>
              ) : null}

              {showAllServoTasks || activeOutputTaskId === 'peripherals' ? (
                <div className="outputs-task-panel outputs-task-panel--stack">
                  {/* The "enable the CAN bus" prompt used to sit here. It is
                      about the optical-flow driver, and optical flow moved to
                      the Peripherals tab — where the prompt now renders, beside
                      the setting it is about. On Servos it was a DroneCAN
                      interruption over a servo output map. */}
                  {renderAdditionalSettingsCard(
                    'Additional output settings',
                    'These metadata-backed output and airframe settings extend Outputs without forcing routine configuration back into raw Parameters.',
                    outputAdditionalGroups,
                    outputAdditionalDraftEntries,
                    outputAdditionalStagedDrafts,
                    outputAdditionalInvalidDrafts,
                    'outputs:additional',
                    'Apply Additional Output Changes',
                    'additional output settings'
                  )}
                </div>
              ) : null}

              {activeOutputTaskId === 'review' ? (
                <div className="outputs-task-panel outputs-task-panel--stack">
                  <div className="scoped-review-card">
                    <div className="switch-exercise-card__header">
                      <div>
                        <strong>Output changes in review</strong>
                        <p>Keep motor mapping, ESC settings, and notification edits grouped here before you apply each scope to the controller.</p>
                      </div>
                      <StatusBadge tone={toneForScopedDraftReview(totalOutputStagedDrafts, totalOutputInvalidDrafts)}>
                        {totalOutputInvalidDrafts > 0
                          ? `${totalOutputInvalidDrafts} invalid`
                          : totalOutputStagedDrafts > 0
                            ? `${totalOutputStagedDrafts} staged`
                            : 'in sync'}
                      </StatusBadge>
                    </div>

                    {outputReviewDraftSummaries.length > 0 ? (
                      <div className="scoped-draft-list">
                        {outputReviewDraftSummaries.map(({ taskId, groupLabel, entry }) => (
                          <article key={`${groupLabel}:${entry.id}`} className={`scoped-draft-item scoped-draft-item--${entry.status}`}>
                            <div className="scoped-draft-item__header">
                              <div>
                                <strong>{entry.id}</strong>
                                <small>{groupLabel}</small>
                              </div>
                              <StatusBadge tone={toneForParameterDraftStatus(entry.status)}>{entry.status}</StatusBadge>
                            </div>
                            <p>{entry.label}</p>
                            <small>
                              {entry.status === 'staged'
                                ? `${formatParameterValue(entry.currentValue, entry.definition?.unit)} to ${formatParameterValue(
                                    entry.nextValue,
                                    entry.definition?.unit
                                  )}`
                                : entry.reason ?? 'Draft matches the live controller value.'}
                            </small>
                            <div className="config-pills">
                              <span>{groupLabel}</span>
                              <span>{taskId === 'motor-setup' ? 'Motor Setup' : taskId === 'esc-protocol' ? 'ESC & Protocol' : 'Peripherals & Alerts'}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="success-copy">No output-specific parameter changes are currently staged.</p>
                    )}
                  </div>

                  {(outputAssignmentDraftEntries.length > 0 || outputAssignmentInvalidDrafts.length > 0) ? (
                    <div className="outputs-inline-toggle">
                      <div>
                        <strong>Motor setup drafts</strong>
                        <p>Review or apply the staged SERVO function remap changes directly from the review deck, or jump back into Motor Setup.</p>
                      </div>
                      <div className="outputs-inline-toggle__actions">
                        <button style={buttonStyle()} onClick={() => setOutputTaskOverride('motor-setup')}>
                          Open Motor Setup
                        </button>
                        <button
                          style={buttonStyle('primary')}
                          onClick={() =>
                            void handleApplyScopedParameterDrafts(outputAssignmentDraftEntries, 'outputs:assignments', 'Output assignments')
                          }
                          disabled={
                            busyAction !== undefined ||
                            outputAssignmentStagedDrafts.length === 0 ||
                            outputAssignmentInvalidDrafts.length > 0 ||
                            !canApplyDraftParameters
                          }
                        >
                          {busyAction === 'outputs:assignments' ? 'Applying…' : `Apply Output Assignments (${outputAssignmentStagedDrafts.length})`}
                        </button>
                        <button
                          style={buttonStyle()}
                          onClick={() =>
                            handleDiscardScopedParameterDrafts(outputAssignmentDraftEntries.map((entry) => entry.id), 'output assignments')
                          }
                          disabled={busyAction !== undefined || outputAssignmentDraftEntries.length === 0}
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {(outputReviewDraftEntries.length > 0 || outputReviewInvalidDrafts.length > 0 || outputReviewStagedDrafts.length > 0) ? (
                    <div className="outputs-inline-toggle">
                      <div>
                        <strong>ESC & protocol drafts</strong>
                        <p>Motor protocol and spin-threshold changes remain grouped here so you can apply or discard them without leaving review.</p>
                      </div>
                      <div className="outputs-inline-toggle__actions">
                        <button style={buttonStyle()} onClick={() => setOutputTaskOverride('esc-protocol')}>
                          Open ESC & Protocol
                        </button>
                        <button
                          style={buttonStyle('primary')}
                          onClick={() =>
                            void handleApplyScopedParameterDrafts(outputReviewDraftEntries, 'outputs:apply', 'Outputs')
                          }
                          disabled={
                            busyAction !== undefined ||
                            outputReviewStagedDrafts.length === 0 ||
                            outputReviewInvalidDrafts.length > 0 ||
                            !canApplyDraftParameters
                          }
                        >
                          {busyAction === 'outputs:apply' ? 'Applying…' : `Apply Output Changes (${outputReviewStagedDrafts.length})`}
                        </button>
                        <button
                          style={buttonStyle()}
                          onClick={() => handleDiscardScopedParameterDrafts(outputReviewDraftEntries.map((entry) => entry.id), 'output')}
                          disabled={busyAction !== undefined || outputReviewDraftEntries.length === 0}
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {(outputAdditionalDraftEntries.length > 0 || outputAdditionalInvalidDrafts.length > 0 || outputAdditionalStagedDrafts.length > 0) ? (
                    <div className="outputs-inline-toggle">
                      <div>
                        <strong>Additional output settings</strong>
                        <p>Metadata-backed output settings remain available here so no Outputs capability gets buried or dropped.</p>
                      </div>
                      <div className="outputs-inline-toggle__actions">
                        <button style={buttonStyle()} onClick={() => setOutputTaskOverride('peripherals')}>
                          Open Additional Settings
                        </button>
                        <button
                          style={buttonStyle('primary')}
                          onClick={() =>
                            void handleApplyScopedParameterDrafts(outputAdditionalDraftEntries, 'outputs:additional', 'Additional output settings')
                          }
                          disabled={
                            busyAction !== undefined ||
                            outputAdditionalStagedDrafts.length === 0 ||
                            outputAdditionalInvalidDrafts.length > 0 ||
                            !canApplyDraftParameters
                          }
                        >
                          {busyAction === 'outputs:additional' ? 'Applying…' : `Apply Additional Output Changes (${outputAdditionalStagedDrafts.length})`}
                        </button>
                        <button
                          style={buttonStyle()}
                          onClick={() =>
                            handleDiscardScopedParameterDrafts(outputAdditionalDraftEntries.map((entry) => entry.id), 'additional output settings')
                          }
                          disabled={busyAction !== undefined || outputAdditionalDraftEntries.length === 0}
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
          </>
        }
        reviewDockSlot={outputHasPendingReview ? (
          <div className="outputs-review-dock">
            <div className="outputs-review-dock__summary">
              <strong>Output changes pending</strong>
              <div className="config-pills">
                {outputAssignmentStagedDrafts.length > 0 ? <span>{outputAssignmentStagedDrafts.length} motor setup staged</span> : null}
                {outputAssignmentInvalidDrafts.length > 0 ? <span className="is-pending">{outputAssignmentInvalidDrafts.length} motor setup invalid</span> : null}
                {outputReviewStagedDrafts.length > 0 ? <span>{outputReviewStagedDrafts.length} ESC staged</span> : null}
                {outputReviewInvalidDrafts.length > 0 ? <span className="is-pending">{outputReviewInvalidDrafts.length} ESC invalid</span> : null}
                {outputPeripheralStagedDraftCount > 0 ? <span>{outputPeripheralStagedDraftCount} peripheral staged</span> : null}
                {outputPeripheralInvalidDraftCount > 0 ? <span className="is-pending">{outputPeripheralInvalidDraftCount} peripheral invalid</span> : null}
              </div>
            </div>

            <div className="outputs-review-dock__actions">
              <button style={buttonStyle()} onClick={() => setOutputTaskOverride('review')}>
                Open Review
              </button>
              {(outputAssignmentStagedDrafts.length > 0 || outputAssignmentInvalidDrafts.length > 0) ? (
                <button style={buttonStyle()} onClick={() => setOutputTaskOverride('motor-setup')}>
                  Open Motor Setup
                </button>
              ) : null}
              {(outputReviewStagedDrafts.length > 0 || outputReviewInvalidDrafts.length > 0) ? (
                <button style={buttonStyle()} onClick={() => setOutputTaskOverride('esc-protocol')}>
                  Open ESC & Protocol
                </button>
              ) : null}
              {(outputPeripheralStagedDraftCount > 0 || outputPeripheralInvalidDraftCount > 0) ? (
                <button style={buttonStyle()} onClick={() => setOutputTaskOverride('peripherals')}>
                  Open Peripherals & Alerts
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      />

      {/* Spin-threshold wizard — a popout rather than a panel on the page.
       *  It owns the motors while it runs (it drives real motor-test commands
       *  at a rising throttle), so it wants the operator's whole attention,
       *  and the Motors tab has no room to spare for a surface used once per
       *  build. Closing it stops whatever it was spinning. */}
      {isExpertMode && spinWizardOpen ? (
        <div
          className="board-media-lightbox spin-wizard-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Measure spin thresholds"
          onClick={closeSpinWizard}
        >
          <div
            className="board-media-lightbox__frame spin-wizard-lightbox__frame"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="board-media-lightbox__header">
              <div>
                <strong>Spin thresholds</strong>
                <p>
                  Every motor spins at a rising output until you say they are all turning.{' '}
                  <code>MOT_SPIN_ARM</code> lands one margin above that and <code>MOT_SPIN_MIN</code>{' '}
                  another above ARM, which is the order the firmware requires. Nothing is written
                  until you stage the values.
                </p>
              </div>
              <StatusBadge tone={spinWizard.status === 'ready' ? 'success' : spinWizard.status === 'failed' ? 'danger' : 'neutral'}>
                {spinWizard.status === 'idle'
                  ? 'not measured'
                  : spinWizard.status === 'stepping'
                    ? `testing ${formatSpinValue(spinWizard.currentValue)}`
                    : spinWizard.status === 'ready'
                      ? 'measured'
                      : 'failed'}
              </StatusBadge>
              <button type="button" style={buttonStyle()} data-testid="spin-wizard-close" onClick={closeSpinWizard}>
                Close
              </button>
            </div>
            <section className="bf-gui-box" data-testid="spin-threshold-wizard">

                        {spinWizard.status === 'idle' ? (
                          <button
                            style={buttonStyle('primary')}
                            data-testid="spin-wizard-start"
                            disabled={busyAction !== undefined || !motorTestEligibility.allowed || spinWizardAckMissing}
                            onClick={() => {
                              const next = startSpinWizard()
                              setSpinWizard(next)
                              runSpinWizardAt(next.currentValue)
                            }}
                          >
                            Start Measuring
                          </button>
                        ) : null}

                        {/* The gate lives on the page behind this dialog, so a
                         *  disabled Start with no explanation would be a dead
                         *  end. Name the missing condition instead. */}
                        {spinWizard.status === 'idle' && spinWizardAckMissing ? (
                          <p className="switch-exercise-warning" data-testid="spin-wizard-blocked">
                            {!propsRemovedAcknowledged || !testAreaAcknowledged
                              ? 'Confirm props are off and the vehicle is restrained — the checkbox at the top of the Motors tab — before measuring. This spins every motor.'
                              : 'Confirm the craft is on the bench — the USB acknowledgement at the top of the Motors tab — before measuring. This spins every motor.'}
                          </p>
                        ) : null}

                        {spinWizard.status === 'stepping' ? (
                          <div className="motor-test-sliders-row" data-testid="spin-wizard-stepping">
                            {/* The same slider component the test section uses, so
                                this reads as the Motors page rather than a form.
                                Driving ALL simultaneously: the point being found is
                                where every motor breaks away, not the best one. */}
                            <MotorTestSliders
                              // ALL only. The wizard drives every motor at once
                              // by definition -- the point is where they ALL
                              // break away -- so per-motor tiles here are four
                              // controls that read 0% and do nothing.
                              targets={[]}
                              selectedOutput={ALL_MOTOR_TEST_OUTPUT_SIMULTANEOUS}
                              throttlePercent={spinValueToThrottlePercent(spinWizard.currentValue)}
                              onSelectOutput={() => undefined}
                              // Live: the motors follow the slider. Safe to
                              // fire on every pointermove because the sender
                              // keeps one update in flight and collapses the
                              // rest to the latest value.
                              onThrottleChange={(percent) => {
                                const next = setSpinWizardValue(spinWizard, percent / 100)
                                setSpinWizard(next)
                                runSpinWizardAt(next.currentValue)
                              }}
                              onTest={() => runSpinWizardAt(spinWizard.currentValue)}
                              testDisabled={busyAction !== undefined || !motorTestEligibility.allowed}
                              onStop={() => void handleStopMotorTest()}
                              stopEnabled={snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running'}
                              masterEnabled
                              // The whole track covers the wizard's own range.
                              // At full scale its usable 0-20% lived in the
                              // bottom fifth of the track -- about 16px for
                              // twenty steps -- so easing up on the break-away
                              // point meant nudging a few pixels at a time.
                              maxPercent={spinValueToThrottlePercent(SPIN_ARM_MAX)}
                              trackHeight={SPIN_WIZARD_TRACK_HEIGHT}
                              testId="spin-wizard-sliders"
                            />
                            <div className="motor-test-acknowledgments">
                              <p>
                                The motors are live and following the slider — raise it slowly until
                                they all just break away, then say so. Commanding{' '}
                                <strong>{formatSpinValue(spinWizard.currentValue)}</strong>{' '}
                                ({spinValueToThrottlePercent(spinWizard.currentValue)}%).
                              </p>
                              {/* Fixed-height slot. Both of these appear and
                               *  vanish while the operator is on the slider,
                               *  and letting them reflow moved the control
                               *  under the cursor mid-drag. */}
                              <div className="spin-wizard-messages">
                                {spinWizard.currentValue >= SPIN_ARM_MAX ? (
                                  <p className="switch-exercise-warning" data-testid="spin-wizard-ceiling">{spinCeilingReason()}</p>
                                ) : null}
                                {spinWizardRefusal ? (
                                  <p className="switch-exercise-warning" data-testid="spin-wizard-refused">
                                    Motors not commanded: {spinWizardRefusal}
                                  </p>
                                ) : null}
                              </div>
                              <div className="button-row">
                                <button
                                  style={buttonStyle('primary')}
                                  data-testid="spin-wizard-mark"
                                  onClick={() => {
                                    const next = confirmSpinWizard(spinWizard)
                                    setSpinWizard(next)
                                    void handleStopMotorTest()
                                    if (next.observedValue !== undefined) {
                                      const derived = deriveSpinThresholds(next.observedValue)
                                      setSpinArmDraft(formatSpinValue(derived.spinArm))
                                      setSpinMinDraft(formatSpinValue(derived.spinMin))
                                    }
                                  }}
                                >
                                  They just started spinning
                                </button>
                                <button
                                  style={buttonStyle()}
                                  data-testid="spin-wizard-cancel"
                                  onClick={() => {
                                    setSpinWizard(createIdleSpinWizardState())
                                    void handleStopMotorTest()
                                  }}
                                >
                                  Stop
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {spinWizard.status === 'ready' ? (
                          <div className="scoped-editor-grid" data-testid="spin-wizard-result">
                            <label className="scoped-editor-field">
                              <span>MOT_SPIN_ARM</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max="0.2"
                                value={spinArmDraft}
                                data-testid="spin-wizard-arm"
                                onChange={(event) => setSpinArmDraft(event.target.value)}
                              />
                            </label>
                            <label className="scoped-editor-field">
                              <span>MOT_SPIN_MIN</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                max="0.25"
                                value={spinMinDraft}
                                data-testid="spin-wizard-min"
                                onChange={(event) => setSpinMinDraft(event.target.value)}
                              />
                            </label>
                            <p className="bf-note">
                              Motors first turned at {formatSpinValue(spinWizard.observedValue ?? 0)}. Adjust either
                              value before staging if you want more margin.
                            </p>
                            {spinThresholdProblem ? (
                              <p className="switch-exercise-warning" data-testid="spin-wizard-problem">{spinThresholdProblem}</p>
                            ) : null}
                            <div className="button-row">
                              <button
                                style={buttonStyle('primary')}
                                data-testid="spin-wizard-stage"
                                disabled={spinThresholdProblem !== undefined}
                                onClick={() => {
                                  setDraft('MOT_SPIN_ARM', spinArmDraft)
                                  setDraft('MOT_SPIN_MIN', spinMinDraft)
                                  setSpinWizard(createIdleSpinWizardState())
                                }}
                              >
                                Stage Both Values
                              </button>
                              <button
                                style={buttonStyle()}
                                data-testid="spin-wizard-restart"
                                onClick={() => setSpinWizard(createIdleSpinWizardState())}
                              >
                                Start Over
                              </button>
                            </div>
                          </div>
                        ) : null}

                        {spinWizard.status === 'failed' ? (
                          <div className="motor-test-acknowledgments">
                            <p className="switch-exercise-warning" data-testid="spin-wizard-failed">{spinWizard.failureReason}</p>
                            <button
                              style={buttonStyle()}
                              onClick={() => setSpinWizard(createIdleSpinWizardState())}
                            >
                              Start Over
                            </button>
                          </div>
                        ) : null}
            </section>
          </div>
        </div>
      ) : null}
    </>
  )
}
