// A line's frequency spectrum, for a chart's FFT view (MAVExplorer's fft,
// PlotJuggler's FFT): what frequencies a vibration or an rpm wobble holds.
// Live samples do not arrive evenly, so the window is first resampled onto
// an even grid at the median sample spacing, then Hann-windowed (less
// leakage from the window's edges) and transformed. Pure.

export interface Spectrum {
  /** Frequency of each bin, Hz (0 .. Nyquist). */
  hz: number[]
  /** Amplitude of each bin, in the line's own units. */
  amplitude: number[]
  /** The even sample rate the window was resampled to. */
  sampleRateHz: number
}

/** Most points a spectrum is computed from (a power of two). */
export const SPECTRUM_MAX_POINTS = 4096

/** The spectrum of the points inside [from, to], or undefined when there are too few to say anything. */
export function spectrum(t: ArrayLike<number>, v: ArrayLike<number>, from = Number.NEGATIVE_INFINITY, to = Number.POSITIVE_INFINITY): Spectrum | undefined {
  const times: number[] = []
  const values: number[] = []
  for (let index = 0; index < t.length; index += 1) {
    if (t[index] < from || t[index] > to || !Number.isFinite(v[index])) continue
    times.push(t[index])
    values.push(v[index])
  }
  if (times.length < 16) return undefined
  const gaps = times.slice(1).map((time, index) => time - times[index]).filter((gap) => gap > 0).sort((a, b) => a - b)
  const dt = gaps[Math.floor(gaps.length / 2)]
  if (!dt) return undefined
  const span = times[times.length - 1] - times[0]
  const evenCount = Math.min(SPECTRUM_MAX_POINTS, Math.floor(span / dt) + 1)
  let size = 1
  while (size * 2 <= evenCount) size *= 2
  if (size < 16) return undefined
  // The newest `size` points on an even grid, by linear interpolation.
  const start = times[times.length - 1] - (size - 1) * dt
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  let cursor = 0
  let mean = 0
  for (let index = 0; index < size; index += 1) {
    const time = start + index * dt
    while (cursor < times.length - 2 && times[cursor + 1] < time) cursor += 1
    const t0 = times[cursor]
    const t1 = times[cursor + 1]
    const fraction = t1 > t0 ? Math.min(1, Math.max(0, (time - t0) / (t1 - t0))) : 0
    re[index] = values[cursor] + (values[cursor + 1] - values[cursor]) * fraction
    mean += re[index]
  }
  mean /= size
  // Remove the mean (the DC bin would dwarf everything) and apply a Hann window.
  let windowSum = 0
  for (let index = 0; index < size; index += 1) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1))
    re[index] = (re[index] - mean) * w
    windowSum += w
  }
  fft(re, im)
  const bins = size / 2
  const hz: number[] = []
  const amplitude: number[] = []
  for (let bin = 0; bin <= bins; bin += 1) {
    hz.push(bin / (size * dt))
    // Single-sided amplitude, corrected for the window's gain.
    amplitude.push(((bin === 0 || bin === bins ? 1 : 2) * Math.hypot(re[bin], im[bin])) / windowSum)
  }
  return { hz, amplitude, sampleRateHz: 1 / dt }
}

/** The bin with the most energy (above DC): the dominant frequency. */
export function spectrumPeak(result: Spectrum): { hz: number; amplitude: number } | undefined {
  let best = -1
  for (let bin = 1; bin < result.amplitude.length; bin += 1) {
    if (best < 0 || result.amplitude[bin] > result.amplitude[best]) best = bin
  }
  return best < 0 ? undefined : { hz: result.hz[best], amplitude: result.amplitude[best] }
}

/** In-place radix-2 FFT (length a power of two). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length
    const wRe = Math.cos(angle)
    const wIm = Math.sin(angle)
    for (let i = 0; i < n; i += length) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < length / 2; k += 1) {
        const aRe = re[i + k]
        const aIm = im[i + k]
        const bRe = re[i + k + length / 2] * curRe - im[i + k + length / 2] * curIm
        const bIm = re[i + k + length / 2] * curIm + im[i + k + length / 2] * curRe
        re[i + k] = aRe + bRe
        im[i + k] = aIm + bIm
        re[i + k + length / 2] = aRe - bRe
        im[i + k + length / 2] = aIm - bIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}
