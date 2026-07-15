import assert from 'node:assert/strict'
import test from 'node:test'

import { analyzeLogTuning } from '../packages/log-analysis/dist/index.js'

// Exercise the analysis engine against a synthetic parsed log that reproduces
// the real scenario from the vibration diagnosis: a sharp ~12 Hz oscillation on
// the ROLL gyro (and not pitch/yaw), ESC RPM present, and a non-trivial roll
// rate-D. The binary parser is tested separately, so we build the parsed
// structure directly to isolate the analysis logic.

function makeLog({
  oscHz = 12,
  oscAmp = 500,
  pitchOscHz = 7,
  pitchOscAmp = 8,
  sampleRate = 1000,
  rpm = 6000,
  rllD = 0.01,
  pitD = 0.008,
  hntchEnable = 0
} = {}) {
  const messagesByType = new Map()

  // --- Gyro batch sampler (ISBH header + ISBD data) ---
  const totalSamples = 1024
  const perRecord = 32
  const isbh = [{ name: 'ISBH', N: 1, type: 1, instance: 0, smp_rate: sampleRate, smp_cnt: totalSamples }]
  const isbd = []
  let idx = 0
  for (let seq = 0; seq < totalSamples / perRecord; seq += 1) {
    const x = []
    const y = []
    const z = []
    for (let k = 0; k < perRecord; k += 1) {
      // Roll (x) + pitch (y): configurable sines (defaults: strong roll, tiny
      // sub-band pitch). Yaw (z): tiny noise only.
      x.push(Math.round(oscAmp * Math.sin((2 * Math.PI * oscHz * idx) / sampleRate)))
      y.push(Math.round(pitchOscAmp * Math.sin((2 * Math.PI * pitchOscHz * idx) / sampleRate)))
      z.push(Math.round(4 * Math.sin((2 * Math.PI * 5 * idx) / sampleRate)))
      idx += 1
    }
    isbd.push({ name: 'ISBD', N: 1, seqno: seq, x, y, z })
  }
  messagesByType.set('ISBH', isbh)
  messagesByType.set('ISBD', isbd)

  // --- ESC RPM (motor telemetry) ---
  const esc = []
  for (let i = 0; i < 200; i += 1) esc.push({ name: 'ESC', Instance: 0, RPM: rpm + (i % 20) })
  messagesByType.set('ESC', esc)

  // --- Flight evidence (RATE) + low vibration (VIBE) ---
  const rate = []
  for (let i = 0; i < 200; i += 1) rate.push({ name: 'RATE', R: 0, RDes: 0 })
  messagesByType.set('RATE', rate)
  const vibe = []
  for (let i = 0; i < 50; i += 1) vibe.push({ name: 'VIBE', VibeX: 2, VibeY: 2, VibeZ: 2, Clip: 0 })
  messagesByType.set('VIBE', vibe)

  // --- Params captured in the log ---
  messagesByType.set('PARM', [
    { name: 'PARM', Name: 'ATC_RAT_RLL_D', Value: rllD },
    { name: 'PARM', Name: 'ATC_RAT_PIT_D', Value: pitD },
    { name: 'PARM', Name: 'INS_HNTCH_ENABLE', Value: hntchEnable }
  ])

  return { messagesByType, formats: new Map(), counts: new Map(), skippedBytes: 0 }
}

test('detects a single-axis roll limit cycle and recommends halving roll rate-D', () => {
  const result = analyzeLogTuning(makeLog({ oscHz: 12, rllD: 0.01 }))

  assert.equal(result.gyroSource, 'batch')
  assert.ok(Math.abs(result.gyroSampleRateHz - 1000) < 1)
  assert.equal(result.usable, true)

  assert.ok(result.limitCycle, 'expected a limit cycle')
  assert.equal(result.limitCycle.axis, 'roll')
  assert.ok(Math.abs(result.limitCycle.freqHz - 12) < 2, `limit cycle at ${result.limitCycle.freqHz}Hz`)

  const dRec = result.recommendations.find((r) => r.param === 'ATC_RAT_RLL_D')
  assert.ok(dRec, 'expected a roll rate-D recommendation')
  assert.ok(Math.abs(dRec.suggestedValue - 0.005) < 1e-6, `suggested ${dRec.suggestedValue}`)
  assert.equal(dRec.currentValue, 0.01)
})

test('a limit cycle on two axes with both rate-D high recommends halving BOTH', () => {
  // Same 12 Hz oscillation strong on roll AND pitch, both D above the floor.
  const result = analyzeLogTuning(
    makeLog({ oscHz: 12, oscAmp: 500, pitchOscHz: 12, pitchOscAmp: 500, rllD: 0.01, pitD: 0.008 })
  )
  const rll = result.recommendations.find((r) => r.param === 'ATC_RAT_RLL_D')
  const pit = result.recommendations.find((r) => r.param === 'ATC_RAT_PIT_D')
  assert.ok(rll, 'expected a roll rate-D recommendation')
  assert.ok(pit, 'expected a pitch rate-D recommendation')
  assert.ok(Math.abs(rll.suggestedValue - 0.005) < 1e-6, `roll suggested ${rll.suggestedValue}`)
  assert.ok(Math.abs(pit.suggestedValue - 0.004) < 1e-6, `pitch suggested ${pit.suggestedValue}`)
})

test('a secondary axis already at default D yields a coupling advisory, not a D cut', () => {
  // This mirrors the real vibration log: pitch is the sharp/primary oscillator
  // with high D, roll carries the same frequency but is already at default D.
  const result = analyzeLogTuning(
    makeLog({ oscHz: 12, oscAmp: 200, pitchOscHz: 12, pitchOscAmp: 500, rllD: 0.004, pitD: 0.008 })
  )
  // Pitch (primary, high D) → halve; roll (secondary, already low D) → no cut.
  const pit = result.recommendations.find((r) => r.param === 'ATC_RAT_PIT_D')
  assert.ok(pit && Math.abs(pit.suggestedValue - 0.004) < 1e-6, 'pitch D halved')
  assert.ok(!result.recommendations.some((r) => r.param === 'ATC_RAT_RLL_D'), 'roll D not cut further')
  assert.ok(
    result.advisories.some((a) => /roll/i.test(a) && /coupling/i.test(a)),
    'expected a roll coupling advisory'
  )
  // The primary rec should note the coupled axis.
  assert.match(pit.reason, /also appears on roll/i)
})

test('recommends enabling the ESC-telemetry harmonic notch when RPM is present and it is off', () => {
  const result = analyzeLogTuning(makeLog({ rpm: 6000, hntchEnable: 0 }))
  assert.ok(Math.abs(result.motorFundamentalHz - 100) < 2, `motor fundamental ${result.motorFundamentalHz}`)
  const enable = result.recommendations.find((r) => r.param === 'INS_HNTCH_ENABLE')
  assert.ok(enable && enable.suggestedValue === 1)
  const mode = result.recommendations.find((r) => r.param === 'INS_HNTCH_MODE')
  assert.ok(mode && mode.suggestedValue === 3, 'ESC-telemetry notch mode')
})

test('does not recommend enabling the notch when it is already on', () => {
  const result = analyzeLogTuning(makeLog({ hntchEnable: 1 }))
  assert.ok(!result.recommendations.some((r) => r.param === 'INS_HNTCH_ENABLE'))
})

test('flags a bench log (no flight data) as not usable', () => {
  const log = makeLog()
  log.messagesByType.set('RATE', []) // no flight evidence
  log.messagesByType.set('CTUN', [])
  const result = analyzeLogTuning(log)
  assert.equal(result.usable, false)
  assert.ok(result.gateWarnings.some((w) => /in-flight|hover|flight log/i.test(w)))
})

test('vibration verdict is good for low VIBE with no clipping', () => {
  const result = analyzeLogTuning(makeLog())
  assert.ok(result.vibe)
  assert.equal(result.vibe.verdict, 'good')
})

test('high vibration produces a mechanical advisory and is NOT called "clean"', () => {
  // No oscillation + notch already on => zero parameter recommendations, but
  // high VIBE must still surface as an advisory (the reported real-log bug).
  const log = makeLog({ oscAmp: 0, hntchEnable: 1 })
  log.messagesByType.set('VIBE', Array.from({ length: 50 }, () => ({ name: 'VIBE', VibeX: 40, VibeY: 10, VibeZ: 10, Clip: 0 })))
  const r = analyzeLogTuning(log)

  assert.equal(r.vibe.verdict, 'bad')
  assert.equal(r.recommendations.length, 0, 'no param changes for a purely mechanical vibration problem')
  assert.ok(r.advisories.length >= 1, 'expected a vibration advisory')
  assert.match(r.advisories[0], /vibration/i)
  assert.doesNotMatch(r.summary, /looks clean/i)
})

test('IMU clipping produces a clipping-specific advisory', () => {
  const log = makeLog({ oscAmp: 0, hntchEnable: 1 })
  log.messagesByType.set('VIBE', Array.from({ length: 50 }, () => ({ name: 'VIBE', VibeX: 25, VibeY: 10, VibeZ: 10, Clip: 9 })))
  const r = analyzeLogTuning(log)
  assert.equal(r.vibe.verdict, 'bad')
  assert.match(r.advisories[0], /clipping/i)
})
