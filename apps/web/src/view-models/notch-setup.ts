// The harmonic notch, planned from a hover and judged against the vehicle.
//
// ESC telemetry (bidirectional DShot or a telemetry wire): MODE 3, REF 1,
// FREQ below the hover frequency but above INS_GYRO_FILTER, BW = FREQ / 2
// (common-esc-telem-based-notch.rst). No telemetry: MODE 1, REF = the hover
// throttle, FREQ = the hover's dominant gyro peak, BW = FREQ / 2
// (common-throttle-based-notch.rst). With the per-motor option (OPTS bit 1)
// the bandwidth comes down to FREQ / 4 or less.

import type { NotchPlanFromLog } from '@arduconfig/log-analysis'

export interface NotchSetupInputs {
  plan: NotchPlanFromLog | undefined
  /** Live ESC RPM on the bench (bidirectional DShot) counts as a telemetry source too. */
  liveEscTelemetry: boolean
  gyroFilterHz: number | undefined
  hoverThrottle: number | undefined
  current: {
    enable?: number
    mode?: number
    ref?: number
    freq?: number
    bw?: number
    harmonics?: number
    options?: number
  }
}

export interface NotchSetupPlan {
  source: 'esc' | 'throttle' | 'unknown'
  /** Drafts that would set the notch up from the plan; empty when nothing can be planned. */
  drafts: Record<string, string>
  /** Why a draft is missing, in operator words. */
  blockers: string[]
  checks: {
    enabled: boolean
    referenceRight: boolean
    frequencySane: boolean
    bandwidthSane: boolean
    harmonicsSane: boolean
  }
  summary: string
}

const within = (value: number | undefined, target: number, tolerance: number): boolean =>
  value !== undefined && Math.abs(value - target) <= target * tolerance

export function buildNotchSetupPlan(inputs: NotchSetupInputs): NotchSetupPlan {
  const { plan, liveEscTelemetry, gyroFilterHz, hoverThrottle, current } = inputs
  const escSource = liveEscTelemetry || plan?.escTelemetry === true
  const source: NotchSetupPlan['source'] = escSource ? 'esc' : plan ? 'throttle' : 'unknown'
  const drafts: Record<string, string> = {}
  const blockers: string[] = []

  if (source === 'esc') {
    drafts.INS_HNTCH_ENABLE = '1'
    drafts.INS_HNTCH_MODE = '3'
    drafts.INS_HNTCH_REF = '1'
    if (plan?.hoverFundamentalHz !== undefined) {
      // Below the hover frequency, above the gyro filter.
      let freq = Math.round(plan.hoverFundamentalHz * 0.8)
      if (gyroFilterHz !== undefined && freq <= gyroFilterHz) freq = gyroFilterHz + 10
      drafts.INS_HNTCH_FREQ = String(freq)
      drafts.INS_HNTCH_BW = String(Math.round(freq / 2))
    } else {
      blockers.push('Read a hover log with ESC telemetry to place the notch.')
    }
  } else if (source === 'throttle') {
    drafts.INS_HNTCH_ENABLE = '1'
    drafts.INS_HNTCH_MODE = '1'
    const reference = plan?.hoverThrottle ?? hoverThrottle
    if (reference !== undefined) drafts.INS_HNTCH_REF = String(Math.round(reference * 1000) / 1000)
    else blockers.push('No hover throttle to scale from.')
    if (plan?.gyroPeakHz !== undefined) {
      const freq = Math.round(plan.gyroPeakHz)
      drafts.INS_HNTCH_FREQ = String(freq)
      drafts.INS_HNTCH_BW = String(Math.round(freq / 2))
    } else {
      blockers.push('No gyro peak in the log. Turn on Logs ▸ Logging for tuning and fly the hover again.')
    }
  } else {
    blockers.push('Read a hover log to plan the notch.')
  }

  const mode = current.mode
  const enabled = (current.enable ?? 0) !== 0 && mode !== undefined && mode !== 0
  const perMotor = ((current.options ?? 0) & 2) !== 0
  const referenceRight =
    mode === 3 || mode === 2 || mode === 5
      ? current.ref === 1
      : mode === 1
        ? within(current.ref, plan?.hoverThrottle ?? hoverThrottle ?? Number.NaN, 0.1)
        : mode === 4
          ? true
          : false
  const frequencySane =
    current.freq !== undefined &&
    current.freq > 0 &&
    (mode === 3
      ? (gyroFilterHz === undefined || current.freq > gyroFilterHz) &&
        (plan?.hoverFundamentalHz === undefined || current.freq < plan.hoverFundamentalHz)
      : mode === 1
        ? plan?.gyroPeakHz === undefined || within(current.freq, plan.gyroPeakHz, 0.2)
        : true)
  const bandwidthSane =
    current.freq !== undefined &&
    current.bw !== undefined &&
    current.bw > 0 &&
    (perMotor ? current.bw <= current.freq / 4 + 1 : within(current.bw, current.freq / 2, 0.35))
  const harmonicsSane = current.harmonics === undefined || (current.harmonics > 0 && current.harmonics <= 7 && current.harmonics !== 4)

  const summary =
    source === 'esc'
      ? plan?.hoverFundamentalHz !== undefined
        ? `Motors at ${plan.hoverFundamentalHz.toFixed(0)} Hz in the hover; notch from ESC telemetry.`
        : 'ESC telemetry found. Read a hover log to place the notch.'
      : source === 'throttle'
        ? plan?.gyroPeakHz !== undefined
          ? `Strongest hover peak ${plan.gyroPeakHz.toFixed(0)} Hz on ${plan.gyroPeakAxis ?? 'gyro'}; notch from throttle.`
          : 'No ESC telemetry: the notch follows throttle, placed from the hover log.'
        : 'Read a hover log to plan the notch.'

  return {
    source,
    drafts,
    blockers,
    checks: { enabled, referenceRight, frequencySane, bandwidthSane, harmonicsSane },
    summary
  }
}
