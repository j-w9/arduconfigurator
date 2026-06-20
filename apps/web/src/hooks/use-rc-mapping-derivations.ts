// Receiver / RC-mapping derived state, lifted out of App.tsx as the first
// step toward a proper ReceiverSection extract. Pure verbatim move: every
// useMemo body is byte-identical to the original, just relocated into a
// hook so the Receiver block can eventually consume one named bag instead
// of N individual values. Inputs that were only used to derive other
// outputs (excludedChannelNumbers, rawCandidate, detectedChannelMap,
// draftPreview) stay private to the hook; only values App.tsx still reads
// are returned.

import { useMemo } from 'react'

import {
  type ConfiguratorSnapshot,
  type RcAxisChannelMap,
  type RcAxisId,
  type RcMappingCandidate,
  deriveRcMapDraftValues,
  detectDominantRcChannelChange,
  formatRcAxisLabel
} from '@arduconfig/ardupilot-core'

import type {
  RcMappingAutoCaptureState,
  RcMappingAxisCapture,
  RcMappingSessionState
} from '../app-types'
import {
  RC_CALIBRATION_AXIS_ORDER,
  RC_MAPPING_AUTO_CAPTURE_MS,
  deriveRcMappingLiveCandidates,
  describeRcMappingRejectedCandidate,
  rcMappingConfidenceLabel,
  rcMappingTargetPrompt
} from '../setup-exercise-helpers'

export interface UseRcMappingDerivationsResult {
  rcMappingCandidate: RcMappingCandidate | undefined
  rcMappingLiveCandidates: RcMappingCandidate[]
  rcMappingCapturedCount: number
  rcMappingTargetGuide: ReturnType<typeof rcMappingTargetPrompt>
  rcMappingCandidateConfidence: ReturnType<typeof rcMappingConfidenceLabel>
  rcMappingRejectedReason: string | undefined
  rcMappingStagedChangeCount: number
  rcMappingAutoCaptureKey: string | undefined
  rcMappingAutoCaptureProgressPercent: number
  rcMappingSummary: string
  rcMappingInstructions: string[]
}

/**
 * Derives the rcMapping family of values the Receiver workbench reads.
 * Inputs are the live snapshot, the in-progress mapping session +
 * auto-capture tracker from useRcExercises, and the currently-configured
 * RC axis channel map. Outputs are byte-identical to the App.tsx originals.
 */
export function useRcMappingDerivations(input: {
  snapshot: ConfiguratorSnapshot
  rcMappingSession: RcMappingSessionState
  rcMappingAutoCaptureState: RcMappingAutoCaptureState
  currentRcAxisChannelMap: RcAxisChannelMap
}): UseRcMappingDerivationsResult {
  const { snapshot, rcMappingSession, rcMappingAutoCaptureState, currentRcAxisChannelMap } = input

  const rcMappingExcludedChannelNumbers = useMemo(
    () =>
      (Object.values(rcMappingSession.captures) as RcMappingAxisCapture[])
        .map((capture) => capture.detectedChannelNumber)
        .filter((channelNumber): channelNumber is number => channelNumber !== undefined),
    [rcMappingSession.captures]
  )
  const rcMappingRawCandidate = useMemo(() => {
    if (rcMappingSession.status !== 'running' || rcMappingSession.currentTargetAxis === undefined) {
      return undefined
    }

    return detectDominantRcChannelChange(snapshot.liveVerification.rcInput.channels, rcMappingSession.baselineChannels, {
      excludedChannelNumbers: rcMappingExcludedChannelNumbers
    })
  }, [rcMappingExcludedChannelNumbers, rcMappingSession.baselineChannels, rcMappingSession.currentTargetAxis, rcMappingSession.status, snapshot.liveVerification.rcInput.channels])
  const rcMappingCandidate = useMemo(() => {
    if (rcMappingSession.status !== 'running' || rcMappingSession.currentTargetAxis === undefined) {
      return undefined
    }

    return detectDominantRcChannelChange(snapshot.liveVerification.rcInput.channels, rcMappingSession.baselineChannels, {
      excludedChannelNumbers: rcMappingExcludedChannelNumbers,
      targetAxis: rcMappingSession.currentTargetAxis
    })
  }, [rcMappingExcludedChannelNumbers, rcMappingSession.baselineChannels, rcMappingSession.currentTargetAxis, rcMappingSession.status, snapshot.liveVerification.rcInput.channels])
  const rcMappingLiveCandidates = useMemo(() => {
    if (rcMappingSession.status !== 'running' || rcMappingSession.currentTargetAxis === undefined) {
      return []
    }

    return deriveRcMappingLiveCandidates(
      snapshot.liveVerification.rcInput.channels,
      rcMappingSession.baselineChannels,
      rcMappingExcludedChannelNumbers
    ).slice(0, 4)
  }, [
    rcMappingExcludedChannelNumbers,
    rcMappingSession.baselineChannels,
    rcMappingSession.currentTargetAxis,
    rcMappingSession.status,
    snapshot.liveVerification.rcInput.channels
  ])
  const rcMappingCapturedCount = useMemo(
    () =>
      (Object.values(rcMappingSession.captures) as RcMappingAxisCapture[]).filter(
        (capture) => capture.detectedChannelNumber !== undefined
      ).length,
    [rcMappingSession.captures]
  )
  const rcMappingTargetGuide = rcMappingTargetPrompt(rcMappingSession.currentTargetAxis ?? 'roll')
  const rcMappingCandidateConfidence = rcMappingConfidenceLabel(rcMappingCandidate?.deltaUs)
  const rcMappingRejectedReason = useMemo(() => {
    if (
      rcMappingSession.status !== 'running' ||
      rcMappingSession.currentTargetAxis === undefined ||
      rcMappingCandidate !== undefined ||
      rcMappingRawCandidate === undefined
    ) {
      return undefined
    }

    return describeRcMappingRejectedCandidate(rcMappingSession.currentTargetAxis, rcMappingRawCandidate)
  }, [rcMappingCandidate, rcMappingRawCandidate, rcMappingSession.currentTargetAxis, rcMappingSession.status])
  const rcMappingDetectedChannelMap = useMemo(
    () =>
      Object.fromEntries(
        RC_CALIBRATION_AXIS_ORDER.map((axisId) => [axisId, rcMappingSession.captures[axisId].detectedChannelNumber])
      ) as Partial<Record<RcAxisId, number>>,
    [rcMappingSession.captures]
  )
  const rcMappingDraftPreview = useMemo(
    () => deriveRcMapDraftValues(rcMappingDetectedChannelMap, currentRcAxisChannelMap),
    [currentRcAxisChannelMap, rcMappingDetectedChannelMap]
  )
  const rcMappingStagedChangeCount = Object.keys(rcMappingDraftPreview).length
  const rcMappingAutoCaptureKey =
    rcMappingSession.status === 'running' && rcMappingSession.currentTargetAxis !== undefined && rcMappingCandidate
      ? `${rcMappingSession.currentTargetAxis}:${rcMappingCandidate.channelNumber}`
      : undefined
  const rcMappingAutoCaptureProgressPercent =
    rcMappingSession.status === 'running' &&
    rcMappingCandidate !== undefined &&
    rcMappingAutoCaptureState.axisId === rcMappingSession.currentTargetAxis &&
    rcMappingAutoCaptureState.channelNumber === rcMappingCandidate.channelNumber
      ? Math.min(100, (rcMappingAutoCaptureState.accumulatedMs / RC_MAPPING_AUTO_CAPTURE_MS) * 100)
      : 0

  const rcMappingSummary = (() => {
    if (rcMappingSession.status === 'ready') {
      return rcMappingStagedChangeCount > 0
        ? `Detected all four primary axes. ${rcMappingStagedChangeCount} RCMAP_* change${rcMappingStagedChangeCount === 1 ? '' : 's'} are ready to stage.`
        : 'Detected all four primary axes. The current RCMAP_* values already match the live stick inputs.'
    }
    if (rcMappingSession.status === 'failed') {
      return rcMappingSession.failureReason ?? 'RC mapping exercise failed.'
    }
    if (rcMappingSession.status === 'running') {
      return rcMappingSession.currentTargetAxis === undefined
        ? 'RC mapping capture is ready for review.'
        : `${rcMappingTargetGuide.title}. The app will capture the channel automatically once one input stays clearly dominant.`
    }
    if (!snapshot.liveVerification.rcInput.verified) {
      return 'Waiting for live RC telemetry before channel remapping can start.'
    }
    return 'Run the guided RC mapping capture to identify which live receiver channels actually carry roll, pitch, throttle, and yaw.'
  })()

  const rcMappingInstructions =
    rcMappingSession.status === 'running'
      ? [
          `Current target: ${formatRcAxisLabel(rcMappingSession.currentTargetAxis ?? 'roll')}.`,
          rcMappingTargetGuide.detail,
          rcMappingCandidate
            ? `Current dominant channel: CH${rcMappingCandidate.channelNumber} (${Math.round(rcMappingCandidate.deltaUs)}us delta, ${rcMappingCandidateConfidence.label.toLowerCase()} confidence).`
            : 'Move only the requested axis. Leave the other sticks still so the correct channel can stand out.'
        ]
      : rcMappingSession.status === 'ready'
        ? [
            rcMappingStagedChangeCount > 0
              ? 'Stage the detected RCMAP_* changes, apply them, then refresh parameters before rerunning endpoint capture.'
              : 'No remap is needed. You can move straight on to stick range and endpoint capture.'
          ]
        : rcMappingSession.status === 'failed'
          ? ['Center the sticks, make sure only one control is moving, and rerun the guided capture.']
          : [
              'The app compares live RC motion to the starting baseline and looks for the single channel that moved the most.'
            ]

  return {
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
  }
}
