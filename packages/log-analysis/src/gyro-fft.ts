// Signal-processing core for log-based tuning: a real-signal FFT power spectrum
// and spectral peak finder. Used to turn a gyro (or accel) time series from a
// flight log into the dominant vibration / oscillation frequencies, so the
// tuning analysis can place the harmonic notch, judge the gyro filter, and spot
// rate-loop limit cycles — the same analysis done by hand on a real quad
// (finding a ~12 Hz roll limit cycle, motor-RPM notch placement, etc.).
//
// Self-contained (no deps): an iterative radix-2 Cooley-Tukey FFT with a Hann
// window. Correctness is validated against synthetic multi-tone signals.

/** Next power of two >= n (n >= 1). */
function nextPow2(n: number): number {
  let p = 1
  while (p < n) {
    p <<= 1
  }
  return p
}

/**
 * In-place iterative radix-2 FFT. `re`/`im` are length N = 2^k. Transforms in
 * place (forward transform, no normalisation).
 */
function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) {
      j ^= bit
    }
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  // Butterflies.
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < len / 2; k += 1) {
        const aRe = re[i + k]
        const aIm = im[i + k]
        const bRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm
        const bIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe
        re[i + k] = aRe + bRe
        im[i + k] = aIm + bIm
        re[i + k + len / 2] = aRe - bRe
        im[i + k + len / 2] = aIm - bIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

export interface PowerSpectrum {
  /** Frequency of each bin, Hz. */
  freqHz: Float64Array
  /** One-sided power per bin (window-normalised, arbitrary units). */
  power: Float64Array
  /** Bin width, Hz. */
  binHz: number
}

/**
 * One-sided power spectrum of a real signal sampled at `sampleRateHz`. The
 * signal is mean-removed and Hann-windowed (reduces spectral leakage), then
 * zero-padded to the next power of two.
 */
export function powerSpectrum(signal: ArrayLike<number>, sampleRateHz: number): PowerSpectrum {
  const m = signal.length
  if (m < 2 || !Number.isFinite(sampleRateHz) || sampleRateHz <= 0) {
    return { freqHz: new Float64Array(0), power: new Float64Array(0), binHz: 0 }
  }
  // Mean.
  let mean = 0
  for (let i = 0; i < m; i += 1) {
    mean += signal[i]
  }
  mean /= m

  const n = nextPow2(m)
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  // Hann window over the real samples; zeros beyond fill the pad.
  let windowSumSq = 0
  for (let i = 0; i < m; i += 1) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (m - 1))
    re[i] = (signal[i] - mean) * w
    windowSumSq += w * w
  }
  fftInPlace(re, im)

  const half = n / 2
  const freqHz = new Float64Array(half)
  const power = new Float64Array(half)
  const binHz = sampleRateHz / n
  // Normalise by window energy so amplitudes are comparable across window lengths.
  const norm = windowSumSq > 0 ? 1 / windowSumSq : 1
  for (let i = 0; i < half; i += 1) {
    freqHz[i] = i * binHz
    const p = (re[i] * re[i] + im[i] * im[i]) * norm
    // One-sided: double all but DC (and Nyquist, negligible here).
    power[i] = i === 0 ? p : p * 2
  }
  return { freqHz, power, binHz }
}

export interface SpectralPeak {
  freqHz: number
  power: number
  /** Power relative to the largest peak (0..1). */
  relative: number
}

export interface PeakOptions {
  /** Ignore bins below this frequency (skip DC / very-low drift). Default 5 Hz. */
  minFreqHz?: number
  /** Ignore bins above this frequency. Default Nyquist. */
  maxFreqHz?: number
  /** Merge peaks closer than this. Default 8 Hz. */
  minSeparationHz?: number
  /** Keep peaks at least this fraction of the largest. Default 0.1. */
  minRelative?: number
  /** Max peaks to return. Default 6. */
  maxPeaks?: number
}

/**
 * Find dominant local maxima in a power spectrum, strongest first. A peak is a
 * bin larger than its neighbours; nearby peaks are merged (keeping the larger)
 * so one broad hump isn't reported as several.
 */
export function findSpectralPeaks(spectrum: PowerSpectrum, options: PeakOptions = {}): SpectralPeak[] {
  const { freqHz, power } = spectrum
  if (freqHz.length < 3) {
    return []
  }
  const minFreqHz = options.minFreqHz ?? 5
  const maxFreqHz = options.maxFreqHz ?? freqHz[freqHz.length - 1]
  const minSeparationHz = options.minSeparationHz ?? 8
  const minRelative = options.minRelative ?? 0.1
  const maxPeaks = options.maxPeaks ?? 6

  const candidates: SpectralPeak[] = []
  for (let i = 1; i < freqHz.length - 1; i += 1) {
    const f = freqHz[i]
    if (f < minFreqHz || f > maxFreqHz) {
      continue
    }
    if (power[i] > power[i - 1] && power[i] >= power[i + 1]) {
      candidates.push({ freqHz: f, power: power[i], relative: 0 })
    }
  }
  if (candidates.length === 0) {
    return []
  }
  candidates.sort((a, b) => b.power - a.power)

  // Greedy merge: take the strongest, drop anything within minSeparationHz.
  const kept: SpectralPeak[] = []
  for (const cand of candidates) {
    if (kept.some((k) => Math.abs(k.freqHz - cand.freqHz) < minSeparationHz)) {
      continue
    }
    kept.push(cand)
    if (kept.length >= maxPeaks) {
      break
    }
  }
  const maxPower = kept[0].power
  return kept
    .map((p) => ({ ...p, relative: maxPower > 0 ? p.power / maxPower : 0 }))
    .filter((p) => p.relative >= minRelative)
}
