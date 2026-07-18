// Log-based VALT (baro thrust-compensation) calibration analysis.
//
// A multirotor's props lower the local static pressure over the barometer as
// throttle rises, so the baro reads a *higher* altitude the harder it works.
// ArduPilot corrects this linearly: it subtracts `BARO1_THST_SCALE × throttle`
// (Pascals × normalized-throttle) from the measured pressure. This module fits
// that scale from a flight log by comparing the baro altitude against a
// ground-truth height over steady-hover windows — the same idea as ArduPilot's
// VALT WebTool, done offline in the browser. Ground truth is a downward
// rangefinder (RFND.Dist) when present; otherwise the operator can enter a
// measured hover height (options.manualTrueAltM) for a single steady hover.
//
// Data used (all from the dataflash log, no live connection):
//   - CTUN.ThO   normalized throttle out (0..1), time-aligned with…
//   - CTUN.BAlt  barometer-derived altitude (m)
//   - RFND.Dist  downward rangefinder distance (m) — ground truth, Orient=25,
//                Stat=4 (Good), instance 0
//
// The correction model (from libraries/AP_Baro/AP_Baro.cpp): the FC does
//   corrected_pressure = measured_pressure − BARO1_THST_SCALE × throttle
// A positive altitude error (baro reads high) means measured pressure is too
// low, so the scale is NEGATIVE. In pressure terms, error_Pa = error_m × 12
// (~12 Pa per metre near sea level), giving per point
//   BARO1_THST_SCALE = −(error_m × 12) / throttle
// and, across several steady hover points, a least-squares fit through the
// origin of error_Pa against throttle.

import { parseDataflashLog, type ParsedDataflashLog, type DataflashMessage } from './dataflash-parser.js'

/** Pascals per metre of altitude near sea level (barometric, ~ -12 Pa/m). */
const PA_PER_M = 12
/** Downward rangefinder orientation (ROTATION_PITCH_270) and Good status. */
const RFND_ORIENT_DOWN = 25
const RFND_STATUS_GOOD = 4
/** BARO1_THST_SCALE parameter range (AP_Baro: @Range -300 300, Pascals). */
const SCALE_MIN = -300
const SCALE_MAX = 300

// Steady-hover window detection.
const MIN_THROTTLE = 0.1 // below this it isn't a hover; the fit would divide by ~0
const THROTTLE_BAND = 0.03 // ±3% throttle to count as "steady"
const DIST_BAND = 0.25 // ±0.25 m rangefinder height to count as "steady"
const MIN_WINDOW_S = 2.0 // a steady window must last at least this long
const MIN_WINDOW_SAMPLES = 10
const MAX_SAMPLE_GAP_S = 0.5 // a longer gap breaks the window
const ALIGN_TOLERANCE_S = 0.2 // max time gap to pair a CTUN sample with an RFND sample

export interface ValtPoint {
  /** Mean normalized throttle over the window (0..1). */
  throttle: number
  /** Mean barometer altitude over the window (m). */
  baroAltM: number
  /** Mean rangefinder (true) altitude over the window (m). */
  trueAltM: number
  /** baroAltM − trueAltM (m) — positive means the baro reads high. */
  errorM: number
  /** Number of aligned samples in the window. */
  samples: number
  /** Window duration (s). */
  durationS: number
}

export interface ValtOptions {
  /** Measured true hover height (m) for logs without a rangefinder. When set,
   *  it's used as the ground-truth altitude instead of RFND — for a single
   *  steady hover actually flown at this height. */
  manualTrueAltM?: number
}

export interface ValtResult {
  /** True when a scale could be fit from at least one steady hover window. */
  usable: boolean
  /** Which ground-truth altitude the fit used (or would need). */
  groundTruth: 'rangefinder' | 'manual' | 'none'
  /** Reasons the log can't be used, or caveats on the fit. */
  warnings: string[]
  /** Steady-hover points the fit was built from. */
  points: ValtPoint[]
  /** Fitted BARO1_THST_SCALE (Pascals), clamped to the parameter range. */
  suggestedScale?: number
  /** Current BARO1_THST_SCALE from the log's PARM records, if present. */
  currentScale?: number
  summary: string
}

function num(msg: DataflashMessage, field: string): number | undefined {
  const v = msg[field]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

interface AlignedSample {
  t: number
  throttle: number
  baroAlt: number
  trueAlt: number
}

/** Pair each CTUN (throttle+baro) sample with the nearest-in-time downward
 *  rangefinder reading, dropping pairs that are too far apart in time. */
function alignSamples(
  ctun: { t: number; throttle: number; baroAlt: number }[],
  rfnd: { t: number; dist: number }[]
): AlignedSample[] {
  const aligned: AlignedSample[] = []
  let j = 0
  for (const c of ctun) {
    // Advance the rangefinder pointer to the closest reading at or before c.t,
    // then compare it with the next one to pick the nearer.
    while (j + 1 < rfnd.length && rfnd[j + 1].t <= c.t) j += 1
    let best = rfnd[j]
    if (j + 1 < rfnd.length && Math.abs(rfnd[j + 1].t - c.t) < Math.abs(best.t - c.t)) {
      best = rfnd[j + 1]
    }
    if (best && Math.abs(best.t - c.t) <= ALIGN_TOLERANCE_S) {
      aligned.push({ t: c.t, throttle: c.throttle, baroAlt: c.baroAlt, trueAlt: best.dist })
    }
  }
  return aligned
}

/** Split aligned samples into steady-hover windows. Always requires a stable
 *  throttle; when `requireHeightStable` is set (rangefinder mode) it also
 *  requires the ground-truth height to hold steady, confirming the aircraft
 *  isn't drifting. Manual mode has no per-sample height (it's one entered
 *  constant), so it relies on throttle stability alone. */
function findSteadyWindows(aligned: AlignedSample[], requireHeightStable: boolean): ValtPoint[] {
  const points: ValtPoint[] = []
  let cur: AlignedSample[] = []

  const close = (): void => {
    if (cur.length < MIN_WINDOW_SAMPLES) return
    const durationS = cur[cur.length - 1].t - cur[0].t
    if (durationS < MIN_WINDOW_S) return
    const throttle = mean(cur.map((s) => s.throttle))
    if (throttle < MIN_THROTTLE) return
    const baroAltM = mean(cur.map((s) => s.baroAlt))
    const trueAltM = mean(cur.map((s) => s.trueAlt))
    points.push({
      throttle,
      baroAltM,
      trueAltM,
      errorM: baroAltM - trueAltM,
      samples: cur.length,
      durationS
    })
  }

  for (const s of aligned) {
    if (cur.length === 0) {
      cur = [s]
      continue
    }
    const throttleSteady = Math.abs(s.throttle - mean(cur.map((c) => c.throttle))) <= THROTTLE_BAND
    const heightSteady = !requireHeightStable || Math.abs(s.trueAlt - mean(cur.map((c) => c.trueAlt))) <= DIST_BAND
    const contiguous = s.t - cur[cur.length - 1].t <= MAX_SAMPLE_GAP_S
    if (throttleSteady && heightSteady && contiguous) {
      cur.push(s)
    } else {
      close()
      cur = [s]
    }
  }
  close()
  return points
}

/** Fit BARO1_THST_SCALE (Pa) from steady points via least-squares through the
 *  origin of error_Pa (= error_m × 12) against throttle. */
function fitScale(points: ValtPoint[]): number | undefined {
  let sxx = 0
  let sxy = 0
  for (const p of points) {
    const x = p.throttle
    const y = p.errorM * PA_PER_M
    sxx += x * x
    sxy += x * y
  }
  if (sxx <= 0) return undefined
  const slope = sxy / sxx // = -scale
  const scale = -slope
  return Math.max(SCALE_MIN, Math.min(SCALE_MAX, Number(scale.toFixed(1))))
}

/** Analyse a parsed dataflash log for VALT baro thrust-scale calibration.
 *  Ground truth is a downward rangefinder when present; otherwise pass
 *  `options.manualTrueAltM` (a measured hover height) to fit without one. */
export function analyzeValtLog(log: ParsedDataflashLog, options: ValtOptions = {}): ValtResult {
  const warnings: string[] = []
  const manualTrueAltM =
    typeof options.manualTrueAltM === 'number' && Number.isFinite(options.manualTrueAltM) && options.manualTrueAltM > 0
      ? options.manualTrueAltM
      : undefined

  const ctunRaw = log.messagesByType.get('CTUN') ?? []
  const ctun: { t: number; throttle: number; baroAlt: number }[] = []
  for (const m of ctunRaw) {
    const t = num(m, 'TimeUS')
    const throttle = num(m, 'ThO')
    // CTUN carries the baro-derived altitude as BAlt; fall back to the BARO
    // message only if CTUN.BAlt is absent on this firmware.
    const baroAlt = num(m, 'BAlt')
    if (t !== undefined && throttle !== undefined && baroAlt !== undefined) {
      ctun.push({ t: t / 1e6, throttle, baroAlt })
    }
  }

  const rfndRaw = log.messagesByType.get('RFND') ?? []
  const rfnd: { t: number; dist: number }[] = []
  for (const m of rfndRaw) {
    const t = num(m, 'TimeUS')
    const dist = num(m, 'Dist')
    const orient = num(m, 'Orient')
    const stat = num(m, 'Stat')
    const instance = num(m, 'Instance')
    if (t === undefined || dist === undefined) continue
    if (instance !== undefined && instance !== 0) continue
    if (orient !== undefined && orient !== RFND_ORIENT_DOWN) continue
    if (stat !== undefined && stat !== RFND_STATUS_GOOD) continue
    rfnd.push({ t: t / 1e6, dist })
  }
  rfnd.sort((a, b) => a.t - b.t)

  const params = new Map<string, number>()
  for (const m of log.messagesByType.get('PARM') ?? []) {
    if (typeof m.Name === 'string' && typeof m.Value === 'number') params.set(m.Name, m.Value)
  }
  const currentScale = params.get('BARO1_THST_SCALE')

  if (ctun.length === 0) {
    warnings.push('No throttle/altitude data (CTUN) in this log — it needs an actual flight log.')
  }

  // Ground truth: an entered manual height takes precedence (the operator is
  // telling us the true height); otherwise a downward rangefinder; otherwise
  // nothing to compare against.
  let groundTruth: ValtResult['groundTruth'] = 'none'
  let points: ValtPoint[] = []

  if (ctun.length > 0 && manualTrueAltM !== undefined) {
    groundTruth = 'manual'
    const aligned = ctun.map((c) => ({ t: c.t, throttle: c.throttle, baroAlt: c.baroAlt, trueAlt: manualTrueAltM }))
    points = findSteadyWindows(aligned, false)
    if (points.length === 0) {
      warnings.push('No steady hover found — hold a stable throttle at your fixed height for several seconds.')
    }
    // Manual entry is a single height. If the baro altitude spans a wide range
    // across the steady windows, the log holds more than one hover height and a
    // single entered value can't be right for all of them.
    if (points.length > 1) {
      const levels = points.map((p) => p.baroAltM)
      if (Math.max(...levels) - Math.min(...levels) > 1) {
        warnings.push(
          'Baro altitude varied by more than 1 m across the steady windows — that reads as more than one hover height, but a manual height applies one value to the whole log. Use manual mode for a single steady hover at the entered height, or fly with a rangefinder.'
        )
      }
    }
  } else if (ctun.length > 0 && rfnd.length > 0) {
    groundTruth = 'rangefinder'
    const aligned = alignSamples(ctun, rfnd)
    points = findSteadyWindows(aligned, true)
    if (points.length === 0) {
      warnings.push(
        'No steady hover found — hold a stable throttle at a fixed height for several seconds (ideally at 2–3 different heights).'
      )
    } else if (points.length === 1) {
      warnings.push(
        'Only one steady hover point — the fit is from a single sample. Fly 2–3 steady heights for a more reliable scale.'
      )
    }
  } else if (ctun.length > 0) {
    warnings.push(
      'No downward rangefinder data (RFND, Orient=25, status Good) in this log. Enter the measured height you hovered at below to fit VALT manually, or fly the hover with a downward-facing rangefinder for an automatic fit.'
    )
  }

  const suggestedScale = points.length > 0 ? fitScale(points) : undefined
  const usable = suggestedScale !== undefined

  const summaryParts: string[] = []
  if (usable) {
    const source = groundTruth === 'manual' ? `your entered height (${manualTrueAltM!.toFixed(1)} m)` : 'the rangefinder'
    summaryParts.push(
      `Fitted BARO1_THST_SCALE = ${suggestedScale} Pa from ${points.length} steady hover ${points.length === 1 ? 'point' : 'points'} vs ${source}.`
    )
    if (currentScale !== undefined) summaryParts.push(`Current value is ${Number(currentScale.toFixed(1))} Pa.`)
    const worst = points.reduce((a, b) => (Math.abs(b.errorM) > Math.abs(a.errorM) ? b : a))
    summaryParts.push(`Largest baro error ${worst.errorM >= 0 ? '+' : ''}${worst.errorM.toFixed(2)} m at ${(worst.throttle * 100).toFixed(0)}% throttle.`)
  } else {
    summaryParts.push('Could not fit a baro thrust scale from this log — see the warnings.')
  }

  return {
    usable,
    groundTruth,
    warnings,
    points,
    suggestedScale,
    currentScale,
    summary: summaryParts.join(' ')
  }
}

/** Convenience: parse a raw `.bin` buffer and run the VALT analysis. */
export function analyzeValtBuffer(input: ArrayBuffer | Uint8Array, options: ValtOptions = {}): ValtResult {
  return analyzeValtLog(parseDataflashLog(input), options)
}
