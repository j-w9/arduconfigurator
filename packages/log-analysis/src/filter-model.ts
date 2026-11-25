// Digital filter frequency-response models matching ArduPilot's NotchFilter and
// LowPassFilter2p. These compute the magnitude response |H(f)| of each filter
// stage so a pre-filter gyro spectrum can be multiplied through the chain to
// estimate what the post-filter spectrum would look like for a given set of
// filter parameters — the same "estimated post-filter" overlay that the
// ArduPilot WebTools FilterReview shows.
//
// The biquad coefficients are ported coefficient-for-coefficient from:
//   - libraries/Filter/NotchFilter.cpp (GPL-3.0)
//   - libraries/Filter/LowPassFilter2p.cpp (GPL-3.0)
// and the frequency response is the standard z-transform magnitude evaluation.

export interface NotchParams {
  enabled: boolean
  centerFreqHz: number
  bandwidthHz: number
  attenuationDb: number
  /** Bitmask of harmonic multiples to notch (bit 0 = 1×, bit 1 = 2×, …). */
  harmonics: number
}

export interface LowPassParams {
  cutoffHz: number
}

export interface FilterChainParams {
  sampleRateHz: number
  gyroLowPass: LowPassParams
  /** Per-axis D-term low-pass. */
  dtermLowPass: LowPassParams
  notch1: NotchParams
  notch2: NotchParams
}

// ---- Biquad frequency response (shared) ------------------------------------

interface BiquadCoeffs {
  b0: number; b1: number; b2: number
  a1: number; a2: number
}

function biquadMagnitude(c: BiquadCoeffs, freqHz: number, sampleRateHz: number): number {
  const omega = 2 * Math.PI * freqHz / sampleRateHz
  const cosW = Math.cos(omega)
  const cos2W = Math.cos(2 * omega)
  const sinW = Math.sin(omega)
  const sin2W = Math.sin(2 * omega)
  const numRe = c.b0 + c.b1 * cosW + c.b2 * cos2W
  const numIm = -(c.b1 * sinW + c.b2 * sin2W)
  // a0 is normalised to 1 — the denominator is 1 + a1*z^-1 + a2*z^-2.
  const denRe = 1 + c.a1 * cosW + c.a2 * cos2W
  const denIm = -(c.a1 * sinW + c.a2 * sin2W)
  const numMag2 = numRe * numRe + numIm * numIm
  const denMag2 = denRe * denRe + denIm * denIm
  return denMag2 > 0 ? Math.sqrt(numMag2 / denMag2) : 1
}

// ---- Notch filter (ArduPilot NotchFilter::init_with_A_and_Q) ---------------

function notchCoeffs(sampleRateHz: number, centerFreqHz: number, bandwidthHz: number, attenuationDb: number): BiquadCoeffs | undefined {
  if (centerFreqHz <= 0 || centerFreqHz >= sampleRateHz * 0.5) return undefined
  if (centerFreqHz <= bandwidthHz * 0.5) return undefined

  const A = Math.pow(10, -attenuationDb / 40)
  const octaves = Math.log2(centerFreqHz / (centerFreqHz - bandwidthHz / 2)) * 2
  const Q = Math.sqrt(Math.pow(2, octaves)) / (Math.pow(2, octaves) - 1)
  if (Q <= 0) return undefined

  const omega = 2 * Math.PI * centerFreqHz / sampleRateHz
  const alpha = Math.sin(omega) / (2 * Q)
  const a0Inv = 1 / (1 + alpha)

  return {
    b0: (1 + alpha * A * A) * a0Inv,
    b1: -2 * Math.cos(omega) * a0Inv,
    b2: (1 - alpha * A * A) * a0Inv,
    a1: -2 * Math.cos(omega) * a0Inv,
    a2: (1 - alpha) * a0Inv
  }
}

/** Magnitude of a single notch at `freqHz`. Returns 1 (passthrough) if the notch can't be constructed. */
export function notchMagnitude(params: NotchParams, freqHz: number, sampleRateHz: number): number {
  if (!params.enabled) return 1
  let mag = 1
  for (let h = 0; h < 16; h++) {
    if (!(params.harmonics & (1 << h))) continue
    const harmFreq = params.centerFreqHz * (h + 1)
    const c = notchCoeffs(sampleRateHz, harmFreq, params.bandwidthHz, params.attenuationDb)
    if (c) mag *= biquadMagnitude(c, freqHz, sampleRateHz)
  }
  return mag
}

// ---- Low-pass filter (ArduPilot LowPassFilter2p::compute_params) -----------

function lowPassCoeffs(sampleRateHz: number, cutoffHz: number): BiquadCoeffs | undefined {
  if (cutoffHz <= 0) return undefined
  const clampedCutoff = Math.min(cutoffHz, sampleRateHz * 0.4)
  const fr = sampleRateHz / clampedCutoff
  const ohm = Math.tan(Math.PI / fr)
  const c = 1 + 2 * Math.cos(Math.PI / 4) * ohm + ohm * ohm
  return {
    b0: ohm * ohm / c,
    b1: 2 * ohm * ohm / c,
    b2: ohm * ohm / c,
    a1: 2 * (ohm * ohm - 1) / c,
    a2: (1 - 2 * Math.cos(Math.PI / 4) * ohm + ohm * ohm) / c
  }
}

/** Magnitude of the 2nd-order Butterworth low-pass at `freqHz`. Returns 1 if disabled. */
export function lowPassMagnitude(cutoffHz: number, freqHz: number, sampleRateHz: number): number {
  const c = lowPassCoeffs(sampleRateHz, cutoffHz)
  return c ? biquadMagnitude(c, freqHz, sampleRateHz) : 1
}

// ---- Combined chain --------------------------------------------------------

/**
 * Combined magnitude of the full gyro filter chain at `freqHz`:
 *   gyro low-pass → notch 1 (all harmonics) → notch 2 (all harmonics)
 */
export function filterChainMagnitude(params: FilterChainParams, freqHz: number): number {
  const fs = params.sampleRateHz
  let mag = lowPassMagnitude(params.gyroLowPass.cutoffHz, freqHz, fs)
  mag *= notchMagnitude(params.notch1, freqHz, fs)
  mag *= notchMagnitude(params.notch2, freqHz, fs)
  return mag
}

/**
 * Compute the magnitude response of the full chain over an array of frequencies.
 * Returns an array the same length as `freqsHz`.
 */
export function filterChainResponse(params: FilterChainParams, freqsHz: number[]): number[] {
  return freqsHz.map((f) => filterChainMagnitude(params, f))
}

/**
 * Given a pre-filter power-spectral-density array and the filter parameters,
 * return the estimated post-filter PSD.
 */
export function estimatePostFilterPsd(prePsd: number[], freqsHz: number[], params: FilterChainParams): number[] {
  return prePsd.map((p, i) => {
    const h = filterChainMagnitude(params, freqsHz[i])
    return p * h * h
  })
}
