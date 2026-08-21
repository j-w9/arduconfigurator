// Fitting BARO1_THST_SCALE from a bench throttle ramp.
//
// The logs here are synthesised with a KNOWN scale, so the test is not "does it
// produce a number" but "does it produce the number the log was built from".
// That is the only way to check a fit without a vehicle: the port of the
// operator's Python is faithful if it recovers the slope that was baked in.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  analyzeBaroThrustRampLog,
  fitThroughOrigin,
  lowPassFilter
} from '../packages/log-analysis/dist/index.js'

const HZ = 20
const AMBIENT_PA = 101325
/** ArduPilot's own conversion is what the analysis derives Pa/m from. */
const PA_PER_M = 12

/**
 * A restrained ramp: throttle steps up, pressure falls in proportion.
 *
 * `scale` is the truth being recovered: the firmware model is
 * P_measured = P0 + scale * lpf(throttle), so a NEGATIVE scale means the prop
 * wash lowers the pressure over the baro, which is the real sign.
 */
function rampLog({
  scale = -220,
  filterHz = 1.0,
  hover = 0.35,
  steps = [0, 0, 0.12, 0.12, 0.2, 0.2, 0.28, 0.28, 0.35, 0.35, 0.42, 0.42],
  stepS = 2,
  armLeadS = 3,
  noisePa = 0,
  includeParams = true
} = {}) {
  const times = []
  const throttle = []
  // Armed and idle first: the analysis needs a baseline before throttle-up.
  const idleSamples = Math.round(armLeadS * HZ)
  for (let i = 0; i < idleSamples; i += 1) {
    times.push(i / HZ)
    throttle.push(0)
  }
  for (const step of steps) {
    for (let i = 0; i < stepS * HZ; i += 1) {
      times.push(times[times.length - 1] + 1 / HZ)
      throttle.push(step)
    }
  }

  const filtered = lowPassFilter(throttle, times, filterHz)
  const baro = []
  const motb = []
  const imu = []
  const ang = []
  // Deterministic pseudo-noise: a fixed sequence beats Math.random in a test
  // that has to fail for a real reason or not at all.
  let seed = 7
  const noise = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return ((seed / 2147483648) - 0.5) * 2 * noisePa
  }

  for (let i = 0; i < times.length; i += 1) {
    const t = Math.round(times[i] * 1e6)
    const pressure = AMBIENT_PA + scale * filtered[i] + (noisePa > 0 ? noise() : 0)
    baro.push({
      name: 'BARO',
      TimeUS: t,
      I: 0,
      Press: pressure,
      // Altitude as the firmware derives it, so the analysis recovers Pa/m.
      Alt: (AMBIENT_PA - pressure) / PA_PER_M
    })
    motb.push({ name: 'MOTB', TimeUS: t, ThrOut: throttle[i] })
    imu.push({ name: 'IMU', TimeUS: t, I: 0, AccX: 0, AccY: 0, AccZ: 9.81, GyrX: 0, GyrY: 0, GyrZ: 0 })
    ang.push({ name: 'ANG', TimeUS: t, Roll: 0, Pitch: -80 })
  }

  const messagesByType = new Map()
  messagesByType.set('BARO', baro)
  messagesByType.set('MOTB', motb)
  messagesByType.set('IMU', imu)
  messagesByType.set('ANG', ang)
  messagesByType.set('EV', [
    { name: 'EV', TimeUS: 0, Id: 10 },
    { name: 'EV', TimeUS: Math.round(times[times.length - 1] * 1e6), Id: 11 }
  ])
  messagesByType.set(
    'PARM',
    includeParams
      ? [
          { name: 'PARM', Name: 'BARO_THST_FILT', Value: filterHz },
          { name: 'PARM', Name: 'MOT_THST_HOVER', Value: hover },
          { name: 'PARM', Name: 'BARO1_THST_SCALE', Value: 0 }
        ]
      : []
  )
  return { messagesByType, formats: new Map(), counts: new Map(), skippedBytes: 0 }
}

test('recovers the scale a clean ramp was built from', () => {
  const result = analyzeBaroThrustRampLog(rampLog({ scale: -220, hover: 0.35 }))
  // Rounded to 5 Pa exactly as the Python does.
  assert.equal(result.recommendedScale, -220)
  assert.ok(Math.abs(result.globalSlopePaPerThrottle - -220) < 5, 'global slope near truth')
  assert.equal(result.runs.length, 1)
})

test('recovers it through noise, and reports the residual honestly', () => {
  const result = analyzeBaroThrustRampLog(rampLog({ scale: -180, noisePa: 3 }))
  assert.ok(Math.abs(result.recommendedScale - -180) <= 10, `got ${result.recommendedScale}`)
  const run = result.runs[0]
  assert.ok(run.residualStdPa > 0, 'noise shows up in the residual rather than being hidden')
  assert.ok(run.residualStdPa < 10, 'and it is not swamping the fit')
})

test('prefers the hover band over the global line', () => {
  // A convex response: steeper at high throttle than low. A single linear
  // parameter cannot follow that, so the recommendation must be the value that
  // zeroes the error where the aircraft actually flies.
  const base = rampLog({ scale: -200, hover: 0.35 })
  const baro = base.messagesByType.get('BARO')
  const motb = base.messagesByType.get('MOTB')
  const times = motb.map((m) => m.TimeUS * 1e-6)
  const filtered = lowPassFilter(motb.map((m) => m.ThrOut), times, 1.0)
  for (let i = 0; i < baro.length; i += 1) {
    // Bend it: the slope grows with throttle.
    const scale = -150 - 200 * filtered[i]
    baro[i].Press = AMBIENT_PA + scale * filtered[i]
    baro[i].Alt = (AMBIENT_PA - baro[i].Press) / PA_PER_M
  }
  const result = analyzeBaroThrustRampLog(base)
  assert.ok(result.hoverSlopePaPerThrottle !== undefined, 'hover band was populated')
  assert.notEqual(
    Math.round(result.hoverSlopePaPerThrottle),
    Math.round(result.globalSlopePaPerThrottle),
    'a bent response means the two differ'
  )
  assert.equal(result.recommendedScale, 5 * Math.round(result.hoverSlopePaPerThrottle / 5))
  // And the bucket column shows the bend rather than hiding it.
  const slopes = result.runs[0].buckets.map((bucket) => bucket.slopePaPerThrottle)
  assert.ok(slopes[slopes.length - 1] < slopes[0], 'buckets get steeper with throttle')
})

test('finds the cutoff the pressure actually follows', () => {
  // Built at 2 Hz: the scan should prefer something near it over the 1 Hz
  // default, and say so.
  const result = analyzeBaroThrustRampLog(rampLog({ scale: -200, filterHz: 2.0 }))
  assert.equal(result.filterHz, 2.0, 'fits at the log\'s own BARO_THST_FILT')
  assert.ok(result.filterScan.length > 3)
  const noFilter = result.filterScan.find((entry) => entry.filterHz === 0)
  const atTruth = result.filterScan.find((entry) => entry.filterHz === 2.0)
  assert.ok(atTruth.residualStdPa <= noFilter.residualStdPa, 'the true cutoff fits at least as well as none')
})

test('flags a run that has the shape of a hover, since the fit cannot tell', () => {
  // Level, and mostly sitting at hover throttle: that is a free hover, where
  // the pressure change is altitude, not thrust. The number would be wrong and
  // nothing in the data says so.
  const log = rampLog({ scale: -200, hover: 0.35, steps: [0, 0, 0.35, 0.35, 0.35, 0.35, 0.35, 0.35] })
  for (const message of log.messagesByType.get('ANG')) {
    message.Pitch = 0
  }
  const result = analyzeBaroThrustRampLog(log)
  assert.ok(result.runs[0].looksLikeHover)
  assert.ok(
    result.warnings.some((warning) => /looks like a hover|shape of a hover/i.test(warning)),
    `expected a hover warning, got ${JSON.stringify(result.warnings)}`
  )
})

test('refuses a log with no MOTB rather than fitting the wrong throttle', () => {
  // CTUN.ThO is the controller's REQUEST; MOTB.ThrOut is what the firmware
  // filters. Falling back to the wrong one silently would be worse than
  // refusing.
  const log = rampLog()
  log.messagesByType.set('MOTB', [])
  assert.throws(() => analyzeBaroThrustRampLog(log), /MOTB/)
})

test('refuses a log with no baseline before throttle-up', () => {
  // Throttle already up when the log starts: there is no quiet pressure to
  // measure against, and a fit without one is a fit against nothing.
  const log = rampLog({ armLeadS: 3 })
  for (const message of log.messagesByType.get('MOTB')) {
    message.ThrOut = 0.3
  }
  assert.throws(() => analyzeBaroThrustRampLog(log), /baseline|throttle ramp/i)
})

test('says when there is no hover band to aim at', () => {
  // No MOT_THST_HOVER in the log: the recommendation falls back to the global
  // slope, and the operator is told that is what happened.
  const result = analyzeBaroThrustRampLog(rampLog({ includeParams: false }))
  assert.ok(Number.isFinite(result.recommendedScale))
  assert.equal(result.hoverSlopePaPerThrottle, undefined)
})

test('the low-pass filter matches ArduPilot\'s recurrence exactly', () => {
  // Checked against the firmware's own form rather than the continuous-time
  // 63%-at-one-tau rule: at these sample rates the discrete filter is well
  // ahead of the continuous one, and the contract is the recurrence
  // (LowPassFilterFloat::apply -- alpha = dt / (dt + 1/(2*pi*fc))), not the
  // textbook curve.
  const times = Array.from({ length: 100 }, (_, i) => i / 20)
  const step = times.map((t) => (t < 1 ? 0 : 1))
  const rc = 1 / (2 * Math.PI * 1.0)
  const reference = [step[0]]
  for (let i = 1; i < step.length; i += 1) {
    const dt = times[i] - times[i - 1]
    const alpha = dt / (dt + rc)
    reference.push(reference[i - 1] + alpha * (step[i] - reference[i - 1]))
  }
  assert.deepEqual(lowPassFilter(step, times, 1.0), reference)
  // Monotonic toward the step, and never past it.
  const filtered = lowPassFilter(step, times, 1.0)
  assert.ok(filtered[filtered.length - 1] > 0.99 && filtered[filtered.length - 1] <= 1)
  // Zero cutoff is a pass-through, not a divide-by-zero.
  assert.deepEqual(lowPassFilter(step, times, 0), step)
})

test('fitThroughOrigin is the model AP_Baro implements', () => {
  assert.equal(fitThroughOrigin([1, 2, 3], [-2, -4, -6]), -2)
  // No x-variance: NaN rather than a fabricated slope.
  assert.ok(Number.isNaN(fitThroughOrigin([0, 0], [1, 2])))
})
