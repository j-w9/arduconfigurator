import assert from 'node:assert/strict'
import test from 'node:test'

import { powerSpectrum, findSpectralPeaks } from '../packages/log-analysis/dist/index.js'

// Validate the FFT + peak finder against synthetic multi-tone signals with
// known frequencies — the same shape as the real gyro data it will process
// (a dominant low-frequency oscillation plus higher-frequency motor noise).

function tone(freqHz, amp, sampleRateHz, n, phase = 0) {
  const out = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    out[i] = amp * Math.sin(2 * Math.PI * freqHz * (i / sampleRateHz) + phase)
  }
  return out
}

test('resolves a dominant low-frequency peak and a weaker high-frequency one', () => {
  const fs = 1000
  const n = 2048
  // 12 Hz strong (like the roll limit cycle) + 90 Hz weaker (like motor noise).
  const strong = tone(12, 1.0, fs, n)
  const weak = tone(90, 0.25, fs, n, 1.1)
  const signal = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    signal[i] = strong[i] + weak[i] + 0.5 // + DC offset (must be removed)
  }

  const spec = powerSpectrum(signal, fs)
  // Low minRelative: the 90 Hz tone is a weak secondary (~0.06 of the 12 Hz
  // power), like real motor noise next to a limit cycle — we still want it.
  const peaks = findSpectralPeaks(spec, { minFreqHz: 5, maxFreqHz: 200, minSeparationHz: 6, minRelative: 0.03 })

  assert.ok(peaks.length >= 2, `expected >=2 peaks, got ${peaks.length}`)
  // Strongest peak is the 12 Hz tone (within ~1 bin of 12).
  assert.ok(Math.abs(peaks[0].freqHz - 12) < 1.5, `dominant peak ${peaks[0].freqHz.toFixed(1)}Hz`)
  // The 90 Hz tone is present as a secondary peak.
  const has90 = peaks.some((p) => Math.abs(p.freqHz - 90) < 1.5)
  assert.ok(has90, `expected a ~90Hz peak among ${peaks.map((p) => p.freqHz.toFixed(0)).join(',')}`)
  // DC removed: no giant peak at 0 Hz dominating.
  assert.equal(spec.freqHz[0], 0)
  assert.ok(peaks[0].freqHz > 5)
  // Relative scaling: dominant is 1.0, the 90Hz one is a smaller fraction.
  assert.equal(peaks[0].relative, 1)
  const p90 = peaks.find((p) => Math.abs(p.freqHz - 90) < 1.5)
  assert.ok(p90.relative < 1 && p90.relative > 0)
})

test('a clean single tone yields one dominant peak at its frequency', () => {
  const fs = 2000
  const n = 4096
  const spec = powerSpectrum(tone(47, 1.0, fs, n), fs)
  const peaks = findSpectralPeaks(spec, { minFreqHz: 5 })
  assert.ok(peaks.length >= 1)
  assert.ok(Math.abs(peaks[0].freqHz - 47) < 1.0, `peak at ${peaks[0].freqHz}`)
})

test('empty / too-short input is handled without throwing', () => {
  assert.deepEqual(findSpectralPeaks(powerSpectrum([], 1000)), [])
  assert.deepEqual(findSpectralPeaks(powerSpectrum([1], 1000)), [])
  assert.deepEqual(findSpectralPeaks(powerSpectrum([1, 2, 3], 0)), [])
})
