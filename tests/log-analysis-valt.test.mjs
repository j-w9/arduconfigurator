import assert from 'node:assert/strict'
import test from 'node:test'

import { analyzeValtLog } from '../packages/log-analysis/dist/index.js'

// Build a synthetic parsed log with steady-hover windows: CTUN carries throttle
// (ThO) + baro altitude (BAlt), RFND carries the downward rangefinder ground
// truth. The baro reads high by `errorM` at throttle `tho`, so the expected
// BARO1_THST_SCALE = -(errorM * 12) / tho.

const PA_PER_M = 12

function hoverWindow({ startS, durS = 4, hz = 10, tho, trueAlt, baroErr }) {
  const ctun = []
  const rfnd = []
  const n = Math.round(durS * hz)
  for (let i = 0; i < n; i += 1) {
    const t = Math.round((startS + i / hz) * 1e6)
    ctun.push({ name: 'CTUN', TimeUS: t, ThO: tho, BAlt: trueAlt + baroErr })
    // Rangefinder slightly offset in time to exercise alignment.
    rfnd.push({ name: 'RFND', TimeUS: t + 5000, Instance: 0, Dist: trueAlt, Stat: 4, Orient: 25 })
  }
  return { ctun, rfnd }
}

function makeValtLog(windows, { currentScale, rfndOverride } = {}) {
  const ctun = []
  const rfnd = []
  for (const w of windows) {
    ctun.push(...w.ctun)
    rfnd.push(...w.rfnd)
  }
  const messagesByType = new Map()
  messagesByType.set('CTUN', ctun)
  messagesByType.set('RFND', rfndOverride ?? rfnd)
  const parm = []
  if (currentScale !== undefined) parm.push({ name: 'PARM', Name: 'BARO1_THST_SCALE', Value: currentScale })
  messagesByType.set('PARM', parm)
  return { messagesByType, formats: new Map(), counts: new Map(), skippedBytes: 0 }
}

test('fits BARO1_THST_SCALE from a single steady hover point', () => {
  // baro reads 0.5 m high at 40% throttle -> scale = -(0.5*12)/0.4 = -15 Pa
  const log = makeValtLog([hoverWindow({ startS: 10, tho: 0.4, trueAlt: 2, baroErr: 0.5 })])
  const r = analyzeValtLog(log)
  assert.equal(r.usable, true)
  assert.equal(r.points.length, 1)
  assert.ok(Math.abs(r.suggestedScale - -15) < 0.6, `scale ${r.suggestedScale}`)
  assert.ok(r.warnings.some((w) => /single/i.test(w)), 'single-point caveat')
})

test('least-squares fit through the origin across multiple hover points', () => {
  // Consistent -20 Pa scale: errorM = -scale*tho/12 = 20*tho/12.
  const scale = -20
  const mk = (startS, tho, trueAlt) =>
    hoverWindow({ startS, tho, trueAlt, baroErr: (-scale * tho) / PA_PER_M })
  const log = makeValtLog([mk(10, 0.3, 1.5), mk(20, 0.45, 3), mk(30, 0.6, 5)])
  const r = analyzeValtLog(log)
  assert.equal(r.usable, true)
  assert.equal(r.points.length, 3)
  assert.ok(Math.abs(r.suggestedScale - scale) < 0.5, `scale ${r.suggestedScale}`)
})

test('reports the current scale from PARM and no single-point caveat for 2+ points', () => {
  const mk = (startS, tho, trueAlt) => hoverWindow({ startS, tho, trueAlt, baroErr: 0.3 })
  const log = makeValtLog([mk(10, 0.35, 2), mk(20, 0.5, 3.5)], { currentScale: -8 })
  const r = analyzeValtLog(log)
  assert.equal(r.currentScale, -8)
  assert.ok(!r.warnings.some((w) => /single/i.test(w)))
  assert.match(r.summary, /current value is -8/i)
})

test('warns and is unusable when there is no downward rangefinder', () => {
  const log = makeValtLog([hoverWindow({ startS: 10, tho: 0.4, trueAlt: 2, baroErr: 0.5 })], {
    rfndOverride: [] // no RFND at all
  })
  const r = analyzeValtLog(log)
  assert.equal(r.usable, false)
  assert.ok(r.warnings.some((w) => /rangefinder/i.test(w)))
})

test('ignores forward/upward rangefinder readings (Orient != down)', () => {
  const w = hoverWindow({ startS: 10, tho: 0.4, trueAlt: 2, baroErr: 0.5 })
  const forward = w.rfnd.map((m) => ({ ...m, Orient: 0 })) // forward-facing
  const log = makeValtLog([w], { rfndOverride: forward })
  const r = analyzeValtLog(log)
  assert.equal(r.usable, false)
  assert.ok(r.warnings.some((w) => /rangefinder/i.test(w)))
})

test('does not form a window from a non-steady (drifting throttle) hover', () => {
  // Throttle ramps well beyond the steady band across the window.
  const ctun = []
  const rfnd = []
  for (let i = 0; i < 40; i += 1) {
    const t = Math.round((10 + i / 10) * 1e6)
    ctun.push({ name: 'CTUN', TimeUS: t, ThO: 0.3 + i * 0.02, BAlt: 2.5 })
    rfnd.push({ name: 'RFND', TimeUS: t, Instance: 0, Dist: 2, Stat: 4, Orient: 25 })
  }
  const messagesByType = new Map([
    ['CTUN', ctun],
    ['RFND', rfnd],
    ['PARM', []]
  ])
  const r = analyzeValtLog({ messagesByType, formats: new Map(), counts: new Map(), skippedBytes: 0 })
  assert.equal(r.usable, false)
  assert.ok(r.warnings.some((w) => /steady hover/i.test(w)))
})
