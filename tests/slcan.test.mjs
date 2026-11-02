// SLCAN: the line codec against ArduPilot's own format (AP_SLCANIface.cpp),
// the adapter's open handshake, and the CAN tab's whole node workflow --
// discovery, identity, parameters -- running over an adapter instead of
// MAVLink forwarding.

import assert from 'node:assert/strict'
import test from 'node:test'

import { SlcanAdapter, SlcanLineSplitter, encodeSlcanFrame, parseSlcanLine, slcanBitrateCommand } from '../packages/can-core/dist/index.js'
import { AdapterCanBus, createDemoSlcanIo } from '../packages/ardupilot-core/dist/index.js'

const bytes = (text) => new TextEncoder().encode(text)

test('frames encode the way ArduPilot reads them', () => {
  assert.equal(encodeSlcanFrame({ id: 0x123, extended: false, data: Uint8Array.from([1, 2, 0xff]) }), 't1233' + '0102FF\r')
  assert.equal(encodeSlcanFrame({ id: 0x1e0a3c7f, extended: true, data: Uint8Array.from([9]) }), 'T1E0A3C7F109\r')
  assert.equal(encodeSlcanFrame({ id: 0x7ff, extended: false, rtr: true, data: new Uint8Array(0) }), 'r7FF0\r')
  // FD: DLC is a hex digit; 10 bytes pad to 12 (DLC 9).
  assert.equal(encodeSlcanFrame({ id: 0x1, extended: true, fd: true, data: new Uint8Array(10).fill(0xaa) }), 'D000000019' + 'AA'.repeat(10) + '0000\r')
  assert.throws(() => encodeSlcanFrame({ id: 1, extended: false, data: new Uint8Array(9) }), /at most 8/)
  assert.equal(slcanBitrateCommand(1_000_000), 'S8\r')
  assert.equal(slcanBitrateCommand(125_000), 'S4\r')
  assert.equal(slcanBitrateCommand(123), undefined)
})

test('received lines parse, with or without ArduPilot\'s timestamp', () => {
  assert.deepEqual(parseSlcanLine('t12330102FF'), { kind: 'frame', rawId: 0x123, data: Uint8Array.from([1, 2, 0xff]), fd: false, adapterTimestampMs: undefined })
  const stamped = parseSlcanLine('T1E0A3C7F109EA60')
  assert.equal(stamped.rawId, (0x80000000 | 0x1e0a3c7f) >>> 0)
  assert.deepEqual([...stamped.data], [9])
  assert.equal(stamped.adapterTimestampMs, 0xea60)
  const remote = parseSlcanLine('R1E0A3C7F0')
  assert.equal(remote.rawId, (0x80000000 | 0x40000000 | 0x1e0a3c7f) >>> 0)
  const fd = parseSlcanLine('D00000001F' + '11'.repeat(64))
  assert.equal(fd.fd, true)
  assert.equal(fd.data.length, 64)
  assert.equal(parseSlcanLine('t123'), undefined, 'truncated')
  assert.equal(parseSlcanLine('t1239'), undefined, 'classic DLC above 8')
  assert.equal(parseSlcanLine('V1010').kind, 'reply')
  assert.equal(parseSlcanLine('z').kind, 'ok')
})

test('the splitter handles split reads, BEL replies and \\r\\n endings', () => {
  const splitter = new SlcanLineSplitter()
  assert.deepEqual(splitter.push(bytes('t12310')), [])
  const lines = splitter.push(bytes('1\r\x07t1230\r\n'))
  assert.equal(lines.length, 3)
  assert.equal(lines[0].kind, 'frame')
  assert.deepEqual([...lines[0].data], [0x01])
  assert.equal(lines[1].kind, 'error')
  assert.equal(lines[2].kind, 'frame')
})

test('open sends close, bitrate and open; a refused open is an error', async () => {
  const written = []
  const listeners = new Set()
  const io = {
    connect: async () => {},
    disconnect: async () => {},
    async send(chunk) {
      const text = new TextDecoder().decode(chunk)
      written.push(text)
      const reply = text === 'O\r' ? '\x07' : text.endsWith('\r') && text.trim() !== '' ? '\r' : ''
      if (reply) setTimeout(() => listeners.forEach((listener) => listener(bytes(reply))), 1)
    },
    onFrame(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    onStatus: () => () => {}
  }
  const adapter = new SlcanAdapter(io, { bitrate: 500_000, replyTimeoutMs: 30 })
  await assert.rejects(adapter.open(), /refused to open/)
  assert.deepEqual(written, ['\r\r\r', 'C\r', 'S6\r', 'O\r'])
})

test('over an adapter, the CAN tab finds the nodes, reads identity, and walks parameters', async () => {
  const bus = new AdapterCanBus(new SlcanAdapter(createDemoSlcanIo(), { bitrate: 1_000_000, replyTimeoutMs: 30 }))
  const frames = []
  bus.onCanFrame((frame) => frames.push(frame))
  try {
    await bus.start()
    assert.equal(bus.getSnapshot().status, 'active')
    const until = async (predicate, ms = 5000) => {
      const deadline = Date.now() + ms
      while (!predicate(bus.getSnapshot())) {
        if (Date.now() > deadline) throw new Error('timed out')
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    await until((state) => state.nodes.some((node) => node.nodeId === 124 && node.name === 'com.hex.here3'))
    bus.fetchAllCanBusParameters(124)
    await until((state) => state.nodes.find((node) => node.nodeId === 124)?.parameters.some((entry) => entry.name === 'GPS_TYPE'))
    assert.ok(frames.some((frame) => frame.direction === 'rx' && !frame.extended), 'plain CAN traffic arrives too')
    assert.ok(frames.some((frame) => frame.direction === 'tx'), 'what the service sends is echoed as TX')

    await bus.sendCanFrames([{ id: 0x5a5, extended: false, data: Uint8Array.from([1]) }])
  } finally {
    await bus.stop()
  }
  assert.equal(bus.getSnapshot().status, 'idle')
})
