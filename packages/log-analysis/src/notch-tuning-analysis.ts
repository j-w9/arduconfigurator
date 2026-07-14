// Log-based notch / filter / rate-tuning analysis — the automation of the
// manual pass done on a real quad this session: FFT the gyro to find the
// dominant vibration / oscillation, read motor RPM to place the harmonic notch,
// check accel vibration, and flag a rate-loop limit cycle. Output is a set of
// human-reviewed parameter recommendations (never written without approval).
//
// It works on compass-less FPV logs (no MAG needed). Correctness of the signal
// math is covered by the FFT tests; the recommendation THRESHOLDS are advisory
// and tagged with a confidence, and are meant to be validated against real logs.

import { parseDataflashLog, type ParsedDataflashLog, type DataflashMessage } from './dataflash-parser.js'
import { powerSpectrum, findSpectralPeaks, type PowerSpectrum, type SpectralPeak } from './gyro-fft.js'

export type Axis = 'roll' | 'pitch' | 'yaw'
export type Confidence = 'high' | 'medium' | 'low'

export interface TuningRecommendation {
  param: string
  currentValue?: number
  suggestedValue: number
  reason: string
  confidence: Confidence
}

export interface AxisSpectrum {
  axis: Axis
  peaks: SpectralPeak[]
  /** Dominant peak (strongest), if any. */
  dominant?: SpectralPeak
}

export interface LogTuningResult {
  /** True when the log looks good enough to tune from (see gateWarnings). */
  usable: boolean
  /** Reasons the log may be unsuitable — surfaced to the operator as warnings. */
  gateWarnings: string[]
  gyroSource: 'batch' | 'imu' | 'none'
  gyroSampleRateHz: number
  axisSpectra: AxisSpectrum[]
  /** Motor fundamental from ESC RPM (Hz), if ESC telemetry is present. */
  motorFundamentalHz?: number
  escRpm?: { minHz: number; meanHz: number; maxHz: number }
  vibe?: { max: [number, number, number]; clip: [number, number, number]; verdict: 'good' | 'marginal' | 'bad' }
  /** A sharp single-axis low-frequency peak that reads as a rate-loop limit cycle. */
  limitCycle?: { axis: Axis; freqHz: number }
  recommendations: TuningRecommendation[]
  summary: string
}

const GYRO_AXES: { axis: Axis; batchType: number; imuField: string }[] = [
  { axis: 'roll', batchType: 1, imuField: 'GyrX' },
  { axis: 'pitch', batchType: 1, imuField: 'GyrY' },
  { axis: 'yaw', batchType: 1, imuField: 'GyrZ' }
]

function num(msg: DataflashMessage, field: string): number | undefined {
  const v = msg[field]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** Current parameter values captured in the log's PARM records. */
export function paramsFromLog(log: ParsedDataflashLog): Map<string, number> {
  const out = new Map<string, number>()
  for (const m of log.messagesByType.get('PARM') ?? []) {
    const name = m.Name
    const value = m.Value
    if (typeof name === 'string' && typeof value === 'number') {
      out.set(name, value)
    }
  }
  return out
}

/**
 * Reconstruct the high-rate gyro batch-sampler bursts (ISBH/ISBD) for IMU
 * instance 0. Returns one flattened signal per axis (x→roll, y→pitch, z→yaw)
 * plus the sample rate, or null when no gyro batch data is present.
 */
function extractGyroBatch(log: ParsedDataflashLog): { roll: number[]; pitch: number[]; yaw: number[]; sampleRateHz: number } | null {
  const headers = log.messagesByType.get('ISBH')
  const data = log.messagesByType.get('ISBD')
  if (!headers || !data || headers.length === 0 || data.length === 0) {
    return null
  }
  // Index ISBD arrays by batch id N.
  const dataByBatch = new Map<number, DataflashMessage[]>()
  for (const d of data) {
    const n = num(d, 'N')
    if (n === undefined) continue
    let arr = dataByBatch.get(n)
    if (!arr) {
      arr = []
      dataByBatch.set(n, arr)
    }
    arr.push(d)
  }
  const roll: number[] = []
  const pitch: number[] = []
  const yaw: number[] = []
  let sampleRateHz = 0
  for (const h of headers) {
    if (num(h, 'type') !== 1 || num(h, 'instance') !== 0) {
      continue // gyro (type 1), primary IMU only
    }
    const n = num(h, 'N')
    if (n === undefined) continue
    const rate = num(h, 'smp_rate')
    if (rate && rate > sampleRateHz) sampleRateHz = rate
    const records = (dataByBatch.get(n) ?? []).slice().sort((a, b) => (num(a, 'seqno') ?? 0) - (num(b, 'seqno') ?? 0))
    for (const rec of records) {
      const x = rec.x
      const y = rec.y
      const z = rec.z
      if (Array.isArray(x) && Array.isArray(y) && Array.isArray(z)) {
        for (let i = 0; i < x.length; i += 1) {
          roll.push(x[i])
          pitch.push(y[i])
          yaw.push(z[i])
        }
      }
    }
  }
  if (roll.length < 256 || sampleRateHz <= 0) {
    return null
  }
  return { roll, pitch, yaw, sampleRateHz }
}

/** Fallback: gyro from the ordinary IMU message (instance 0), sample rate from timestamps. */
function extractGyroImu(log: ParsedDataflashLog): { roll: number[]; pitch: number[]; yaw: number[]; sampleRateHz: number } | null {
  const imu = (log.messagesByType.get('IMU') ?? []).filter((m) => num(m, 'I') === 0)
  if (imu.length < 256) {
    return null
  }
  const roll: number[] = []
  const pitch: number[] = []
  const yaw: number[] = []
  for (const m of imu) {
    const gx = num(m, 'GyrX')
    const gy = num(m, 'GyrY')
    const gz = num(m, 'GyrZ')
    if (gx === undefined || gy === undefined || gz === undefined) continue
    roll.push(gx)
    pitch.push(gy)
    yaw.push(gz)
  }
  const t0 = num(imu[0], 'TimeUS')
  const t1 = num(imu[imu.length - 1], 'TimeUS')
  const sampleRateHz = t0 !== undefined && t1 !== undefined && t1 > t0 ? (imu.length - 1) / ((t1 - t0) / 1e6) : 0
  if (roll.length < 256 || sampleRateHz <= 0) {
    return null
  }
  return { roll, pitch, yaw, sampleRateHz }
}

/** Average the power spectra of a long signal split into windows (Welch-ish). */
function averagedSpectrum(signal: number[], sampleRateHz: number, windowSize = 1024): PowerSpectrum {
  if (signal.length <= windowSize) {
    return powerSpectrum(signal, sampleRateHz)
  }
  const step = windowSize
  let acc: Float64Array | null = null
  let freqHz: Float64Array | null = null
  let binHz = 0
  let count = 0
  for (let start = 0; start + windowSize <= signal.length; start += step) {
    const spec = powerSpectrum(signal.slice(start, start + windowSize), sampleRateHz)
    if (!acc) {
      acc = new Float64Array(spec.power.length)
      freqHz = spec.freqHz
      binHz = spec.binHz
    }
    if (spec.power.length === acc.length) {
      for (let i = 0; i < acc.length; i += 1) acc[i] += spec.power[i]
      count += 1
    }
  }
  if (!acc || !freqHz || count === 0) {
    return powerSpectrum(signal.slice(0, windowSize), sampleRateHz)
  }
  for (let i = 0; i < acc.length; i += 1) acc[i] /= count
  return { freqHz, power: acc, binHz }
}

function escRpmSummary(log: ParsedDataflashLog): { minHz: number; meanHz: number; maxHz: number } | undefined {
  const esc = log.messagesByType.get('ESC')
  if (!esc || esc.length === 0) {
    return undefined
  }
  const rpms: number[] = []
  for (const m of esc) {
    const rpm = num(m, 'RPM')
    if (rpm !== undefined && rpm > 100) rpms.push(rpm)
  }
  if (rpms.length === 0) {
    return undefined
  }
  const mean = rpms.reduce((a, b) => a + b, 0) / rpms.length
  return { minHz: Math.min(...rpms) / 60, meanHz: mean / 60, maxHz: Math.max(...rpms) / 60 }
}

function vibeSummary(log: ParsedDataflashLog): LogTuningResult['vibe'] {
  const vibe = log.messagesByType.get('VIBE')
  if (!vibe || vibe.length === 0) {
    return undefined
  }
  const max: [number, number, number] = [0, 0, 0]
  const clip: [number, number, number] = [0, 0, 0]
  for (const m of vibe) {
    const x = num(m, 'VibeX') ?? 0
    const y = num(m, 'VibeY') ?? 0
    const z = num(m, 'VibeZ') ?? 0
    max[0] = Math.max(max[0], x)
    max[1] = Math.max(max[1], y)
    max[2] = Math.max(max[2], z)
    clip[0] = Math.max(clip[0], num(m, 'Clip0') ?? num(m, 'Clip') ?? 0)
    clip[1] = Math.max(clip[1], num(m, 'Clip1') ?? 0)
    clip[2] = Math.max(clip[2], num(m, 'Clip2') ?? 0)
  }
  const worst = Math.max(...max)
  const clipped = Math.max(...clip)
  const verdict = clipped > 0 || worst > 30 ? 'bad' : worst > 15 ? 'marginal' : 'good'
  return { max, clip, verdict }
}

/**
 * Analyse a parsed dataflash log for notch / filter / rate tuning. `log` is the
 * output of {@link parseDataflashLog}; recommendations compare against the
 * parameter values captured in the log (PARM records) when present.
 */
export function analyzeLogTuning(log: ParsedDataflashLog): LogTuningResult {
  const params = paramsFromLog(log)
  const gateWarnings: string[] = []

  // Gyro source: prefer the high-rate batch sampler; fall back to IMU.
  let source: 'batch' | 'imu' | 'none' = 'none'
  let gyro = extractGyroBatch(log)
  if (gyro) {
    source = 'batch'
  } else {
    gyro = extractGyroImu(log)
    if (gyro) {
      source = 'imu'
      gateWarnings.push(
        'No gyro batch-sampler (ISBD) data — using the lower-rate IMU log. Enable INS_LOG_BAT_MASK and re-fly for a proper high-frequency spectrum.'
      )
    }
  }

  const axisSpectra: AxisSpectrum[] = []
  let limitCycle: LogTuningResult['limitCycle']
  if (gyro) {
    const nyquist = gyro.sampleRateHz / 2
    for (const { axis } of GYRO_AXES) {
      const signal = gyro[axis]
      const spec = averagedSpectrum(signal, gyro.sampleRateHz)
      const peaks = findSpectralPeaks(spec, { minFreqHz: 5, maxFreqHz: nyquist, minRelative: 0.05 })
      axisSpectra.push({ axis, peaks, dominant: peaks[0] })
    }
    // Limit-cycle heuristic: a sharp peak below ~40 Hz that dominates ONE axis
    // far more than the others reads as a rate-loop oscillation.
    const dominants = axisSpectra.filter((a) => a.dominant && a.dominant.freqHz < 40)
    if (dominants.length > 0) {
      const strongest = dominants.reduce((best, a) =>
        (a.dominant?.power ?? 0) > (best.dominant?.power ?? 0) ? a : best
      )
      const others = axisSpectra.filter((a) => a.axis !== strongest.axis)
      const otherMax = Math.max(0, ...others.map((a) => a.dominant?.power ?? 0))
      if (strongest.dominant && strongest.dominant.power > otherMax * 4) {
        limitCycle = { axis: strongest.axis, freqHz: strongest.dominant.freqHz }
      }
    }
  } else {
    gateWarnings.push('No usable gyro data (neither ISBD batch nor IMU) — cannot analyse vibration or oscillation.')
  }

  const esc = escRpmSummary(log)
  const motorFundamentalHz = esc?.meanHz
  const vibe = vibeSummary(log)

  // ---- Quality gate ----
  const armedEvidence = (log.messagesByType.get('RATE')?.length ?? 0) > 100 || (log.messagesByType.get('CTUN')?.length ?? 0) > 100
  if (!armedEvidence) {
    gateWarnings.push('Little/no in-flight data (RATE/CTUN) — this needs an actual hover/flight log, not a bench session.')
  }
  if (source === 'batch' && gyro && gyro.roll.length < 4096) {
    gateWarnings.push('Very short flight — a longer steady hover (30–60 s) gives a cleaner spectrum.')
  }
  const usable = gyro !== null && armedEvidence

  // ---- Recommendations (advisory; staged for human approval) ----
  const recommendations: TuningRecommendation[] = []

  // Harmonic notch, driven by motor RPM (ESC telemetry present).
  if (esc && motorFundamentalHz) {
    if ((params.get('INS_HNTCH_ENABLE') ?? 0) < 1) {
      recommendations.push({
        param: 'INS_HNTCH_ENABLE',
        currentValue: params.get('INS_HNTCH_ENABLE'),
        suggestedValue: 1,
        reason: `ESC RPM telemetry is present (motor fundamental ~${motorFundamentalHz.toFixed(0)} Hz); enable the harmonic notch to track motor noise.`,
        confidence: 'high'
      })
      recommendations.push({
        param: 'INS_HNTCH_MODE',
        currentValue: params.get('INS_HNTCH_MODE'),
        suggestedValue: 3,
        reason: 'Track the notch from ESC RPM telemetry (mode 3) — the most accurate source when available.',
        confidence: 'high'
      })
    }
    const minFreqFloor = Math.max(20, Math.round(esc.minHz * 0.7))
    const currentFreq = params.get('INS_HNTCH_FREQ')
    if (currentFreq === undefined || Math.abs(currentFreq - minFreqFloor) > 15) {
      recommendations.push({
        param: 'INS_HNTCH_FREQ',
        currentValue: currentFreq,
        suggestedValue: minFreqFloor,
        reason: `Set the notch minimum tracking frequency near the lowest motor fundamental seen (~${esc.minHz.toFixed(0)} Hz).`,
        confidence: 'medium'
      })
    }
  }

  // Rate-loop limit cycle → lower that axis's rate D.
  if (limitCycle) {
    const dParam = `ATC_RAT_${limitCycle.axis === 'roll' ? 'RLL' : limitCycle.axis === 'pitch' ? 'PIT' : 'YAW'}_D`
    const current = params.get(dParam)
    if (current !== undefined && current > 0.001) {
      recommendations.push({
        param: dParam,
        currentValue: current,
        suggestedValue: Number((current / 2).toFixed(4)),
        reason: `A sharp ~${limitCycle.freqHz.toFixed(0)} Hz oscillation dominates the ${limitCycle.axis} axis and not the others — the classic rate-loop limit cycle. Halve ${limitCycle.axis} rate D and re-fly.`,
        confidence: 'medium'
      })
    }
  }

  // ---- Summary ----
  const summaryParts: string[] = []
  if (source === 'batch') summaryParts.push(`Gyro spectrum from the batch sampler (~${gyro?.sampleRateHz.toFixed(0)} Hz).`)
  else if (source === 'imu') summaryParts.push(`Gyro spectrum from the IMU log (~${gyro?.sampleRateHz.toFixed(0)} Hz — limited resolution).`)
  if (vibe) summaryParts.push(`Vibration ${vibe.verdict} (peak ${Math.max(...vibe.max).toFixed(0)} m/s², clip ${Math.max(...vibe.clip)}).`)
  if (limitCycle) summaryParts.push(`Likely ${limitCycle.freqHz.toFixed(0)} Hz ${limitCycle.axis}-axis limit cycle.`)
  if (motorFundamentalHz) summaryParts.push(`Motor fundamental ~${motorFundamentalHz.toFixed(0)} Hz.`)
  if (recommendations.length === 0 && usable) summaryParts.push('No parameter changes recommended — the tune looks clean.')

  return {
    usable,
    gateWarnings,
    gyroSource: source,
    gyroSampleRateHz: gyro?.sampleRateHz ?? 0,
    axisSpectra,
    motorFundamentalHz,
    escRpm: esc,
    vibe,
    limitCycle,
    recommendations,
    summary: summaryParts.join(' ')
  }
}

/** Convenience: parse a raw `.bin` buffer and analyse it in one call. */
export function analyzeLogBuffer(input: ArrayBuffer | Uint8Array): LogTuningResult {
  return analyzeLogTuning(parseDataflashLog(input))
}
