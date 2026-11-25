// Filter Review — analyse a flight log's gyro data with the same approach as
// the ArduPilot WebTools Filter Review tool: compute pre-filter and post-filter
// (IMU) spectra, read the active filter parameters, and model the estimated
// post-filter spectrum by applying the digital filter transfer functions.
//
// The UI can then overlay pre / actual-post / estimated-post, and let the user
// tweak filter parameters interactively to see the estimated result change.

import { parseDataflashLog, type ParsedDataflashLog, type DataflashMessage } from './dataflash-parser.js'
import { powerSpectrum, findSpectralPeaks, type PowerSpectrum, type SpectralPeak } from './gyro-fft.js'
import { type FilterChainParams, type NotchParams, estimatePostFilterPsd } from './filter-model.js'
import { paramsFromLog } from './notch-tuning-analysis.js'

export type FilterAxis = 'roll' | 'pitch' | 'yaw'

export interface FilterReviewAxisResult {
  axis: FilterAxis
  preFilter: PowerSpectrum
  postFilter: PowerSpectrum | null
  estimatedPost: PowerSpectrum | null
  peaks: SpectralPeak[]
}

export interface FilterReviewResult {
  axes: FilterReviewAxisResult[]
  filterParams: FilterChainParams
  sampleRateHz: number
  gyroSource: 'batch' | 'imu'
  warnings: string[]
}

function num(m: DataflashMessage, field: string): number | undefined {
  const v = m[field]
  return typeof v === 'number' ? v : undefined
}

interface GyroData {
  roll: number[]
  pitch: number[]
  yaw: number[]
  sampleRateHz: number
}

function extractGyroBatch(log: ParsedDataflashLog, postFilter: boolean): GyroData | null {
  const headers = log.messagesByType.get('ISBH')
  const data = log.messagesByType.get('ISBD')
  if (!headers || !data || headers.length === 0 || data.length === 0) return null

  // Count how many gyro IMUs (type=1) are present to identify post-filter instances.
  const gyroInstances = new Set<number>()
  for (const h of headers) {
    if (num(h, 'type') === 1) gyroInstances.add(num(h, 'instance') ?? -1)
  }
  // Pre-filter = instance 0; post-filter = instance >= gyroCount (the offset AP adds).
  const gyroCount = Math.max(1, ...Array.from(gyroInstances).filter((i) => i >= 0))
  const targetInstance = postFilter ? gyroCount : 0
  // If there's only 1 gyro instance and we want post-filter, it doesn't exist.
  if (postFilter && gyroInstances.size <= 1) return null

  const dataByBatch = new Map<number, DataflashMessage[]>()
  for (const d of data) {
    const n = num(d, 'N')
    if (n === undefined) continue
    let arr = dataByBatch.get(n)
    if (!arr) { arr = []; dataByBatch.set(n, arr) }
    arr.push(d)
  }

  const roll: number[] = []
  const pitch: number[] = []
  const yaw: number[] = []
  let sampleRateHz = 0
  for (const h of headers) {
    if (num(h, 'type') !== 1) continue
    const inst = num(h, 'instance') ?? -1
    if (postFilter ? inst !== targetInstance : inst !== 0) continue
    const n = num(h, 'N')
    if (n === undefined) continue
    const rate = num(h, 'smp_rate')
    if (rate && rate > sampleRateHz) sampleRateHz = rate
    const records = (dataByBatch.get(n) ?? []).slice().sort((a, b) => (num(a, 'seqno') ?? 0) - (num(b, 'seqno') ?? 0))
    for (const rec of records) {
      const x = rec.x; const y = rec.y; const z = rec.z
      if (Array.isArray(x) && Array.isArray(y) && Array.isArray(z)) {
        for (let i = 0; i < x.length; i += 1) {
          roll.push(x[i]); pitch.push(y[i]); yaw.push(z[i])
        }
      }
    }
  }
  if (roll.length < 256 || sampleRateHz <= 0) return null
  return { roll, pitch, yaw, sampleRateHz }
}

function extractGyroImu(log: ParsedDataflashLog): GyroData | null {
  const imu = (log.messagesByType.get('IMU') ?? []).filter((m) => num(m, 'I') === 0)
  if (imu.length < 256) return null
  const roll: number[] = []
  const pitch: number[] = []
  const yaw: number[] = []
  for (const m of imu) {
    const gx = num(m, 'GyrX'); const gy = num(m, 'GyrY'); const gz = num(m, 'GyrZ')
    if (gx === undefined || gy === undefined || gz === undefined) continue
    roll.push(gx); pitch.push(gy); yaw.push(gz)
  }
  const t0 = num(imu[0], 'TimeUS')
  const t1 = num(imu[imu.length - 1], 'TimeUS')
  const sampleRateHz = t0 !== undefined && t1 !== undefined && t1 > t0 ? (imu.length - 1) / ((t1 - t0) / 1e6) : 0
  if (roll.length < 256 || sampleRateHz <= 0) return null
  return { roll, pitch, yaw, sampleRateHz }
}

function readNotchParams(params: Map<string, number>, prefix: 'INS_HNTCH' | 'INS_HNTC2'): NotchParams {
  return {
    enabled: (params.get(`${prefix}_ENABLE`) ?? 0) >= 1,
    centerFreqHz: params.get(`${prefix}_FREQ`) ?? 80,
    bandwidthHz: params.get(`${prefix}_BW`) ?? 40,
    attenuationDb: params.get(`${prefix}_ATT`) ?? 40,
    harmonics: params.get(`${prefix}_HMNCS`) ?? 1
  }
}

export function readFilterParamsFromLog(log: ParsedDataflashLog, sampleRateHz: number): FilterChainParams {
  const params = paramsFromLog(log)
  return {
    sampleRateHz,
    gyroLowPass: { cutoffHz: params.get('INS_GYRO_FILTER') ?? 20 },
    dtermLowPass: { cutoffHz: params.get('ATC_RAT_RLL_FLTD') ?? 10 },
    notch1: readNotchParams(params, 'INS_HNTCH'),
    notch2: readNotchParams(params, 'INS_HNTC2')
  }
}

function buildAxisResult(
  axis: FilterAxis,
  preSignal: number[],
  postSignal: number[] | null,
  sampleRateHz: number,
  filterParams: FilterChainParams
): FilterReviewAxisResult {
  const preFilter = powerSpectrum(preSignal, sampleRateHz)
  const postFilter = postSignal ? powerSpectrum(postSignal, sampleRateHz) : null
  const peaks = findSpectralPeaks(preFilter, { minFreqHz: 10, maxPeaks: 8 })

  const freqsHz = Array.from(preFilter.freqHz)
  const estPsd = estimatePostFilterPsd(Array.from(preFilter.power), freqsHz, filterParams)
  const estimatedPost: PowerSpectrum = {
    freqHz: preFilter.freqHz,
    power: new Float64Array(estPsd),
    binHz: preFilter.binHz
  }

  return { axis, preFilter, postFilter, estimatedPost, peaks }
}

export function analyzeFilterReview(log: ParsedDataflashLog): FilterReviewResult {
  const warnings: string[] = []

  const preBatch = extractGyroBatch(log, false)
  const postBatch = extractGyroBatch(log, true)
  const imuFallback = !preBatch ? extractGyroImu(log) : null

  const preGyro = preBatch ?? imuFallback
  if (!preGyro) {
    return {
      axes: [],
      filterParams: { sampleRateHz: 1000, gyroLowPass: { cutoffHz: 20 }, dtermLowPass: { cutoffHz: 10 }, notch1: { enabled: false, centerFreqHz: 80, bandwidthHz: 40, attenuationDb: 40, harmonics: 1 }, notch2: { enabled: false, centerFreqHz: 80, bandwidthHz: 40, attenuationDb: 40, harmonics: 1 } },
      sampleRateHz: 0,
      gyroSource: 'batch',
      warnings: ['No usable gyro data — enable INS_LOG_BAT_MASK and re-fly.']
    }
  }

  const gyroSource = preBatch ? 'batch' : 'imu' as const
  if (!preBatch) warnings.push('No batch sampler data — using the lower-rate IMU log. Enable INS_LOG_BAT_MASK for a proper spectrum.')
  if (!postBatch && preBatch) warnings.push('No post-filter batch data — the estimated post-filter line is modeled, not measured. Enable pre+post logging (INS_LOG_BAT_OPT bit 1) for an actual comparison.')

  const filterParams = readFilterParamsFromLog(log, preGyro.sampleRateHz)

  const axes: FilterReviewAxisResult[] = [
    buildAxisResult('roll', preGyro.roll, postBatch?.roll ?? null, preGyro.sampleRateHz, filterParams),
    buildAxisResult('pitch', preGyro.pitch, postBatch?.pitch ?? null, preGyro.sampleRateHz, filterParams),
    buildAxisResult('yaw', preGyro.yaw, postBatch?.yaw ?? null, preGyro.sampleRateHz, filterParams)
  ]

  return { axes, filterParams, sampleRateHz: preGyro.sampleRateHz, gyroSource, warnings }
}

export function analyzeFilterReviewBuffer(buffer: ArrayBuffer): FilterReviewResult {
  return analyzeFilterReview(parseDataflashLog(buffer))
}

/**
 * Re-compute the estimated post-filter spectrum for one axis given new filter
 * parameters. Used by the interactive UI when the user tweaks a slider — only
 * the estimate changes, pre/post actuals stay the same.
 */
export function reEstimateAxis(
  preFilter: PowerSpectrum,
  params: FilterChainParams
): Float64Array {
  const freqs = Array.from(preFilter.freqHz)
  const psd = Array.from(preFilter.power)
  return new Float64Array(estimatePostFilterPsd(psd, freqs, params))
}
