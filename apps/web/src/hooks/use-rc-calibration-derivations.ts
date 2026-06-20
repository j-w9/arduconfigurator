// RC endpoint calibration summary, lifted out of App.tsx as the next
// bounded slice toward a ReceiverSection extract. Behavior-neutral move:
// the status-to-summary mapping is byte-identical to the App.tsx
// original — same parallel shape as useRcRangeDerivations and
// useModeSwitchDerivations.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import type { RcCalibrationSessionState } from '../app-types'

export interface UseRcCalibrationDerivationsResult {
  rcCalibrationSummary: string
}

/**
 * Derives the rcCalibration summary string. Inputs are the live snapshot
 * (read for rcInput.verified) and the in-progress calibration session
 * from useRcExercises.
 */
export function useRcCalibrationDerivations(input: {
  snapshot: ConfiguratorSnapshot
  rcCalibrationSession: RcCalibrationSessionState
}): UseRcCalibrationDerivationsResult {
  const { snapshot, rcCalibrationSession } = input

  const rcCalibrationSummary = (() => {
    if (rcCalibrationSession.status === 'ready') {
      return 'Observed full stick travel and ready-to-stage RC endpoint values.'
    }
    if (rcCalibrationSession.status === 'capturing') {
      return 'Move each primary axis through its full range to capture new RC endpoints.'
    }
    if (rcCalibrationSession.status === 'failed') {
      return rcCalibrationSession.failureReason ?? 'RC calibration capture failed.'
    }
    if (!snapshot.liveVerification.rcInput.verified) {
      return 'Waiting for live RC telemetry before RC calibration capture can start.'
    }
    return 'Capture fresh RC endpoint values from live stick movement, then stage them in the parameter editor.'
  })()

  return { rcCalibrationSummary }
}
