// PID analysis — D-term noise measurement, rate tracking, overtune detection,
// P vs D balance, and activity window classification. Ported from the SFD
// Tuning Tool's analysis pass, adapted to this repo's typed conventions.
//
// All computations are pure functions over parsed DataFlash messages; nothing
// here writes parameters.

import type { ParsedDataflashLog, DataflashMessage } from './dataflash-parser.js'
import { parseDataflashLog } from './dataflash-parser.js'
import { paramsFromLog } from './notch-tuning-analysis.js'
import { powerSpectrum, type PowerSpectrum } from './gyro-fft.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function num(msg: DataflashMessage, field: string): number | undefined {
  const v = msg[field]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function mean(arr: ArrayLike<number>): number {
  if (arr.length === 0) return 0
  let s = 0
  for (let i = 0; i < arr.length; i++) s += arr[i]
  return s / arr.length
}

function std(arr: ArrayLike<number>): number {
  if (arr.length < 2) return 0
  const m = mean(arr)
  let s = 0
  for (let i = 0; i < arr.length; i++) { const d = arr[i] - m; s += d * d }
  return Math.sqrt(s / arr.length)
}

function rms(arr: ArrayLike<number>): number {
  if (arr.length === 0) return 0
  let s = 0
  for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i]
  return Math.sqrt(s / arr.length)
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = arr.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0
  const sorted = arr.slice().sort((a, b) => a - b)
  const idx = (p / 100) * (sorted.length - 1)
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

// ---------------------------------------------------------------------------
// DSP: biquad high-pass + filtfilt (zero-phase)
// ---------------------------------------------------------------------------

interface BiquadState { b0: number; b1: number; b2: number; a1: number; a2: number }

function biquadHighpass(fc: number, fs: number): BiquadState {
  const omega = 2 * Math.PI * fc / fs
  const alpha = Math.sin(omega) / (2 * (1 / Math.sqrt(2))) // Q = 1/sqrt(2)
  const cosW = Math.cos(omega)
  const a0 = 1 + alpha
  return {
    b0: ((1 + cosW) / 2) / a0,
    b1: (-(1 + cosW)) / a0,
    b2: ((1 + cosW) / 2) / a0,
    a1: (-2 * cosW) / a0,
    a2: (1 - alpha) / a0
  }
}

function applyBiquad(c: BiquadState, x: Float64Array): Float64Array {
  const n = x.length
  const y = new Float64Array(n)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < n; i++) {
    const xi = x[i]
    y[i] = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
    x2 = x1; x1 = xi; y2 = y1; y1 = y[i]
  }
  return y
}

function reverse(arr: Float64Array): Float64Array {
  const out = new Float64Array(arr.length)
  for (let i = 0; i < arr.length; i++) out[i] = arr[arr.length - 1 - i]
  return out
}

/** Zero-phase biquad filter (forward + reverse pass). */
function filtfilt(c: BiquadState, x: Float64Array): Float64Array {
  return reverse(applyBiquad(c, reverse(applyBiquad(c, x))))
}

// ---------------------------------------------------------------------------
// DSP: Welch PSD estimate
// ---------------------------------------------------------------------------

export interface WelchResult {
  freqs: Float64Array
  power: Float64Array
  fs: number
}

function welch(signal: Float64Array, fs: number, windowSize = 512, overlap = 0.5): WelchResult {
  const step = Math.max(1, Math.round(windowSize * (1 - overlap)))
  let acc: Float64Array | null = null
  let freqs: Float64Array | null = null
  let count = 0
  for (let start = 0; start + windowSize <= signal.length; start += step) {
    const seg = new Array(windowSize)
    for (let i = 0; i < windowSize; i++) seg[i] = signal[start + i]
    const spec = powerSpectrum(seg, fs)
    if (!acc) {
      acc = new Float64Array(spec.power.length)
      freqs = spec.freqHz
    }
    if (spec.power.length === acc.length) {
      for (let i = 0; i < acc.length; i++) acc[i] += spec.power[i]
      count++
    }
  }
  if (!acc || !freqs || count === 0) {
    const spec = powerSpectrum(Array.from(signal.subarray(0, Math.min(windowSize, signal.length))), fs)
    return { freqs: spec.freqHz, power: spec.power, fs }
  }
  for (let i = 0; i < acc.length; i++) acc[i] /= count
  return { freqs, power: acc, fs }
}

// ---------------------------------------------------------------------------
// DSP: cross-correlation lag
// ---------------------------------------------------------------------------

function xcorrLag(a: Float64Array, b: Float64Array, maxLag: number): number {
  const n = Math.min(a.length, b.length)
  let bestCorr = -Infinity
  let bestLag = 0
  for (let lag = 0; lag <= maxLag && lag < n; lag++) {
    let sum = 0
    for (let i = lag; i < n; i++) sum += a[i] * b[i - lag]
    if (sum > bestCorr) { bestCorr = sum; bestLag = lag }
  }
  return bestLag
}

// ---------------------------------------------------------------------------
// Time-series extraction from DataFlash messages
// ---------------------------------------------------------------------------

export type PidAxis = 'Roll' | 'Pitch' | 'Yaw'
const RATE_FIELDS = ['R', 'P', 'Y'] as const // RATE message field prefixes
const PID_MSG_NAMES: Record<PidAxis, string> = { Roll: 'PIDR', Pitch: 'PIDP', Yaw: 'PIDY' }

interface RateTimeSeries {
  t: Float64Array
  desired: Float64Array
  actual: Float64Array
  out: Float64Array
  fs: number
}

interface PidTimeSeries {
  t: Float64Array
  P: Float64Array
  I: Float64Array
  D: Float64Array
  FF: Float64Array
  Tar: Float64Array
  Act: Float64Array
  Err: Float64Array
  Dmod: Float64Array | null
  Limit: Float64Array | null
  fs: number
}

function extractRate(log: ParsedDataflashLog, axis: PidAxis): RateTimeSeries | null {
  const msgs = log.messagesByType.get('RATE')
  if (!msgs || msgs.length < 50) return null
  const prefix = RATE_FIELDS[['Roll', 'Pitch', 'Yaw'].indexOf(axis)]
  const desFld = `${prefix}Des`
  const actFld = `${prefix}`
  const outFld = `${prefix}Out`

  const t: number[] = []
  const desired: number[] = []
  const actual: number[] = []
  const out: number[] = []

  for (const m of msgs) {
    const ts = num(m, 'TimeUS')
    const des = num(m, desFld)
    const act = num(m, actFld)
    const o = num(m, outFld)
    if (ts === undefined || des === undefined || act === undefined || o === undefined) continue
    t.push(ts / 1e6)
    desired.push(des)
    actual.push(act)
    out.push(o)
  }
  if (t.length < 50) return null
  const fs = (t.length - 1) / (t[t.length - 1] - t[0])
  return {
    t: Float64Array.from(t),
    desired: Float64Array.from(desired),
    actual: Float64Array.from(actual),
    out: Float64Array.from(out),
    fs
  }
}

function extractPid(log: ParsedDataflashLog, axis: PidAxis): PidTimeSeries | null {
  const msgName = PID_MSG_NAMES[axis]
  const msgs = log.messagesByType.get(msgName)
  if (!msgs || msgs.length < 50) return null

  const t: number[] = []
  const P: number[] = []
  const I: number[] = []
  const D: number[] = []
  const FF: number[] = []
  const Tar: number[] = []
  const Act: number[] = []
  const Err: number[] = []
  const Dmod: number[] = []
  const Limit: number[] = []
  let hasDmod = false, hasLimit = false

  for (const m of msgs) {
    const ts = num(m, 'TimeUS')
    const p = num(m, 'P')
    const i = num(m, 'I')
    const d = num(m, 'D')
    if (ts === undefined || p === undefined || i === undefined || d === undefined) continue
    t.push(ts / 1e6)
    P.push(p)
    I.push(i)
    D.push(d)
    FF.push(num(m, 'FF') ?? 0)
    Tar.push(num(m, 'Tar') ?? num(m, 'Des') ?? 0)
    Act.push(num(m, 'Act') ?? 0)
    Err.push(num(m, 'Err') ?? 0)
    const dm = num(m, 'Dmod')
    if (dm !== undefined) hasDmod = true
    Dmod.push(dm ?? 1)
    const lim = num(m, 'Limit')
    if (lim !== undefined) hasLimit = true
    Limit.push(lim ?? 0)
  }
  if (t.length < 50) return null
  const fs = (t.length - 1) / (t[t.length - 1] - t[0])
  return {
    t: Float64Array.from(t),
    P: Float64Array.from(P),
    I: Float64Array.from(I),
    D: Float64Array.from(D),
    FF: Float64Array.from(FF),
    Tar: Float64Array.from(Tar),
    Act: Float64Array.from(Act),
    Err: Float64Array.from(Err),
    Dmod: hasDmod ? Float64Array.from(Dmod) : null,
    Limit: hasLimit ? Float64Array.from(Limit) : null,
    fs
  }
}

// ---------------------------------------------------------------------------
// Activity window detection
// ---------------------------------------------------------------------------

export interface ActivityWindow {
  start: number
  end: number
  kind: 'active' | 'quiet'
  stdDesired: number
}

const ACTIVITY_WINDOW_SIZE_S = 1.0
const ACTIVE_THRESHOLD_DEG_S = 15

function detectActivityWindows(rate: RateTimeSeries): ActivityWindow[] {
  const windowSamples = Math.round(ACTIVITY_WINDOW_SIZE_S * rate.fs)
  if (windowSamples < 10 || rate.t.length < windowSamples) return []
  const step = Math.max(1, Math.round(windowSamples / 2))
  const windows: ActivityWindow[] = []
  for (let i = 0; i + windowSamples <= rate.desired.length; i += step) {
    const slice = rate.desired.subarray(i, i + windowSamples)
    const s = std(slice)
    windows.push({
      start: rate.t[i],
      end: rate.t[Math.min(i + windowSamples - 1, rate.t.length - 1)],
      kind: s >= ACTIVE_THRESHOLD_DEG_S ? 'active' : 'quiet',
      stdDesired: s
    })
  }
  return windows
}

function windowIndices(t: Float64Array, start: number, end: number): [number, number] {
  let lo = 0, hi = t.length
  for (let i = 0; i < t.length; i++) { if (t[i] >= start) { lo = i; break } }
  for (let i = t.length - 1; i >= 0; i--) { if (t[i] <= end) { hi = i + 1; break } }
  return [lo, hi]
}

// ---------------------------------------------------------------------------
// 1. D-term noise measurement
// ---------------------------------------------------------------------------

export type Severity = 'ok' | 'check' | 'action'

export interface DTermNoiseResult {
  axis: PidAxis
  /** D-term high-frequency noise as a fraction of full motor command (0–1). */
  noiseFraction: number
  noisePercent: number
  severity: Severity
  /** Dominant noise frequency from the Welch PSD (Hz). */
  noiseFreqHz: number
  /** True if the noise is concentrated in a narrow peak (vs broadband). */
  narrowPeak: boolean
  /** Welch PSD of the high-pass-filtered D-term for display. */
  spectrum: WelchResult | null
}

const DNOISE_HP_CUTOFF = 20 // Hz — isolate high-frequency D noise
const DNOISE_ACTION = 0.008 // >= 0.8%
const DNOISE_CHECK = 0.003 // >= 0.3%

function analyzeDTermNoise(pid: PidTimeSeries, quietWindows: ActivityWindow[]): DTermNoiseResult | null {
  if (quietWindows.length === 0) return null
  const hp = biquadHighpass(DNOISE_HP_CUTOFF, pid.fs)

  // Collect D-term samples in quiet (hover) windows
  const dSamples: number[] = []
  for (const w of quietWindows) {
    const [lo, hi] = windowIndices(pid.t, w.start, w.end)
    for (let i = lo; i < hi; i++) dSamples.push(pid.D[i])
  }
  if (dSamples.length < 64) return null

  const dArr = Float64Array.from(dSamples)
  const filtered = filtfilt(hp, dArr)
  const hfRmsVal = rms(filtered)
  const noiseFraction = hfRmsVal // D is already in motor-output units (0..1)

  // Welch PSD to find the noise frequency
  const spec = dSamples.length >= 128 ? welch(filtered, pid.fs, Math.min(512, dSamples.length)) : null
  let noiseFreqHz = 0
  let narrowPeak = false
  if (spec) {
    let maxP = 0
    for (let i = 1; i < spec.power.length; i++) {
      if (spec.power[i] > maxP) { maxP = spec.power[i]; noiseFreqHz = spec.freqs[i] }
    }
    // Narrow peak: the peak bin is > 10× the median power
    const powers = Array.from(spec.power).slice(1)
    const medP = median(powers)
    narrowPeak = maxP > 10 * medP
  }

  const severity: Severity = noiseFraction >= DNOISE_ACTION ? 'action' : noiseFraction >= DNOISE_CHECK ? 'check' : 'ok'

  return {
    axis: 'Roll', // placeholder, set by caller
    noiseFraction,
    noisePercent: noiseFraction * 100,
    severity,
    noiseFreqHz,
    narrowPeak,
    spectrum: spec
  }
}

// ---------------------------------------------------------------------------
// 2. Rate tracking
// ---------------------------------------------------------------------------

export interface RateTrackingResult {
  axis: PidAxis
  /** Number of manoeuvre windows analysed. */
  windowCount: number
  /** RMS tracking error (deg/s) across manoeuvre windows. */
  rmsError: number
  /** Cross-correlation between desired and actual, 0–1. */
  correlation: number
  /** Response lag in samples (from xcorr). */
  lagSamples: number
  lagMs: number
  /** Fraction of time output is near saturation (|Out| > 0.9). */
  saturationFraction: number
  severity: Severity
}

function analyzeRateTracking(rate: RateTimeSeries, activeWindows: ActivityWindow[]): RateTrackingResult | null {
  if (activeWindows.length < 2) return null

  const errors: number[] = []
  let totalSatSamples = 0
  let totalSamples = 0
  const lags: number[] = []
  const correlations: number[] = []

  for (const w of activeWindows) {
    const [lo, hi] = windowIndices(rate.t, w.start, w.end)
    if (hi - lo < 10) continue
    const des = rate.desired.subarray(lo, hi)
    const act = rate.actual.subarray(lo, hi)
    const out = rate.out.subarray(lo, hi)

    for (let i = 0; i < des.length; i++) errors.push(act[i] - des[i])
    for (let i = 0; i < out.length; i++) { if (Math.abs(out[i]) > 0.9) totalSatSamples++ }
    totalSamples += des.length

    const maxLag = Math.min(Math.round(rate.fs * 0.05), hi - lo) // up to 50ms
    lags.push(xcorrLag(act, des, maxLag))

    // Pearson correlation
    const mD = mean(des), mA = mean(act)
    let num = 0, denD = 0, denA = 0
    for (let i = 0; i < des.length; i++) {
      const dd = des[i] - mD, da = act[i] - mA
      num += dd * da; denD += dd * dd; denA += da * da
    }
    const denom = Math.sqrt(denD * denA)
    correlations.push(denom > 0 ? num / denom : 0)
  }

  if (errors.length < 20) return null

  const rmsError = rms(Float64Array.from(errors))
  const correlation = mean(Float64Array.from(correlations))
  const lagSamples = median(lags)
  const saturationFraction = totalSamples > 0 ? totalSatSamples / totalSamples : 0

  const severity: Severity = saturationFraction > 0.05 ? 'action'
    : correlation < 0.7 ? 'action'
    : correlation < 0.85 ? 'check'
    : 'ok'

  return {
    axis: 'Roll',
    windowCount: activeWindows.length,
    rmsError,
    correlation,
    lagSamples,
    lagMs: lagSamples / rate.fs * 1000,
    saturationFraction,
    severity
  }
}

// ---------------------------------------------------------------------------
// 3. Overtune detection
// ---------------------------------------------------------------------------

export interface OvertuneResult {
  axis: PidAxis
  /** Median std(actual)/std(desired) across manoeuvre windows. */
  medianRatio: number
  p90Ratio: number
  /** Per-window ratios for display. */
  windowRatios: number[]
  verdict: 'over-tuned' | 'under-tuned' | 'ok' | 'check'
  severity: Severity
  /** Oscillation frequency in tracking error, if detected (Hz). */
  oscillationFreqHz: number | null
}

const OVERTUNE_ACTION = 1.3
const OVERTUNE_CHECK = 1.15
const UNDERTUNE_CHECK = 0.8

function analyzeOvertune(rate: RateTimeSeries, activeWindows: ActivityWindow[]): OvertuneResult | null {
  if (activeWindows.length < 3) return null

  const ratios: number[] = []
  const errorSignal: number[] = []

  for (const w of activeWindows) {
    const [lo, hi] = windowIndices(rate.t, w.start, w.end)
    if (hi - lo < 10) continue
    const des = rate.desired.subarray(lo, hi)
    const act = rate.actual.subarray(lo, hi)
    const stdDes = std(des)
    const stdAct = std(act)
    if (stdDes < 1) continue // skip near-zero input windows
    ratios.push(stdAct / stdDes)
    for (let i = 0; i < des.length; i++) errorSignal.push(act[i] - des[i])
  }

  if (ratios.length < 3) return null

  const medianRatio = median(ratios)
  const p90Ratio = pct(ratios, 90)

  // Oscillation frequency from Welch on tracking error
  let oscillationFreqHz: number | null = null
  if (errorSignal.length >= 128) {
    const errArr = Float64Array.from(errorSignal)
    const spec = welch(errArr, rate.fs, Math.min(512, errorSignal.length))
    let maxP = 0
    for (let i = 1; i < spec.power.length; i++) {
      if (spec.freqs[i] >= 5 && spec.freqs[i] <= 80 && spec.power[i] > maxP) {
        maxP = spec.power[i]; oscillationFreqHz = spec.freqs[i]
      }
    }
    // Only report if the peak is prominent
    if (oscillationFreqHz !== null) {
      const powers = Array.from(spec.power).slice(1)
      const medP = median(powers)
      if (maxP < 5 * medP) oscillationFreqHz = null
    }
  }

  let verdict: OvertuneResult['verdict']
  let severity: Severity
  if (medianRatio >= OVERTUNE_ACTION) { verdict = 'over-tuned'; severity = 'action' }
  else if (medianRatio >= OVERTUNE_CHECK || p90Ratio >= OVERTUNE_ACTION) { verdict = 'check'; severity = 'check' }
  else if (medianRatio < UNDERTUNE_CHECK) { verdict = 'under-tuned'; severity = 'check' }
  else { verdict = 'ok'; severity = 'ok' }

  return {
    axis: 'Roll',
    medianRatio,
    p90Ratio,
    windowRatios: ratios,
    verdict,
    severity,
    oscillationFreqHz
  }
}

// ---------------------------------------------------------------------------
// 4. P vs D analysis
// ---------------------------------------------------------------------------

export interface PvsDResult {
  axis: PidAxis
  /** rms(D) / rms(P) during manoeuvres. */
  dpRatio: number
  rmsP: number
  rmsD: number
  verdict: 'D dominating' | 'under-damped' | 'ok' | 'check'
  severity: Severity
}

function analyzePvsD(pid: PidTimeSeries, activeWindows: ActivityWindow[]): PvsDResult | null {
  if (activeWindows.length < 2) return null

  const pSamples: number[] = []
  const dSamples: number[] = []

  for (const w of activeWindows) {
    const [lo, hi] = windowIndices(pid.t, w.start, w.end)
    for (let i = lo; i < hi; i++) {
      pSamples.push(pid.P[i])
      dSamples.push(pid.D[i])
    }
  }
  if (pSamples.length < 20) return null

  const rmsP = rms(Float64Array.from(pSamples))
  const rmsD = rms(Float64Array.from(dSamples))
  const dpRatio = rmsP > 0 ? rmsD / rmsP : 0

  let verdict: PvsDResult['verdict']
  let severity: Severity
  if (dpRatio > 1) { verdict = 'D dominating'; severity = 'check' }
  else if (dpRatio < 0.15) { verdict = 'under-damped'; severity = 'check' }
  else if (dpRatio < 0.3 || dpRatio > 0.8) { verdict = 'check'; severity = 'check' }
  else { verdict = 'ok'; severity = 'ok' }

  return {
    axis: 'Roll',
    dpRatio,
    rmsP,
    rmsD,
    verdict,
    severity
  }
}

// ---------------------------------------------------------------------------
// 5. Spectrogram (time-frequency heatmap)
// ---------------------------------------------------------------------------

export interface SpectrogramResult {
  /** Time of each column (s since boot). */
  times: number[]
  /** Frequency of each row (Hz). */
  freqs: number[]
  /** Power in dB, z[col][row]. */
  z: number[][]
  maxFreqHz: number
}

function db(x: number): number { return 10 * Math.log10(Math.max(x, 1e-20)) }

export function computeSpectrogram(
  signal: Float64Array,
  fs: number,
  tStart: number,
  maxCols = 200,
  maxRows = 100,
  maxFreq = 500
): SpectrogramResult | null {
  if (signal.length < 256) return null
  const windowSize = Math.min(1024, signal.length)
  const step = Math.max(1, Math.round(windowSize / 2))

  const rawCols: { t: number; power: Float64Array; freqs: Float64Array }[] = []
  for (let start = 0; start + windowSize <= signal.length; start += step) {
    const seg = new Array(windowSize)
    for (let i = 0; i < windowSize; i++) seg[i] = signal[start + i]
    const spec = powerSpectrum(seg, fs)
    rawCols.push({ t: tStart + start / fs, power: spec.power, freqs: spec.freqHz })
  }
  if (rawCols.length === 0) return null

  // Downsample columns (time)
  const colStep = Math.max(1, Math.ceil(rawCols.length / maxCols))
  // Downsample rows (frequency): cap at maxFreq
  const nBins = rawCols[0].freqs.length
  let maxBin = nBins
  for (let i = 0; i < nBins; i++) {
    if (rawCols[0].freqs[i] > maxFreq) { maxBin = i; break }
  }
  const rowStep = Math.max(1, Math.ceil(maxBin / maxRows))

  const times: number[] = []
  const z: number[][] = []
  for (let c = 0; c < rawCols.length; c += colStep) {
    const batch = rawCols.slice(c, c + colStep)
    times.push(batch[0].t)
    const col: number[] = []
    for (let r = 0; r < maxBin; r += rowStep) {
      let acc = 0, cnt = 0
      for (const b of batch) {
        for (let q = r; q < Math.min(maxBin, r + rowStep); q++) {
          acc += b.power[q]; cnt++
        }
      }
      col.push(db(acc / Math.max(cnt, 1)))
    }
    z.push(col)
  }

  const freqs: number[] = []
  for (let r = 0; r < maxBin; r += rowStep) freqs.push(rawCols[0].freqs[r])

  return { times, freqs, z, maxFreqHz: maxFreq }
}

// ---------------------------------------------------------------------------
// 6. Static vs motor peak classification
// ---------------------------------------------------------------------------

export interface PeakClassification {
  freqHz: number
  classification: 'static' | 'motor-harmonic' | 'unclear'
  harmonic: number | null
  confidence: number
  detail: string
}

function classifyPeaks(
  gyroSpectrum: PowerSpectrum,
  escRpmHz: Float64Array | null
): PeakClassification[] {
  // Find the top peaks in the gyro spectrum
  const freqs = gyroSpectrum.freqHz
  const power = gyroSpectrum.power
  if (freqs.length < 10) return []

  // Simple peak detection
  const peaks: { freq: number; power: number }[] = []
  for (let i = 2; i < freqs.length - 2; i++) {
    if (freqs[i] < 15) continue
    if (power[i] > power[i - 1] && power[i] > power[i + 1] && power[i] > power[i - 2] && power[i] > power[i + 2]) {
      peaks.push({ freq: freqs[i], power: power[i] })
    }
  }
  peaks.sort((a, b) => b.power - a.power)

  // Noise floor
  const allPowers: number[] = []
  for (let i = 0; i < power.length; i++) if (freqs[i] >= 15) allPowers.push(power[i])
  const floor = median(allPowers)

  const results: PeakClassification[] = []
  for (const pk of peaks.slice(0, 8)) {
    const heightDb = db(pk.power) - db(floor)
    if (heightDb < 6) continue

    if (!escRpmHz || escRpmHz.length < 10) {
      results.push({
        freqHz: pk.freq,
        classification: 'unclear',
        harmonic: null,
        confidence: 0.3,
        detail: `${heightDb.toFixed(0)} dB above floor; no motor RPM data`
      })
      continue
    }

    // Check if this frequency tracks a motor harmonic
    const medRpm = median(Array.from(escRpmHz))
    if (medRpm < 5) {
      results.push({ freqHz: pk.freq, classification: 'unclear', harmonic: null, confidence: 0.3, detail: 'motor RPM too low' })
      continue
    }

    const ratio = pk.freq / medRpm
    const nearestK = Math.round(ratio)
    const tolerance = 0.12

    if (nearestK >= 1 && nearestK <= 8 && Math.abs(ratio - nearestK) < tolerance) {
      results.push({
        freqHz: pk.freq,
        classification: 'motor-harmonic',
        harmonic: nearestK,
        confidence: 0.7,
        detail: `f/motor = ${ratio.toFixed(2)}, harmonic ${nearestK}`
      })
    } else {
      results.push({
        freqHz: pk.freq,
        classification: 'static',
        harmonic: null,
        confidence: 0.6,
        detail: `f/motor = ${ratio.toFixed(2)}, not a motor harmonic`
      })
    }
  }

  return results
}

// ---------------------------------------------------------------------------
// Combined analysis result
// ---------------------------------------------------------------------------

export interface PidAxisAnalysis {
  axis: PidAxis
  dTermNoise: DTermNoiseResult | null
  rateTracking: RateTrackingResult | null
  overtune: OvertuneResult | null
  pvsD: PvsDResult | null
  activityWindows: ActivityWindow[]
}

export interface PidAnalysisResult {
  axes: PidAxisAnalysis[]
  peakClassification: PeakClassification[]
  spectrogram: SpectrogramResult | null
  sampleRateHz: number
  warnings: string[]
  findings: PidFinding[]
}

export interface PidFinding {
  severity: Severity
  axis: PidAxis | 'all'
  category: 'dnoise' | 'tracking' | 'overtune' | 'pvsd' | 'saturation'
  message: string
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function analyzePid(log: ParsedDataflashLog): PidAnalysisResult {
  const warnings: string[] = []
  const findings: PidFinding[] = []
  const params = paramsFromLog(log)

  const axes: PidAxisAnalysis[] = []
  let spectrogramSource: { signal: Float64Array; fs: number; tStart: number } | null = null

  for (const axis of ['Roll', 'Pitch', 'Yaw'] as PidAxis[]) {
    const rate = extractRate(log, axis)
    const pid = extractPid(log, axis)

    if (!rate) {
      warnings.push(`No RATE data for ${axis}`)
      axes.push({ axis, dTermNoise: null, rateTracking: null, overtune: null, pvsD: null, activityWindows: [] })
      continue
    }

    const windows = detectActivityWindows(rate)
    const activeWindows = windows.filter(w => w.kind === 'active')
    const quietWindows = windows.filter(w => w.kind === 'quiet')

    // D-term noise (needs PID data + quiet windows)
    let dTermNoise: DTermNoiseResult | null = null
    const axisCode = axis === 'Roll' ? 'RLL' : axis === 'Pitch' ? 'PIT' : 'YAW'
    const dGain = params.get(`ATC_RAT_${axisCode}_D`) ?? 0
    if (pid && dGain > 0) {
      dTermNoise = analyzeDTermNoise(pid, quietWindows)
      if (dTermNoise) {
        dTermNoise.axis = axis
        if (dTermNoise.severity === 'action') {
          findings.push({
            severity: 'action', axis, category: 'dnoise',
            message: `${axis}: D-term noise in hover is ${dTermNoise.noisePercent.toFixed(2)}% of motor command (${dTermNoise.narrowPeak ? `concentrated at ${dTermNoise.noiseFreqHz.toFixed(0)} Hz` : `broadband, strongest near ${dTermNoise.noiseFreqHz.toFixed(0)} Hz`}). Target: under 0.3%.`
          })
        } else if (dTermNoise.severity === 'check') {
          findings.push({
            severity: 'check', axis, category: 'dnoise',
            message: `${axis}: D-term noise in hover is ${dTermNoise.noisePercent.toFixed(2)}% of motor command. Moderate — check motor temperature after flight.`
          })
        }
      }
    }

    // Rate tracking (needs active windows)
    let rateTracking = analyzeRateTracking(rate, activeWindows)
    if (rateTracking) {
      rateTracking.axis = axis
      if (rateTracking.saturationFraction > 0.05) {
        findings.push({
          severity: 'action', axis, category: 'saturation',
          message: `${axis}: output saturated ${(rateTracking.saturationFraction * 100).toFixed(1)}% of the time during manoeuvres.`
        })
      }
      if (rateTracking.severity === 'action' && rateTracking.saturationFraction <= 0.05) {
        findings.push({
          severity: 'action', axis, category: 'tracking',
          message: `${axis}: rate tracking correlation ${rateTracking.correlation.toFixed(2)} (poor). Lag ${rateTracking.lagMs.toFixed(1)} ms.`
        })
      }
    }

    // Overtune detection
    let overtune = analyzeOvertune(rate, activeWindows)
    if (overtune) {
      overtune.axis = axis
      if (overtune.severity !== 'ok') {
        const oscStr = overtune.oscillationFreqHz ? ` Oscillation at ${overtune.oscillationFreqHz.toFixed(0)} Hz.` : ''
        findings.push({
          severity: overtune.severity, axis, category: 'overtune',
          message: `${axis}: ${overtune.verdict} — std(actual)/std(desired) median ${overtune.medianRatio.toFixed(2)}, 90th pct ${overtune.p90Ratio.toFixed(2)}.${oscStr}`
        })
      }
    }

    // P vs D
    let pvsD: PvsDResult | null = null
    if (pid) {
      pvsD = analyzePvsD(pid, activeWindows)
      if (pvsD) {
        pvsD.axis = axis
        if (pvsD.severity !== 'ok') {
          findings.push({
            severity: pvsD.severity, axis, category: 'pvsd',
            message: `${axis}: D/P ratio ${pvsD.dpRatio.toFixed(2)} — ${pvsD.verdict}. rms(P)=${pvsD.rmsP.toFixed(4)}, rms(D)=${pvsD.rmsD.toFixed(4)}.`
          })
        }
      }
    }

    // Keep the first axis's actual rate for the spectrogram
    if (!spectrogramSource && rate.actual.length >= 256) {
      spectrogramSource = { signal: rate.actual, fs: rate.fs, tStart: rate.t[0] }
    }

    axes.push({ axis, dTermNoise, rateTracking, overtune, pvsD, activityWindows: windows })
  }

  // Peak classification: use gyro batch data if available
  let peakClassification: PeakClassification[] = []
  const esc = log.messagesByType.get('ESC')
  let escRpmHz: Float64Array | null = null
  if (esc && esc.length > 10) {
    const rpms: number[] = []
    for (const m of esc) {
      const rpm = num(m, 'RPM')
      if (rpm !== undefined && rpm > 100) rpms.push(rpm / 60)
    }
    if (rpms.length > 10) escRpmHz = Float64Array.from(rpms)
  }
  // Try to get a gyro spectrum for peak classification
  const isbh = log.messagesByType.get('ISBH')
  if (isbh && isbh.length > 0) {
    // Reuse filter-review's extraction — but we have the rate data as a fallback
    if (spectrogramSource) {
      const spec = powerSpectrum(Array.from(spectrogramSource.signal), spectrogramSource.fs)
      peakClassification = classifyPeaks(spec, escRpmHz)
    }
  } else if (spectrogramSource) {
    const spec = powerSpectrum(Array.from(spectrogramSource.signal), spectrogramSource.fs)
    peakClassification = classifyPeaks(spec, escRpmHz)
  }

  // Spectrogram from gyro batch if available, else from rate data
  let spectrogram: SpectrogramResult | null = null
  if (spectrogramSource) {
    spectrogram = computeSpectrogram(spectrogramSource.signal, spectrogramSource.fs, spectrogramSource.tStart)
  }

  return {
    axes,
    peakClassification,
    spectrogram,
    sampleRateHz: axes[0]?.activityWindows.length ? 0 : 0, // informational
    warnings,
    findings
  }
}

export function analyzePidBuffer(buffer: ArrayBuffer): PidAnalysisResult {
  return analyzePid(parseDataflashLog(buffer))
}
