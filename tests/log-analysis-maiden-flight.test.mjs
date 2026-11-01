import assert from 'node:assert/strict'
import test from 'node:test'

import { analyzeMaidenFlightLog } from '../packages/log-analysis/dist/index.js'

const s = (seconds) => Math.round(seconds * 1e6)
function ctun(startS, durS, alt) {
  const out = []
  for (let i = 0; i < durS * 10; i += 1) {
    out.push({ name: 'CTUN', TimeUS: s(startS + i / 10), Alt: alt, ThO: 0.2, ThH: 0.35, DCRt: 0, CRt: 0 })
  }
  return out
}
function makeLog({ ev = [], modes = [], ctunRows = [], msgs = [], vibe = [] } = {}) {
  const messagesByType = new Map()
  if (ev.length) messagesByType.set('EV', ev)
  if (modes.length) messagesByType.set('MODE', modes)
  if (ctunRows.length) messagesByType.set('CTUN', ctunRows)
  if (msgs.length) messagesByType.set('MSG', msgs)
  if (vibe.length) messagesByType.set('VIBE', vibe)
  return { messagesByType, formats: new Map(), counts: new Map(), skippedBytes: 0, paddingBytes: 0 }
}
const armed = (t) => ({ name: 'EV', TimeUS: s(t), Id: 10 })
const disarmed = (t) => ({ name: 'EV', TimeUS: s(t), Id: 11 })

test('a textbook maiden reads clean: Stabilize, a rehearsal, a short hover, nothing reported', () => {
  const log = makeLog({
    modes: [{ name: 'MODE', TimeUS: s(1), ModeNum: 0 }],
    ev: [armed(10), disarmed(13), armed(20), disarmed(60)],
    ctunRows: [...ctun(10, 10, 0), ...ctun(25, 20, 1.5), ...ctun(45, 15, 0)]
  })
  const result = analyzeMaidenFlightLog(log)
  assert.equal(result.hasFlight, true)
  assert.equal(result.firstArmedModeName, 'Stabilize')
  assert.equal(result.armCycles, 2)
  assert.equal(result.rehearsedArmDisarm, true)
  assert.ok(result.airborneSeconds > 8, `airborne ${result.airborneSeconds}`)
  assert.deepEqual(result.findings, [])
  assert.equal(result.verdict, 'clean')
})

test('the wrong mode, no rehearsal, and a firmware warning are each named', () => {
  const log = makeLog({
    modes: [{ name: 'MODE', TimeUS: s(1), ModeNum: 2 }],
    ev: [armed(20), disarmed(60)],
    ctunRows: [...ctun(25, 20, 1.5)],
    msgs: [{ name: 'MSG', TimeUS: s(30), Message: 'Potential Thrust Loss (3)' }]
  })
  const result = analyzeMaidenFlightLog(log)
  assert.equal(result.verdict, 'review')
  assert.equal(result.firstArmedModeName, 'AltHold')
  assert.equal(result.rehearsedArmDisarm, false)
  assert.ok(result.findings.some((line) => /belongs in Stabilize/.test(line)))
  assert.ok(result.findings.some((line) => /rehearsal/.test(line)))
  assert.ok(result.findings.some((line) => /Potential Thrust Loss/.test(line)))
})

test('a log with no armed segment is not a flight', () => {
  const result = analyzeMaidenFlightLog(makeLog({ ctunRows: ctun(0, 5, 0) }))
  assert.equal(result.hasFlight, false)
  assert.equal(result.verdict, 'no-flight')
})
