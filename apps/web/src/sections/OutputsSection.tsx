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
import { MAX_MOTOR_TEST_THROTTLE_PERCENT } from '@arduconfig/ardupilot-core'
import {
  ARDUCOPTER_NOTIFICATION_BUZZER_TYPE_BIT_LABELS,
  ARDUCOPTER_NOTIFICATION_LED_TYPE_BIT_LABELS,
  formatArducopterNotificationLedBrightness,
  formatArducopterNotificationLedOverride
} from '@arduconfig/param-metadata'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { useMotorManagement } from '../hooks/use-motor-management'
import type { useMotorOutputAssignments } from '../hooks/use-motor-output-assignments'
import type { useMotorTestConfig } from '../hooks/use-motor-test-config'
import type { useOutputAssignmentVisibility } from '../hooks/use-output-assignment-visibility'
import type { useOutputNotificationCatalog } from '../hooks/use-output-notification-catalog'
import type { useSafetyAcks } from '../hooks/use-safety-acks'
import type { ParameterDraftValues } from '../hooks/use-parameter-drafts'
import type { buildVehicleOutputSummary } from '../view-models/vehicle-output-summary'
import type { createMotorPreviewNodes } from '../view-models/motor-preview'
import { outputKindLabel, toneForOutputKind } from '../device-display'
import { ALL_MOTOR_TEST_OUTPUT, ALL_MOTOR_TEST_OUTPUT_SIMULTANEOUS } from '../motor-test-helpers'
import { MotorTestSliders } from '../motor-test-sliders'
import { formatParameterValue, normalizeBitmaskValue } from '../parameter-format'
import { describeBitmaskSelections, hasBitmaskFlag, toggleBitmaskFlag } from '../selectors/bitmask'
import { readRoundedParameter, selectParameterById } from '../selectors/parameter-read'
import { QUADPLANE_ESC_PARAM_IDS } from '../param-groups'
import { buildPlaneControlSurfaces } from '../view-models/plane-control-surfaces'
import {
  OUTPUTS_BENCH_TARGET_ID,
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
  /** The inline motor reorder/direction panel rendered as the Motor Setup tab. */
  motorSetupSlot: ReactNode
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
    motorSetupSlot,
    canApplyDraftParameters,
    busyAction,
    editedValues,
    parameterDraftById,
    outputNotificationCatalog,
    motorTestConfig,
    motorManagement,
    safetyAcks,
    derived,
    handlers,
    motorTestMaxDurationSeconds
  } = props



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
    frameClassParameter,
    frameTypeParameter,
    frameDraftEntries,
    frameStagedDrafts,
    motorTestEligibility,
    isCopterVehicle,
    notificationLedOutputs,
    escReviewSummary,
    currentMotorTestSucceeded,
    motorTestSliderTargets,
    motorTestGuardReasons,
    motorTestOverUsb,
    canRunMotorTest,
    outputReviewParameters,
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
    handleRunMotorTest,
    handleStopMotorTest,
    renderAdditionalSettingsCard,
    setDraft,
    updateDrafts,
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

  // Fixed-wing control-surface checklist (Plane/QuadPlane): per-surface channel,
  // reversal, and L/R pairing — the things to verify before flight.
  const planeControlSurfaces = isCopterVehicle
    ? { surfaces: [], mappedCount: 0, incompleteCount: 0 }
    : buildPlaneControlSurfaces(
        outputMapping.outputs,
        (channelNumber) => readRoundedParameter(snapshot, `SERVO${channelNumber}_REVERSED`) === 1
      )

  return (
      <OutputsView
        // Motors tab: motor verification flow (everything except aux
        // servo peripherals). Servos tab: aux peripheral assignments
        // only. The underlying task-body render blocks below are still
        // gated by activeOutputTaskId so unfiltered task IDs simply
        // won't render — no duplicate UI between tabs.
        taskCards={
          activeViewId === 'motors'
            ? // Motors is three sub-tabs in a fixed order: ESC & protocol,
              // Motor setup, Direction & test (the consolidated 'review' task is
              // dropped — each sub-tab applies its own drafts).
              (['esc-protocol', 'motor-setup', 'direction-test'] as const)
                .map((id) => outputTaskCards.find((card) => card.id === id))
                .filter((card): card is (typeof outputTaskCards)[number] => card !== undefined)
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
        // The output overview panel was removed as part of the Motors/Outputs
        // declutter — the task surfaces below carry the per-output detail.
        overviewSlot={undefined}
        taskBodySlot={
          <>
              {activeOutputTaskId === 'motor-setup' ? (
                isCopterVehicle ? (
                  <div className="outputs-task-panel outputs-task-panel--stack">{motorSetupSlot}</div>
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

              {activeOutputTaskId === 'direction-test' ? (
                <div className="outputs-task-panel outputs-task-panel--stack">
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
                         *  Drives both underlying acknowledgments together. */}
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
