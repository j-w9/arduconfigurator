// Fit BARO1_THST_SCALE from a bench throttle ramp, with no altitude truth.
//
// A port of the operator's baro_thst_cal.py, kept faithful to its defaults and
// its reasoning. The browser version drops Pyodide: the same arithmetic in
// TypeScript reads a log through the parser this package already has, with no
// 10 MB runtime fetched from a CDN.
//
// The idea, and why it beats the hover method next door: AP_Baro subtracts
// BARO1_THST_SCALE * lpf(throttle_out, BARO_THST_FILT) from the raw pressure
// (AP_Baro.cpp, thrust_pressure_correction). If the airframe is physically
// FIXED -- clamped, or held nose-down so the wash goes sideways and nothing
// lifts -- then every Pascal the baro moves after the throttle comes up is the
// thrust effect and nothing else. The scale is just the slope of
// (BARO.Press - P0) against the filtered MOTB.ThrOut. No rangefinder, no
// measured hover height, nothing to be wrong about except the restraint.
//
// Sources, and why each:
//   - BARO.Press is the RAW pressure (AP_Baro_Logging.cpp logs get_pressure();
//     CPress is the compensated one), so the fit is the TOTAL scale to set,
//     whatever the log already had.
//   - MOTB.ThrOut is motors->get_throttle_out(), the exact input the firmware
//     filters. CTUN.ThO is the attitude controller's request and differs under
//     mixer limiting.
//
// The trap this cannot see: a real hover looks identical to a clamped vehicle
// from the accelerometer (|acc| = g in both). The analysis flags a run that
// looks like a hover; only the operator knows how it was flown.

import { parseDataflashLog, type DataflashMessage, type ParsedDataflashLog } from './dataflash-parser.js'

/** Cutoffs scanned to see which BARO_THST_FILT the pressure actually follows. */
const FILTER_SCAN_HZ = [0, 0.3, 0.5, 0.7, 1.0, 1.5, 2.0, 3.0] as const
/** Throttle bucket width for the per-band table. */
const BUCKET = 0.04
/** ArduPilot's EV ids for armed / disarmed. */
const EV_ARMED = 10
const EV_DISARMED = 11
/** BARO1_THST_SCALE's documented range (AP_Baro: @Range -300 300). */
const SCALE_LIMIT = 300
/** Hover band half-width used for the recommendation. */
const HOVER_BAND = 0.03

export interface BaroThrustRampOptions {
  /** Cutoff to fit at. Defaults to the log's BARO_THST_FILT, else 1 Hz. */
  filterHz?: number
  /** ThrOut above this counts as throttle-up. */
  throttleMin?: number
  /** Skip samples with |ThrOut - lpf(ThrOut)| above this in the slope fit. */
  settleBand?: number
}

export interface BaroThrustBucket {
  throttleFrom: number
  throttleTo: number
  samples: number
  /** Mean pressure change over the bucket (Pa). */
  meanDeltaPa: number
  /** That change expressed as altitude error (m). */
  errorM: number
  /** Mean dP/throttle in the bucket — the local slope. */
  slopePaPerThrottle: number
  /** Residual against the run's fitted slope (Pa). */
  residualPa: number
  /** True when MOT_THST_HOVER falls in this bucket. */
  isHoverBand: boolean
}

export interface BaroThrustRun {
  index: number
  startS: number
  throttleUpS: number
  endS: number
  /** Baseline pressure taken just before throttle-up (Pa). */
  baselinePa: number
  /** Standard deviation of the baseline window — the ambient-drift check. */
  baselineStdPa: number
  /** True when the baseline had to be taken before arming. */
  baselinePreArm: boolean
  throttleMin: number
  throttleMax: number
  deltaMinPa: number
  deltaMaxPa: number
  /** Local Pa per metre, from the log's own pressure-to-altitude conversion. */
  paPerM: number
  /** Slope through the origin on settled samples (Pa per unit throttle). */
  slopePaPerThrottle: number
  /** Slope with an intercept — a large intercept means it is not proportional. */
  slopeWithInterceptPaPerThrottle: number
  interceptPa: number
  residualStdPa: number
  settledSamples: number
  droppedSamples: number
  meanRollDeg?: number
  meanPitchDeg?: number
  meanAccelMagnitude?: number
  meanGyroDegPerS?: number
  buckets: BaroThrustBucket[]
  /** Set when the run looks like a free hover rather than a restrained ramp. */
  looksLikeHover: boolean
  /** Fraction of the run sitting within HOVER_BAND of MOT_THST_HOVER. */
  hoverFraction?: number
}

export interface BaroThrustFilterScanEntry {
  filterHz: number
  slopePaPerThrottle: number
  residualStdPa: number
}

export interface BaroThrustRampResult {
  runs: BaroThrustRun[]
  /** Slope over every settled sample from every run. */
  globalSlopePaPerThrottle: number
  /** Slope restricted to the hover band, when there were samples there. */
  hoverSlopePaPerThrottle?: number
  hoverSamples?: number
  /** The value to set: the hover-band slope when available, rounded to 5 Pa. */
  recommendedScale: number
  /** Mean residual in the hover band at the recommended value (Pa). */
  hoverResidualPa?: number
  /** Uncompensated altitude error at hover throttle with that scale (m). */
  hoverErrorM?: number
  /** Cutoff scan across the whole log, lowest residual first in `bestFilterHz`. */
  filterScan: BaroThrustFilterScanEntry[]
  bestFilterHz: number
  filterHz: number
  currentScale?: number
  currentFilterHz?: number
  hoverThrottle?: number
  /** Anything the operator has to weigh before trusting the number. */
  warnings: string[]
}

/** ArduPilot's LowPassFilterFloat::apply(sample, dt), run over a series. */
export function lowPassFilter(values: readonly number[], times: readonly number[], cutoffHz: number): number[] {
  const out = new Array<number>(values.length)
  if (values.length === 0) {
    return out
  }
  out[0] = values[0]!
  if (cutoffHz <= 0) {
    return values.slice()
  }
  const rc = 1 / (2 * Math.PI * cutoffHz)
  for (let i = 1; i < values.length; i += 1) {
    const dt = times[i]! - times[i - 1]!
    const alpha = dt / (dt + rc)
    out[i] = out[i - 1]! + alpha * (values[i]! - out[i - 1]!)
  }
  return out
}

/** Least squares through the origin: the model AP_Baro actually implements. */
export function fitThroughOrigin(x: readonly number[], y: readonly number[]): number {
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < x.length; i += 1) {
    sxx += x[i]! * x[i]!
    sxy += x[i]! * y[i]!
  }
  return sxx > 0 ? sxy / sxx : Number.NaN
}

/** Ordinary least squares with an intercept, for the not-proportional check. */
export function fitLine(x: readonly number[], y: readonly number[]): { slope: number; intercept: number } {
  const n = x.length
  if (n < 3) {
    return { slope: Number.NaN, intercept: Number.NaN }
  }
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i += 1) {
    sx += x[i]!
    sy += y[i]!
    sxx += x[i]! * x[i]!
    sxy += x[i]! * y[i]!
  }
  const denominator = n * sxx - sx * sx
  if (denominator === 0) {
    return { slope: Number.NaN, intercept: Number.NaN }
  }
  const slope = (n * sxy - sx * sy) / denominator
  return { slope, intercept: (sy - slope * sx) / n }
}

function numberField(message: DataflashMessage, field: string): number | undefined {
  const value = message[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Linear interpolation of a sampled series onto another series' timestamps. */
function resample(
  targetTimes: readonly number[],
  sourceTimes: readonly number[],
  sourceValues: readonly number[],
  outOfRange = 0
): number[] {
  const out = new Array<number>(targetTimes.length).fill(outOfRange)
  if (sourceTimes.length === 0) {
    return out
  }
  let cursor = 0
  for (let i = 0; i < targetTimes.length; i += 1) {
    const t = targetTimes[i]!
    if (t <= sourceTimes[0]!) {
      out[i] = t < sourceTimes[0]! ? outOfRange : sourceValues[0]!
      continue
    }
    if (t >= sourceTimes[sourceTimes.length - 1]!) {
      out[i] = t > sourceTimes[sourceTimes.length - 1]! ? outOfRange : sourceValues[sourceValues.length - 1]!
      continue
    }
    while (cursor < sourceTimes.length - 2 && sourceTimes[cursor + 1]! < t) {
      cursor += 1
    }
    const t0 = sourceTimes[cursor]!
    const t1 = sourceTimes[cursor + 1]!
    const span = t1 - t0
    const ratio = span > 0 ? (t - t0) / span : 0
    out[i] = sourceValues[cursor]! + ratio * (sourceValues[cursor + 1]! - sourceValues[cursor]!)
  }
  return out
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return Number.NaN
  }
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}

function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) {
    return Number.NaN
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? Number.NaN : values.reduce((sum, value) => sum + value, 0) / values.length
}

function readLogParameters(log: ParsedDataflashLog): Map<string, number> {
  const params = new Map<string, number>()
  for (const message of log.messagesByType.get('PARM') ?? []) {
    const name = message.Name
    const value = numberField(message, 'Value')
    if (typeof name === 'string' && value !== undefined) {
      params.set(name, value)
    }
  }
  return params
}

/** Armed intervals from the EV stream, or the whole log when it has none. */
function armedSegments(log: ParsedDataflashLog, firstS: number, lastS: number): { startS: number; endS: number }[] {
  const events = log.messagesByType.get('EV') ?? []
  const segments: { startS: number; endS: number }[] = []
  let armedAt: number | undefined
  for (const event of events) {
    const t = numberField(event, 'TimeUS')
    const id = numberField(event, 'Id')
    if (t === undefined || id === undefined) {
      continue
    }
    if (id === EV_ARMED) {
      armedAt = t * 1e-6
    } else if (id === EV_DISARMED && armedAt !== undefined) {
      segments.push({ startS: armedAt, endS: t * 1e-6 })
      armedAt = undefined
    }
  }
  if (armedAt !== undefined) {
    segments.push({ startS: armedAt, endS: lastS })
  }
  // A log with no EV records (or a bench run captured with LOG_DISARMED) still
  // has a ramp in it; treating the whole log as one segment finds it.
  return segments.length > 0 ? segments : [{ startS: firstS, endS: lastS }]
}

/**
 * Fit BARO1_THST_SCALE from a restrained throttle ramp.
 *
 * Throws with a plain-language reason when the log cannot answer, rather than
 * returning a number nobody should act on.
 */
export function analyzeBaroThrustRampLog(
  log: ParsedDataflashLog,
  options: BaroThrustRampOptions = {}
): BaroThrustRampResult {
  const params = readLogParameters(log)

  const baroMessages = (log.messagesByType.get('BARO') ?? []).filter(
    (message) => (numberField(message, 'I') ?? 0) === 0
  )
  const motbMessages = log.messagesByType.get('MOTB') ?? []
  if (baroMessages.length < 20) {
    throw new Error('This log has no BARO records for the primary barometer, so there is nothing to fit.')
  }
  if (motbMessages.length === 0) {
    throw new Error(
      'This log has no MOTB records, so the throttle the firmware actually filters is not in it. Enable the MOTB (motor battery/throttle) log bit and fly the ramp again.'
    )
  }

  const times: number[] = []
  const pressures: number[] = []
  const altitudes: number[] = []
  for (const message of baroMessages) {
    const t = numberField(message, 'TimeUS')
    const press = numberField(message, 'Press')
    const alt = numberField(message, 'Alt')
    if (t === undefined || press === undefined || alt === undefined) {
      continue
    }
    times.push(t * 1e-6)
    pressures.push(press)
    altitudes.push(alt)
  }
  if (times.length < 20) {
    throw new Error('This log has too few usable BARO samples to fit anything.')
  }

  const motbTimes: number[] = []
  const motbThrottle: number[] = []
  for (const message of motbMessages) {
    const t = numberField(message, 'TimeUS')
    const throttle = numberField(message, 'ThrOut')
    if (t === undefined || throttle === undefined) {
      continue
    }
    motbTimes.push(t * 1e-6)
    motbThrottle.push(throttle)
  }
  const throttle = resample(times, motbTimes, motbThrottle, 0)

  // Attitude and IMU are context for the operator, never inputs to the fit.
  const angMessages = log.messagesByType.get('ANG') ?? []
  const angTimes = angMessages.map((message) => (numberField(message, 'TimeUS') ?? 0) * 1e-6)
  const rollSeries = angMessages.length > 0 ? resample(times, angTimes, angMessages.map((m) => numberField(m, 'Roll') ?? 0)) : undefined
  const pitchSeries = angMessages.length > 0 ? resample(times, angTimes, angMessages.map((m) => numberField(m, 'Pitch') ?? 0)) : undefined

  const imuMessages = (log.messagesByType.get('IMU') ?? []).filter((message) => (numberField(message, 'I') ?? 0) === 0)
  const imuTimes = imuMessages.map((message) => (numberField(message, 'TimeUS') ?? 0) * 1e-6)
  const accelMagnitude =
    imuMessages.length > 0
      ? resample(
          times,
          imuTimes,
          imuMessages.map((m) =>
            Math.hypot(numberField(m, 'AccX') ?? 0, numberField(m, 'AccY') ?? 0, numberField(m, 'AccZ') ?? 0)
          )
        )
      : undefined
  const gyroMagnitude =
    imuMessages.length > 0
      ? resample(
          times,
          imuTimes,
          imuMessages.map(
            (m) =>
              (180 / Math.PI) *
              Math.hypot(numberField(m, 'GyrX') ?? 0, numberField(m, 'GyrY') ?? 0, numberField(m, 'GyrZ') ?? 0)
          )
        )
      : undefined

  const filterHz = options.filterHz ?? params.get('BARO_THST_FILT') ?? 1.0
  const throttleMin = options.throttleMin ?? 0.01
  const settleBand = options.settleBand ?? 0.02
  const hoverThrottle = params.get('MOT_THST_HOVER')

  const filtered = lowPassFilter(throttle, times, filterHz)
  const settled = throttle.map((value, index) => Math.abs(value - filtered[index]!) <= settleBand)

  const warnings: string[] = []
  const runs: BaroThrustRun[] = []
  const combinedSelected: number[] = []
  const combinedDelta: number[] = []

  const segments = armedSegments(log, times[0]!, times[times.length - 1]!)
  segments.forEach((segment, segmentIndex) => {
    const upIndex = times.findIndex(
      (t, index) => t >= segment.startS && t < segment.endS && throttle[index]! > throttleMin
    )
    if (upIndex < 0) {
      return
    }
    const throttleUpS = times[upIndex]!
    const inRun = times.map((t) => t >= throttleUpS && t < segment.endS)
    const runCount = inRun.filter(Boolean).length
    if (runCount < 20) {
      return
    }

    // Baseline: armed, motors at spin-arm, in the run's own orientation. A
    // pre-arm baseline in a different attitude can be ~1 Pa out from port
    // sensitivity, so it is used only as a fallback and flagged.
    let baselineMask = times.map(
      (t) => t >= Math.max(segment.startS, throttleUpS - 3) && t < throttleUpS - 0.2
    )
    let baselinePreArm = false
    if (baselineMask.filter(Boolean).length < 5) {
      baselineMask = times.map((t) => t >= throttleUpS - 3 && t < throttleUpS - 0.2)
      baselinePreArm = true
    }
    const baselineValues = pressures.filter((_, index) => baselineMask[index]!)
    if (baselineValues.length < 5) {
      return
    }
    const baselinePa = median(baselineValues)
    const delta = pressures.map((value) => value - baselinePa)

    // Pa per metre from the log's own pressure-to-altitude conversion, rather
    // than a sea-level constant: the run's own air is the right reference.
    const runPressures = pressures.filter((_, index) => inRun[index]!)
    const runAltitudes = altitudes.filter((_, index) => inRun[index]!)
    const altFit = fitLine(runPressures, runAltitudes)
    const paPerM = altFit.slope !== 0 && Number.isFinite(altFit.slope) ? -1 / altFit.slope : Number.NaN

    const selectedIndices: number[] = []
    for (let index = 0; index < times.length; index += 1) {
      if (inRun[index] && settled[index]) {
        selectedIndices.push(index)
      }
    }
    if (selectedIndices.length < 10) {
      return
    }
    const selectedThrottle = selectedIndices.map((index) => filtered[index]!)
    const selectedDelta = selectedIndices.map((index) => delta[index]!)
    const slope = fitThroughOrigin(selectedThrottle, selectedDelta)
    const withIntercept = fitLine(selectedThrottle, selectedDelta)
    const residuals = selectedDelta.map((value, i) => value - slope * selectedThrottle[i]!)

    const runThrottles = throttle.filter((_, index) => inRun[index]!)
    const runDeltas = delta.filter((_, index) => inRun[index]!)

    // Buckets of filtered throttle: the response is usually mildly convex, and
    // a linear parameter cannot follow that, so the column is what tells the
    // operator where the chosen value is honest.
    const buckets: BaroThrustBucket[] = []
    const maxFilteredThrottle = Math.max(...selectedThrottle)
    for (let low = 0; low < maxFilteredThrottle; low += BUCKET) {
      const bucketIndices = selectedIndices.filter(
        (index) => filtered[index]! >= low && filtered[index]! < low + BUCKET
      )
      if (bucketIndices.length < 5) {
        continue
      }
      const meanDelta = mean(bucketIndices.map((index) => delta[index]!))
      const meanThrottle = mean(bucketIndices.map((index) => filtered[index]!))
      buckets.push({
        throttleFrom: low,
        throttleTo: low + BUCKET,
        samples: bucketIndices.length,
        meanDeltaPa: meanDelta,
        errorM: -meanDelta / paPerM,
        slopePaPerThrottle: meanDelta / meanThrottle,
        residualPa: meanDelta - slope * meanThrottle,
        isHoverBand: hoverThrottle !== undefined && low <= hoverThrottle && hoverThrottle < low + BUCKET
      })
    }

    const meanPitch = pitchSeries ? mean(selectedIndices.map((index) => pitchSeries[index]!)) : undefined
    const hoverFraction =
      hoverThrottle !== undefined
        ? runThrottles.filter((value) => Math.abs(value - hoverThrottle) < HOVER_BAND).length / runThrottles.length
        : undefined
    // The trap: a free hover reads the same as a clamped vehicle. Say so when
    // the run has the shape of one.
    const looksLikeHover =
      hoverFraction !== undefined &&
      hoverFraction > 0.5 &&
      meanPitch !== undefined &&
      Math.abs(meanPitch) < 20

    runs.push({
      index: segmentIndex + 1,
      startS: segment.startS,
      throttleUpS,
      endS: segment.endS,
      baselinePa,
      baselineStdPa: standardDeviation(baselineValues),
      baselinePreArm,
      throttleMin: Math.min(...runThrottles),
      throttleMax: Math.max(...runThrottles),
      deltaMinPa: Math.min(...runDeltas),
      deltaMaxPa: Math.max(...runDeltas),
      paPerM,
      slopePaPerThrottle: slope,
      slopeWithInterceptPaPerThrottle: withIntercept.slope,
      interceptPa: withIntercept.intercept,
      residualStdPa: standardDeviation(residuals),
      settledSamples: selectedIndices.length,
      droppedSamples: runCount - selectedIndices.length,
      meanRollDeg: rollSeries ? mean(selectedIndices.map((index) => rollSeries[index]!)) : undefined,
      meanPitchDeg: meanPitch,
      meanAccelMagnitude: accelMagnitude ? mean(selectedIndices.map((index) => accelMagnitude[index]!)) : undefined,
      meanGyroDegPerS: gyroMagnitude ? mean(selectedIndices.map((index) => gyroMagnitude[index]!)) : undefined,
      buckets,
      looksLikeHover,
      hoverFraction
    })

    selectedIndices.forEach((index, i) => {
      combinedSelected.push(filtered[index]!)
      combinedDelta.push(selectedDelta[i]!)
    })
  })

  if (runs.length === 0) {
    throw new Error(
      'No throttle ramp with a usable baseline found. The run needs a few seconds of steady, near-zero throttle before the ramp so the analysis has a pressure to measure against.'
    )
  }

  const globalSlope = fitThroughOrigin(combinedSelected, combinedDelta)
  let recommended = 5 * Math.round(globalSlope / 5)
  let hoverSlope: number | undefined
  let hoverSamples: number | undefined
  let hoverResidual: number | undefined

  if (hoverThrottle !== undefined) {
    const hoverIndices: number[] = []
    for (let i = 0; i < combinedSelected.length; i += 1) {
      if (Math.abs(combinedSelected[i]! - hoverThrottle) < HOVER_BAND) {
        hoverIndices.push(i)
      }
    }
    if (hoverIndices.length >= 10) {
      // The hover band, not the global line: a linear parameter cannot follow a
      // bent bucket column, so zero the error where the aircraft actually flies.
      hoverSlope = fitThroughOrigin(
        hoverIndices.map((i) => combinedSelected[i]!),
        hoverIndices.map((i) => combinedDelta[i]!)
      )
      hoverSamples = hoverIndices.length
      recommended = 5 * Math.round(hoverSlope / 5)
      hoverResidual = mean(hoverIndices.map((i) => combinedDelta[i]! - recommended * combinedSelected[i]!))
    } else {
      warnings.push(
        `No samples in the hover band (${hoverThrottle.toFixed(2)} ± ${HOVER_BAND}), so the recommendation is the global slope rather than the value that zeroes the error at hover.`
      )
    }
  }

  // Cutoff scan: which BARO_THST_FILT the pressure actually follows. Run on ALL
  // samples, not settled ones, because the steps are what identify the lag.
  const allRunIndices: number[] = []
  for (const run of runs) {
    for (let index = 0; index < times.length; index += 1) {
      if (times[index]! >= run.throttleUpS && times[index]! < run.endS) {
        allRunIndices.push(index)
      }
    }
  }
  const baselineByRun = new Map<number, number>()
  runs.forEach((run) => baselineByRun.set(run.index, run.baselinePa))
  const scanDelta = allRunIndices.map((index) => {
    const run = runs.find((candidate) => times[index]! >= candidate.throttleUpS && times[index]! < candidate.endS)
    return pressures[index]! - (run?.baselinePa ?? 0)
  })
  const filterScan: BaroThrustFilterScanEntry[] = FILTER_SCAN_HZ.map((scanHz) => {
    const scanFiltered = scanHz === filterHz ? filtered : lowPassFilter(throttle, times, scanHz)
    const x = allRunIndices.map((index) => scanFiltered[index]!)
    const slope = fitThroughOrigin(x, scanDelta)
    const residual = standardDeviation(scanDelta.map((value, i) => value - slope * x[i]!))
    return { filterHz: scanHz, slopePaPerThrottle: slope, residualStdPa: residual }
  })
  const bestFilter = filterScan.reduce((best, entry) => (entry.residualStdPa < best.residualStdPa ? entry : best))

  for (const run of runs) {
    if (run.looksLikeHover) {
      warnings.push(
        `Run ${run.index}: ${Math.round((run.hoverFraction ?? 0) * 100)}% of it sits within ${HOVER_BAND} of MOT_THST_HOVER with the vehicle level. That is the shape of a hover, not a bench ramp — the fit is only valid if the airframe was physically restrained.`
      )
    }
    if (run.baselinePreArm) {
      warnings.push(
        `Run ${run.index}: the baseline had to be taken before arming (less than a second armed before throttle-up). A baseline in a different attitude can be ~1 Pa out, which is 0.1 m.`
      )
    }
    if (run.baselineStdPa > 2) {
      warnings.push(
        `Run ${run.index}: the pre-throttle baseline drifted by ${run.baselineStdPa.toFixed(1)} Pa. Ambient drift aliases into the slope, so keep runs under a minute.`
      )
    }
  }
  if (Math.abs(recommended) > SCALE_LIMIT) {
    warnings.push(
      `The fitted value (${recommended.toFixed(0)} Pa) is outside BARO1_THST_SCALE's documented range of ±${SCALE_LIMIT}.`
    )
  }
  if (Math.abs(bestFilter.filterHz - filterHz) > 0.01) {
    warnings.push(
      `The pressure follows a ${bestFilter.filterHz.toFixed(1)} Hz filter better than the ${filterHz.toFixed(1)} Hz in use — consider BARO_THST_FILT = ${bestFilter.filterHz.toFixed(1)} and re-fitting.`
    )
  }

  const firstRun = runs[0]!
  return {
    runs,
    globalSlopePaPerThrottle: globalSlope,
    hoverSlopePaPerThrottle: hoverSlope,
    hoverSamples,
    recommendedScale: recommended,
    hoverResidualPa: hoverResidual,
    hoverErrorM:
      hoverThrottle !== undefined && Number.isFinite(firstRun.paPerM)
        ? -(recommended * hoverThrottle) / firstRun.paPerM
        : undefined,
    filterScan,
    bestFilterHz: bestFilter.filterHz,
    filterHz,
    currentScale: params.get('BARO1_THST_SCALE'),
    currentFilterHz: params.get('BARO_THST_FILT'),
    hoverThrottle,
    warnings
  }
}

/** Parse a raw `.bin` and fit it. The buffer entry point the UI uses. */
export function analyzeBaroThrustRamp(
  input: ArrayBuffer | Uint8Array,
  options: BaroThrustRampOptions = {}
): BaroThrustRampResult {
  return analyzeBaroThrustRampLog(parseDataflashLog(input), options)
}
