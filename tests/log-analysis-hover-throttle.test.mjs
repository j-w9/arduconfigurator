import assert from 'node:assert/strict'
import test from 'node:test'

import { analyzeHoverThrottleLog, THST_HOVER_MIN } from '../packages/log-analysis/dist/index.js'

// Synthetic CTUN at 50 Hz. ThO is the throttle out the firmware itself
// filters; DCRt/CRt are the climb-rate gates Copter::update_throttle_hover
// applies before it learns anything.
function ctunSpan({ startS, durS, hz = 50, tho, thh = 0.35, dcrt = 0, crt = 0, jitter = 0 }) {
  const out = []
  const n = Math.round(durS * hz)
  for (let i = 0; i < n; i += 1) {
    out.push({
      name: 'CTUN',
      TimeUS: Math.round((startS + i / hz) * 1e6),
      ThO: tho + (jitter === 0 ? 0 : (i % 2 === 0 ? jitter : -jitter)),
      ThH: typeof thh === 'function' ? thh(i, n) : thh,
      DCRt: dcrt,
      CRt: crt
    })
  }
  return out
}

function makeLog({ ctun = [], rate = [], modes = [] } = {}) {
  const messagesByType = new Map()
  if (ctun.length > 0) messagesByType.set('CTUN', ctun)
  if (rate.length > 0) messagesByType.set('RATE', rate)
  if (modes.length > 0) messagesByType.set('MODE', modes)
  return { messagesByType, formats: new Map(), counts: new Map(), skippedBytes: 0 }
}

test('measures the hover throttle from a steady hover', () => {
  const log = makeLog({ ctun: ctunSpan({ startS: 10, durS: 20, tho: 0.118 }) })
  const result = analyzeHoverThrottleLog(log)

  assert.ok(Math.abs(result.hoverThrottle - 0.118) < 1e-9)
  assert.equal(result.source, 'CTUN')
  assert.equal(result.windows.length, 1)
  assert.ok(result.totalHoverS >= 19)
})

// The reported case: MOT_THST_HOVER sat at exactly 0.350 after a real hover,
// so the card read the vehicle as never having flown. The log still carries
// the answer, AND says the firmware's own learner never moved.
test('reports a firmware learner that never moved', () => {
  const log = makeLog({ ctun: ctunSpan({ startS: 5, durS: 20, tho: 0.118, thh: 0.35 }) })
  const result = analyzeHoverThrottleLog(log)

  assert.equal(result.firmwareLearnerIdle, true)
  assert.equal(result.firmwareLearnedFirst, 0.35)
  assert.equal(result.firmwareLearnedLast, 0.35)
  assert.ok(result.warnings.some((warning) => warning.includes('never moved')))
})

test('names the mode when the hover could not have been learned', () => {
  const log = makeLog({
    ctun: ctunSpan({ startS: 5, durS: 20, tho: 0.2 }),
    // Stabilize: has_manual_throttle() is true, so the learner never runs.
    modes: [{ name: 'MODE', TimeUS: 1e6, ModeNum: 0 }]
  })
  const result = analyzeHoverThrottleLog(log)

  assert.deepEqual(result.hoverModes, ['Stabilize'])
  assert.deepEqual(result.blindHoverModes, ['Stabilize'])
  assert.ok(result.warnings.some((warning) => warning.includes('learns no hover throttle')))
})

test('a hover flown in VALT is not flagged — it derives from AltHold', () => {
  const log = makeLog({
    ctun: ctunSpan({ startS: 5, durS: 20, tho: 0.2 }),
    modes: [{ name: 'MODE', TimeUS: 1e6, ModeNum: 29 }]
  })
  const result = analyzeHoverThrottleLog(log)

  assert.deepEqual(result.hoverModes, ['VALT'])
  assert.deepEqual(result.blindHoverModes, [])
})

test('gates out a climb by the same rule the firmware uses', () => {
  // Commanded climb throughout: the firmware would learn nothing here, and
  // averaging it would produce a "hover throttle" that was never a hover.
  const log = makeLog({ ctun: ctunSpan({ startS: 5, durS: 20, tho: 0.4, dcrt: 1.5, crt: 1.4 }) })
  const result = analyzeHoverThrottleLog(log)

  assert.equal(result.hoverThrottle, undefined)
  assert.equal(result.windows.length, 0)
  assert.ok(result.warnings.some((warning) => warning.includes('No steady hover')))
})

test('splits a climb between two hovers into separate windows', () => {
  const log = makeLog({
    ctun: [
      ...ctunSpan({ startS: 0, durS: 8, tho: 0.12 }),
      ...ctunSpan({ startS: 8, durS: 6, tho: 0.45, dcrt: 2, crt: 1.9 }),
      ...ctunSpan({ startS: 14, durS: 8, tho: 0.13 })
    ]
  })
  const result = analyzeHoverThrottleLog(log)

  assert.equal(result.windows.length, 2)
  // The climb's 0.45 must not drag the measurement up.
  assert.ok(result.hoverThrottle < 0.14)
})

test('says when the aircraft hovers below what the parameter can hold', () => {
  const log = makeLog({ ctun: ctunSpan({ startS: 5, durS: 20, tho: 0.11 }) })
  const result = analyzeHoverThrottleLog(log)

  assert.ok(result.hoverThrottle < THST_HOVER_MIN)
  assert.equal(result.belowParameterFloor, true)
  assert.ok(result.warnings.some((warning) => warning.includes('lowest value MOT_THST_HOVER can hold')))
})

test('falls back to RATE.AOut when CTUN is not logged', () => {
  const rate = []
  for (let i = 0; i < 1000; i += 1) {
    rate.push({ name: 'RATE', TimeUS: Math.round((10 + i / 50) * 1e6), AOut: 0.118 })
  }
  const result = analyzeHoverThrottleLog(makeLog({ rate }))

  assert.equal(result.source, 'RATE')
  assert.ok(Math.abs(result.hoverThrottle - 0.118) < 1e-9)
  assert.ok(result.warnings.some((warning) => warning.includes('RATE.AOut')))
})

test('says so rather than guessing when there is no throttle data at all', () => {
  const result = analyzeHoverThrottleLog(makeLog({}))

  assert.equal(result.hoverThrottle, undefined)
  assert.ok(result.warnings.some((warning) => warning.includes('No throttle data')))
})
