// ReceiverSection — App.tsx's `activeViewId === 'receiver'` block, one page:
// the RCMAP picks beside the channel-direction check, a table with one row
// per reported channel (function, live bar with the endpoint ticks, reverse,
// endpoints), the flight-mode selects with the arm switch, an Advanced
// disclosure (RSSI, RC options, protocols, input rate) and the one apply dock.
// The former sub-tabs (Mapping / Endpoints / Flight Modes / Functions /
// Signal Setup) survive as section ids the wizard and the jump row route to.
// Explanatory copy lives in each card's "i" dot; state (exercise status,
// guard reasons, verdicts, warnings) stays inline.
//
// The receiver hook results are passed as grouped props typed via
// `ReturnType<typeof useX>` so the prop shapes are INFERRED from the hooks
// and cannot drift. Scalar derivations, edit plumbing, and handler bodies
// stay in App.tsx and are threaded through here.

import { useEffect, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { ConfiguratorSnapshot, ParameterDraftEntry, ParameterState, RcAxisId } from '@arduconfig/ardupilot-core'
import {
  deriveAirframe,
  deriveModeAssignments,
  deriveModeExerciseAssignments,
  deriveModeSwitchEstimate,
  deriveRcAxisChannelMap,
  deriveRcAxisObservations,
  formatRcAxisLabel
} from '@arduconfig/ardupilot-core'
import { formatArducopterRssiType } from '@arduconfig/param-metadata'
import { StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { armSwitchChannelOptions, isArmSwitchHighlightActive, type ArmSwitchAssignment } from '../view-models/arm-switch'
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
import { RcChannelBarStyles, RcChannelTrack } from '../rc-channel-bars'
import { selectParameterById } from '../selectors/parameter-read'
import { RC_DIRECTION_PROMPTS, type RcDirectionResult } from '../view-models/receiver-direction-check'
import {
  CRSF_RC_CENTER_US,
  CRSF_RC_MAX_US,
  CRSF_RC_MIN_US,
  assessTransmitterCalibration,
  buildCrsfEndpointDrafts,
  detectRcLinkProtocol,
  withRcChannelOptions
} from '../view-models/receiver-channels'
import { RC_CALIBRATION_AXIS_ORDER, rcCalibrationCaptureComplete } from '../setup-exercise-helpers'
import { StickCraftPreview } from '../preview-components'
import { formatRxRssi } from '../status-formatters'
import { toneForModeSwitchExercise } from '../tone-helpers'
import { InfoDot } from '../views/InfoDot'
import { ReceiverView, receiverSectionElementId, type ReceiverTaskId } from '../views/Receiver'
import { ScopedBitmaskField, ScopedCheckboxField, ScopedField, ScopedNumberField, ScopedSelectField } from '../views/ScopedField'

const RCMAP_PARAM_IDS: Record<RcAxisId, string> = {
  roll: 'RCMAP_ROLL',
  pitch: 'RCMAP_PITCH',
  throttle: 'RCMAP_THROTTLE',
  yaw: 'RCMAP_YAW'
}

export interface ReceiverSectionDerived {
  airframe: ReturnType<typeof deriveAirframe>
  rcAxisObservations: ReturnType<typeof deriveRcAxisObservations>
  currentRcAxisChannelMap: ReturnType<typeof deriveRcAxisChannelMap>
  modeSwitchEstimate: ReturnType<typeof deriveModeSwitchEstimate>
  modeExerciseAssignments: ReturnType<typeof deriveModeExerciseAssignments>
  modeAssignments: ReturnType<typeof deriveModeAssignments>
  modeSwitchExercise: ReturnType<typeof useSetupExercises>['modeSwitchExercise']
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
  /** True once RC5_OPTION metadata is synced — proves this firmware exposes
   *  RCn_OPTION at all, so the Arm switch card has something to bind to. */
  armSwitchAvailable: boolean
  armSwitchAssignment: ArmSwitchAssignment
  /** RC Mixer (AP_RC_Logic) function labels per channel, so aux-channel cards
   *  and the arm-switch card can warn that a channel already carries an RCL
   *  term (the reverse of the RC Mixer's own "also used by" badge). */
  rcLogicChannelClaims?: ReadonlyMap<number, readonly string[]>
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
  /** Stage several drafts at once (the CRSF endpoint set). Same pool as setDraft. */
  mergeDrafts: (drafts: Record<string, string>) => void
  setReceiverTaskOverride: (taskId: import('../views/Receiver').ReceiverTaskId) => void
  handleSetArmSwitchChannel: (channel: number, airmode: boolean) => void
}

export interface ReceiverSectionProps {
  snapshot: ConfiguratorSnapshot
  canApplyDraftParameters: boolean
  busyAction: string | undefined
  /** Send MAV_CMD_START_RX_PAIR to bind the RC receiver (ELRS/CRSF). */
  onBindReceiver: () => void
  /** Latched per-axis channel-direction verdicts (computed in App so the
   *  Endpoints card and the guided-setup radio gate share one result). */
  rcDirectionResults: Record<RcAxisId, RcDirectionResult>
  /** The axis whose stick is deflected right now — highlights its row + is what
   *  the reacting example craft is showing. Momentary, not latched. */
  rcDirectionActiveAxis: RcAxisId | undefined
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

/** Scroll a section into view. `nearest` for a route that arrives with the
 *  page (the wizard's deep link lands on a page that usually fits the screen,
 *  so nothing moves); `start` for a jump link the operator clicked. */
function scrollToReceiverSection(taskId: ReceiverTaskId, block: ScrollLogicalPosition): void {
  document.getElementById(receiverSectionElementId(taskId))?.scrollIntoView({ block, behavior: 'smooth' })
}

interface EndpointReading {
  live: number | undefined
  /** The value as the operator sees it: a staged draft wins over the live one. */
  shown: number | undefined
  staged: boolean
}

export function ReceiverSection(props: ReceiverSectionProps): ReactElement {
  const {
    snapshot,
    canApplyDraftParameters,
    busyAction,
    onBindReceiver,
    rcDirectionResults,
    rcDirectionActiveAxis,
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

  // Bind button hidden for now (the runtime capability + onBindReceiver wiring
  // stay intact, so flip this to re-surface it). See the receiver-bind-action
  // block below.
  const SHOW_RECEIVER_BIND_BUTTON: boolean = false

  // Brief visual confirmation that the bind command was sent — the action is
  // fire-and-forget, so the button flips to the accent colour (and "Bind sent")
  // for ~1.6s on click, then reverts.
  const [bindFlash, setBindFlash] = useState(false)
  // The dock's per-draft list (id, old → new) is behind Show changes: the
  // count and the buttons are what the bar is for; the list is on request.
  const [showDockDrafts, setShowDockDrafts] = useState(false)
  // Advanced (RSSI, RC options, protocols, input rate) is closed until the
  // operator opens it, the wizard routes to it, or a draft inside it is
  // invalid — an invalid draft blocks Apply and must not hide in a closed box.
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // Phone layout: a row's endpoint pills sit behind a per-row tap.
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<number>>(() => new Set())
  useEffect(() => {
    if (!bindFlash) {
      return
    }
    const timer = setTimeout(() => setBindFlash(false), 1600)
    return () => clearTimeout(timer)
  }, [bindFlash])

  const { rcMappingSession, rcCalibrationSession } = rcExercises

  const { receiverPrimaryChannelDisplays, receiverAuxChannelDisplays } = receiverChannelDisplays

  const {
    rcMappingCandidate,
    rcMappingLiveCandidates,
    rcMappingTargetGuide,
    rcMappingCandidateConfidence,
    rcMappingRejectedReason,
    rcMappingStagedChangeCount,
    rcMappingAutoCaptureKey,
    rcMappingAutoCaptureProgressPercent
  } = rcMappingDerivations

  const { rcCalibrationSummary } = rcCalibrationDerivations

  const { activeReceiverTaskId, receiverTaskCards, activeReceiverTask, receiverTaskOverride } = receiverTasks

  const {
    modeChannelParameter,
    rssiTypeParameter,
    rssiChannelParameter,
    rssiChannelLowParameter,
    rssiChannelHighParameter,
    rcOptionsParameter,
    receiverSupportParameterById,
    rcFunctionRows,
    rcFunctionAssigned,
    rcFunctionConflicts
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
    modeExerciseAssignments,
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
    receiverHasPendingReview,
    receiverAdvancedInvalidCount,
    armSwitchAvailable,
    armSwitchAssignment,
    rcLogicChannelClaims
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
    mergeDrafts,
    setReceiverTaskOverride,
    handleSetArmSwitchChannel
  } = handlers

  // A route (jump link, wizard deep link, mapping completion) scrolls to its
  // section; the recommendation never does. Advanced opens when routed to, so
  // the deep link does not land on a closed box.
  useEffect(() => {
    if (!receiverTaskOverride) {
      return
    }
    if (receiverTaskOverride === 'advanced') {
      setAdvancedOpen(true)
    }
    const timer = window.setTimeout(() => scrollToReceiverSection(receiverTaskOverride, 'nearest'), 80)
    return () => window.clearTimeout(timer)
  }, [receiverTaskOverride])
  useEffect(() => {
    if (receiverAdvancedInvalidCount > 0) {
      setAdvancedOpen(true)
    }
  }, [receiverAdvancedInvalidCount])

  const handleSelectTask = (taskId: ReceiverTaskId): void => {
    setReceiverTaskOverride(taskId)
    if (taskId === 'advanced') {
      setAdvancedOpen(true)
    }
    scrollToReceiverSection(taskId, 'start')
  }

  // Arm-switch red box: the live PWM on the assigned arm-switch channel (0xffff
  // = the RC_CHANNELS no-data sentinel), and whether the vehicle is armed via
  // that switch (armed + channel in the arm/high position).
  const armSwitchChannelPwm =
    armSwitchAssignment.channel !== undefined
      ? snapshot.liveVerification.rcInput.channels[armSwitchAssignment.channel - 1]
      : undefined
  const armSwitchHighlightActive = isArmSwitchHighlightActive(
    armSwitchAssignment,
    Boolean(snapshot.vehicle?.armed),
    armSwitchChannelPwm === undefined || armSwitchChannelPwm === 0xffff ? undefined : armSwitchChannelPwm
  )

  // The four RCMAP_* pickers: a channel dropdown over the live parameter.
  const rcmapParameters = useMemo(
    () =>
      Object.fromEntries(
        RC_CALIBRATION_AXIS_ORDER.map((axisId) => {
          const parameter = selectParameterById(snapshot, RCMAP_PARAM_IDS[axisId])
          return [axisId, parameter ? withRcChannelOptions(parameter) : undefined]
        })
      ) as Record<RcAxisId, ParameterState | undefined>,
    [snapshot]
  )
  // The channel an axis is mapped to as the operator sees it: a staged RCMAP
  // pick wins over the live map, so the channel row's role follows the pick.
  const mappedChannel = (axisId: RcAxisId): number => {
    const edited = editedValues[RCMAP_PARAM_IDS[axisId]]
    const editedNumber = edited !== undefined ? Number(edited) : NaN
    return Number.isInteger(editedNumber) && editedNumber >= 1 && editedNumber <= 16
      ? editedNumber
      : currentRcAxisChannelMap[axisId]
  }

  const rcLinkProtocol = detectRcLinkProtocol({
    rcProtocolsMask: selectParameterById(snapshot, 'RC_PROTOCOLS')?.value,
    statusTexts: snapshot.statusTexts
  })
  const crsfLink = rcLinkProtocol === 'crsf'

  // One apply bar for the whole tab: workflow drafts (mapping, endpoints,
  // modes, functions, RSSI) and the Signal Setup extras. The two scopes are
  // disjoint, so the concatenation has no duplicates.
  const allReceiverDrafts = useMemo(
    () =>
      [...receiverDraftEntries, ...receiverAdditionalDraftEntries].filter(
        // An edit that matches the live value is nothing to apply or list.
        (entry) => entry.status !== 'unchanged'
      ),
    [receiverAdditionalDraftEntries, receiverDraftEntries]
  )
  const allStagedCount = receiverStagedDrafts.length + receiverAdditionalStagedDrafts.length
  const allInvalidCount = receiverInvalidDrafts.length + receiverAdditionalInvalidDrafts.length

  const renderReverseField = (channelNumber: number, testId: string): ReactNode => {
    const parameter = selectParameterById(snapshot, `RC${channelNumber}_REVERSED`)
    if (!parameter) {
      return null
    }
    return (
      <ScopedCheckboxField
        parameter={parameter}
        liveValue={parameter.value}
        editedValues={editedValues}
        onChange={(paramId, value) => setDraft(paramId, value)}
        draftStatusById={parameterDraftById}
        testId={testId}
        caption=""
        showTitle={false}
      />
    )
  }

  const endpointReading = (paramId: string): EndpointReading => {
    const parameter = selectParameterById(snapshot, paramId)
    if (!parameter) {
      return { live: undefined, shown: undefined, staged: false }
    }
    const edited = editedValues[paramId]
    const editedNumber = edited !== undefined && edited !== '' ? Number(edited) : NaN
    const hasEdit = Number.isFinite(editedNumber)
    return {
      live: parameter.value,
      shown: hasEdit ? editedNumber : parameter.value,
      staged: hasEdit && editedNumber !== parameter.value
    }
  }

  const calibrationTone = toneForModeSwitchExercise(
    rcCalibrationSession.status === 'ready' ? 'passed' : rcCalibrationSession.status === 'capturing' ? 'running' : rcCalibrationSession.status === 'failed' ? 'failed' : 'idle'
  )

  // The channel rows: every channel the monitor showed at a glance (mapped
  // axes, live PWM, assigned functions, the mode switch), plus the silent
  // spares behind Show AUX Channels. Never bounded by RC_CHANNELS.chancount,
  // which under-reports; the displays already cover the reported channels.
  const channelDisplays = useMemo(
    () =>
      [...receiverPrimaryChannelDisplays, ...(showReceiverChannelDetails ? receiverAuxChannelDisplays : [])].sort(
        (left, right) => left.channelNumber - right.channelNumber
      ),
    [receiverAuxChannelDisplays, receiverPrimaryChannelDisplays, showReceiverChannelDetails]
  )
  const rcVerified = snapshot.liveVerification.rcInput.verified
  const toggleRowExpanded = (channelNumber: number): void => {
    setExpandedRows((existing) => {
      const next = new Set(existing)
      if (next.has(channelNumber)) {
        next.delete(channelNumber)
      } else {
        next.add(channelNumber)
      }
      return next
    })
  }


  // The direction check's craft. The verdicts themselves sit on the mapped
  // channels' rows in the table (see the Direction column); the reacting
  // craft keeps its place in the map line so the operator still sees the
  // airframe answer the stick. Same observations, same verdict and stick-
  // craft maths (a safety verdict with a documented history).
  const directionCraft = (
    <div className="rc-direction-craft receiver-map__craft" data-testid="receiver-direction-craft">
      <div className="receiver-stick-craft" data-testid="receiver-stick-craft-card">
        <StickCraftPreview
          observations={rcAxisObservations}
          snapshot={snapshot}
          verified={rcVerified}
          vehicleType={snapshot.vehicle?.vehicle}
          frameClassLabel={airframe.frameClassLabel}
          frameTypeLabel={airframe.frameTypeLabel}
          mini
        />
      </div>
    </div>
  )
  const directionSlot = null

  // The map is one line: title, the four picks, the buttons that apply when
  // no capture is running, the status. A running capture adds its strips and
  // its controls under that line, across the full width.
  const mapSlot = (
    <div className="rc-mapping-card receiver-map" id={receiverSectionElementId('mapping')} data-testid="receiver-mapping-card">
      {directionCraft}
      <div className="receiver-map__line">
        <div className="receiver-map__title switch-exercise-card__header">
          <div>
            <strong>Map</strong>
            <InfoDot label="About channel mapping" wide>
              Which receiver channel carries roll, pitch, throttle and yaw (RCMAP_*). Pick each channel here, or run
              the guided capture: move one stick at a time, the app locks onto the channel that moves alone and stages
              the detected map. A channel the flight controller reads backwards gets its Reverse box ticked in the
              Channels table; the direction check under this finds those for you. RCMAP changes take effect after a
              reboot.
            </InfoDot>
          </div>
        </div>

        <div className="receiver-map-grid" data-testid="receiver-map-grid">
          {RC_CALIBRATION_AXIS_ORDER.map((axisId) => {
            const capture = rcMappingSession.captures[axisId]
            const activeTarget = rcMappingSession.status === 'running' && rcMappingSession.currentTargetAxis === axisId
            const detected = capture.detectedChannelNumber
            const rcmap = rcmapParameters[axisId]
            const channel = mappedChannel(axisId)
            // Short, so the label column stays narrow and the pick keeps its
            // width: the focus strip above carries the full instruction.
            // Only while a capture runs: afterwards the pick itself shows the
            // channel, and "Found CH2" under a pick that says CH2 said nothing.
            const detail =
              rcMappingSession.status !== 'running'
                ? ''
                : activeTarget
                  ? rcMappingCandidate
                    ? `Locking CH${rcMappingCandidate.channelNumber}`
                    : 'Move now'
                  : detected !== undefined
                    ? `Found CH${detected}`
                    : 'Pending'
            return (
              <div
                key={axisId}
                className={`receiver-map-row${activeTarget ? ' receiver-map-row--target' : ''}${detected !== undefined ? ' receiver-map-row--complete' : ''}`}
                data-testid={`receiver-map-${axisId}`}
              >
                <span className="receiver-map-row__axis">
                  <strong>{formatRcAxisLabel(axisId)}</strong>
                  {detail ? <small>{detail}</small> : null}
                </span>
                {rcmap ? (
                  <ScopedSelectField
                    parameter={rcmap}
                    liveValue={currentRcAxisChannelMap[axisId]}
                    editedValues={editedValues}
                    onChange={(paramId, value) => setDraft(paramId, value)}
                    draftStatusById={parameterDraftById}
                  />
                ) : (
                  <span className="receiver-map-row__fixed">CH{channel}</span>
                )}
              </div>
            )
          })}
        </div>

        {rcMappingSession.status !== 'running' ? (
          <div className="receiver-map__actions">
            <button
              style={buttonStyle('primary')}
              data-testid="receiver-mapping-start"
              onClick={handleStartRcMappingExercise}
              disabled={!canRunRcMappingExercise}
            >
              {rcMappingSession.status === 'ready' ? 'Run Guided Mapping Again' : 'Begin Guided Mapping'}
            </button>
            {rcMappingSession.status === 'ready' && rcMappingStagedChangeCount > 0 ? (
              <button
                style={buttonStyle('secondary')}
                data-testid="receiver-mapping-stage"
                onClick={handleStageRcMappingDrafts}
              >
                {`Stage Detected Mapping (${rcMappingStagedChangeCount})`}
              </button>
            ) : null}
            {rcMappingSession.status !== 'idle' ? (
              <button style={buttonStyle()} onClick={handleResetRcMappingExercise}>
                Start Over
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {rcMappingSession.status === 'running' ? (
        <div className="rc-mapping-focus rc-mapping-focus--active" data-testid="receiver-mapping-focus">
          <div className="rc-mapping-focus__copy">
            <strong>{rcMappingTargetGuide.title}</strong>
            <p>{rcMappingTargetGuide.detail}</p>
          </div>
          <div className="rc-mapping-focus__status">
            <StatusBadge tone={rcMappingCandidateConfidence.tone}>
              {`${rcMappingCandidateConfidence.label} detection`}
            </StatusBadge>
          </div>
        </div>
      ) : null}

      {/* Second row: the buttons, then the outcome as one line. */}
      <div className="receiver-map__footer">
        {rcMappingSession.status === 'ready' ? (
          <p className="receiver-map__result" data-testid="receiver-mapping-focus">
            <strong>Roll, pitch, throttle and yaw identified.</strong>{' '}
            {rcMappingStagedChangeCount > 0
              ? `${rcMappingStagedChangeCount} RCMAP change${rcMappingStagedChangeCount === 1 ? '' : 's'} staged. Apply below, then reboot.`
              : 'The current map already matches the sticks.'}
          </p>
        ) : null}
        {rcMappingSession.status === 'failed' && rcMappingSession.failureReason ? (
          <p className="switch-exercise-warning">{rcMappingSession.failureReason}</p>
        ) : null}
      </div>

      {rcMappingCandidate ? (
        <div key={rcMappingAutoCaptureKey} className="rc-mapping-auto-capture">
          <div className="rc-mapping-auto-capture__copy">
            <strong>Locking onto CH{rcMappingCandidate.channelNumber}</strong>
            <small>Keep moving it; the channel captures on its own.</small>
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

      {rcMappingSession.status === 'running' && showReceiverMappingDiagnostics ? (
        <div className="rc-mapping-candidate-panel">
          <div className="rc-mapping-candidate-panel__header">
            <strong>Live candidates</strong>
            <small>Channel movement against the baseline captured when the exercise started.</small>
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

      {rcMappingSession.status === 'running' ? (
      <div className="switch-exercise-controls receiver-map__controls">
          <button
            style={buttonStyle('secondary')}
            onClick={handleConfirmRcMappingCandidate}
            disabled={rcMappingCandidate === undefined}
          >
            {rcMappingCandidate && rcMappingSession.currentTargetAxis
              ? `Capture CH${rcMappingCandidate.channelNumber} for ${formatRcAxisLabel(rcMappingSession.currentTargetAxis)}`
              : 'Capture Current Channel'}
          </button>
          <button
            style={buttonStyle()}
            onClick={() => setShowReceiverMappingDiagnostics((existing) => !existing)}
          >
            {showReceiverMappingDiagnostics ? 'Hide Detection Details' : 'Show Detection Details'}
          </button>
          <button style={buttonStyle()} onClick={handleResetRcMappingExercise}>
            Start Over
          </button>
          <button style={buttonStyle('secondary')} onClick={handleFailRcMappingExercise}>
            Can’t Isolate Axis
          </button>
      </div>
      ) : null}

      {SHOW_RECEIVER_BIND_BUTTON ? (
        <div className="receiver-bind-action" data-testid="receiver-bind-action">
          <button
            type="button"
            data-testid="receiver-bind-button"
            style={{
              ...buttonStyle(),
              ...(bindFlash
                ? { background: 'var(--accent, #ffbb00)', borderColor: 'var(--accent, #ffbb00)', color: '#10151c' }
                : {})
            }}
            disabled={snapshot.connection.kind !== 'connected' || busyAction !== undefined}
            onClick={() => {
              onBindReceiver()
              setBindFlash(true)
            }}
          >
            {bindFlash ? 'Bind sent ✓' : 'Bind RX (ELRS / CRSF)'}
          </button>
          {/* The shared InfoDot rather than a hand-rolled copy of its
              markup: the copy could not carry the wiki link, and being
              aria-hidden it hid the only explanation of what Bind does
              from screen-reader users entirely. */}
          <InfoDot label="About binding an ELRS / CRSF receiver" testId="receiver-bind-info" wikiTopic="receiverBind">
            Tells ArduPilot to send the bind command to the receiver (MAV_CMD_START_RX_PAIR).
            Put your transmitter / ELRS module into bind mode too; the receiver LED confirms pairing.
            ELRS receivers with a bind phrase set ignore this — bind by phrase or power-cycle instead.
          </InfoDot>
        </div>
      ) : null}
    </div>
  )


  const renderDirectionCell = (channelNumber: number): ReactNode => {
    const observation = rcAxisObservations.find((entry) => entry.channelNumber === channelNumber)
    if (!observation) {
      return <span className="receiver-channel-row__direction" aria-hidden="true" />
    }
    const result = rcDirectionResults[observation.axisId]
    const active = rcDirectionActiveAxis === observation.axisId
    return (
      <span
        className={`receiver-channel-row__direction rc-direction-row--${result}${active ? ' rc-direction-row--active' : ''}`}
        data-testid={`receiver-direction-${observation.axisId}`}
        title={RC_DIRECTION_PROMPTS[observation.axisId].movement}
      >
        <span className="rc-direction-row__verdict" data-testid={`receiver-direction-result-${observation.axisId}`}>
          {result === 'correct' ? '✓ correct' : result === 'reversed' ? '⚠ backwards, tick Reverse' : '— move to test'}
        </span>
      </span>
    )
  }

  // Per-axis CRSF calibration warnings: the stick fell short of the fixed
  // CRSF range, which the radio fixes, not these parameters.
  const calibrationWarnings = crsfLink
    ? RC_CALIBRATION_AXIS_ORDER.flatMap((axisId) => {
        const capture = rcCalibrationSession.captures[axisId]
        const observation = rcAxisObservations.find((obs) => obs.axisId === axisId)
        const channelNumber = capture.channelNumber || observation?.channelNumber || currentRcAxisChannelMap[axisId]
        const warning = assessTransmitterCalibration({
          channelNumber,
          observedMin: capture.observedMin,
          observedMax: capture.observedMax,
          centerPwm: axisId === 'throttle' ? undefined : capture.trimPwm,
          complete: rcCalibrationCaptureComplete(capture)
        })
        return warning ? [{ axisId, warning }] : []
      })
    : []

  const channelsSlot = (
    <div className="rc-calibration-card receiver-channels" id={receiverSectionElementId('endpoints')} data-testid="receiver-endpoints-card">
      <div className="switch-exercise-card__header">
        <div>
          <strong>Channels</strong>
          <InfoDot label="About the channel table" wide>
            One row per channel the receiver reports. Function is what the channel does (RCn_OPTION; the stick axes
            are fixed by the map above). The bar is the live input on the 900 to 2100 µs scale with the stored
            endpoints as ticks: the stick should reach both. Reverse ticks RCn_REVERSED for a channel the flight
            controller reads backwards.{' '}
            {crsfLink
              ? `CRSF has a fixed range, ${CRSF_RC_MIN_US} to ${CRSF_RC_MAX_US} µs with centre ${CRSF_RC_CENTER_US}: Set CRSF Limits stages it for every channel, and Check Sticks confirms the radio reaches it. A stick that falls short is fixed on the radio.`
              : 'Start the capture with the sticks centred and throttle low, move roll, pitch, throttle and yaw through their full travel, and flick the CH5/CH6 switches low and high if you use them. Stage the captured values, then apply them below.'}
          </InfoDot>
        </div>
        <StatusBadge tone={calibrationTone}>
          {rcCalibrationSession.status === 'ready' ? 'endpoints complete' : rcCalibrationSession.status === 'idle' ? `${rcFunctionAssigned} functions assigned` : rcCalibrationSession.status}
        </StatusBadge>
      </div>

      <div className="receiver-channel-table" data-testid="receiver-functions-panel">
        <span data-testid="receiver-direction-check" className="receiver-direction-anchor" aria-hidden="true" />
        <RcChannelBarStyles />
        <div className="receiver-channel-head" aria-hidden="true">
          <span>CH</span>
          <span>Function</span>
          <span className="receiver-channel-head__scale">
            900<i>/</i>1500<i>/</i>2100
          </span>
          <span className="receiver-channel-head__value">µs</span>
          <span className="receiver-channel-head__direction">Direction</span>
          <span className="receiver-channel-head__reverse">
            Reverse
            <InfoDot label="About reverse" wide>
              RCn_REVERSED. Tick it when the flight controller reads the channel backwards; the direction column
              says which. Staged like every other change.
            </InfoDot>
          </span>
          <span className="receiver-channel-head__endpoints">Low · Trim · High (µs)</span>
        </div>
        <div className="receiver-channel-rows" data-testid="receiver-channel-bars">
          {channelDisplays.map((display) => {
            const channelNumber = display.channelNumber
            const axes = RC_CALIBRATION_AXIS_ORDER.filter((axisId) => mappedChannel(axisId) === channelNumber)
            const axisId = axes[0]
            const functionRow = rcFunctionRows.find((row) => row.channelNumber === channelNumber)
            const functionParameter = functionRow ? receiverSupportParameterById.get(functionRow.paramId) : undefined
            const conflict = (functionRow?.duplicateChannels.length ?? 0) > 0
            const hasData = rcVerified && display.pwm !== undefined
            const minimum = endpointReading(`RC${channelNumber}_MIN`)
            const trim = endpointReading(`RC${channelNumber}_TRIM`)
            const maximum = endpointReading(`RC${channelNumber}_MAX`)
            const axisCapture =
              axisId !== undefined &&
              (rcCalibrationSession.captures[axisId].channelNumber || currentRcAxisChannelMap[axisId]) === channelNumber
                ? rcCalibrationSession.captures[axisId]
                : undefined
            const switchCapture = rcCalibrationSession.switchCaptures[channelNumber]
            const capture = axisCapture ?? switchCapture
            const captureActive = capture !== undefined && rcCalibrationSession.status !== 'idle'
            const armHighlight = armSwitchHighlightActive && armSwitchAssignment.channel === channelNumber
            const expanded = expandedRows.has(channelNumber)
            const hasEndpoints = minimum.shown !== undefined || maximum.shown !== undefined
            return (
              <div
                key={channelNumber}
                // The arm switch's row is the one outlined (it is the channel
                // that makes the craft dangerous), red while it is in the arm
                // position. The mode channel is named in Flight modes and
                // needs no marker here.
                className={`receiver-channel-row${armSwitchAssignment.channel === channelNumber ? ' receiver-channel-row--arm' : ''}${armHighlight ? ' receiver-channel-row--armed' : ''}${conflict ? ' receiver-channel-row--conflict' : ''}${expanded ? ' is-expanded' : ''}`}
                data-testid={`receiver-channel-bars-ch${channelNumber}`}
                data-arm-switch-armed={armHighlight ? 'true' : undefined}
                title={
                  armHighlight
                    ? `Armed — CH${channelNumber} is the arm switch and is in the arm position.`
                    : captureActive && capture.observedMin !== undefined && capture.observedMax !== undefined
                      ? `Seen ${Math.round(capture.observedMin)} to ${Math.round(capture.observedMax)} µs so far.`
                      : undefined
                }
              >
                <span className="receiver-channel-row__ch">CH{channelNumber}</span>
                <div className="receiver-channel-row__role">
                  {axes.length > 0 ? (
                    <strong className="receiver-channel-row__axis">{axes.map((axis) => formatRcAxisLabel(axis)).join(' / ')}</strong>
                  ) : functionRow && functionParameter ? (
                    <div className="receiver-channel-row__function" data-testid={`receiver-function-${channelNumber}`}>
                      <ScopedSelectField
                        parameter={functionParameter}
                        liveValue={functionParameter.value}
                        editedValues={editedValues}
                        onChange={(paramId, value) => setDraft(paramId, value)}
                        draftStatusById={parameterDraftById}
                        compact
                      />
                    </div>
                  ) : (
                    <span className="receiver-channel-row__plain">{display.role}</span>
                  )}
                  {armSwitchAssignment.channel === channelNumber ? <span className="receiver-channel-row__tag">Arm</span> : null}
                </div>
                <div className="receiver-channel-row__bar">
                  <RcChannelTrack
                    pwm={hasData ? display.pwm : undefined}
                    isModeChannel={false}
                    minUs={minimum.shown}
                    trimUs={trim.shown}
                    maxUs={maximum.shown}
                    minStaged={minimum.staged}
                    maxStaged={maximum.staged}
                    testId={axisId ? `rc-range-bar-${axisId}` : switchCapture ? `rc-range-bar-ch${channelNumber}` : undefined}
                  />
                </div>
                <span className={`rc-bar-value${hasData ? '' : ' rc-bar-value--empty'}`}>{hasData ? display.pwm : '—'}</span>
                {renderDirectionCell(channelNumber)}
                <div className="receiver-channel-row__reverse">{renderReverseField(channelNumber, `receiver-reverse-${channelNumber}`)}</div>
                {hasEndpoints ? (
                  <button
                    type="button"
                    className="receiver-channel-row__expand"
                    aria-expanded={expanded}
                    onClick={() => toggleRowExpanded(channelNumber)}
                  >
                    {expanded ? 'Hide endpoints' : 'Endpoints'}
                  </button>
                ) : (
                  <span className="receiver-channel-row__expand" aria-hidden="true" />
                )}
                <div
                  className="receiver-channel-row__endpoints"
                  data-testid={axisId ? `receiver-endpoint-${axisId}` : undefined}
                >
                  {hasEndpoints ? (
                    <>
                      {/* Low, trim and high are inputs, not pills: an operator
                          sets a trim or an endpoint here, staged like any field. */}
                      {([`RC${channelNumber}_MIN`, `RC${channelNumber}_TRIM`, `RC${channelNumber}_MAX`] as const).map((paramId, index) => {
                        const parameter = selectParameterById(snapshot, paramId)
                        if (!parameter) {
                          return <span key={paramId} className="receiver-endpoint-input receiver-endpoint-input--empty" aria-hidden="true" />
                        }
                        const observed = index === 0 ? capture?.lowObserved : index === 1 ? axisCapture?.centeredObserved : capture?.highObserved
                        return (
                          <span key={paramId} className={`receiver-endpoint-input${observed ? ' is-complete' : ''}`}>
                            <ScopedNumberField
                              parameter={parameter}
                              liveValue={parameter.value}
                              editedValues={editedValues}
                              onChange={(id, value) => setDraft(id, value)}
                              draftStatusById={parameterDraftById}
                              showTitle={false}
                              ariaLabel={`CH${channelNumber} ${index === 0 ? 'low' : index === 1 ? 'trim' : 'high'}`}
                              testId={`receiver-endpoint-${channelNumber}-${index === 0 ? 'low' : index === 1 ? 'trim' : 'high'}`}
                            />
                          </span>
                        )
                      })}
                    </>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {rcFunctionConflicts.length > 0 ? (
        <p className="switch-exercise-warning" data-testid="receiver-functions-conflict">
          ⚠ The same function is on more than one channel
          ({rcFunctionConflicts.map((row) => `CH${row.channelNumber}`).join(', ')}). ArduPilot does not define
          which one wins — clear the channel you do not want.
        </p>
      ) : null}

      {calibrationWarnings.map(({ axisId, warning }) => (
        <p
          key={axisId}
          className="switch-exercise-warning"
          data-testid={`receiver-endpoints-calibration-warning-${axisId}`}
        >
          ⚠ {warning}
        </p>
      ))}

      {rcCalibrationSession.status === 'failed' && rcCalibrationSession.failureReason ? (
        <p className="switch-exercise-warning">{rcCalibrationSession.failureReason}</p>
      ) : null}

      <div className="receiver-channels__actions">
        <div className="switch-exercise-controls receiver-channels__buttons">
          <button
            style={buttonStyle(crsfLink ? 'secondary' : 'primary')}
            data-testid="receiver-endpoints-capture"
            onClick={handleStartRcCalibrationCapture}
            disabled={!canCaptureRcCalibration || rcCalibrationSession.status === 'capturing'}
          >
            {crsfLink
              ? rcCalibrationSession.status === 'ready'
                ? 'Check Sticks Again'
                : 'Check Sticks'
              : rcCalibrationSession.status === 'ready'
                ? 'Capture Again'
                : 'Start Capture'}
          </button>
          {rcCalibrationSession.status !== 'idle' ? (
            <button style={buttonStyle()} onClick={handleResetRcCalibrationCapture}>
              Reset
            </button>
          ) : null}
          {crsfLink ? (
            <button
              style={buttonStyle('primary')}
              data-testid="receiver-set-crsf-limits"
              onClick={() =>
                mergeDrafts(buildCrsfEndpointDrafts((paramId) => selectParameterById(snapshot, paramId) !== undefined))
              }
            >
              Set CRSF Limits
            </button>
          ) : rcCalibrationSession.status === 'ready' ? (
            <button
              style={buttonStyle('secondary')}
              data-testid="receiver-endpoints-stage"
              onClick={handleStageRcCalibrationDrafts}
            >
              Stage Captured Values
            </button>
          ) : null}
          {/* Channels that are neither mapped nor streaming nor assigned.
              Nothing to show means no button either. */}
          {receiverAuxChannelDisplays.length > 0 ? (
            <button
              style={buttonStyle()}
              data-testid="receiver-aux-toggle"
              onClick={() => setShowReceiverChannelDetails((existing) => !existing)}
            >
              {showReceiverChannelDetails ? 'Hide AUX Channels' : `Show AUX Channels (${receiverAuxChannelDisplays.length})`}
            </button>
          ) : null}
        </div>
        {crsfLink ? (
          <p className="receiver-endpoints-line" data-testid="receiver-endpoints-crsf">
            CRSF link: fixed range {CRSF_RC_MIN_US} to {CRSF_RC_MAX_US} µs, centre {CRSF_RC_CENTER_US}.
          </p>
        ) : rcCalibrationSession.status !== 'idle' ? (
          <p className="receiver-endpoints-line">{rcCalibrationSummary}</p>
        ) : null}
      </div>

    </div>
  )

  const flightModesSlot =
    modeChannelParameter || modeAssignmentParameters.length > 0 || armSwitchAvailable ? (
      <div
        className="scoped-review-card scoped-review-card--compact receiver-modes"
        id={receiverSectionElementId('flight-modes')}
        data-testid="receiver-flight-modes-card"
      >
        <div className="switch-exercise-card__header">
          <div>
            <strong>Flight modes</strong>
            <InfoDot label="About flight modes" wide>
              Which receiver channel selects the flight mode, and the mode for each of its six switch positions. The
              arm switch is a channel that arms and disarms from a physical switch (RCn_OPTION, written directly);
              AirMode keeps the stabilisation active at zero throttle. Changes apply below.
            </InfoDot>
          </div>
          {modeAssignmentParameters.length > 0 && modeExerciseAssignments.length < 2 ? (
            <StatusBadge tone="warning">Review needed</StatusBadge>
          ) : null}
        </div>

        <div className="receiver-modes__row">
          {modeChannelParameter ? (
            <ScopedSelectField
              // A copy with a one-word title; the copy never reaches the write path.
              parameter={modeChannelParameter.definition ? { ...modeChannelParameter, definition: { ...modeChannelParameter.definition, label: 'Channel' } } : modeChannelParameter}
              liveValue={configuredModeChannel}
              editedValues={editedValues}
              onChange={(paramId, value) => setDraft(paramId, value)}
              draftStatusById={parameterDraftById}
            />
          ) : null}
          {modeAssignmentParameters.map((parameter, index) => (
            <ScopedSelectField
              key={parameter.id}
              parameter={parameter.definition ? { ...parameter, definition: { ...parameter.definition, label: String(index + 1) } } : parameter}
              liveValue={parameter.value}
              editedValues={editedValues}
              onChange={(paramId, value) => setDraft(paramId, value)}
              draftStatusById={parameterDraftById}
            />
          ))}
        </div>

        {armSwitchAvailable ? (
          <div className="receiver-arm-line" data-testid="receiver-arm-switch">
            <label className="receiver-arm-switch__field">
              <span>Arm switch</span>
              <select
                data-testid="receiver-arm-switch-channel"
                value={String(armSwitchAssignment.channel ?? 0)}
                onChange={(event) => handleSetArmSwitchChannel(Number(event.target.value), armSwitchAssignment.airmode)}
              >
                {armSwitchChannelOptions().map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <StatusBadge tone={armSwitchAssignment.channel !== undefined ? 'success' : 'neutral'}>
              {armSwitchAssignment.channel !== undefined
                ? `CH${armSwitchAssignment.channel}${armSwitchAssignment.airmode ? ' + AirMode' : ''}`
                : 'not assigned'}
            </StatusBadge>
            <label className="receiver-arm-switch__checkbox">
              <input
                type="checkbox"
                data-testid="receiver-arm-switch-airmode"
                checked={armSwitchAssignment.airmode}
                disabled={armSwitchAssignment.channel === undefined}
                onChange={(event) => handleSetArmSwitchChannel(armSwitchAssignment.channel ?? 0, event.target.checked)}
              />
              <span>AirMode when armed by this switch</span>
            </label>
            {armSwitchAssignment.channel !== undefined && rcLogicChannelClaims?.get(armSwitchAssignment.channel)?.length ? (
              <p className="switch-exercise-warning" data-testid="receiver-arm-switch-rcl-conflict">
                ⚠ CH{armSwitchAssignment.channel} also drives an RC Mixer function
                ({rcLogicChannelClaims.get(armSwitchAssignment.channel)!.join(', ')}) — the arm switch and the RC Mixer
                term both act on this channel.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    ) : null

  const advancedSlot = (
    <details
      className="receiver-advanced"
      id={receiverSectionElementId('advanced')}
      data-testid="receiver-advanced"
      open={advancedOpen}
      onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
    >
      <summary className="receiver-advanced__summary" data-testid="receiver-advanced-toggle">
        <strong>Advanced</strong>
        <span>RSSI · RC options · protocols · input rate</span>
        {receiverAdditionalInvalidDrafts.length > 0 ? (
          <StatusBadge tone="danger">{`${receiverAdditionalInvalidDrafts.length} invalid`}</StatusBadge>
        ) : null}
      </summary>
      <div className="receiver-advanced__body">
        {rssiTypeParameter || rssiChannelParameter || rssiChannelLowParameter || rssiChannelHighParameter ? (
          <div className="scoped-review-card scoped-review-card--compact receiver-rssi-card" data-testid="receiver-rssi-card">
            <div className="switch-exercise-card__header">
              <div>
                <strong>RSSI</strong>
                <InfoDot label="About RSSI" wide>
                  Where the link-quality readout comes from. The receiver serial protocol itself is assigned from
                  Ports; this card covers the receiver side of that link. After changing RSSI settings, rerun the RC
                  checks before flight.
                </InfoDot>
              </div>
            </div>

            <div className="config-pills">
              <span>RSSI source: {formatArducopterRssiType(rssiType)}</span>
              <span>Live RX RSSI: {formatRxRssi(snapshot.liveVerification.rcInput.rssi)}</span>
              {receiverLinkPorts.length > 0
                ? receiverLinkPorts.map((port) => <span key={`receiver-link:${port.portNumber}`}>{port.label}: {port.protocolLabel}</span>)
                : <span>No receiver serial link in the current port roles</span>}
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
          </div>
        ) : null}

        {rcOptionsParameter ? (
          <div className="scoped-review-card scoped-review-card--compact" data-testid="receiver-rc-options">
            <div className="switch-exercise-card__header">
              <div>
                <strong>RC options</strong>
                <InfoDot label="About RC options">
                  Advanced receiver behaviour (RC_OPTIONS). Leave these off unless a specific receiver or setup needs
                  them.
                </InfoDot>
              </div>
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

        {renderAdditionalSettingsCard(
          'Additional receiver settings',
          '',
          receiverAdditionalGroups,
          receiverAdditionalDraftEntries,
          receiverAdditionalStagedDrafts,
          receiverAdditionalInvalidDrafts,
          'receiver:additional',
          'Apply Additional Receiver Changes',
          'additional receiver settings'
        )}
      </div>
    </details>
  )

  return (
    <ReceiverView
      taskCards={receiverTaskCards}
      activeTaskId={activeReceiverTaskId}
      activeTask={activeReceiverTask}
      onSelectTask={handleSelectTask}
      mapSlot={mapSlot}
      directionSlot={directionSlot}
      channelsSlot={channelsSlot}
      flightModesSlot={flightModesSlot}
      advancedSlot={advancedSlot}
      helpDockSlot={
        receiverHasPendingReview ? (
          <div className="receiver-review-dock" data-testid="receiver-review-dock">
            <div className="receiver-review-dock__summary">
              <strong>{allInvalidCount > 0 ? `${allInvalidCount} invalid` : `${allStagedCount} staged`}</strong>
              {showDockDrafts ? (
                <div className="config-pills receiver-review-dock__drafts" data-testid="receiver-draft-list">
                  {allReceiverDrafts.map((draft) => (
                    <span
                      key={draft.id}
                      className={draft.status === 'invalid' ? 'is-pending' : undefined}
                      title={draft.status === 'staged' ? draft.label : draft.reason}
                    >
                      {draft.id}
                      {draft.status === 'staged'
                        ? ` ${formatParameterValue(draft.currentValue, draft.definition?.unit)} → ${formatParameterValue(draft.nextValue, draft.definition?.unit)}`
                        : draft.status === 'invalid'
                          ? ' invalid'
                          : ''}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="receiver-review-dock__actions">
              <button
                data-testid="receiver-draft-show"
                style={buttonStyle()}
                onClick={() => setShowDockDrafts((existing) => !existing)}
              >
                {showDockDrafts ? 'Hide changes' : 'Show changes'}
              </button>
              <button
                data-testid="receiver-discard-button"
                style={buttonStyle()}
                onClick={() =>
                  handleDiscardScopedParameterDrafts(allReceiverDrafts.map((entry) => entry.id), 'receiver')
                }
                disabled={busyAction !== undefined || allReceiverDrafts.length === 0}
              >
                Discard Receiver Changes
              </button>
              <button
                data-testid="receiver-apply-button"
                style={buttonStyle('primary')}
                onClick={() =>
                  void handleApplyScopedParameterDrafts(allReceiverDrafts, 'receiver:apply', 'Receiver setup')
                }
                disabled={
                  busyAction !== undefined ||
                  allStagedCount === 0 ||
                  allInvalidCount > 0 ||
                  !canApplyDraftParameters
                }
              >
                {busyAction === 'receiver:apply' ? 'Applying…' : `Apply Receiver Changes (${allStagedCount})`}
              </button>
            </div>
          </div>
        ) : null
      }
    />
  )
}
