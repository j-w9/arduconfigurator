import assert from 'node:assert/strict'
import test from 'node:test'

import { planNotchFromLog } from '../packages/log-analysis/dist/index.js'

const s = (seconds) => Math.round(seconds * 1e6)
function ctun(startS, durS, tho) {
  const out = []
  for (let i = 0; i < durS * 50; i += 1) {
    out.push({ name: 'CTUN', TimeUS: s(startS + i / 50), Alt: 3, ThO: tho, ThH: 0.35, DCRt: 0, CRt: 0 })
  }
  return out
}
function esc(startS, durS, rpm) {
  const out = []
  for (let i = 0; i < durS * 10; i += 1) {
    out.push({ name: 'ESC', TimeUS: s(startS + i / 10), Instance: 0, RPM: rpm })
  }
  return out
}
function makeLog(entries) {
  const messagesByType = new Map()
  for (const [name, rows] of Object.entries(entries)) if (rows.length) messagesByType.set(name, rows)
  return { messagesByType, formats: new Map(), counts: new Map(), skippedBytes: 0, paddingBytes: 0 }
}

test('the hover fundamental is read from ESC RPM inside the steady hover, not from spin-up', () => {
  // Idle at 1800 rpm before the hover, 9000 rpm in the hover.
  const log = makeLog({
    CTUN: ctun(10, 30, 0.2),
    ESC: [...esc(0, 10, 1800), ...esc(10, 30, 9000)]
  })
  const plan = planNotchFromLog(log)
  assert.equal(plan.escTelemetry, true)
  assert.ok(Math.abs(plan.hoverFundamentalHz - 150) < 1, `fundamental ${plan.hoverFundamentalHz}`)
  assert.ok(Math.abs(plan.hoverThrottle - 0.2) < 1e-6)
  assert.ok(plan.hoverSeconds >= 29)
})

test('without ESC telemetry the plan says so and still carries the hover throttle', () => {
  const plan = planNotchFromLog(makeLog({ CTUN: ctun(10, 30, 0.18) }))
  assert.equal(plan.escTelemetry, false)
  assert.equal(plan.hoverFundamentalHz, undefined)
  assert.ok(Math.abs(plan.hoverThrottle - 0.18) < 1e-6)
  assert.ok(plan.notes.some((note) => /batch sampler|gyro/i.test(note)))
})

test('no steady hover is named', () => {
  const plan = planNotchFromLog(makeLog({ CTUN: ctun(10, 3, 0.2) }))
  assert.ok(plan.notes.some((note) => /No steady hover/.test(note)))
})
