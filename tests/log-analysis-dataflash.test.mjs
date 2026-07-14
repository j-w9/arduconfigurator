import assert from 'node:assert/strict'
import test from 'node:test'

import { parseDataflashLog } from '../packages/log-analysis/dist/index.js'

// Build a synthetic DataFlash `.bin` stream so the parser is validated against
// exactly-known values (framing, FMT bootstrap, every scaled type code) without
// shipping a multi-MB real-log fixture. Real-log + magfit_WMM.py oracle
// validation lives with the MAGFit analysis that consumes this parser.

const HEAD1 = 0xa3
const HEAD2 = 0x95
const FMT_TYPE = 0x80

function padBytes(str, length) {
  const out = new Uint8Array(length)
  for (let i = 0; i < str.length && i < length; i += 1) {
    out[i] = str.charCodeAt(i)
  }
  return out
}

// A FMT record is always 89 bytes: head(2) type(1) definedType(1) length(1)
// name(4) format(16) columns(64).
function fmtRecord(definedType, length, name, format, columns) {
  const buf = new Uint8Array(89)
  const view = new DataView(buf.buffer)
  buf[0] = HEAD1
  buf[1] = HEAD2
  buf[2] = FMT_TYPE
  view.setUint8(3, definedType)
  view.setUint8(4, length)
  buf.set(padBytes(name, 4), 5)
  buf.set(padBytes(format, 16), 9)
  buf.set(padBytes(columns, 64), 25)
  return buf
}

function concat(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

test('parses framing, FMT schema, and every scaled type code', () => {
  // TEST message: B(u8) h(i16) f(f32) L(i32×1e-7). Body = 1+2+4+4 = 11 → len 14.
  const testFmt = fmtRecord(200, 14, 'TEST', 'BhfL', 'a,b,c,lat')
  const testMsg = new Uint8Array(14)
  {
    const v = new DataView(testMsg.buffer)
    testMsg[0] = HEAD1
    testMsg[1] = HEAD2
    testMsg[2] = 200
    v.setUint8(3, 42)
    v.setInt16(4, -1234, true)
    v.setFloat32(6, 3.5, true)
    v.setInt32(10, 473977000, true) // 47.3977 deg after ×1e-7
  }

  // ATT with 'c' (centidegree ×0.01) fields to exercise built-in scaling.
  const attFmt = fmtRecord(201, 9, 'ATT', 'ccc', 'Roll,Pitch,Yaw')
  const attMsg = new Uint8Array(9)
  {
    const v = new DataView(attMsg.buffer)
    attMsg[0] = HEAD1
    attMsg[1] = HEAD2
    attMsg[2] = 201
    v.setInt16(3, 1050, true) // 10.5 deg
    v.setInt16(5, -500, true) // -5.0 deg
    v.setInt16(7, 9000, true) // 90.0 deg
  }

  const log = parseDataflashLog(concat([testFmt, testMsg, attFmt, attMsg, attMsg]))

  assert.equal(log.skippedBytes, 0, 'clean stream, nothing skipped')
  assert.equal(log.counts.get('TEST'), 1)
  assert.equal(log.counts.get('ATT'), 2)
  assert.ok(log.formats.has('TEST') && log.formats.has('ATT'))

  const t = log.messagesByType.get('TEST')[0]
  assert.equal(t.name, 'TEST')
  assert.equal(t.a, 42)
  assert.equal(t.b, -1234)
  assert.equal(t.c, 3.5)
  assert.ok(Math.abs(t.lat - 47.3977) < 1e-6, `lat decoded ${t.lat}`)

  const att = log.messagesByType.get('ATT')[0]
  assert.ok(Math.abs(att.Roll - 10.5) < 1e-9)
  assert.ok(Math.abs(att.Pitch - -5.0) < 1e-9)
  assert.ok(Math.abs(att.Yaw - 90.0) < 1e-9)
})

test('resynchronises past leading garbage and a torn frame boundary', () => {
  const fmt = fmtRecord(200, 6, 'ONE', 'H', 'v')
  const msg = new Uint8Array(6)
  msg[0] = HEAD1
  msg[1] = HEAD2
  msg[2] = 200
  new DataView(msg.buffer).setUint16(3, 65000, true)

  const garbage = new Uint8Array([0x00, 0x11, 0xa3, 0x22, 0x95]) // near-misses on the head bytes
  const log = parseDataflashLog(concat([garbage, fmt, msg]))

  assert.equal(log.counts.get('ONE'), 1)
  assert.equal(log.messagesByType.get('ONE')[0].v, 65000)
  assert.ok(log.skippedBytes >= garbage.length, `skipped ${log.skippedBytes} garbage bytes`)
})

test('drops a truncated final message instead of throwing', () => {
  const fmt = fmtRecord(200, 7, 'TWO', 'I', 'v')
  const truncated = new Uint8Array([HEAD1, HEAD2, 200, 0x01, 0x02]) // needs 4 body bytes, only 2
  const log = parseDataflashLog(concat([fmt, truncated]))
  assert.equal(log.counts.get('TWO'), undefined) // the torn message is not emitted
  assert.ok(log.formats.has('TWO'))
})
