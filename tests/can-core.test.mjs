// packages/can-core: the frame model, ring buffer, filters, per-id trace, bus
// load and the candump / CSV formats every CAN tool in the app is built on.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CanCaptureBuffer,
  CanIdTrace,
  EMPTY_CAN_FRAME_FILTER,
  canFrameFromRawId,
  canFrameRawId,
  canDlcForLength,
  canLengthForDlc,
  estimateCanBusLoad,
  formatCanCsv,
  formatCanId,
  formatCandump,
  matchesCanFilter,
  parseCanDataSearch,
  parseCanIdFilter,
  parseCanCsv,
  parseCanLog,
  parseCandump,
  canFrameIndexAt,
  canFramesBetween,
  canLogTimeline
} from '../packages/can-core/dist/index.js'

const frame = (rawId, bytes, extra = {}) =>
  canFrameFromRawId({ timestampMs: 1000, bus: 1, rawId, data: Uint8Array.from(bytes), ...extra })

test('flag bits in the raw id become fields, and round-trip back', () => {
  // ArduPilot (AP_HAL::CANFrame) and SocketCAN carry EFF/RTR/ERR in bits 31/30/29.
  const ext = frame(0x80000000 | 0x1e0a3c7f, [1, 2])
  assert.equal(ext.extended, true)
  assert.equal(ext.id, 0x1e0a3c7f)
  assert.equal(canFrameRawId(ext), (0x80000000 | 0x1e0a3c7f) >>> 0)
  const std = frame(0x123, [])
  assert.equal(std.extended, false)
  assert.equal(std.id, 0x123)
  assert.equal(frame(0x40000000 | 0x123, []).rtr, true)
  assert.equal(formatCanId(0x123, false), '123')
  assert.equal(formatCanId(0x3c7f, true), '00003C7F')
})

test('the frame copies its payload, so a reused source buffer cannot change it', () => {
  const source = Uint8Array.from([1, 2, 3])
  const captured = canFrameFromRawId({ timestampMs: 0, bus: 1, rawId: 0x10, data: source })
  source[0] = 99
  assert.equal(captured.data[0], 1)
})

test('CAN FD DLC codes map to their data lengths', () => {
  assert.equal(canLengthForDlc(9), 12)
  assert.equal(canLengthForDlc(15), 64)
  assert.equal(canDlcForLength(13), 10) // rounds up to 16 bytes
  assert.equal(canDlcForLength(8), 8)
})

test('the ring keeps the newest frames, counts what fell off, and numbers them', () => {
  const buffer = new CanCaptureBuffer(3)
  for (let index = 0; index < 5; index += 1) buffer.push(frame(index, [index]))
  assert.equal(buffer.size, 3)
  assert.equal(buffer.totalCaptured, 5)
  assert.equal(buffer.droppedOldest, 2)
  assert.deepEqual(buffer.toArray().map((entry) => entry.id), [2, 3, 4])
  assert.deepEqual(buffer.toArray().map((entry) => entry.seq), [3, 4, 5])
  assert.deepEqual(buffer.since(3).map((entry) => entry.seq), [4, 5])
  buffer.clear()
  assert.equal(buffer.size, 0)
  assert.equal(buffer.lastSeq, 0)
})

test('id filters: exact, range, id/mask and exclusions, all in hex', () => {
  const parsed = parseCanIdFilter('123, 0x200-2FF 1E0A3C00/1FFFFF00 !250')
  assert.equal(parsed.ok, true)
  const filter = { ...EMPTY_CAN_FRAME_FILTER, idTerms: parsed.value }
  const pass = (rawId) => matchesCanFilter(frame(rawId, []), filter)
  assert.equal(pass(0x123), true)
  assert.equal(pass(0x2a0), true)
  assert.equal(pass(0x250), false, 'excluded even though the range includes it')
  assert.equal(pass(0x80000000 | 0x1e0a3c7f), true, 'matches the masked bits')
  assert.equal(pass(0x124), false)
  assert.equal(parseCanIdFilter('').ok, true)
  assert.equal(parseCanIdFilter('xyz').ok, false)
  assert.equal(parseCanIdFilter('100-').ok, false)
})

test('an exclude-only filter shows everything else', () => {
  const parsed = parseCanIdFilter('!341')
  const filter = { ...EMPTY_CAN_FRAME_FILTER, idTerms: parsed.value }
  assert.equal(matchesCanFilter(frame(0x100, []), filter), true)
  assert.equal(matchesCanFilter(frame(0x341, []), filter), false)
})

test('kind, direction and payload filters', () => {
  const kinds = { ...EMPTY_CAN_FRAME_FILTER.kinds, standard: false }
  assert.equal(matchesCanFilter(frame(0x123, []), { ...EMPTY_CAN_FRAME_FILTER, kinds }), false)
  assert.equal(matchesCanFilter(frame(0x80000123, []), { ...EMPTY_CAN_FRAME_FILTER, kinds }), true)
  const tx = frame(0x1, [], { direction: 'tx' })
  assert.equal(matchesCanFilter(tx, { ...EMPTY_CAN_FRAME_FILTER, direction: 'rx' }), false)
  const search = parseCanDataSearch('1f 00')
  assert.deepEqual(search.value, [0x1f, 0x00])
  const withData = { ...EMPTY_CAN_FRAME_FILTER, dataContains: search.value }
  assert.equal(matchesCanFilter(frame(0x1, [9, 0x1f, 0x00, 4]), withData), true)
  assert.equal(matchesCanFilter(frame(0x1, [0x1f, 0x01]), withData), false)
  assert.equal(parseCanDataSearch('1').ok, false)
})

test('the per-id trace counts, times and marks the bytes that changed', () => {
  const trace = new CanIdTrace()
  trace.add({ ...frame(0x123, [1, 2, 3]), timestampMs: 0 })
  trace.add({ ...frame(0x123, [1, 9, 3]), timestampMs: 100 })
  trace.add({ ...frame(0x123, [1, 9, 4]), timestampMs: 200 })
  trace.add({ ...frame(0x80000001, [0]), timestampMs: 50 })
  const [first, second] = trace.list()
  assert.equal(first.id, 0x123)
  assert.equal(first.count, 3)
  assert.equal(first.periodMs, 100)
  assert.equal(first.changedBytes, 0b100)
  assert.equal(second.extended, true)
})

test('bus load: a saturated 1 Mbit/s second reads 100, an idle one 0', () => {
  const full = Array.from({ length: 8000 }, () => frame(0x80000000 | 1, [0, 0, 0, 0, 0, 0, 0, 0]))
  assert.equal(Math.round(estimateCanBusLoad(full, 1000, 1_000_000)), 100)
  assert.equal(estimateCanBusLoad([], 1000, 1_000_000), 0)
  const some = Array.from({ length: 1000 }, () => frame(0x123, [1, 2]))
  const load = estimateCanBusLoad(some, 1000, 1_000_000)
  assert.ok(load > 5 && load < 10, `~7% expected, got ${load}`)
})

test('candump -L round-trips classic, extended, remote and FD frames', () => {
  const frames = [
    canFrameFromRawId({ timestampMs: 1436509052249.713, bus: 1, rawId: 0x123, data: Uint8Array.from([0xde, 0xad]) }),
    canFrameFromRawId({ timestampMs: 1436509052250, bus: 2, rawId: 0x80000000 | 0x1e0a3c7f, data: Uint8Array.from([0]) }),
    canFrameFromRawId({ timestampMs: 1436509052251, bus: 1, rawId: 0x40000000 | 0x7ff, data: new Uint8Array(0) }),
    canFrameFromRawId({ timestampMs: 1436509052252, bus: 1, rawId: 0x80000000 | 0x10, data: new Uint8Array(12).fill(7), fd: true })
  ]
  const text = formatCandump(frames)
  assert.match(text, /^\(1436509052\.249713\) can0 123#DEAD$/m)
  assert.match(text, /^\(1436509052\.250000\) can1 1E0A3C7F#00$/m)
  assert.match(text, /^\(1436509052\.251000\) can0 7FF#R$/m)
  assert.match(text, /^\(1436509052\.252000\) can0 00000010##0(07){12}$/m)
  const parsed = parseCandump(`# a comment\n${text}garbage line\n`)
  assert.deepEqual(parsed.skippedLines, [6])
  assert.equal(parsed.frames.length, 4)
  assert.equal(parsed.frames[1].bus, 2)
  assert.equal(parsed.frames[1].extended, true)
  assert.equal(parsed.frames[1].id, 0x1e0a3c7f)
  assert.equal(parsed.frames[2].rtr, true)
  assert.equal(parsed.frames[3].fd, true)
  assert.equal(parsed.frames[3].data.length, 12)
})

test('CSV has a header and keeps the direction candump has no field for', () => {
  const csv = formatCanCsv([frame(0x123, [1, 2], { direction: 'tx' })])
  const [header, row] = csv.trim().split('\n')
  assert.equal(header, 'timestamp_s,bus,direction,id,extended,fd,remote,error,length,data')
  assert.equal(row, '1.000000,1,tx,123,0,0,0,0,2,01 02')
})

test('CSV saved here opens back, direction included', () => {
  const frames = [
    canFrameFromRawId({ timestampMs: 1000, bus: 1, rawId: 0x123, data: Uint8Array.from([1, 2]), direction: 'tx' }),
    canFrameFromRawId({ timestampMs: 1500, bus: 2, rawId: 0x80000000 | 0x1e0a3c7f, data: new Uint8Array(0) }),
    canFrameFromRawId({ timestampMs: 2000, bus: 1, rawId: 0x40000000 | 0x10, data: new Uint8Array(0) }),
    canFrameFromRawId({ timestampMs: 2500, bus: 1, rawId: 0x321, data: new Uint8Array(12).fill(5), fd: true })
  ]
  const parsed = parseCanCsv(formatCanCsv(frames))
  assert.deepEqual(parsed.skippedLines, [])
  assert.equal(parsed.frames.length, 4)
  assert.equal(parsed.frames[0].direction, 'tx')
  assert.deepEqual([...parsed.frames[0].data], [1, 2])
  assert.equal(parsed.frames[1].extended, true)
  assert.equal(parsed.frames[1].bus, 2)
  assert.equal(parsed.frames[2].rtr, true)
  assert.equal(parsed.frames[3].fd, true)
  assert.equal(parsed.frames[3].data.length, 12)
})

test('parseCanLog tells the formats apart and returns frames in time order', () => {
  const csv = formatCanCsv([frame(0x1, [1])])
  assert.equal(parseCanLog(csv).format, 'csv')
  const candump = '(2.000000) can0 002#02\n(1.000000) can0 001#01\n'
  const parsed = parseCanLog(candump)
  assert.equal(parsed.format, 'candump')
  assert.deepEqual(parsed.frames.map((entry) => entry.id), [1, 2], 'sorted by timestamp')
})

test('playback steps yield every frame exactly once, and seeking finds the right index', () => {
  const frames = [0, 100, 100, 250, 400].map((ms, index) =>
    canFrameFromRawId({ timestampMs: 10_000 + ms, bus: 1, rawId: index, data: new Uint8Array(0) })
  )
  const timeline = canLogTimeline(frames)
  assert.deepEqual(timeline, { startMs: 10_000, endMs: 10_400, durationMs: 400 })
  const seen = []
  let position = -1
  for (const next of [0, 50, 100, 260, 400]) {
    const range = canFramesBetween(frames, timeline, position, next)
    for (let index = range.from; index < range.to; index += 1) seen.push(frames[index].id)
    position = next
  }
  assert.deepEqual(seen, [0, 1, 2, 3, 4])
  assert.equal(canFrameIndexAt(frames, 10_100), 1)
  assert.equal(canFrameIndexAt(frames, 10_101), 3)
  assert.equal(canFrameIndexAt(frames, 99_999), 5)
  assert.deepEqual(canLogTimeline([]), { startMs: 0, endMs: 0, durationMs: 0 })
})
