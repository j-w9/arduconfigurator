import { describe, expect, it } from 'vitest'

import { spectrum, spectrumPeak } from './plot-spectrum'

describe('spectrum', () => {
  it('finds a sine wave at its frequency and amplitude, from uneven samples', () => {
    // 100 Hz-ish sampling with jitter, a 12 Hz sine of amplitude 3 on an offset of 50.
    const t: number[] = []
    const v: number[] = []
    let time = 0
    for (let i = 0; i < 3000; i += 1) {
      time += 0.01 + (i % 3 === 0 ? 0.0004 : -0.0002)
      t.push(time)
      v.push(50 + 3 * Math.sin(2 * Math.PI * 12 * time))
    }
    const result = spectrum(t, v)!
    expect(result.sampleRateHz).toBeGreaterThan(95)
    const peak = spectrumPeak(result)!
    expect(peak.hz).toBeGreaterThan(11.5)
    expect(peak.hz).toBeLessThan(12.5)
    expect(peak.amplitude).toBeGreaterThan(2.2)
    expect(peak.amplitude).toBeLessThan(3.3)
  })

  it('says nothing from too few points, and keeps to the window', () => {
    expect(spectrum([0, 1, 2], [1, 2, 3])).toBeUndefined()
    const t = Array.from({ length: 500 }, (_u, i) => i / 100)
    const v = t.map((time) => Math.sin(2 * Math.PI * 5 * time))
    expect(spectrum(t, v, 10, 20)).toBeUndefined()
    expect(spectrumPeak(spectrum(t, v, 0, 5)!)!.hz).toBeCloseTo(5, 0)
  })
})
