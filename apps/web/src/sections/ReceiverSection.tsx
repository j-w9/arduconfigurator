// ReceiverSection — App.tsx's `activeViewId === 'receiver'` block, the
// ~966-line ReceiverView invocation that builds the live-monitor,
// task-body, and help-dock slots for RC mapping / endpoints / flight-modes
// / signal-setup / review. Behaviour-neutral verbatim move: the slot JSX is
// byte-identical to the App.tsx original.
//
// The receiver hook results are passed as grouped props typed via
// `ReturnType<typeof useX>` so the prop shapes are INFERRED from the hooks
// and cannot drift. Each group is destructured back into the exact flat
// variable names the JSX reads at the top of the component body, so no JSX
// identifier needs renaming. Scalar derivations, edit plumbing, and handler
// bodies stay in App.tsx and are threaded through here.

import type { ReactElement, ReactNode } from 'react'
import type { ConfiguratorSnapshot, ParameterDraftEntry, ParameterState } from '@arduconfig/ardupilot-core'
import {
  deriveAirframe,
  deriveModeAssignments,
  deriveModeExerciseAssignments,
  deriveModeSwitchEstimate,
  deriveRcAxisChannelMap,
  deriveRcAxisObservations,
  formatRcAxisLabel
} from '@arduconfig/ardupilot-core'
import { formatArducopterFlightModeChannel, formatArducopterRssiType } from '@arduconfig/param-metadata'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import type { useModeSwitchDerivations } from '../hooks/use-mode-switch-derivations'
import type { useRcCalibrationDerivations } from '../hooks/use-rc-calibration-derivations'
import type { useRcExercises } from '../hooks/use-rc-exercises'
import type { useRcMappingDerivations } from '../hooks/use-rc-mapping-derivations'
import type { useRcRangeDerivations } from '../hooks/use-rc-range-derivations'
import type { useReceiverAdditional } from '../hooks/use-receiver-additional'
import type { useReceiverChannelDisplays } from '../hooks/use-receiver-channel-displays'
import type { useReceiverDetailToggles } from '../hooks/use-receiver-detail-toggles'
import type { useReceiverSupportCatalog } from '../hooks/use-receiver-support-catalog'
import type { useReceiverTasks } from '../hooks/use-receiver-tasks'
import type { useSerialPortModels } from '../hooks/use-serial-port-models'
import type { useSetupExercises } from '../hooks/use-setup-exercises'
import { formatParameterValue } from '../parameter-format'
import { formatModeAssignment, modeSlotParamId } from '../modes-failsafe-helpers'
import { RcChannelBars } from '../rc-channel-bars'
import { readRoundedParameter, selectParameterById } from '../selectors/parameter-read'
import { RC_CALIBRATION_AXIS_ORDER, RC_CALIBRATION_SWITCH_CHANNELS, rcCalibrationCaptureComplete } from '../setup-exercise-helpers'
import { StickCraftPreview } from '../preview-components'
import { formatRxRssi } from '../status-formatters'
import { toneForModeSwitchExercise, toneForParameterDraftStatus, toneForScopedDraftReview } from '../tone-helpers'
import { ReceiverView } from '../views/Receiver'
import { ScopedBitmaskField, ScopedField, ScopedSelectField } from '../views/ScopedField'

export interface ReceiverSectionDerived {
  airframe: ReturnType<typeof deriveAirframe>
  rcAxisObservations: ReturnType<typeof deriveRcAxisObservations>
  currentRcAxisChannelMap: ReturnType<typeof deriveRcAxisChannelMap>
  modeSwitchEstimate: ReturnType<typeof deriveModeSwitchEstimate>
  modeExerciseAssignments: ReturnType<typeof deriveModeExerciseAssignments>
  modeAssignments: ReturnType<typeof deriveModeAssignments>
  modeSwitchExercise: ReturnType<typeof useSetupExercises>['modeSwitchExercise']
  modeSwitchActivity: ReturnType<typeof useSetupExercises>['modeSwitchActivity']
  recentModeSwitchChange: boolean | undefined
  configuredModeChannel: number | undefined
  rssiType: number | undefined
  rssiChannel: number | undefined
  rssiChannelLow: number | undefined
  rssiChannelHigh: number | undefined
  modeAssignmentParameters: readonly ParameterState[]
  receiverLinkPorts: ReturnType<typeof useSerialPortModels>['receiverLinkPorts']
  receiverDraftEntries: readonly ParameterDraftEntry[]
  receiverStagedDrafts: readonly ParameterDraftEntry[]
  receiverInvalidDrafts: readonly ParameterDraftEntry[]
  canRunRcMappingExercise: boolean
  canRunRcRangeExercise: boolean
  canCaptureRcCalibration: boolean
  canRunModeSwitchExercise: boolean
  receiverWorkflowDraftCount: number
  receiverWorkflowInvalidCount: number
  receiverAdvancedDraftCount: number
  receiverAdvancedInvalidCount: number
  receiverHasPendingReview: boolean
}

export interface ReceiverSectionHandlers {
  handleStartRcMappingExercise: () => void
  handleConfirmRcMappingCandidate: () => void
  handleStageRcMappingDrafts: () => void
  handleResetRcMappingExercise: () => void
  handleFailRcMappingExercise: () => void
  handleStartRcRangeExercise: () => void
  handleResetRcRangeExercise: () => void
  handleFailRcRangeExercise: () => void
  handleStartRcCalibrationCapture: () => void
  handleResetRcCalibrationCapture: () => void
  handleStageRcCalibrationDrafts: () => void
  handleStartModeSwitchExercise: () => void
  handleCompleteModeSwitchExercise: () => void
  handleResetModeSwitchExercise: () => void
  handleApplyScopedParameterDrafts: (
    drafts: readonly ParameterDraftEntry[],
    busyKey: string,
    scopeLabel: string
  ) => void | Promise<void>
  handleDiscardScopedParameterDrafts: (paramIds: readonly string[], scopeLabel: string) => void
  renderAdditionalSettingsCard: (
    title: string,
    description: string,
    groups: import('../view-models/peripherals').AdditionalSettingsGroup[],
    drafts: ParameterDraftEntry[],
    staged: ParameterDraftEntry[],
    invalid: ParameterDraftEntry[],
    applyActionId: string,
    applyLabel: string,
    discardScope: string
  ) => ReactNode
  setDraft: (paramId: string, value: string) => void
  setReceiverTaskOverride: (taskId: import('../views/Receiver').ReceiverTaskId) => void
}

export interface ReceiverSectionProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  editedValues: Record<string, string>
  parameterDraftById: ReadonlyMap<string, ParameterDraftEntry>
  rcExercises: ReturnType<typeof useRcExercises>
  receiverChannelDisplays: ReturnType<typeof useReceiverChannelDisplays>
  rcMappingDerivations: ReturnType<typeof useRcMappingDerivations>
  rcRangeDerivations: ReturnType<typeof useRcRangeDerivations>
  modeSwitchDerivations: ReturnType<typeof useModeSwitchDerivations>
  rcCalibrationDerivations: ReturnType<typeof useRcCalibrationDerivations>
  receiverTasks: ReturnType<typeof useReceiverTasks>
  receiverSupportCatalog: ReturnType<typeof useReceiverSupportCatalog>
  receiverAdditional: ReturnType<typeof useReceiverAdditional>
  receiverDetailToggles: ReturnType<typeof useReceiverDetailToggles>
  derived: ReceiverSectionDerived
  handlers: ReceiverSectionHandlers
}

export function ReceiverSection(props: ReceiverSectionProps): ReactElement {
  const {
    snapshot,
    canApplyDraftParameters,
    busyAction,
    editedValues,
    parameterDraftById,
    rcExercises,
    receiverChannelDisplays,
    rcMappingDerivations,
    rcCalibrationDerivations,
    receiverTasks,
    receiverSupportCatalog,
    receiverAdditional,
    receiverDetailToggles,
    derived,
    handlers
  } = props

  const { rcMappingSession, rcCalibrationSession } = rcExercises

  const { receiverPrimaryChannelDisplays, receiverAuxChannelDisplays } = receiverChannelDisplays

  const {
    rcMappingCandidate,
    rcMappingLiveCandidates,
    rcMappingCapturedCount,
    rcMappingTargetGuide,
    rcMappingCandidateConfidence,
    rcMappingRejectedReason,
    rcMappingStagedChangeCount,
    rcMappingAutoCaptureKey,
    rcMappingAutoCaptureProgressPercent,
    rcMappingSummary,
    rcMappingInstructions
  } = rcMappingDerivations

  const { rcCalibrationSummary } = rcCalibrationDerivations

  const { activeReceiverTaskId, receiverTaskCards, activeReceiverTask } = receiverTasks

  const {
    modeChannelParameter,
    rssiTypeParameter,
    rssiChannelParameter,
    rssiChannelLowParameter,
    rssiChannelHighParameter,
    rcOptionsParameter
  } = receiverSupportCatalog

  const {
    receiverAdditionalGroups,
    receiverAdditionalDraftEntries,
    receiverAdditionalStagedDrafts,
    receiverAdditionalInvalidDrafts
  } = receiverAdditional

  const {
    showReceiverChannelDetails,
    setShowReceiverChannelDetails,
    showReceiverMappingDiagnostics,
    setShowReceiverMappingDiagnostics
  } = receiverDetailToggles

  const {
    airframe,
    rcAxisObservations,
    currentRcAxisChannelMap,
    modeSwitchEstimate,
    modeExerciseAssignments,
    modeAssignments,
    modeSwitchActivity,
    recentModeSwitchChange,
    configuredModeChannel,
    rssiType,
    rssiChannel,
    rssiChannelLow,
    rssiChannelHigh,
    modeAssignmentParameters,
    receiverLinkPorts,
    receiverDraftEntries,
    receiverStagedDrafts,
    receiverInvalidDrafts,
    canRunRcMappingExercise,
    canCaptureRcCalibration,
    receiverWorkflowDraftCount,
    receiverWorkflowInvalidCount,
    receiverAdvancedDraftCount,
    receiverAdvancedInvalidCount,
    receiverHasPendingReview
  } = derived

  const {
    handleStartRcMappingExercise,
    handleConfirmRcMappingCandidate,
    handleStageRcMappingDrafts,
    handleResetRcMappingExercise,
    handleFailRcMappingExercise,
    handleStartRcCalibrationCapture,
    handleResetRcCalibrationCapture,
    handleStageRcCalibrationDrafts,
    handleApplyScopedParameterDrafts,
    handleDiscardScopedParameterDrafts,
    renderAdditionalSettingsCard,
    setDraft,
    setReceiverTaskOverride
  } = handlers

  return (
        <ReceiverView
          taskCards={receiverTaskCards}
          activeTaskId={activeReceiverTaskId}
          activeTask={activeReceiverTask}
          onSelectTask={setReceiverTaskOverride}
          liveMonitorSlot={
                <div className="receiver-monitor__sticky">
                  <div className="telemetry-header">
                    <div>
                      <h3>Live monitor</h3>
                    </div>
                    <StatusBadge tone={snapshot.liveVerification.rcInput.verified ? 'success' : 'warning'}>
                      {snapshot.liveVerification.rcInput.verified ? `${snapshot.liveVerification.rcInput.channelCount} channels live` : 'No RC telemetry'}
                    </StatusBadge>
                  </div>

                  <div className="receiver-stick-craft" data-testid="receiver-stick-craft-card">
                    <StickCraftPreview
                      observations={rcAxisObservations}
                      snapshot={snapshot}
                      verified={snapshot.liveVerification.rcInput.verified}
                      vehicleType={snapshot.vehicle?.vehicle}
                      frameClassLabel={airframe.frameClassLabel}
                      frameTypeLabel={airframe.frameTypeLabel}
                    />
                  </div>

                  <div className="receiver-live-primary-grid">
                    {rcAxisObservations.map((axis) => {
                      const channel = receiverPrimaryChannelDisplays.find((entry) => entry.channelNumber === axis.channelNumber)
                      return (
                        <article key={axis.axisId} className="receiver-live-card">
                          <div className="receiver-live-card__header">
                            <strong>{axis.label}</strong>
                            <span>CH{axis.channelNumber}</span>
                          </div>
                          <div className="rc-bar" aria-hidden="true">
                            <div className="rc-bar__trim" style={{ left: `${channel?.trimPercent ?? 50}%` }} />
                            <div className="rc-bar__fill" style={{ width: `${channel?.fillPercent ?? 0}%` }} />
                          </div>
                          <div className="receiver-live-card__footer">
                            <span>{axis.pwm !== undefined ? `${axis.pwm} µs` : 'No data'}</span>
                            <span>{channel?.role ?? 'Primary control'}</span>
                          </div>
                        </article>
                      )
                    })}

                    <article className={`receiver-live-card receiver-live-card--mode${recentModeSwitchChange ? ' receiver-live-card--attention' : ''}`}>
                      <div className="receiver-live-card__header">
                        <strong>Flight mode</strong>
                        <span>{modeSwitchEstimate.channelNumber !== undefined ? `CH${modeSwitchEstimate.channelNumber}` : 'Unset'}</span>
                      </div>
                      <p>
                        {modeSwitchEstimate.channelNumber === undefined
                          ? 'Mode channel not configured yet.'
                          : modeSwitchEstimate.estimatedSlot !== undefined
                            ? `Slot ${modeSwitchEstimate.estimatedSlot} · ${formatModeAssignment(modeSwitchEstimate.configuredValue, snapshot.vehicle?.vehicle)}`
                            : 'Waiting for the configured mode channel to move.'}
                      </p>
                      <div className="receiver-live-card__footer">
                        <span>{modeSwitchEstimate.pwm !== undefined ? `${modeSwitchEstimate.pwm} µs` : 'No data'}</span>
                        <span>{recentModeSwitchChange ? 'Recent movement' : 'Mode switch'}</span>
                      </div>
                    </article>
                  </div>

                  <RcChannelBars
                    channels={receiverPrimaryChannelDisplays}
                    verified={snapshot.liveVerification.rcInput.verified}
                    testId="receiver-channel-bars"
                  />


                  <div className="receiver-channel-disclosure">
                    <div>
                      <strong>Aux channel details</strong>
                    </div>
                    <button
                      style={buttonStyle()}
                      onClick={() => setShowReceiverChannelDetails((existing) => !existing)}
                    >
                      {showReceiverChannelDetails ? 'Hide AUX Channels' : `Show AUX Channels (${receiverAuxChannelDisplays.length})`}
                    </button>
                  </div>

                  {showReceiverChannelDetails ? (
                    receiverAuxChannelDisplays.length > 0 ? (
                      <div className="rc-channel-grid rc-channel-grid--secondary">
                        {receiverAuxChannelDisplays.map((channel) => (
                          <article
                            key={channel.channelNumber}
                            className={`rc-channel-card${channel.isModeChannel ? ' rc-channel-card--mode' : ''}${channel.isModeChannel && recentModeSwitchChange ? ' rc-channel-card--active' : ''}`}
                          >
                            <div className="rc-channel-card__header">
                              <strong>CH{channel.channelNumber}</strong>
                              <span>{channel.role}</span>
                            </div>
                            <div className="rc-bar" aria-hidden="true">
                              <div className="rc-bar__trim" style={{ left: `${channel.trimPercent}%` }} />
                              <div className="rc-bar__fill" style={{ width: `${channel.fillPercent}%` }} />
                            </div>
                            <div className="rc-channel-card__footer">
                              <span>{channel.pwm !== undefined ? `${channel.pwm} µs` : 'No data'}</span>
                              <span>{channel.isModeChannel ? 'Mode channel' : 'Aux input'}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p className="switch-exercise-warning">No additional AUX channels are currently streaming beyond the primary controls.</p>
                    )
                  ) : null}
                </div>
          }
          taskBodySlot={
            <>
                {activeReceiverTaskId === 'mapping' ? (
                  <div className="receiver-task-panel receiver-task-panel--stack">
                    <div className="rc-mapping-card">
                      <div className="switch-exercise-card__header">
                        <div>
                          <strong>RC channel mapping</strong>
                          <p>{rcMappingSummary}</p>
                        </div>
                        <StatusBadge tone={toneForModeSwitchExercise(rcMappingSession.status === 'ready' ? 'passed' : rcMappingSession.status === 'running' ? 'running' : rcMappingSession.status === 'failed' ? 'failed' : 'idle')}>
                          {rcMappingSession.status === 'ready' ? 'complete' : rcMappingSession.status}
                        </StatusBadge>
                      </div>

                      <div className={`rc-mapping-focus${rcMappingSession.status === 'running' ? ' rc-mapping-focus--active' : ''}${rcMappingSession.status === 'ready' ? ' rc-mapping-focus--complete' : ''}`}>
                        <div className="rc-mapping-focus__copy">
                          <span>
                            {rcMappingSession.status === 'running'
                              ? `Step ${Math.min(rcMappingCapturedCount + 1, RC_CALIBRATION_AXIS_ORDER.length)} of ${RC_CALIBRATION_AXIS_ORDER.length}`
                              : rcMappingSession.status === 'ready'
                                ? 'Mapping Complete'
                                : 'Guided Capture'}
                          </span>
                          <strong>
                            {rcMappingSession.status === 'running'
                              ? rcMappingTargetGuide.title
                              : rcMappingSession.status === 'ready'
                                ? 'Roll, pitch, throttle, and yaw were all identified.'
                                : 'Capture one axis at a time.'}
                          </strong>
                          <p>
                            {rcMappingSession.status === 'running'
                              ? rcMappingTargetGuide.detail
                              : rcMappingSession.status === 'ready'
                                ? rcMappingStagedChangeCount > 0
                                  ? 'Review the detected map below, then stage the RCMAP_* changes before continuing with endpoint capture.'
                                  : 'The current receiver map already matches the live inputs, so you can continue without staging any remap.'
                                : 'Start the guided capture, then move only the highlighted control. The app will lock onto the dominant channel automatically.'}
                          </p>
                        </div>

                        <div className="rc-mapping-focus__status">
                          <StatusBadge tone={rcMappingCandidateConfidence.tone}>
                            {rcMappingSession.status === 'running'
                              ? `${rcMappingCandidateConfidence.label} detection`
                              : rcMappingSession.status === 'ready'
                                ? `${rcMappingCapturedCount}/${RC_CALIBRATION_AXIS_ORDER.length} captured`
                                : 'idle'}
                          </StatusBadge>
                          <div className="config-pills">
                            <span>{rcMappingCapturedCount}/{RC_CALIBRATION_AXIS_ORDER.length} axes captured</span>
                            {rcMappingCandidate ? <span>CH{rcMappingCandidate.channelNumber} leading</span> : null}
                            {rcMappingSession.status === 'ready' ? <span>{rcMappingStagedChangeCount} remap changes</span> : null}
                          </div>
                        </div>
                      </div>

                      <div className="rc-range-axis-grid">
                        {RC_CALIBRATION_AXIS_ORDER.map((axisId) => {
                          const capture = rcMappingSession.captures[axisId]
                          const activeTarget = rcMappingSession.currentTargetAxis === axisId
                          return (
                            <article
                              key={axisId}
                              className={`rc-range-axis-card${activeTarget ? ' rc-range-axis-card--target' : ''}${capture.detectedChannelNumber !== undefined ? ' rc-range-axis-card--complete' : ''}`}
                            >
                              <div className="rc-range-axis-card__header">
                                <strong>{formatRcAxisLabel(axisId)}</strong>
                                <span>{capture.detectedChannelNumber !== undefined ? 'Captured' : activeTarget ? 'Current target' : 'Pending'}</span>
                              </div>
                              <p>
                                {capture.detectedChannelNumber !== undefined
                                  ? `Current map CH${currentRcAxisChannelMap[axisId]} · detected CH${capture.detectedChannelNumber}${capture.deltaUs !== undefined ? ` (${Math.round(capture.deltaUs)}µs delta)` : ''}`
                                  : activeTarget
                                    ? rcMappingCandidate
                                      ? `Current dominant channel CH${rcMappingCandidate.channelNumber} (${Math.round(rcMappingCandidate.deltaUs)}µs delta)`
                                      : 'Waiting for one clear dominant channel.'
                                    : `Current map CH${currentRcAxisChannelMap[axisId]} · not captured yet`}
                              </p>
                              {activeTarget && rcMappingSession.status === 'running' ? (
                                <div className="config-pills">
                                  <span className="is-target">{rcMappingTargetGuide.title}</span>
                                  <span>{rcMappingCandidate ? 'Auto-capture armed' : 'Move only this control'}</span>
                                </div>
                              ) : null}
                            </article>
                          )
                        })}
                      </div>

                      {rcMappingCandidate ? (
                        <div key={rcMappingAutoCaptureKey} className="rc-mapping-auto-capture">
                          <div className="rc-mapping-auto-capture__copy">
                            <strong>Locking onto CH{rcMappingCandidate.channelNumber}</strong>
                            <small>Repeated strong movement on the same channel will auto-capture it and advance to the next axis.</small>
                          </div>
                          <div className="rc-mapping-auto-capture__meter" aria-hidden="true">
                            <span
                              className="rc-mapping-auto-capture__fill"
                              style={{ width: `${rcMappingAutoCaptureProgressPercent}%` }}
                            />
                          </div>
                        </div>
                      ) : null}

                      {!rcMappingCandidate && rcMappingRejectedReason ? (
                        <p className="switch-exercise-warning">{rcMappingRejectedReason}</p>
                      ) : null}

                      {rcMappingSession.status === 'running' ? (
                        <div className="receiver-inline-toggle">
                          <div>
                            <strong>Detection diagnostics</strong>
                            <p>Only expand this when you need to see which channels are competing during the current capture.</p>
                          </div>
                          <button
                            style={buttonStyle()}
                            onClick={() => setShowReceiverMappingDiagnostics((existing) => !existing)}
                          >
                            {showReceiverMappingDiagnostics ? 'Hide Detection Details' : 'Show Detection Details'}
                          </button>
                        </div>
                      ) : null}

                      {rcMappingSession.status === 'running' && showReceiverMappingDiagnostics ? (
                        <div className="rc-mapping-candidate-panel">
                          <div className="rc-mapping-candidate-panel__header">
                            <strong>Live candidates right now</strong>
                            <small>Top channel movement compared to the baseline captured when this exercise started.</small>
                          </div>
                          {rcMappingLiveCandidates.length > 0 ? (
                            <div className="rc-mapping-candidate-list">
                              {rcMappingLiveCandidates.map((candidate, index) => (
                                <article
                                  key={`${rcMappingSession.currentTargetAxis}:${candidate.channelNumber}`}
                                  className={`rc-mapping-candidate${index === 0 ? ' is-leading' : ''}`}
                                >
                                  <div className="rc-mapping-candidate__header">
                                    <strong>CH{candidate.channelNumber}</strong>
                                    <StatusBadge tone={index === 0 ? rcMappingCandidateConfidence.tone : 'neutral'}>
                                      {index === 0 ? 'leading' : 'candidate'}
                                    </StatusBadge>
                                  </div>
                                  <p>{Math.round(candidate.deltaUs)} µs change</p>
                                  <small>
                                    {Math.round(candidate.baselinePwm)} µs baseline to {Math.round(candidate.livePwm)} µs live
                                  </small>
                                </article>
                              ))}
                            </div>
                          ) : (
                            <p className="switch-exercise-warning">No channel is standing out yet. Move only the highlighted control and keep the others still.</p>
                          )}
                        </div>
                      ) : null}

                      <ol className="switch-exercise-instructions">
                        {rcMappingInstructions.map((instruction) => (
                          <li key={instruction}>{instruction}</li>
                        ))}
                      </ol>

                      <div className="switch-exercise-controls">
                        <button
                          style={buttonStyle('primary')}
                          onClick={handleStartRcMappingExercise}
                          disabled={!canRunRcMappingExercise || rcMappingSession.status === 'running'}
                        >
                          {rcMappingSession.status === 'ready' ? 'Run Guided Mapping Again' : 'Begin Guided Mapping'}
                        </button>
                        <button
                          style={buttonStyle('secondary')}
                          onClick={handleConfirmRcMappingCandidate}
                          disabled={rcMappingSession.status !== 'running' || rcMappingCandidate === undefined}
                        >
                          {rcMappingCandidate && rcMappingSession.currentTargetAxis
                            ? `Capture CH${rcMappingCandidate.channelNumber} for ${formatRcAxisLabel(rcMappingSession.currentTargetAxis)}`
                            : 'Capture Current Channel'}
                        </button>
                        <button
                          style={buttonStyle('secondary')}
                          onClick={handleStageRcMappingDrafts}
                          disabled={rcMappingSession.status !== 'ready' || rcMappingStagedChangeCount === 0}
                        >
                          {rcMappingSession.status === 'ready' && rcMappingStagedChangeCount === 0
                            ? 'No RCMAP Changes Needed'
                            : `Stage Detected Mapping (${rcMappingStagedChangeCount})`}
                        </button>
                        {rcMappingSession.status === 'ready' ? (
                          <button
                            style={buttonStyle('primary')}
                            data-testid="receiver-mapping-continue-endpoints"
                            onClick={() => setReceiverTaskOverride('endpoints')}
                          >
                            Continue to Endpoints
                          </button>
                        ) : null}
                        <button
                          style={buttonStyle()}
                          onClick={handleResetRcMappingExercise}
                          disabled={rcMappingSession.status === 'idle'}
                        >
                          Start Over
                        </button>
                        <button
                          style={buttonStyle('secondary')}
                          onClick={handleFailRcMappingExercise}
                          disabled={rcMappingSession.status !== 'running'}
                        >
                          Can’t Isolate Axis
                        </button>
                      </div>
                    </div>

                    {/* Channel direction lives with mapping: once you know which
                     *  channel is which, set its direction. Per-channel reverse
                     *  toggles for the four primary axes (roll / pitch / throttle
                     *  / yaw). Pitch reversal is the common one — most Mode-2
                     *  transmitters need RC2_REVERSED=1 for stick-back = pitch-up.
                     *  Toggles flow through staged drafts like every Receiver edit. */}
                    {(() => {
                      const reverseRows: { axisLabel: string; recommendedNote?: string; parameter: ReturnType<typeof selectParameterById> }[] = [
                        { axisLabel: 'Roll (RC1)', parameter: selectParameterById(snapshot, 'RC1_REVERSED') },
                        { axisLabel: 'Pitch (RC2)', recommendedNote: 'Most Mode-2 transmitters need this set to Reversed for stick-back = pitch-up.', parameter: selectParameterById(snapshot, 'RC2_REVERSED') },
                        { axisLabel: 'Throttle (RC3)', parameter: selectParameterById(snapshot, 'RC3_REVERSED') },
                        { axisLabel: 'Yaw (RC4)', parameter: selectParameterById(snapshot, 'RC4_REVERSED') }
                      ].filter((row) => row.parameter !== undefined)
                      if (reverseRows.length === 0) return null
                      return (
                        <div className="scoped-review-card scoped-review-card--compact" data-testid="receiver-channel-direction">
                          <div className="switch-exercise-card__header">
                            <div>
                              <strong>Channel direction</strong>
                              <p>Reverse a channel here instead of inverting it on the transmitter — staged like every other Receiver edit.</p>
                            </div>
                          </div>
                          <div className="scoped-editor-grid">
                            {reverseRows.map((row) => (
                              <div key={row.parameter!.id} data-testid={`receiver-reverse-${row.parameter!.id}`}>
                                <ScopedField
                                  parameter={row.parameter!}
                                  liveValue={row.parameter!.value}
                                  editedValues={editedValues}
                                  onChange={(paramId, value) => setDraft(paramId, value)}
                                  draftStatusById={parameterDraftById}
                                />
                                {row.recommendedNote ? (
                                  <small className="scoped-editor-field__hint">{row.recommendedNote}</small>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                ) : null}

                {activeReceiverTaskId === 'endpoints' ? (
                  <div className="receiver-task-panel receiver-task-panel--stack">
                    <div className="receiver-task-two-up receiver-task-two-up--single">
                      <div className="rc-calibration-card">
                        <div className="switch-exercise-card__header">
                          <div>
                            <strong>RC calibration capture</strong>
                            <p>{rcCalibrationSummary}</p>
                          </div>
                          <StatusBadge tone={toneForModeSwitchExercise(rcCalibrationSession.status === 'ready' ? 'passed' : rcCalibrationSession.status === 'capturing' ? 'running' : rcCalibrationSession.status === 'failed' ? 'failed' : 'idle')}>
                            {rcCalibrationSession.status === 'ready' ? 'complete' : rcCalibrationSession.status}
                          </StatusBadge>
                        </div>

                        <div className="config-pills">
                          {rcAxisObservations.map((axis) => (
                            <span key={axis.axisId}>
                              {axis.label}: CH{axis.channelNumber}
                            </span>
                          ))}
                        </div>

                        <div className="rc-range-axis-grid">
                          {RC_CALIBRATION_AXIS_ORDER.map((axisId) => {
                            const capture = rcCalibrationSession.captures[axisId]
                            const livePwm = rcAxisObservations.find((obs) => obs.axisId === axisId)?.pwm
                            const toPct = (value: number): number => Math.max(0, Math.min(100, ((value - 1000) / 1000) * 100))
                            return (
                              <article
                                key={axisId}
                                className={`rc-range-axis-card${rcCalibrationCaptureComplete(capture) ? ' rc-range-axis-card--complete' : ''}`}
                              >
                                <div className="rc-range-axis-card__header">
                                  <strong>{capture.label}</strong>
                                  <span>CH{capture.channelNumber}</span>
                                </div>
                                <p>{livePwm !== undefined ? `${livePwm} µs live` : 'No live data'}</p>
                                {/* Live channel-movement bar (from the old stick-range exercise):
                                    the swept band lights the ends already reached and the marker
                                    tracks the stick's current position, alongside the capture below. */}
                                <div className="rc-range-axis-card__bar" data-testid={`rc-range-bar-${axisId}`} aria-hidden="true">
                                  {capture.lowObserved ? <div className="rc-range-axis-card__swept" style={{ left: '0%', width: '20%' }} /> : null}
                                  {capture.highObserved ? <div className="rc-range-axis-card__swept" style={{ left: '80%', width: '20%' }} /> : null}
                                  {livePwm !== undefined ? <div className="rc-range-axis-card__marker" style={{ left: `${toPct(livePwm)}%` }} /> : null}
                                </div>
                                <p>
                                  Min {capture.observedMin !== undefined ? Math.round(capture.observedMin) : 'Unknown'} µs · Max{' '}
                                  {capture.observedMax !== undefined ? Math.round(capture.observedMax) : 'Unknown'} µs
                                </p>
                                <div className="config-pills">
                                  <span className={capture.lowObserved ? 'is-complete' : undefined}>Low</span>
                                  <span className={capture.highObserved ? 'is-complete' : undefined}>High</span>
                                  {axisId !== 'throttle' ? (
                                    <span className={capture.centeredObserved ? 'is-complete' : undefined}>
                                      Trim {capture.trimPwm !== undefined ? Math.round(capture.trimPwm) : 'pending'}
                                    </span>
                                  ) : null}
                                </div>
                              </article>
                            )
                          })}
                          {/* CH5/CH6 switch channels — optional add-on. Flick each
                              switch low + high to capture its RCn_MIN/MAX endpoints. */}
                          {RC_CALIBRATION_SWITCH_CHANNELS.map((channelNumber) => {
                            const capture = rcCalibrationSession.switchCaptures[channelNumber]
                            if (!capture) {
                              return null
                            }
                            const livePwm = snapshot.liveVerification.rcInput.channels[channelNumber - 1]
                            const hasLive = typeof livePwm === 'number' && livePwm !== 0xffff
                            const toPct = (value: number): number => Math.max(0, Math.min(100, ((value - 1000) / 1000) * 100))
                            const complete = capture.lowObserved && capture.highObserved
                            return (
                              <article
                                key={`switch-${channelNumber}`}
                                className={`rc-range-axis-card${complete ? ' rc-range-axis-card--complete' : ''}`}
                              >
                                <div className="rc-range-axis-card__header">
                                  <strong>{capture.label}</strong>
                                  <span>Switch</span>
                                </div>
                                <p>{hasLive ? `${livePwm} µs live` : 'No live data'}</p>
                                <div className="rc-range-axis-card__bar" data-testid={`rc-range-bar-ch${channelNumber}`} aria-hidden="true">
                                  {capture.lowObserved ? <div className="rc-range-axis-card__swept" style={{ left: '0%', width: '20%' }} /> : null}
                                  {capture.highObserved ? <div className="rc-range-axis-card__swept" style={{ left: '80%', width: '20%' }} /> : null}
                                  {hasLive ? <div className="rc-range-axis-card__marker" style={{ left: `${toPct(livePwm)}%` }} /> : null}
                                </div>
                                <p>
                                  Min {capture.observedMin !== undefined ? Math.round(capture.observedMin) : 'Unknown'} µs · Max{' '}
                                  {capture.observedMax !== undefined ? Math.round(capture.observedMax) : 'Unknown'} µs
                                </p>
                                <div className="config-pills">
                                  <span className={capture.lowObserved ? 'is-complete' : undefined}>Low</span>
                                  <span className={capture.highObserved ? 'is-complete' : undefined}>High</span>
                                </div>
                              </article>
                            )
                          })}
                        </div>

                        <ol className="switch-exercise-instructions">
                          <li>Start capture with the sticks centered and throttle low.</li>
                          <li>Move roll, pitch, throttle, and yaw through their full travel.</li>
                          <li>Optional: flick CH5/CH6 switches fully low then high to capture their endpoints.</li>
                          <li>Stage the captured values, then review and apply them from the Receiver view before confirming the radio step.</li>
                        </ol>

                        <div className="switch-exercise-controls">
                          <button
                            style={buttonStyle('primary')}
                            onClick={handleStartRcCalibrationCapture}
                            disabled={!canCaptureRcCalibration || rcCalibrationSession.status === 'capturing'}
                          >
                            {rcCalibrationSession.status === 'ready' ? 'Capture Again' : 'Start Capture'}
                          </button>
                          <button
                            style={buttonStyle()}
                            onClick={handleResetRcCalibrationCapture}
                            disabled={rcCalibrationSession.status === 'idle'}
                          >
                            Reset
                          </button>
                          <button
                            style={buttonStyle('secondary')}
                            onClick={handleStageRcCalibrationDrafts}
                            disabled={rcCalibrationSession.status !== 'ready'}
                          >
                            Stage Captured Values
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {activeReceiverTaskId === 'flight-modes' ? (
                  <div className="receiver-task-panel receiver-task-panel--stack">
                    <div className="receiver-task-two-up">
                      <div className="mode-estimate-card">
                        <div className="mode-estimate-card__header">
                          <strong>Flight mode switch</strong>
                          <StatusBadge tone={recentModeSwitchChange ? 'warning' : modeSwitchEstimate.estimatedSlot !== undefined ? 'success' : 'neutral'}>
                            {recentModeSwitchChange ? 'Switch moved' : modeSwitchEstimate.estimatedSlot !== undefined ? 'Stable' : 'Waiting'}
                          </StatusBadge>
                        </div>
                        <p>
                          {modeSwitchEstimate.channelNumber === undefined
                            ? 'Mode channel is not configured yet.'
                            : modeSwitchEstimate.pwm === undefined
                              ? `Configured for CH${modeSwitchEstimate.channelNumber}, waiting for that channel to stream.`
                              : `Estimated slot ${modeSwitchEstimate.estimatedSlot} on CH${modeSwitchEstimate.channelNumber} at ${modeSwitchEstimate.pwm} µs.`}
                        </p>
                        <small>
                          {modeSwitchEstimate.configuredParamId && modeSwitchEstimate.configuredValue !== undefined
                            ? `${modeSwitchEstimate.configuredParamId} = ${formatModeAssignment(modeSwitchEstimate.configuredValue, snapshot.vehicle?.vehicle)}`
                            : `Heartbeat mode: ${snapshot.vehicle?.flightMode ?? 'Unknown'}`}
                        </small>
                        {modeSwitchActivity ? (
                          <small>
                            {modeSwitchActivity.previousSlot !== undefined && modeSwitchActivity.previousSlot !== modeSwitchActivity.currentSlot
                              ? `Last slot change: ${formatModeAssignment(readRoundedParameter(snapshot, modeSlotParamId(snapshot.vehicle?.vehicle, modeSwitchActivity.previousSlot)), snapshot.vehicle?.vehicle)} -> ${formatModeAssignment(
                                  readRoundedParameter(snapshot, modeSlotParamId(snapshot.vehicle?.vehicle, modeSwitchActivity.currentSlot)),
                                  snapshot.vehicle?.vehicle
                                )}`
                              : `Last switch movement: ${modeSwitchActivity.previousPwm ?? modeSwitchActivity.currentPwm} µs -> ${modeSwitchActivity.currentPwm} µs`}
                          </small>
                        ) : null}
                      </div>

                      {modeChannelParameter ? (
                        <div className="scoped-review-card scoped-review-card--compact">
                          <div className="switch-exercise-card__header">
                            <div>
                              <strong>Mode channel</strong>
                              <p>Choose which receiver channel ArduPilot should use for flight-mode selection.</p>
                            </div>
                            <StatusBadge tone={toneForScopedDraftReview(receiverStagedDrafts.length, receiverInvalidDrafts.length)}>
                              {parameterDraftById.get(modeChannelParameter.id)?.status ?? 'unchanged'}
                            </StatusBadge>
                          </div>

                          <div className="config-pills">
                            <span>Current: {formatArducopterFlightModeChannel(configuredModeChannel)}</span>
                            {receiverLinkPorts.length > 0
                              ? receiverLinkPorts.map((port) => <span key={`receiver-link:${port.portNumber}`}>{port.label}: {port.protocolLabel}</span>)
                              : <span>Receiver link assigned from Ports</span>}
                          </div>

                          <ScopedSelectField
                            parameter={modeChannelParameter}
                            liveValue={configuredModeChannel}
                            editedValues={editedValues}
                            onChange={(paramId, value) => setDraft(paramId, value)}
                            draftStatusById={parameterDraftById}
                          />
                        </div>
                      ) : null}

                      {rcOptionsParameter ? (
                        <div className="scoped-review-card scoped-review-card--compact" data-testid="receiver-rc-options">
                          <div className="switch-exercise-card__header">
                            <div>
                              <strong>RC options</strong>
                              <p>Advanced receiver behavior (RC_OPTIONS). Leave these off unless a specific receiver/setup needs them.</p>
                            </div>
                            <StatusBadge tone={toneForScopedDraftReview(receiverStagedDrafts.length, receiverInvalidDrafts.length)}>
                              {parameterDraftById.get(rcOptionsParameter.id)?.status ?? 'unchanged'}
                            </StatusBadge>
                          </div>
                          <ScopedBitmaskField
                            parameter={rcOptionsParameter}
                            liveValue={rcOptionsParameter.value}
                            editedValues={editedValues}
                            onChange={(paramId, value) => setDraft(paramId, value)}
                            draftStatusById={parameterDraftById}
                          />
                        </div>
                      ) : null}
                    </div>

                    {modeAssignmentParameters.length > 0 ? (
                      <div className="scoped-review-card scoped-review-card--compact">
                        <div className="switch-exercise-card__header">
                          <div>
                            <strong>Flight mode assignments</strong>
                            <p>Edit the configured switch positions here, then apply them from the same Receiver workflow.</p>
                          </div>
                          <StatusBadge tone={modeExerciseAssignments.length >= 2 ? 'success' : 'warning'}>
                            {modeExerciseAssignments.length >= 2 ? `${modeExerciseAssignments.length} distinct positions` : 'Review needed'}
                          </StatusBadge>
                        </div>

                        <div className="scoped-editor-grid">
                          {modeAssignmentParameters.map((parameter) => (
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

                        <div className="config-pills">
                          {modeAssignments.map((assignment) => (
                            <span
                              key={assignment.slot}
                              className={assignment.slot === modeSwitchEstimate.estimatedSlot ? 'is-active' : undefined}
                            >
                              {modeSlotParamId(snapshot.vehicle?.vehicle, assignment.slot)} = {formatModeAssignment(assignment.value, snapshot.vehicle?.vehicle)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {activeReceiverTaskId === 'advanced' ? (
                  <div className="receiver-task-panel receiver-task-panel--stack">
                    {rssiTypeParameter || rssiChannelParameter || rssiChannelLowParameter || rssiChannelHighParameter ? (
                      <div className="scoped-review-card scoped-review-card--compact">
                        <div className="switch-exercise-card__header">
                          <div>
                            <strong>Receiver signal setup</strong>
                            <p>RSSI configuration and receiver-link interpretation stay available here without crowding the main setup path.</p>
                          </div>
                          <StatusBadge tone={toneForScopedDraftReview(receiverStagedDrafts.length, receiverInvalidDrafts.length)}>
                            {receiverInvalidDrafts.length > 0
                              ? `${receiverInvalidDrafts.length} invalid`
                              : receiverStagedDrafts.length > 0
                                ? `${receiverStagedDrafts.length} staged`
                                : 'in sync'}
                          </StatusBadge>
                        </div>

                        <div className="config-pills">
                          <span>RSSI source: {formatArducopterRssiType(rssiType)}</span>
                          <span>Live RX RSSI: {formatRxRssi(snapshot.liveVerification.rcInput.rssi)}</span>
                          {receiverLinkPorts.length > 0
                            ? receiverLinkPorts.map((port) => <span key={`receiver-link:${port.portNumber}`}>{port.label}: {port.protocolLabel}</span>)
                            : <span>No receiver serial link detected in current port roles</span>}
                        </div>

                        <div className="scoped-editor-grid">
                          {rssiTypeParameter ? (
                            <ScopedSelectField
                              parameter={rssiTypeParameter}
                              liveValue={rssiType}
                              editedValues={editedValues}
                              onChange={(paramId, value) => setDraft(paramId, value)}
                              draftStatusById={parameterDraftById}
                            />
                          ) : null}

                          {rssiChannelParameter ? (
                            <ScopedField
                              parameter={rssiChannelParameter}
                              liveValue={rssiChannel}
                              editedValues={editedValues}
                              onChange={(paramId, value) => setDraft(paramId, value)}
                              draftStatusById={parameterDraftById}
                            />
                          ) : null}

                          {rssiChannelLowParameter ? (
                            <ScopedField
                              parameter={rssiChannelLowParameter}
                              liveValue={rssiChannelLow}
                              editedValues={editedValues}
                              onChange={(paramId, value) => setDraft(paramId, value)}
                              draftStatusById={parameterDraftById}
                            />
                          ) : null}

                          {rssiChannelHighParameter ? (
                            <ScopedField
                              parameter={rssiChannelHighParameter}
                              liveValue={rssiChannelHigh}
                              editedValues={editedValues}
                              onChange={(paramId, value) => setDraft(paramId, value)}
                              draftStatusById={parameterDraftById}
                            />
                          ) : null}
                        </div>

                        <ul className="output-note-list">
                          <li>Receiver serial protocol is usually assigned from Ports; this card covers the receiver-side interpretation of that link.</li>
                          <li>After changing RSSI settings, rerun the RC verification flow before flight.</li>
                        </ul>
                      </div>
                    ) : null}

                    {renderAdditionalSettingsCard(
                      'Additional receiver settings',
                      'These metadata-backed receiver and mode settings remain available here without forcing you into raw Parameters.',
                      receiverAdditionalGroups,
                      receiverAdditionalDraftEntries,
                      receiverAdditionalStagedDrafts,
                      receiverAdditionalInvalidDrafts,
                      'receiver:additional',
                      'Apply Additional Receiver Changes',
                      'additional receiver settings'
                    )}
                  </div>
                ) : null}

                {activeReceiverTaskId === 'review' ? (
                  <div className="receiver-task-panel receiver-task-panel--stack">
                    <div className="scoped-review-card">
                      <div className="switch-exercise-card__header">
                        <div>
                          <strong>Receiver & mode changes in review</strong>
                          <p>
                            Keep RC mapping, calibration, and flight-mode work local to this view. Apply verified changes here instead of
                            jumping to Parameters.
                          </p>
                        </div>
                        <StatusBadge tone={toneForScopedDraftReview(receiverStagedDrafts.length, receiverInvalidDrafts.length)}>
                          {receiverInvalidDrafts.length > 0
                            ? `${receiverInvalidDrafts.length} invalid`
                            : receiverStagedDrafts.length > 0
                              ? `${receiverStagedDrafts.length} staged`
                              : 'in sync'}
                        </StatusBadge>
                      </div>

                      {receiverDraftEntries.length > 0 ? (
                        <div className="scoped-draft-list">
                          {receiverDraftEntries.map((draft) => (
                            <article key={draft.id} className={`scoped-draft-item scoped-draft-item--${draft.status}`}>
                              <div className="scoped-draft-item__header">
                                <strong>{draft.id}</strong>
                                <StatusBadge tone={toneForParameterDraftStatus(draft.status)}>{draft.status}</StatusBadge>
                              </div>
                              <p>{draft.label}</p>
                              <small>
                                {draft.status === 'staged'
                                  ? `${formatParameterValue(draft.currentValue, draft.definition?.unit)} to ${formatParameterValue(
                                      draft.nextValue,
                                      draft.definition?.unit
                                    )}`
                                  : draft.reason ?? 'Draft matches the live controller value.'}
                              </small>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="success-copy">No receiver-specific parameter changes are currently staged.</p>
                      )}

                      <div className="switch-exercise-controls">
                        <button
                          style={buttonStyle('primary')}
                          onClick={() =>
                            void handleApplyScopedParameterDrafts(receiverDraftEntries, 'receiver:apply', 'Receiver setup')
                          }
                          disabled={
                            busyAction !== undefined ||
                            receiverStagedDrafts.length === 0 ||
                            receiverInvalidDrafts.length > 0 ||
                            !canApplyDraftParameters
                          }
                        >
                          {busyAction === 'receiver:apply' ? 'Applying…' : `Apply Receiver Changes (${receiverStagedDrafts.length})`}
                        </button>
                        <button
                          style={buttonStyle()}
                          onClick={() =>
                            handleDiscardScopedParameterDrafts(receiverDraftEntries.map((entry) => entry.id), 'receiver')
                          }
                          disabled={busyAction !== undefined || receiverDraftEntries.length === 0}
                        >
                          Discard Receiver Changes
                        </button>
                      </div>
                    </div>

                    {(receiverAdvancedDraftCount > 0 || receiverAdvancedInvalidCount > 0) ? (
                      <div className="receiver-inline-toggle receiver-inline-toggle--review">
                        <div>
                          <strong>Advanced receiver settings also changed</strong>
                          <p>
                            {receiverAdvancedInvalidCount > 0
                              ? `${receiverAdvancedInvalidCount} advanced setting${receiverAdvancedInvalidCount === 1 ? '' : 's'} still need attention.`
                              : `${receiverAdvancedDraftCount} advanced receiver change${receiverAdvancedDraftCount === 1 ? '' : 's'} are staged in Signal Setup.`}
                          </p>
                        </div>
                        <button
                          style={buttonStyle()}
                          onClick={() => setReceiverTaskOverride('advanced')}
                        >
                          Open Signal Setup
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
            </>
          }
          helpDockSlot={
            receiverHasPendingReview ? (
              <div className="receiver-review-dock">
                <div className="receiver-review-dock__summary">
                  <strong>Receiver changes pending</strong>
                  <div className="config-pills">
                    {receiverWorkflowDraftCount > 0 ? <span>{receiverWorkflowDraftCount} workflow staged</span> : null}
                    {receiverWorkflowInvalidCount > 0 ? <span className="is-pending">{receiverWorkflowInvalidCount} workflow invalid</span> : null}
                    {receiverAdvancedDraftCount > 0 ? <span>{receiverAdvancedDraftCount} advanced staged</span> : null}
                    {receiverAdvancedInvalidCount > 0 ? <span className="is-pending">{receiverAdvancedInvalidCount} advanced invalid</span> : null}
                  </div>
                </div>

                <div className="receiver-review-dock__actions">
                  <button
                    style={buttonStyle()}
                    onClick={() => setReceiverTaskOverride('review')}
                  >
                    Open Review
                  </button>
                  {(receiverAdvancedDraftCount > 0 || receiverAdvancedInvalidCount > 0) ? (
                    <button
                      style={buttonStyle()}
                      onClick={() => setReceiverTaskOverride('advanced')}
                    >
                      Open Signal Setup
                    </button>
                  ) : null}
                  <button
                    data-testid="receiver-apply-button"
                    style={buttonStyle('primary')}
                    onClick={() =>
                      void handleApplyScopedParameterDrafts(receiverDraftEntries, 'receiver:apply', 'Receiver setup')
                    }
                    disabled={
                      busyAction !== undefined ||
                      receiverStagedDrafts.length === 0 ||
                      receiverInvalidDrafts.length > 0 ||
                      !canApplyDraftParameters
                    }
                  >
                    {busyAction === 'receiver:apply' ? 'Applying…' : `Apply Receiver Changes (${receiverStagedDrafts.length})`}
                  </button>
                </div>
              </div>
            ) : null
          }
        />
  )
}
