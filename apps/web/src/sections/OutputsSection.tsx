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
import { EXPERT_MAX_MOTOR_TEST_DURATION_SECONDS, MAX_MOTOR_TEST_THROTTLE_PERCENT } from '@arduconfig/ardupilot-core'
import {
  ARDUCOPTER_NOTIFICATION_BUZZER_TYPE_BIT_LABELS,
  ARDUCOPTER_NOTIFICATION_LED_TYPE_BIT_LABELS,
  formatArducopterNotificationLedBrightness,
  formatArducopterNotificationLedOverride
} from '@arduconfig/param-metadata'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { motorSpinArcPath } from '../views/motor-spin-arc'
import type { useMotorManagement } from '../hooks/use-motor-management'
import type { useMotorOutputAssignments } from '../hooks/use-motor-output-assignments'
import type { useMotorTestConfig } from '../hooks/use-motor-test-config'
import type { useOutputAssignmentVisibility } from '../hooks/use-output-assignment-visibility'
import type { useOutputNotificationCatalog } from '../hooks/use-output-notification-catalog'
import type { useSafetyAcks } from '../hooks/use-safety-acks'
import type { ParameterDraftValues } from '../hooks/use-parameter-drafts'
import type { buildVehicleOutputSummary } from '../view-models/vehicle-output-summary'
import type { createMotorPreviewNodes } from '../view-models/motor-preview'
import { describeOutputAssignment, outputKindLabel, toneForOutputKind } from '../device-display'
import { ALL_MOTOR_TEST_OUTPUT, ALL_MOTOR_TEST_OUTPUT_SIMULTANEOUS } from '../motor-test-helpers'
import { MotorTestSliders } from '../motor-test-sliders'
import { formatParameterValue, normalizeBitmaskValue } from '../parameter-format'
import { describeBitmaskSelections, hasBitmaskFlag, toggleBitmaskFlag } from '../selectors/bitmask'
import { readRoundedParameter, selectParameterById } from '../selectors/parameter-read'
import { QUADPLANE_ESC_PARAM_IDS } from '../param-groups'
import {
  OUTPUTS_BENCH_TARGET_ID,
  OUTPUTS_MOTOR_CONFIRM_BUTTON_ID,
  OUTPUTS_MOTOR_START_BUTTON_ID,
  OUTPUTS_MOTOR_TEST_BUTTON_ID,
  escCalibrationInstructions,
  escCalibrationPathLabel
} from '../setup-flow-helpers'
import {
  toneForModeSwitchExercise,
  toneForMotorTestStatus,
  toneForParameterDraftStatus,
  toneForScopedDraftReview
} from '../tone-helpers'
import { OutputsView } from '../views/Outputs'
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
  motorTestEligibility: ReturnType<typeof evaluateMotorTestEligibility>
  isCopterVehicle: boolean
  configuredOutputs: readonly ConfiguredOutput[]
  visibleDisabledOutputs: readonly ConfiguredOutput[]
  notificationLedOutputs: readonly ConfiguredOutput[]
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
  notificationLedTypes: number | undefined
  notificationLedBrightness: number | undefined
  notificationLedLength: number | undefined
  notificationLedOverride: number | undefined
  notificationBuzzTypes: number | undefined
  notificationBuzzVolume: number | undefined
  editedNotificationLedTypes: number
  editedNotificationBuzzTypes: number
  outputAssignmentDraftEntries: ParameterDraftEntry[]
  outputAssignmentStagedDrafts: ParameterDraftEntry[]
  outputAssignmentInvalidDrafts: ParameterDraftEntry[]
  outputReviewDraftEntries: ParameterDraftEntry[]
  outputReviewStagedDrafts: ParameterDraftEntry[]
  outputReviewInvalidDrafts: ParameterDraftEntry[]
  outputNotificationDraftEntries: ParameterDraftEntry[]
  outputNotificationStagedDrafts: ParameterDraftEntry[]
  outputNotificationInvalidDrafts: ParameterDraftEntry[]
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
}

export interface OutputsSectionHandlers {
  handleApplyScopedParameterDrafts: (
    drafts: readonly ParameterDraftEntry[],
    busyKey: string,
    scopeLabel: string
  ) => void | Promise<void>
  handleDiscardScopedParameterDrafts: (paramIds: readonly string[], scopeLabel: string) => void
  handleOpenMotorReorderDialog: () => void
  handleRunMotorTest: () => void | Promise<void>
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
  updateDrafts: (updater: (existing: ParameterDraftValues) => ParameterDraftValues) => void
  setShowAllOutputAssignments: (updater: (current: boolean) => boolean) => void
  setOutputTaskOverride: (taskId: OutputsTaskId) => void
}

export interface OutputsSectionProps {
  activeViewId: 'motors' | 'servos'
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  editedValues: ParameterDraftValues
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  motorOutputAssignments: ReturnType<typeof useMotorOutputAssignments>
  outputAssignmentVisibility: ReturnType<typeof useOutputAssignmentVisibility>
  outputNotificationCatalog: ReturnType<typeof useOutputNotificationCatalog>
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

export function OutputsSection(props: OutputsSectionProps): ReactElement {
  const {
    activeViewId,
    snapshot,
    canApplyDraftParameters,
    busyAction,
    editedValues,
    parameterDraftById,
    motorOutputAssignments,
    outputAssignmentVisibility,
    outputNotificationCatalog,
    motorTestConfig,
    motorManagement,
    safetyAcks,
    derived,
    handlers,
    motorTestMaxDurationSeconds
  } = props

  const { effectiveMotorOutputs, effectiveMotorOutputByMotorNumber } = motorOutputAssignments

  const { visibleOutputAssignmentParameters, hiddenOutputAssignmentCount } = outputAssignmentVisibility

  const {
    notificationLedTypesParameter,
    notificationLedLengthParameter,
    notificationLedBrightnessParameter,
    notificationLedOverrideParameter,
    notificationBuzzTypesParameter,
    notificationBuzzVolumeParameter
  } = outputNotificationCatalog

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
    motorPreviewCount,
    motorPreviewGeometryMode,
    motorTestEligibility,
    isCopterVehicle,
    configuredOutputs,
    visibleDisabledOutputs,
    notificationLedOutputs,
    frameConfigEditable,
    frameClassParameter,
    frameTypeParameter,
    frameDraftEntries,
    frameStagedDrafts,
    frameInvalidDrafts,
    escReviewConfirmation,
    escReviewSummary,
    motorMixerSummary,
    motorDirectionSummary,
    currentMotorTestSucceeded,
    currentMotorVerificationLabel,
    selectedMotorTestOutputLabel,
    selectedMotorTestOutputMotorNumber,
    motorTestSliderTargets,
    motorTestGuardReasons,
    motorTestOverUsb,
    canRunMotorTest,
    canRunMotorVerification,
    outputReviewParameters,
    outputAssignmentParameters,
    showAllOutputAssignments,
    outputAssignmentReviewLabel,
    servoMappingRows,
    notificationLedTypes,
    notificationLedBrightness,
    notificationLedLength,
    notificationLedOverride,
    notificationBuzzTypes,
    notificationBuzzVolume,
    editedNotificationLedTypes,
    editedNotificationBuzzTypes,
    outputAssignmentDraftEntries,
    outputAssignmentStagedDrafts,
    outputAssignmentInvalidDrafts,
    outputReviewDraftEntries,
    outputReviewStagedDrafts,
    outputReviewInvalidDrafts,
    outputNotificationDraftEntries,
    outputNotificationStagedDrafts,
    outputNotificationInvalidDrafts,
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
    activeOutputTask
  } = derived

  const {
    handleApplyScopedParameterDrafts,
    handleDiscardScopedParameterDrafts,
    handleOpenMotorReorderDialog,
    handleRunMotorTest,
    handleStopMotorTest,
    handleStartMotorVerification,
    handleConfirmMotorVerification,
    handleFailMotorVerification,
    handleResetMotorVerification,
    confirmSetupSection,
    clearSetupSectionConfirmation,
    renderMetadataParameterField,
    renderAdditionalSettingsCard,
    setDraft,
    updateDrafts,
    setShowAllOutputAssignments,
    setOutputTaskOverride
  } = handlers

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

  return (
      <OutputsView
        // Motors tab: motor verification flow (everything except aux
        // servo peripherals). Servos tab: aux peripheral assignments
        // only. The underlying task-body render blocks below are still
        // gated by activeOutputTaskId so unfiltered task IDs simply
        // won't render — no duplicate UI between tabs.
        taskCards={
          activeViewId === 'motors'
            ? outputTaskCards.filter((card) => card.id !== 'peripherals' && card.id !== 'servo-mapping')
            : outputTaskCards.filter((card) => card.id === 'servo-mapping' || card.id === 'peripherals')
        }
        title={activeViewId === 'motors' ? 'Motors' : 'Servos'}
        subtitle={
          activeViewId === 'motors'
            ? 'Frame class, output map, direction & test, ESC protocol, and verification review for propulsion motors.'
            : 'Auxiliary peripheral servo outputs — gimbal, parachute, gripper, and other aux roles.'
        }
        activeTaskId={activeOutputTaskId}
        activeTask={activeOutputTask}
        onSelectTask={setOutputTaskOverride}
        // The Servos nav tab uses a full-width layout — the per-channel
        // SERVOn mapping table doesn't fit alongside the overview's
        // current-output-map sidebar (the columns would overlap), and
        // the table already shows everything the overview would.
        overviewSlot={activeViewId === 'servos' ? undefined : (
              <div className="outputs-overview__sticky">
                <div className="telemetry-header">
                  <div>
                    <h3>Output overview</h3>
                    <p>
                      Keep the current frame, output map, and auxiliary output inventory visible while you move through
                      motor setup, direction checks, ESC review, and notification hardware work.
                    </p>
                  </div>
                  <div className="outputs-overview__badges">
                    <StatusBadge
                      tone={
                        airframe.expectedMotorCount !== undefined &&
                        outputMapping.motorOutputs.length === airframe.expectedMotorCount
                          ? 'success'
                          : outputMapping.motorOutputs.length > 0
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {airframe.expectedMotorCount !== undefined
                        ? `${outputMapping.motorOutputs.length}/${airframe.expectedMotorCount} mapped`
                        : `${outputMapping.motorOutputs.length} mapped`}
                    </StatusBadge>
                    {/* Physical output count from the boot banner
                      * "RCOut: PWM:1-N" — captured into hardware.pwmOutputCount.
                      * Falls back to the SERVOn_FUNCTION count when the banner
                      * wasn't seen (e.g. the user connected long after FC
                      * boot). The two numbers diverge on most boards: SERVOn
                      * params are allocated up to MAX_SERVO (16) regardless of
                      * how many PWM pins exist; only the banner reveals the
                      * physical count. Surface BOTH so the operator can tell
                      * which slots back real hardware. */}
                    {(() => {
                      const physical = snapshot.hardware.pwmOutputCount
                      const slotCount = outputMapping.outputs.length
                      if (physical === undefined && slotCount === 0) {
                        return null
                      }
                      if (physical !== undefined && physical !== slotCount) {
                        return (
                          <StatusBadge tone="neutral">
                            <span data-testid="outputs-overview-channel-count">
                              {physical} PWM output{physical === 1 ? '' : 's'}
                              {' · '}
                              {slotCount} SERVOn slot{slotCount === 1 ? '' : 's'}
                            </span>
                          </StatusBadge>
                        )
                      }
                      const count = physical ?? slotCount
                      return (
                        <StatusBadge tone="neutral">
                          <span data-testid="outputs-overview-channel-count">
                            {count} channel{count === 1 ? '' : 's'} available
                          </span>
                        </StatusBadge>
                      )
                    })()}
                  </div>
                </div>

                {frameConfigEditable ? (
                  <>
                    {/* FRAME_CLASS=0 is what ArduPilot reports as "Frame:
                      * UNSUPPORTED" in the boot banner and "PreArm: Motors:
                      * Check frame class and type" in the status feed. While
                      * that warning is active the autopilot refuses every
                      * calibration COMMAND (accel/level/compass) and won't
                      * arm. Make the root cause prominent right next to the
                      * dropdowns that fix it instead of leaving the operator
                      * to chase the cal failures. */}
                    {frameClassParameter?.value === 0 ? (
                      <div className="bf-note bf-note--warning" data-testid="frame-class-unset-warning">
                        <p>
                          <strong>FRAME_CLASS is not set.</strong>{' '}
                          The autopilot is reporting <code>Frame: UNSUPPORTED</code> and will
                          refuse calibration commands (accelerometer, level,
                          compass, motor test) until a valid frame class is
                          picked here. Choose the class that matches your
                          build below, then <em>Apply Frame Config</em>.
                        </p>
                      </div>
                    ) : null}
                    <div className="scoped-editor-grid" data-testid="frame-config-editor">
                      {frameClassParameter ? renderMetadataParameterField(frameClassParameter) : null}
                      {frameTypeParameter && !airframe.frameTypeIgnored
                        ? renderMetadataParameterField(frameTypeParameter)
                        : (
                            <article className="telemetry-metric-card">
                              <span>Frame type</span>
                              <strong>{airframe.frameTypeLabel}</strong>
                            </article>
                          )}
                    </div>
                  </>
                ) : null}

                {frameConfigEditable && frameDraftEntries.length > 0 ? (
                  <div className="switch-exercise-controls" data-testid="frame-config-actions">
                    <button
                      style={buttonStyle('primary')}
                      onClick={() => void handleApplyScopedParameterDrafts(frameDraftEntries, 'frame:apply', 'Frame configuration')}
                      disabled={
                        busyAction !== undefined ||
                        frameStagedDrafts.length === 0 ||
                        frameInvalidDrafts.length > 0 ||
                        !canApplyDraftParameters
                      }
                    >
                      {busyAction === 'frame:apply' ? 'Applying…' : `Apply Frame Config (${frameStagedDrafts.length})`}
                    </button>
                    <button
                      style={buttonStyle()}
                      onClick={() => handleDiscardScopedParameterDrafts(frameDraftEntries.map((entry) => entry.id), 'Frame configuration')}
                      disabled={busyAction !== undefined || frameDraftEntries.length === 0}
                    >
                      Revert
                    </button>
                  </div>
                ) : null}

                <div className="telemetry-metric-grid">
                  {!frameConfigEditable ? (
                    <>
                      <article className="telemetry-metric-card">
                        <span>Frame class</span>
                        <strong>{airframe.frameClassLabel}</strong>
                      </article>
                      <article className="telemetry-metric-card">
                        <span>Frame type</span>
                        <strong>{airframe.frameTypeLabel}</strong>
                      </article>
                    </>
                  ) : null}
                  <article className="telemetry-metric-card">
                    <span>Expected motors</span>
                    <strong>{airframe.expectedMotorCount ?? 'Specialized'}</strong>
                  </article>
                  <article className="telemetry-metric-card">
                    <span>Mapped motors</span>
                    <strong>
                      {outputMapping.motorOutputs.length}
                      {airframe.expectedMotorCount !== undefined ? ` / ${airframe.expectedMotorCount}` : ''}
                    </strong>
                  </article>
                </div>

                <div className="config-pills">
                  <span>{motorPreviewGeometryMode.toUpperCase()} geometry</span>
                  <span>{outputMapping.configuredAuxOutputs.length} configured non-motor outputs</span>
                  <span>{outputMapping.disabledOutputs.length} disabled outputs in SERVO1-16</span>
                  <span className={escReviewConfirmation ? 'is-complete' : 'is-pending'}>
                    {escReviewConfirmation ? 'ESC review confirmed' : 'ESC review pending'}
                  </span>
                </div>

                <div className="scoped-review-card scoped-review-card--compact">
                  <div className="switch-exercise-card__header">
                    <div>
                      <strong>Current output map</strong>
                      <p>The live motor and peripheral assignments stay visible here while you work through each output task.</p>
                    </div>
                    <StatusBadge tone={configuredOutputs.length > 0 ? 'success' : 'warning'}>
                      {configuredOutputs.length > 0 ? `${configuredOutputs.length} configured` : 'Review needed'}
                    </StatusBadge>
                  </div>

                  <div className="output-card-grid">
                    {configuredOutputs.length > 0 ? (
                      configuredOutputs.map((output) => (
                        <article key={output.paramId} className={`output-card output-card--${output.kind}`}>
                          <div className="output-card__header">
                            <div>
                              <strong>OUT{output.channelNumber}</strong>
                              <small>
                                {output.paramId} = {output.functionValue}
                              </small>
                            </div>
                            <StatusBadge tone={toneForOutputKind(output.kind)}>{outputKindLabel(output.kind)}</StatusBadge>
                          </div>
                          <p>{output.functionLabel}</p>
                          <small>{describeOutputAssignment(output.kind, output.motorNumber)}</small>
                        </article>
                      ))
                    ) : (
                      <div className="output-card output-card--other">
                        <div className="output-card__header">
                          <div>
                            <strong>No configured outputs</strong>
                            <small>Inspecting SERVO1-16</small>
                          </div>
                          <StatusBadge tone="warning">Review needed</StatusBadge>
                        </div>
                        <p>No motor or peripheral outputs were detected in the inspected SERVO function range.</p>
                        <small>Pull parameters again or verify that the controller exposes SERVOx_FUNCTION parameters on this target.</small>
                      </div>
                    )}
                  </div>

                  {outputMapping.notes.length > 0 ? (
                    <ul className="output-note-list">
                      {outputMapping.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>

                {visibleDisabledOutputs.length > 0 ? (
                  <p className="telemetry-note">
                    Disabled outputs in view: {visibleDisabledOutputs.map((output) => `OUT${output.channelNumber}`).join(', ')}
                    {outputMapping.disabledOutputs.length > visibleDisabledOutputs.length
                      ? `, plus ${outputMapping.disabledOutputs.length - visibleDisabledOutputs.length} more.`
                      : '.'}
                  </p>
                ) : null}
              </div>
        )}
        taskBodySlot={
          <>
              {activeOutputTaskId === 'motor-setup' ? (
                <div className="outputs-task-panel outputs-task-panel--stack">
                  <section className="bf-gui-box">
                    <div className="bf-gui-box__titlebar">
                      <strong>Mixer</strong>
                    </div>
                    <div className="bf-gui-box__body">
                      <div className="switch-exercise-card__header">
                        <div>
                          <strong>Motor Setup</strong>
                          <p>{motorMixerSummary}</p>
                        </div>
                        <StatusBadge tone={toneForScopedDraftReview(outputAssignmentStagedDrafts.length, outputAssignmentInvalidDrafts.length)}>
                          {outputAssignmentReviewLabel}
                        </StatusBadge>
                      </div>

                      {!isCopterVehicle ? (
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
                          <ul className="output-note-list">
                            <li>Edit any assignment, PWM range, trim, or reverse in the Servos tab.</li>
                            <li>Powered output movement tests for {airframe.frameClassLabel} (control-surface sweeps, steering/throttle, thrusters) are a guarded follow-up — use the transmitter on the bench meanwhile.</li>
                          </ul>
                        </div>
                      ) : motorPreviewNodes.length > 0 ? (
                        <div className="motor-mixer-preview">
                          <svg viewBox="0 0 260 260" role="img" aria-label="Schematic motor map preview">
                            <defs>
                              <radialGradient id="motorPreviewBody" cx="50%" cy="50%" r="65%">
                                <stop offset="0%" stopColor="rgba(255, 187, 0, 0.18)" />
                                <stop offset="100%" stopColor="rgba(255, 187, 0, 0.02)" />
                              </radialGradient>
                              <marker id="spinArrowOutputs" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                                <path d="M 0 0 L 6 3 L 0 6 z" className="motor-mixer-preview__spin-head" />
                              </marker>
                            </defs>
                            <rect x="0" y="0" width="260" height="260" rx="18" className="motor-mixer-preview__backdrop" />
                            <line x1="130" y1="34" x2="130" y2="58" className="motor-mixer-preview__nose-arrow" />
                            <polygon points="130,18 122,36 138,36" className="motor-mixer-preview__nose-arrow" />
                            {motorPreviewNodes.map((node) => {
                              const assignedOutput = effectiveMotorOutputByMotorNumber.get(node.motorNumber)
                              const x = 130 + node.x * 82
                              const y = 130 + node.y * 82
                              const stateClassName =
                                motorVerification.currentMotorNumber === node.motorNumber
                                  ? 'is-target'
                                  : motorVerification.verifiedOutputs.includes(assignedOutput?.channelNumber ?? -1)
                                    ? 'is-complete'
                                    : assignedOutput
                                      ? 'is-mapped'
                                      : 'is-empty'

                              return (
                                <g key={`motor-preview:${node.motorNumber}`} className={`motor-mixer-preview__node ${stateClassName}`}>
                                  <line x1="130" y1="130" x2={x} y2={y} className="motor-mixer-preview__arm" />
                                  <circle cx={x} cy={y} r={node.stack ? 29 : 24} className="motor-mixer-preview__ring" />
                                  {node.stack ? <circle cx={x} cy={y} r={19} className="motor-mixer-preview__stack" /> : null}
                                  {node.spin ? (
                                    <path
                                      d={motorSpinArcPath(x, y, (node.stack ? 29 : 24) + 6, node.spin)}
                                      className="motor-mixer-preview__spin"
                                      markerEnd="url(#spinArrowOutputs)"
                                    />
                                  ) : null}
                                  <text x={x} y={y + 4} textAnchor="middle" className="motor-mixer-preview__motor-number">
                                    {node.motorNumber}
                                  </text>
                                  <text x={x} y={y + (node.stack ? 38 : 34)} textAnchor="middle" className="motor-mixer-preview__channel-label">
                                    {assignedOutput ? `OUT${assignedOutput.channelNumber}` : 'UNMAPPED'}
                                  </text>
                                  {node.stack ? (
                                    <text x={x} y={y - 34} textAnchor="middle" className="motor-mixer-preview__stack-label">
                                      {node.stack}
                                    </text>
                                  ) : null}
                                </g>
                              )
                            })}
                            <circle cx="130" cy="130" r="26" fill="url(#motorPreviewBody)" className="motor-mixer-preview__body" />
                            <text x="130" y="136" textAnchor="middle" className="motor-mixer-preview__center-label">
                              {motorPreviewGeometryMode.toUpperCase()}
                            </text>
                          </svg>
                        </div>
                      ) : (
                        <div className="bf-note">
                          <p>No mapped motor outputs were detected yet. Set the required `SERVOx_FUNCTION` motor assignments first.</p>
                        </div>
                      )}

                      {isCopterVehicle ? (
                        <>
                          <div className="motor-mixer-summary-grid">
                            {Array.from({ length: motorPreviewCount }, (_, index) => {
                              const motorNumber = index + 1
                              const assignedOutput = effectiveMotorOutputByMotorNumber.get(motorNumber)
                              return (
                                <div key={`motor-summary:${motorNumber}`} className="motor-mixer-summary-card">
                                  <strong>M{motorNumber}</strong>
                                  <span>{assignedOutput ? `OUT${assignedOutput.channelNumber}` : 'Unmapped'}</span>
                                  <small>{assignedOutput?.functionLabel ?? 'No motor function staged on any visible output.'}</small>
                                </div>
                              )
                            })}
                          </div>

                          <div className="config-pills">
                            <span>Schematic preview only</span>
                            <span>{airframe.frameClassLabel}</span>
                            <span>{airframe.frameTypeLabel}</span>
                            <span>{effectiveMotorOutputs.length} mapped motors</span>
                            {airframe.expectedMotorCount !== undefined ? <span>{airframe.expectedMotorCount} expected</span> : null}
                          </div>
                        </>
                      ) : null}

                      <div className="bf-tool-button-row">
                        {isCopterVehicle ? (
                          <button
                            type="button"
                            style={buttonStyle('secondary')}
                            onClick={handleOpenMotorReorderDialog}
                            disabled={effectiveMotorOutputs.length === 0}
                          >
                            Reorder Motor Outputs
                          </button>
                        ) : null}
                        <button
                          type="button"
                          style={buttonStyle()}
                          onClick={() => setShowAllOutputAssignments((current) => !current)}
                          disabled={outputAssignmentParameters.length === 0}
                        >
                          {showAllOutputAssignments ? 'Show Focused Output Slots' : `Show All ${outputAssignmentParameters.length} Output Slots`}
                        </button>
                      </div>

                      <ul className="output-note-list">
                        <li>Reordering stages new `SERVOx_FUNCTION` values. Nothing changes on the flight controller until you apply the staged output drafts.</li>
                        <li>This preview is schematic. Always confirm the actual motor that spins with the guarded bench test before flight.</li>
                      </ul>

                      {outputAssignmentStagedDrafts.length > 0 || outputAssignmentInvalidDrafts.length > 0 ? (
                        <div className="bf-toolbar">
                          <div className="bf-toolbar__status">
                            <span>{outputAssignmentReviewLabel}</span>
                          </div>
                          <button
                            type="button"
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
                            type="button"
                            style={buttonStyle()}
                            onClick={() =>
                              handleDiscardScopedParameterDrafts(outputAssignmentDraftEntries.map((entry) => entry.id), 'output assignments')
                            }
                            disabled={busyAction !== undefined || outputAssignmentDraftEntries.length === 0}
                          >
                            Discard
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </section>

                  {/* Board orientation is a Setup-flow concern — the Setup wizard
                   * owns the Orientation Check card and the live attitude preview, so
                   * the Motors tab intentionally omits it to keep a single place to
                   * run / re-run the check. */}

                  {outputAssignmentParameters.length > 0 ? (
                    <div className="scoped-review-card scoped-review-card--compact">
                      <div className="switch-exercise-card__header">
                        <div>
                          <strong>Output assignments</strong>
                          <p>Remap motor and peripheral functions directly from Outputs, then rerun output verification before flight.</p>
                        </div>
                        <StatusBadge tone={toneForScopedDraftReview(outputAssignmentStagedDrafts.length, outputAssignmentInvalidDrafts.length)}>
                          {outputAssignmentInvalidDrafts.length > 0
                            ? `${outputAssignmentInvalidDrafts.length} invalid`
                            : outputAssignmentStagedDrafts.length > 0
                              ? `${outputAssignmentStagedDrafts.length} staged`
                              : 'in sync'}
                        </StatusBadge>
                      </div>

                      <div className="scoped-review-card__disclosure">
                        <small>
                          {showAllOutputAssignments
                            ? `Showing all ${outputAssignmentParameters.length} SERVO function slots.`
                            : `Showing ${visibleOutputAssignmentParameters.length} likely-relevant outputs first${hiddenOutputAssignmentCount > 0 ? `, with ${hiddenOutputAssignmentCount} additional slot${hiddenOutputAssignmentCount === 1 ? '' : 's'} hidden.` : '.'}`}
                        </small>
                        {outputAssignmentParameters.length > visibleOutputAssignmentParameters.length || showAllOutputAssignments ? (
                          <button
                            style={buttonStyle()}
                            onClick={() => setShowAllOutputAssignments((current) => !current)}
                            disabled={busyAction !== undefined}
                          >
                            {showAllOutputAssignments ? 'Show Focused Outputs' : `Show All ${outputAssignmentParameters.length} Outputs`}
                          </button>
                        ) : null}
                      </div>

                      <div className="scoped-editor-grid">
                        {/* Shared ScopedSelectField so each row picks up the
                          * staged-red + "was X" treatment without a separate
                          * "Current X on OUTn" caption duplicating what the dropdown
                          * already shows. The channel context (OUTn) is implicit in
                          * the SERVOn_FUNCTION id surfaced by the field's label
                          * area. */}
                        {visibleOutputAssignmentParameters.map((parameter) => (
                          <ScopedSelectField
                            key={parameter.id}
                            parameter={parameter}
                            liveValue={parameter.value}
                            editedValues={editedValues}
                            onChange={(paramId, value) => setDraft(paramId, value)}
                            draftStatusById={parameterDraftById}
                          />
                        ))}
                      </div>

                      <ul className="output-note-list">
                        <li>Changing SERVOx function assignments can move motors, LEDs, or accessories to a different output pin immediately after apply/reboot.</li>
                        <li>After remapping outputs, keep props off and repeat the motor/peripheral verification steps from this view.</li>
                      </ul>

                      <div className="switch-exercise-controls">
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
                          Discard Output Assignments
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeOutputTaskId === 'direction-test' ? (
                <div className="outputs-task-panel outputs-task-panel--stack">
                  {!isCopterVehicle ? (
                    <section className="bf-gui-box" id={OUTPUTS_BENCH_TARGET_ID}>
                      <div className="bf-gui-box__titlebar">
                        <strong>Direction &amp; Test</strong>
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
                      <strong>Direction & Test</strong>
                    </div>
                    <div className="bf-gui-box__body">
                      <div className="switch-exercise-card__header">
                        <div>
                          <strong>Motor Direction Check</strong>
                          <p>{motorDirectionSummary}</p>
                        </div>
                        <StatusBadge tone={toneForModeSwitchExercise(motorVerification.status)}>{motorVerification.status}</StatusBadge>
                      </div>

                      <div className="config-pills">
                        <span>Current: {currentMotorVerificationLabel ?? 'Not started'}</span>
                        <span>Selected: {selectedMotorTestOutputLabel ?? 'None selected'}</span>
                        <span>Bench test: {motorTestThrottlePercent}% / {motorTestDurationSeconds.toFixed(1)}s</span>
                        {outputMapping.motorOutputs.map((output) => {
                          const verified = motorVerification.verifiedOutputs.includes(output.channelNumber)
                          const targeted = motorVerification.currentOutputChannel === output.channelNumber
                          const selected = selectedMotorTestOutputMotorNumber === output.motorNumber
                          return (
                            <span
                              key={`direction-pill:${output.paramId}`}
                              className={verified ? 'is-complete' : targeted ? 'is-target' : selected ? 'is-pending' : undefined}
                            >
                              M{output.motorNumber ?? '?'} · OUT{output.channelNumber}
                            </span>
                          )
                        })}
                      </div>

                      <div className="motor-direction-layout">
                        <div className="motor-direction-layout__sliders">
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

                          <div className="config-pills">
                            <span>Single output, ALL in sequence, or ALL at once</span>
                            <span>"At once" spins every motor together (props off!)</span>
                            <span>Auto-stop after {motorTestDurationSeconds.toFixed(1)}s</span>
                            <span>Throttle up to {MAX_MOTOR_TEST_THROTTLE_PERCENT}% (start low)</span>
                            {/* The longer duration ceiling exists behind Expert
                             *  mode; surface that here so the basic-mode cap isn't
                             *  mistaken for a bug. */}
                            <span>
                              Duration up to {motorTestMaxDurationSeconds}s
                              {motorTestMaxDurationSeconds < EXPERT_MAX_MOTOR_TEST_DURATION_SECONDS
                                ? ` — Expert mode raises it to ${EXPERT_MAX_MOTOR_TEST_DURATION_SECONDS}s`
                                : ''}
                            </span>
                            {selectedMotorTestOutputLabel ? <span>Selected: {selectedMotorTestOutputLabel}</span> : null}
                          </div>

                          <div className="motor-test-acknowledgments">
                            {/* Props-off is the load-bearing safety ack — promote it
                             *  visually so an operator who's eye-skimmed past it
                             *  can't miss its unchecked state. Other acks stay in
                             *  the muted style; only the prop guarantee gets the
                             *  danger-toned card treatment until it's checked. */}
                            <label
                              className={`motor-test-acknowledgments__props-off${propsRemovedAcknowledged ? ' is-acknowledged' : ''}`}
                              data-testid="motor-test-props-off-ack"
                            >
                              <input
                                type="checkbox"
                                checked={propsRemovedAcknowledged}
                                onChange={(event) => setPropsRemovedAcknowledged(event.target.checked)}
                                disabled={busyAction !== undefined || snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running'}
                              />
                              <span>All propellers are removed.</span>
                            </label>
                            <label>
                              <input
                                type="checkbox"
                                checked={testAreaAcknowledged}
                                onChange={(event) => setTestAreaAcknowledged(event.target.checked)}
                                disabled={busyAction !== undefined || snapshot.motorTest.status === 'requested' || snapshot.motorTest.status === 'running'}
                              />
                              <span>The vehicle is restrained and the test area is clear.</span>
                            </label>
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

                          <ul className="output-note-list">
                            {motorTestGuardReasons.length > 0
                              ? motorTestGuardReasons.map((reason) => <li key={reason}>{reason}</li>)
                              : snapshot.motorTest.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}
                          </ul>

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

                      {(() => {
                        const rvmaskParam = selectParameterById(snapshot, 'SERVO_BLH_RVMASK')
                        if (!rvmaskParam || outputMapping.motorOutputs.length === 0) {
                          return null
                        }
                        const currentMask = normalizeBitmaskValue(editedValues[rvmaskParam.id], rvmaskParam.value)
                        const motPwmType = Math.round(
                          Number(editedValues.MOT_PWM_TYPE ?? readRoundedParameter(snapshot, 'MOT_PWM_TYPE') ?? 0)
                        )
                        const isDShot = motPwmType >= 4 && motPwmType <= 7
                        return (
                          <div className="motor-reverse-card" data-testid="motor-reverse">
                            <div className="switch-exercise-card__header">
                              <div>
                                <strong>Reverse motor direction</strong>
                                <p>
                                  If the right motor spins the wrong way, reverse it here over DShot (BLHeli/AM32) instead
                                  of swapping wires. {isDShot ? 'Takes effect on the next reboot/redetect.' : 'Requires a DShot ESC protocol — set it in the ESC & Protocol task or Config.'}
                                </p>
                              </div>
                            </div>
                            <div className="motor-reverse-grid">
                              {outputMapping.motorOutputs.map((output) => {
                                const bit = output.channelNumber - 1
                                const reversed = hasBitmaskFlag(currentMask, bit)
                                return (
                                  <label
                                    key={`motor-reverse:${output.paramId}`}
                                    className="motor-reverse-toggle"
                                    data-testid={`motor-reverse-${output.channelNumber}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={reversed}
                                      disabled={!isDShot || busyAction !== undefined}
                                      onChange={(event) =>
                                        setDraft(rvmaskParam.id, String(toggleBitmaskFlag(currentMask, bit, event.target.checked)))
                                      }
                                    />
                                    <span>
                                      M{output.motorNumber ?? '?'} · OUT{output.channelNumber}
                                      {reversed ? ' — reversed' : ''}
                                    </span>
                                  </label>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })()}

                      <ol className="switch-exercise-instructions">
                        <li>Remove props, acknowledge the motor-test guardrails, and keep the vehicle restrained.</li>
                        <li>Start the guided direction check or target a specific mapped output, then spin one motor at a time.</li>
                        <li>If the correct motor spins but its direction is wrong, flip it with the Reverse controls above (DShot), then retest here.</li>
                      </ol>

                      <div className="bf-tool-button-row">
                        <button
                          id={OUTPUTS_MOTOR_START_BUTTON_ID}
                          type="button"
                          style={buttonStyle('primary')}
                          onClick={() => handleStartMotorVerification()}
                          disabled={!canRunMotorVerification || motorVerification.status === 'running'}
                        >
                          {motorVerification.status === 'passed' ? 'Run Direction Check Again' : 'Start Direction Check'}
                        </button>
                        <button
                          type="button"
                          style={buttonStyle()}
                          onClick={() => setMotorTestOutput(motorVerification.currentOutputChannel)}
                          disabled={motorVerification.currentOutputChannel === undefined}
                        >
                          Target Current Output
                        </button>
                        <button
                          id={OUTPUTS_MOTOR_CONFIRM_BUTTON_ID}
                          type="button"
                          className={currentMotorTestSucceeded ? 'guided-action-pulse' : undefined}
                          style={buttonStyle('secondary')}
                          onClick={handleConfirmMotorVerification}
                          disabled={
                            motorVerification.status !== 'running' ||
                            snapshot.motorTest.status !== 'succeeded' ||
                            snapshot.motorTest.selectedOutputChannel !== motorVerification.currentOutputChannel
                          }
                        >
                          Confirm Motor & Direction
                        </button>
                        <button
                          type="button"
                          style={buttonStyle('secondary')}
                          onClick={handleFailMotorVerification}
                          disabled={motorVerification.status !== 'running'}
                        >
                          Mark Failed
                        </button>
                        <button
                          type="button"
                          style={buttonStyle()}
                          onClick={handleResetMotorVerification}
                          disabled={motorVerification.status === 'idle'}
                        >
                          Reset
                        </button>
                      </div>

                      <div className="bf-note">
                        <p>Direction changes are not written from this card. Use it to verify the real motor response after any ESC-side reversal or output remap.</p>
                      </div>
                    </div>
                  </section>
                  )}
                </div>
              ) : null}

              {activeOutputTaskId === 'esc-protocol' ? (
                <div className="outputs-task-panel outputs-task-panel--stack">
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
                    <div className="switch-exercise-card__header">
                      <div>
                        <strong>ESC calibration & motor range</strong>
                        <p>{escReviewSummary}</p>
                      </div>
                      <StatusBadge tone={escReviewConfirmation ? 'success' : escSetup.calibrationPath === 'manual-review' ? 'warning' : 'neutral'}>
                        {escReviewConfirmation ? 'confirmed' : escCalibrationPathLabel(escSetup.calibrationPath)}
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

                    <ol className="switch-exercise-instructions">
                      {escCalibrationInstructions(escSetup).map((instruction) => (
                        <li key={instruction}>{instruction}</li>
                      ))}
                    </ol>

                    <ul className="output-note-list">
                      {escSetup.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>

                    <div className="switch-exercise-controls">
                      <button
                        style={buttonStyle(escReviewConfirmation ? 'secondary' : 'primary')}
                        onClick={() => (escReviewConfirmation ? clearSetupSectionConfirmation('esc-range') : confirmSetupSection('esc-range'))}
                        disabled={outputMapping.motorOutputs.length === 0}
                      >
                        {escReviewConfirmation
                          ? 'Clear ESC Review'
                          : escSetup.calibrationPath === 'analog-calibration'
                            ? 'Confirm ESC Calibration Review'
                            : 'Confirm ESC Range Review'}
                      </button>
                    </div>
                  </div>
                  )}
                </div>
              ) : null}

              {activeOutputTaskId === 'servo-mapping' ? (
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

              {activeOutputTaskId === 'peripherals' ? (
                <div className="outputs-task-panel outputs-task-panel--stack">
                  {notificationLedTypesParameter || notificationLedLengthParameter || notificationLedBrightnessParameter || notificationLedOverrideParameter || notificationBuzzTypesParameter || notificationBuzzVolumeParameter ? (
                    <div className="scoped-review-card scoped-review-card--compact">
                      <div className="switch-exercise-card__header">
                        <div>
                          <strong>LED & buzzer notifications</strong>
                          <p>Keep common FPV notification hardware setup local to Outputs instead of dropping into raw parameters.</p>
                        </div>
                        <StatusBadge tone={toneForScopedDraftReview(outputNotificationStagedDrafts.length, outputNotificationInvalidDrafts.length)}>
                          {outputNotificationInvalidDrafts.length > 0
                            ? `${outputNotificationInvalidDrafts.length} invalid`
                            : outputNotificationStagedDrafts.length > 0
                              ? `${outputNotificationStagedDrafts.length} staged`
                              : 'in sync'}
                        </StatusBadge>
                      </div>

                      <div className="config-pills">
                        {notificationLedTypesParameter ? <span>LED drivers: {describeBitmaskSelections(notificationLedTypes, ARDUCOPTER_NOTIFICATION_LED_TYPE_BIT_LABELS, 'Disabled')}</span> : null}
                        {notificationLedBrightnessParameter ? <span>Brightness: {formatArducopterNotificationLedBrightness(notificationLedBrightness)}</span> : null}
                        {notificationLedLengthParameter ? <span>LED length: {notificationLedLength ?? 'Unknown'}</span> : null}
                        {notificationLedOverrideParameter ? <span>LED source: {formatArducopterNotificationLedOverride(notificationLedOverride)}</span> : null}
                        {notificationBuzzTypesParameter ? <span>Buzzer drivers: {describeBitmaskSelections(notificationBuzzTypes, ARDUCOPTER_NOTIFICATION_BUZZER_TYPE_BIT_LABELS, 'Disabled')}</span> : null}
                        {notificationBuzzVolumeParameter ? <span>Buzzer volume: {notificationBuzzVolume !== undefined ? `${notificationBuzzVolume}%` : 'Unknown'}</span> : null}
                        {notificationLedOutputs.length > 0
                          ? notificationLedOutputs.map((output) => <span key={`notification-output:${output.channelNumber}`}>OUT{output.channelNumber}: {output.functionLabel}</span>)
                          : <span>No NeoPixel output assignment detected yet</span>}
                      </div>

                      <div className="scoped-editor-grid">
                        {notificationLedTypesParameter ? (
                          <label className={`scoped-editor-field scoped-editor-field--${parameterDraftById.get(notificationLedTypesParameter.id)?.status ?? 'unchanged'}`}>
                            <span>{notificationLedTypesParameter.definition?.label ?? notificationLedTypesParameter.id}</span>
                            <div className="scoped-checkbox-list">
                              {Object.entries(ARDUCOPTER_NOTIFICATION_LED_TYPE_BIT_LABELS).map(([bit, label]) => {
                                const numericBit = Number(bit)
                                return (
                                  <label key={`${notificationLedTypesParameter.id}:${bit}`} className="scoped-checkbox-option">
                                    <input
                                      type="checkbox"
                                      checked={hasBitmaskFlag(editedNotificationLedTypes, numericBit)}
                                      onChange={(event) =>
                                        updateDrafts((existing) => {
                                          const currentValue = normalizeBitmaskValue(existing[notificationLedTypesParameter.id], notificationLedTypes)
                                          const nextValue = toggleBitmaskFlag(currentValue, numericBit, event.target.checked)

                                          return {
                                            ...existing,
                                            [notificationLedTypesParameter.id]: String(nextValue)
                                          }
                                        })
                                      }
                                    />
                                    <span>{label}</span>
                                  </label>
                                )
                              })}
                            </div>
                            <small>
                              {parameterDraftById.get(notificationLedTypesParameter.id)?.status === 'staged'
                                ? `Staged ${describeBitmaskSelections(parameterDraftById.get(notificationLedTypesParameter.id)?.nextValue, ARDUCOPTER_NOTIFICATION_LED_TYPE_BIT_LABELS, 'Disabled')}`
                                : parameterDraftById.get(notificationLedTypesParameter.id)?.reason ??
                                  `Current ${describeBitmaskSelections(notificationLedTypes, ARDUCOPTER_NOTIFICATION_LED_TYPE_BIT_LABELS, 'Disabled')}`}
                            </small>
                          </label>
                        ) : null}

                        {notificationLedBrightnessParameter ? (
                          <ScopedSelectField
                            parameter={notificationLedBrightnessParameter}
                            liveValue={notificationLedBrightness}
                            editedValues={editedValues}
                            onChange={(paramId, value) => setDraft(paramId, value)}
                            draftStatusById={parameterDraftById}
                          />
                        ) : null}

                        {notificationLedLengthParameter ? (
                          <ScopedField
                            parameter={notificationLedLengthParameter}
                            liveValue={notificationLedLength}
                            editedValues={editedValues}
                            onChange={(paramId, value) => setDraft(paramId, value)}
                            draftStatusById={parameterDraftById}
                          />
                        ) : null}

                        {notificationLedOverrideParameter ? (
                          <ScopedSelectField
                            parameter={notificationLedOverrideParameter}
                            liveValue={notificationLedOverride}
                            editedValues={editedValues}
                            onChange={(paramId, value) => setDraft(paramId, value)}
                            draftStatusById={parameterDraftById}
                          />
                        ) : null}

                        {notificationBuzzTypesParameter ? (
                          <label className={`scoped-editor-field scoped-editor-field--${parameterDraftById.get(notificationBuzzTypesParameter.id)?.status ?? 'unchanged'}`}>
                            <span>{notificationBuzzTypesParameter.definition?.label ?? notificationBuzzTypesParameter.id}</span>
                            <div className="scoped-checkbox-list">
                              {Object.entries(ARDUCOPTER_NOTIFICATION_BUZZER_TYPE_BIT_LABELS).map(([bit, label]) => {
                                const numericBit = Number(bit)
                                return (
                                  <label key={`${notificationBuzzTypesParameter.id}:${bit}`} className="scoped-checkbox-option">
                                    <input
                                      type="checkbox"
                                      checked={hasBitmaskFlag(editedNotificationBuzzTypes, numericBit)}
                                      onChange={(event) =>
                                        updateDrafts((existing) => {
                                          const currentValue = normalizeBitmaskValue(existing[notificationBuzzTypesParameter.id], notificationBuzzTypes)
                                          const nextValue = toggleBitmaskFlag(currentValue, numericBit, event.target.checked)

                                          return {
                                            ...existing,
                                            [notificationBuzzTypesParameter.id]: String(nextValue)
                                          }
                                        })
                                      }
                                    />
                                    <span>{label}</span>
                                  </label>
                                )
                              })}
                            </div>
                            <small>
                              {parameterDraftById.get(notificationBuzzTypesParameter.id)?.status === 'staged'
                                ? `Staged ${describeBitmaskSelections(parameterDraftById.get(notificationBuzzTypesParameter.id)?.nextValue, ARDUCOPTER_NOTIFICATION_BUZZER_TYPE_BIT_LABELS, 'Disabled')}`
                                : parameterDraftById.get(notificationBuzzTypesParameter.id)?.reason ??
                                  `Current ${describeBitmaskSelections(notificationBuzzTypes, ARDUCOPTER_NOTIFICATION_BUZZER_TYPE_BIT_LABELS, 'Disabled')}`}
                            </small>
                          </label>
                        ) : null}

                        {notificationBuzzVolumeParameter ? (
                          <ScopedField
                            parameter={notificationBuzzVolumeParameter}
                            liveValue={notificationBuzzVolume}
                            editedValues={editedValues}
                            onChange={(paramId, value) => setDraft(paramId, value)}
                            draftStatusById={parameterDraftById}
                          />
                        ) : null}
                      </div>

                      <ul className="output-note-list">
                        <li>Assign a NeoPixel output in the Output assignments card before expecting external LED strips to respond.</li>
                        <li>After notification-driver changes, bench-check the LEDs and buzzer with props off before flight.</li>
                      </ul>

                      <div className="switch-exercise-controls">
                        <button
                          style={buttonStyle('primary')}
                          onClick={() =>
                            void handleApplyScopedParameterDrafts(outputNotificationDraftEntries, 'outputs:notifications', 'Notification outputs')
                          }
                          disabled={
                            busyAction !== undefined ||
                            outputNotificationStagedDrafts.length === 0 ||
                            outputNotificationInvalidDrafts.length > 0 ||
                            !canApplyDraftParameters
                          }
                        >
                          {busyAction === 'outputs:notifications' ? 'Applying…' : `Apply Notification Changes (${outputNotificationStagedDrafts.length})`}
                        </button>
                        <button
                          style={buttonStyle()}
                          onClick={() =>
                            handleDiscardScopedParameterDrafts(outputNotificationDraftEntries.map((entry) => entry.id), 'notification outputs')
                          }
                          disabled={busyAction !== undefined || outputNotificationDraftEntries.length === 0}
                        >
                          Discard Notification Changes
                        </button>
                      </div>
                    </div>
                  ) : null}

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

                  {(outputNotificationDraftEntries.length > 0 || outputNotificationInvalidDrafts.length > 0 || outputNotificationStagedDrafts.length > 0) ? (
                    <div className="outputs-inline-toggle">
                      <div>
                        <strong>Notification drafts</strong>
                        <p>LED and buzzer changes stay local to Outputs. Review them here or jump back into Peripherals & Alerts.</p>
                      </div>
                      <div className="outputs-inline-toggle__actions">
                        <button style={buttonStyle()} onClick={() => setOutputTaskOverride('peripherals')}>
                          Open Peripherals & Alerts
                        </button>
                        <button
                          style={buttonStyle('primary')}
                          onClick={() =>
                            void handleApplyScopedParameterDrafts(outputNotificationDraftEntries, 'outputs:notifications', 'Notification outputs')
                          }
                          disabled={
                            busyAction !== undefined ||
                            outputNotificationStagedDrafts.length === 0 ||
                            outputNotificationInvalidDrafts.length > 0 ||
                            !canApplyDraftParameters
                          }
                        >
                          {busyAction === 'outputs:notifications' ? 'Applying…' : `Apply Notification Changes (${outputNotificationStagedDrafts.length})`}
                        </button>
                        <button
                          style={buttonStyle()}
                          onClick={() =>
                            handleDiscardScopedParameterDrafts(outputNotificationDraftEntries.map((entry) => entry.id), 'notification outputs')
                          }
                          disabled={busyAction !== undefined || outputNotificationDraftEntries.length === 0}
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
                          Open Peripherals & Alerts
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
  )
}
