import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { MavlinkSession, MavlinkV2Codec, createArduCopterMockScenario } from '../packages/protocol-mavlink/dist/index.js'
import {
  MockTransport,
  ReplayTransport,
  WebSerialTransport,
  WebSocketTransport,
  createRecordedSession,
  createRecordedSessionEvent,
  parseRecordedSession,
  serializeRecordedSession
} from '../packages/transport/dist/index.js'
import {
  MAVLINK_MESSAGE_CRCS,
  MAVLINK_V2_HEADER_LENGTH,
  MAVLINK_V2_CHECKSUM_LENGTH
} from '../packages/protocol-mavlink/dist/constants.js'
import { NativeSerialTransport } from '../apps/desktop/dist/native-serial-transport.js'
import { TcpTransport, UdpTransport } from '../packages/sitl-harness/dist/index.js'
import { createServer } from 'node:net'
import { createDesktopWebPreferences } from '../apps/desktop/dist/electron-window-options.js'
import { startWebSocketBridgeServer } from '../apps/desktop/dist/websocket-bridge-server.js'

test('WebSocketTransport connects, relays frames, and disconnects with an injected socket', async () => {
  const socket = new FakeWebSocket()
  const transport = new WebSocketTransport('test-websocket', {
    url: 'ws://127.0.0.1:14550',
    socketFactory: () => socket
  })

  const statuses = []
  const receivedFrames = []
  transport.onStatus((status) => {
    statuses.push(status.kind)
  })
  transport.onFrame((frame) => {
    receivedFrames.push([...frame])
  })

  const connectPromise = transport.connect()
  socket.emitOpen()
  await connectPromise

  await transport.send(new Uint8Array([1, 2, 3]))
  assert.deepEqual(socket.sentFrames.map((frame) => [...frame]), [[1, 2, 3]])

  socket.emitMessage(new Uint8Array([9, 8, 7]).buffer)
  await wait(0)
  assert.deepEqual(receivedFrames, [[9, 8, 7]])

  await transport.disconnect()
  assert.deepEqual(statuses, ['idle', 'connecting', 'connected', 'disconnected'])
})

test('WebSocketTransport: a concurrent connect() while still connecting returns the in-flight promise (audit-33)', async () => {
  // Pre-audit-33 the early-return only checked status==='connected'; a
  // second connect() while status was 'connecting' created a SECOND
  // socket via the factory, overwrote this.socket and this.connectReject,
  // and stranded the first caller's await on a reject that no longer
  // belongs to any live socket. Both awaiters must now settle off the
  // same single socket.
  let socketFactoryCalls = 0
  const socket = new FakeWebSocket()
  const transport = new WebSocketTransport('test-double-connect', {
    url: 'ws://127.0.0.1:14550',
    socketFactory: () => {
      socketFactoryCalls += 1
      return socket
    }
  })

  const firstPromise = transport.connect()
  const secondPromise = transport.connect()
  // Same factory call: the latch returned the in-flight promise without
  // building another socket.
  assert.equal(socketFactoryCalls, 1, 'exactly one socket built across both connect() calls')
  socket.emitOpen()
  // Both awaiters settle together off the single socket.
  await Promise.all([firstPromise, secondPromise])
  assert.equal(transport.getStatus().kind, 'connected')

  await transport.disconnect()

  // After settling, a NEW connect() goes through the factory again (the
  // latch was cleared in .finally()) — so the idempotency is scoped to
  // the in-flight window, not a permanent gate.
  const fresh = new FakeWebSocket()
  const transport2 = new WebSocketTransport('test-fresh', {
    url: 'ws://127.0.0.1:14550',
    socketFactory: () => fresh
  })
  const p = transport2.connect()
  fresh.emitOpen()
  await p
  assert.equal(transport2.getStatus().kind, 'connected')
  await transport2.disconnect()
})

test('WebSocketTransport: a concurrent connect() during connect rejection both reject (audit-33)', async () => {
  // The same latch must also surface a failed connect to all in-flight
  // awaiters — not just the first one. Pre-audit-33 a second connect()
  // during connecting overwrote this.connectReject, so the first caller
  // saw a different (or no) rejection.
  const socket = new FakeWebSocket()
  const transport = new WebSocketTransport('test-fail-double', {
    url: 'ws://127.0.0.1:14550',
    socketFactory: () => socket
  })

  const firstPromise = transport.connect()
  const secondPromise = transport.connect()
  // Trigger the connection failure path.
  socket.emitError()

  await assert.rejects(() => firstPromise, /Failed to open WebSocket/)
  await assert.rejects(() => secondPromise, /Failed to open WebSocket/)
  // Status reflects the failure.
  assert.equal(transport.getStatus().kind, 'error')
})

test('WebSocketTransport: disconnect() during connect detaches connect-phase listeners so a late close cannot clobber a follow-up reconnect (audit-41)', async () => {
  // Regression for audit-41 (P1 from the 12-dimension extreme audit):
  // disconnect() detached only the RUNTIME triplet (message / runtime-
  // error / runtime-close), which were not yet attached during the
  // connecting window (they get added in handleOpen). The connect-phase
  // trio (handleOpen / handleError / handleCloseBeforeOpen) lived in a
  // Promise-scoped closure inaccessible to disconnect, so socket.close
  // (1000) below queued a close event that fired after disconnect
  // returned. If the user reconnected meanwhile, the late close on
  // the aborted socket ran handleCloseBeforeOpen, which emitted
  // 'disconnected' on the live transport — the runtime treated it as
  // a real disconnect and rejectAll'd every in-flight waiter +
  // resetLiveState.
  //
  // The fix lifts cleanupConnectListeners onto the instance so
  // disconnect can call it. This test exercises the close-after-
  // reconnect race directly.
  let nextSocket = new FakeWebSocket()
  const sockets = []
  const transport = new WebSocketTransport('test-late-close', {
    url: 'ws://127.0.0.1:14550',
    socketFactory: () => {
      const s = nextSocket
      sockets.push(s)
      return s
    }
  })
  const statusKinds = []
  transport.onStatus((status) => statusKinds.push(status.kind))

  // 1. Start a connect — socket1 created, connect-phase listeners attached.
  const firstConnect = transport.connect()
  const socket1 = sockets[0]
  assert.ok(socket1.hasAnyListener(), 'socket1 should have connect-phase listeners after connect()')

  // 2. Disconnect mid-connect. The fix detaches the connect-phase
  //    listeners on socket1; pre-fix they were left attached.
  await transport.disconnect()
  await assert.rejects(() => firstConnect, /aborted by disconnect/i)
  assert.equal(
    socket1.hasAnyListener(),
    false,
    'disconnect must detach connect-phase listeners so the aborted socket cannot touch the transport again'
  )

  // 3. Reconnect — socket2 created, transport status moves to 'connecting'
  //    and then 'connected' once we emit open on the new socket.
  nextSocket = new FakeWebSocket()
  const secondConnect = transport.connect()
  const socket2 = sockets[1]
  assert.notEqual(socket1, socket2, 'reconnect must build a fresh socket')
  socket2.emitOpen()
  await secondConnect
  assert.equal(transport.getStatus().kind, 'connected', 'live transport is on socket2')

  // 4. Fire the late close on the OLD aborted socket. Pre-fix this
  //    would run handleCloseBeforeOpen and emit 'disconnected' on the
  //    live transport. Post-fix the listeners are already detached
  //    and the close goes nowhere.
  const statusKindsBeforeLateClose = statusKinds.slice()
  socket1.emitClose({ code: 1000, reason: 'aborted' })

  assert.equal(
    transport.getStatus().kind,
    'connected',
    'live transport must stay connected when the stale close fires on the aborted socket'
  )
  assert.deepEqual(
    statusKinds,
    statusKindsBeforeLateClose,
    `no status emit allowed from the aborted socket's late close; got ${statusKinds.join(' -> ')}`
  )

  await transport.disconnect()
})

test('WebSerialTransport reports an error when the selected port fails to open', async () => {
  const failingPort = {
    readable: {},
    writable: {},
    async open() {
      throw new Error('The port is already open.')
    },
    async close() {}
  }
  const transport = new WebSerialTransport('test-web-serial', {
    baudRate: 115200,
    port: failingPort
  })

  const statuses = []
  transport.onStatus((status) => {
    statuses.push(status.kind)
  })

  await assert.rejects(() => transport.connect(), /already open/i)
  assert.deepEqual(statuses, ['idle', 'connecting', 'error'])
  assert.deepEqual(transport.getStatus(), { kind: 'error', message: 'The port is already open.' })
})

test('WebSerialTransport resolves a function `port` lazily at connect (no rebuild needed)', async () => {
  // The app supplies the selected port via a resolver so a connect-time
  // onPortSelected can't re-key the runtime useMemo and tear down the
  // in-flight transport ("no heartbeats until refresh"). The resolver
  // must be read at connect(), not captured in the constructor.
  let resolverCalls = 0
  let currentPort
  const makePort = () => ({
    readable: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => {}, releaseLock() {} }) },
    writable: { getWriter: () => ({ write: async () => {}, releaseLock() {} }) },
    async open() {},
    async close() {}
  })
  const transport = new WebSerialTransport('lazy-port', {
    baudRate: 115200,
    port: () => {
      resolverCalls += 1
      return currentPort
    },
    onPortSelected: () => {
      // mimic the app: remembering the port must not require a rebuild
      currentPort = currentPort ?? makePort()
    }
  })
  assert.equal(resolverCalls, 0, 'resolver is NOT called in the constructor')

  const statuses = []
  transport.onStatus((s) => statuses.push(s.kind))
  currentPort = makePort()
  await transport.connect()
  assert.ok(resolverCalls >= 1, 'resolver is called at connect()')
  assert.deepEqual(statuses, ['idle', 'connecting', 'connected'])
  await transport.disconnect()
})

test('WebSerialTransport self-heals a stale port whose first open() fails (no page refresh)', async () => {
  // Real bug: a prior attempt (auto-reconnect on load, or a failed
  // connect) left the handle's OS port open — a Cube's close() can
  // reject — so the next port.open() threw "Failed to open serial port"
  // and the ONLY way through was a full page refresh. The transport must
  // instead close + reopen (re-resolving a fresh resolver handle) inline.
  let opens = 0
  let closes = 0
  const makeStreams = () => ({
    readable: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => {}, releaseLock() {} }) },
    writable: { getWriter: () => ({ write: async () => {}, releaseLock() {} }) }
  })
  const port = {
    ...makeStreams(),
    async open() {
      opens += 1
      if (opens === 1) {
        throw new Error("Failed to execute 'open' on 'SerialPort': Failed to open serial port.")
      }
    },
    async close() {
      closes += 1
    }
  }
  const transport = new WebSerialTransport('stale-port', {
    baudRate: 115200,
    port: () => port
  })
  const statuses = []
  transport.onStatus((s) => statuses.push(s.kind))

  await transport.connect() // must NOT reject — recovered inline

  assert.equal(opens, 2, 'open() retried exactly once after the stale-handle failure')
  assert.equal(closes, 1, 'the stale handle was closed before the reopen')
  assert.deepEqual(statuses, ['idle', 'connecting', 'connected'], 'no spurious extra status churn')
  assert.equal(transport.getStatus().kind, 'connected')
  await transport.disconnect()
})

test('WebSerialTransport: a "device has been lost" handle recovers once the resolver yields the re-enumerated port (audit-14)', async () => {
  // A Cube/Pixhawk re-enumerates over USB CDC as its bootloader hands
  // off to firmware, so the picked handle is PERMANENTLY dead ("The
  // device has been lost") — unlike #188's transiently-locked port,
  // reopening the same handle can't work. Recovery needs the device's
  // NEW getPorts() handle, which the app re-acquires on a failed connect
  // and feeds back through the resolver. Model that across two connect()
  // calls: dead handle → reject (surfaced, not swallowed) → resolver now
  // yields the fresh handle → connected, no page refresh.
  const streams = () => ({
    readable: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => {}, releaseLock() {} }) },
    writable: { getWriter: () => ({ write: async () => {}, releaseLock() {} }) }
  })
  const deadPort = {
    ...streams(),
    async open() {
      throw new Error('The device has been lost.')
    },
    async close() {}
  }
  const freshPort = {
    ...streams(),
    async open() {},
    async close() {}
  }
  let current = deadPort
  const transport = new WebSerialTransport('reenumerated', {
    baudRate: 115200,
    port: () => current
  })
  const statuses = []
  transport.onStatus((s) => statuses.push(s.kind))

  await assert.rejects(() => transport.connect(), /device has been lost/, 'the dead handle surfaces, not swallowed')
  assert.equal(transport.getStatus().kind, 'error')

  // The app re-acquires the device's current handle via getPorts() and
  // points the resolver at it; the next connect must succeed inline.
  current = freshPort
  await transport.connect()
  assert.equal(transport.getStatus().kind, 'connected', `recovered with the fresh handle, saw ${statuses.join(',')}`)
  await transport.disconnect()
})

test('WebSerialTransport: disconnect during the connecting window never ends up connected', async () => {
  // Regression (#167 fixed this for WebSocket but not WebSerial): if
  // disconnect() is called while port.open() is still pending, doConnect()
  // must NOT resume, mark the transport connected and start a readLoop
  // that breaks silently — leaving the session "connected" over a dead
  // link.
  let releaseOpen
  const openGate = new Promise((resolve) => {
    releaseOpen = resolve
  })
  const port = {
    readable: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => {}, releaseLock() {} }) },
    writable: { getWriter: () => ({ write: async () => {}, releaseLock() {} }) },
    async open() {
      await openGate
    },
    async close() {}
  }
  const transport = new WebSerialTransport('disc-mid-connect', { baudRate: 115200, port })
  const statuses = []
  transport.onStatus((status) => {
    statuses.push(status.kind)
  })

  const connectPromise = transport.connect()
  await wait(5) // let doConnect() reach `await port.open()`
  await transport.disconnect()
  releaseOpen() // open() resolves; doConnect() resumes and must abort

  await assert.rejects(() => connectPromise, /aborted by disconnect/)
  assert.equal(transport.getStatus().kind, 'disconnected')
  assert.ok(!statuses.includes('connected'), `must never report connected, saw ${statuses.join(',')}`)
})

test('WebSerialTransport recovers from a transient break during read instead of erroring the session', async () => {
  const receivedFrames = []
  const statuses = []
  const transport = new WebSerialTransport('recovering-web-serial', {
    baudRate: 115200,
    port: new RecoveringWebSerialPort([
      { type: 'throw', error: new Error('Break received') },
      { type: 'value', value: new Uint8Array([9, 8, 7]) },
      { type: 'done' }
    ])
  })

  transport.onStatus((status) => {
    statuses.push(status.kind)
  })
  transport.onFrame((frame) => {
    receivedFrames.push([...frame])
  })

  await transport.connect()
  await wait(20)

  assert.deepEqual(receivedFrames, [[9, 8, 7]])
  assert.deepEqual(statuses, ['idle', 'connecting', 'connected', 'disconnected'])
})

test('ReplayTransport replays inbound frames and validates strict outbound frames', async () => {
  const outboundA = new Uint8Array([1, 2, 3])
  const outboundB = new Uint8Array([4, 5, 6])
  const inboundA = new Uint8Array([10, 11, 12])
  const inboundB = new Uint8Array([13, 14, 15])

  const session = createRecordedSession('transport replay', [
    createRecordedSessionEvent(outboundA, 'out', 0),
    createRecordedSessionEvent(inboundA, 'in', 5),
    createRecordedSessionEvent(outboundB, 'out', 10),
    createRecordedSessionEvent(inboundB, 'in', 15)
  ])
  const roundTrip = parseRecordedSession(serializeRecordedSession(session))
  const transport = new ReplayTransport('strict-replay', {
    session: roundTrip,
    strictOutbound: true,
    speedMultiplier: 50
  })

  const statuses = []
  const receivedFrames = []
  transport.onStatus((status) => {
    statuses.push(status.kind)
  })
  transport.onFrame((frame) => {
    receivedFrames.push([...frame])
  })

  await transport.connect()
  await transport.send(outboundA)
  await wait(20)
  await transport.send(outboundB)
  await wait(20)
  await transport.disconnect()

  assert.deepEqual(receivedFrames, [[10, 11, 12], [13, 14, 15]])
  assert.deepEqual(statuses, ['idle', 'connecting', 'connected', 'disconnected'])
})

test('ReplayTransport strict mode gates inbound frames behind matched outbound steps', async () => {
  const outboundA = new Uint8Array([1, 2, 3])
  const outboundB = new Uint8Array([4, 5, 6])
  const inboundA = new Uint8Array([10, 11, 12])
  const inboundB = new Uint8Array([13, 14, 15])

  const transport = new ReplayTransport('strict-gated-replay', {
    session: createRecordedSession('strict gated replay', [
      createRecordedSessionEvent(outboundA, 'out', 0),
      createRecordedSessionEvent(inboundA, 'in', 5),
      createRecordedSessionEvent(outboundB, 'out', 10),
      createRecordedSessionEvent(inboundB, 'in', 15)
    ]),
    strictOutbound: true,
    speedMultiplier: 50
  })

  const receivedFrames = []
  transport.onFrame((frame) => {
    receivedFrames.push([...frame])
  })

  await transport.connect()
  await wait(20)
  assert.deepEqual(receivedFrames, [])

  await transport.send(outboundA)
  await wait(20)
  assert.deepEqual(receivedFrames, [[10, 11, 12]])

  await transport.send(outboundB)
  await wait(20)
  assert.deepEqual(receivedFrames, [[10, 11, 12], [13, 14, 15]])
  await transport.disconnect()
})

test('ReplayTransport strict mode fails disconnect when required outbound frames were never emitted', async () => {
  const outboundA = new Uint8Array([1, 2, 3])
  const inboundA = new Uint8Array([10, 11, 12])
  const transport = new ReplayTransport('strict-missing-outbound', {
    session: createRecordedSession('strict missing outbound', [
      createRecordedSessionEvent(outboundA, 'out', 0),
      createRecordedSessionEvent(inboundA, 'in', 5)
    ]),
    strictOutbound: true,
    speedMultiplier: 50
  })

  const statuses = []
  transport.onStatus((status) => {
    statuses.push(status.kind)
  })

  await transport.connect()
  await assert.rejects(
    () => transport.disconnect(),
    /ended before 1 required outbound frame was emitted/i
  )
  assert.deepEqual(statuses, ['idle', 'connecting', 'connected', 'error'])
})

test('ReplayTransport can drive runtime heartbeat and parameter sync from a recorded session', async () => {
  const codec = new MavlinkV2Codec()
  let sequence = 0
  const encodeEnvelope = (message) =>
    codec.encode({
      header: {
        systemId: 1,
        componentId: 1,
        sequence: sequence++
      },
      message,
      timestampMs: Date.now()
    })

  const session = createRecordedSession('ArduCopter minimal sync', [
    createRecordedSessionEvent(
      encodeEnvelope({
        type: 'HEARTBEAT',
        customMode: 0,
        vehicleType: 2,
        autopilot: 3,
        baseMode: 0,
        systemStatus: 4,
        mavlinkVersion: 3
      }),
      'in',
      0
    ),
    createRecordedSessionEvent(
      encodeEnvelope({
        type: 'PARAM_VALUE',
        paramId: 'FLTMODE1',
        paramValue: 0,
        paramType: 9,
        paramCount: 2,
        paramIndex: 0
      }),
      'in',
      5
    ),
    createRecordedSessionEvent(
      encodeEnvelope({
        type: 'PARAM_VALUE',
        paramId: 'FLTMODE2',
        paramValue: 5,
        paramType: 9,
        paramCount: 2,
        paramIndex: 1
      }),
      'in',
      10
    )
  ])

  const transport = new ReplayTransport('runtime-replay', {
    session,
    speedMultiplier: 50
  })
  const runtime = new ArduPilotConfiguratorRuntime(
    new MavlinkSession(transport, new MavlinkV2Codec()),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    const snapshot = runtime.getSnapshot()
    assert.equal(snapshot.connection.kind, 'connected')
    assert.equal(snapshot.vehicle?.vehicle, 'ArduCopter')
    assert.equal(snapshot.parameterStats.status, 'complete')
    assert.equal(snapshot.parameterStats.downloaded, 2)
    assert.equal(snapshot.parameters.find((parameter) => parameter.id === 'FLTMODE2')?.value, 5)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('a faithfully v2-truncated STATUSTEXT decodes through codec→session→runtime (audit-20, locks audit-18 end-to-end)', async () => {
  // The mock-scenario encodes with the product's own NON-truncating
  // encoder, so the suite never sees a v2-truncated frame — structurally
  // why audit-18's real-hardware bug passed every test. This drives the
  // FULL runtime stack with a frame truncated exactly like real ArduPilot
  // (trailing zeros stripped, LEN + CRC recomputed). Pre-audit-18 the
  // truncated STATUSTEXT (LEN < the old MIN 51) was silently dropped and
  // never reached snapshot.statusTexts — this test fails on that code.
  const enc = new MavlinkV2Codec()
  let seq = 0
  const frameOf = (message) => enc.encode({ header: { systemId: 1, componentId: 1, sequence: seq++ }, message, timestampMs: 0 })
  const accumulate = (byte, checksum) => {
    let tmp = byte ^ (checksum & 0xff)
    tmp ^= (tmp << 4) & 0xff
    return ((checksum >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff
  }
  const truncateLikeRealFc = (full) => {
    const hdr = MAVLINK_V2_HEADER_LENGTH
    const msgId = full[7] | (full[8] << 8) | (full[9] << 16)
    let len = full[1]
    while (len > 1 && full[hdr + len - 1] === 0) len -= 1
    const out = new Uint8Array(hdr + len + MAVLINK_V2_CHECKSUM_LENGTH)
    out.set(full.subarray(0, hdr))
    out[1] = len
    out.set(full.subarray(hdr, hdr + len), hdr)
    let crc = 0xffff
    for (const b of out.subarray(1, hdr + len)) crc = accumulate(b, crc)
    crc = accumulate(MAVLINK_MESSAGE_CRCS[msgId], crc)
    out[hdr + len] = crc & 0xff
    out[hdr + len + 1] = (crc >> 8) & 0xff
    return out
  }

  const heartbeat = frameOf({ type: 'HEARTBEAT', customMode: 0, vehicleType: 2, autopilot: 3, baseMode: 0, systemStatus: 4, mavlinkVersion: 3 })
  const statusFull = frameOf({ type: 'STATUSTEXT', severity: 4, text: 'PreArm: GPS' })
  const statusTruncated = truncateLikeRealFc(statusFull)
  assert.ok(statusTruncated.length < statusFull.length, 'frame must actually be truncated like a real FC')

  const replaySession = createRecordedSession('faithful-truncated', [
    createRecordedSessionEvent(heartbeat, 'in', 0),
    createRecordedSessionEvent(statusTruncated, 'in', 5)
  ])
  const transport = new ReplayTransport('audit20', { session: replaySession, speedMultiplier: 50 })
  const runtime = new ArduPilotConfiguratorRuntime(new MavlinkSession(transport, new MavlinkV2Codec()), arducopterMetadata)
  try {
    await runtime.connect()
    const deadline = Date.now() + 3000
    let ok = false
    while (Date.now() < deadline) {
      const s = runtime.getSnapshot()
      if (s.vehicle?.vehicle === 'ArduCopter' && s.statusTexts.some((e) => e.text.includes('PreArm: GPS'))) {
        ok = true
        break
      }
      await new Promise((r) => setTimeout(r, 50))
    }
    assert.equal(ok, true, 'a faithfully v2-truncated STATUSTEXT must decode end-to-end (audit-18 zero-pad), not be dropped')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('ReplayTransport (non-strict) paces inbound relative to the first event, not absolute atMs', async () => {
  // Regression: a real recorder timestamps frames with a monotonic/wall
  // clock, so the first frame's atMs is not ~0. Scheduling at raw
  // atMs/speed made the desktop bridge --source=replay sit silent for
  // that offset (seconds → decades for epoch ms). Non-strict must pace
  // relative to the first inbound event, like strict mode.
  const frameA = Uint8Array.from([1, 2, 3])
  const frameB = Uint8Array.from([4, 5, 6])
  const session = createRecordedSession('offset-clock recording', [
    createRecordedSessionEvent(frameA, 'in', 100000),
    createRecordedSessionEvent(frameB, 'in', 100050)
  ])
  const transport = new ReplayTransport('offset-replay', { session, speedMultiplier: 1 })

  const received = []
  transport.onFrame((frame) => received.push(Array.from(frame)))
  await transport.connect()

  // At speedMultiplier 1 the OLD code would schedule frame A 100000ms
  // out; relative pacing puts it at 0ms and B at 50ms.
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.deepEqual(received, [[1, 2, 3], [4, 5, 6]], 'both frames replayed promptly, paced from the first event')

  await transport.disconnect()
})

test('MockTransport serializes chunked inbound frames so demo parameter sync completes', {
  timeout: 180000,
  // Structurally flaky under contended CI runners (~10x slowdown vs local).
  // The chunked path forces ~5000 setTimeout calls through MockTransport's
  // per-chunk pacing; each setTimeout(0) drifts by ~20-100ms when the
  // runner is contended, stretching the timeline past every budget we've
  // tried (30s -> 60s -> 120s, all hit). Skip on CI; the local run still
  // validates the reassembly path on every push, and the smaller
  // "no-interleave when chunkSize is set" regression below covers the
  // protocol invariant without the param-count amplifier.
  skip: process.env.CI === 'true'
}, async () => {
  const scenario = createArduCopterMockScenario()
  const transport = new MockTransport('mock-demo-transport', {
    initialFrames: scenario.initialFrames,
    respondToOutbound: scenario.respondToOutbound,
    // chunkSize:7 is the stressor — it splits every PARAM_VALUE into ~5 chunks
    // to exercise multi-frame reassembly. The COUNT of chunks (5000+ across
    // 1072 params) is the timing concern, not the reassembly logic itself.
    // Drop per-frame pacing + response delay to 0 so the ~5000-chunk
    // timeline drains as fast as the runner can clear setTimeout(0)
    // callbacks; contended CI runners regularly drifted past the older
    // 5ms/45ms timings even with a 60s budget. The reassembly path is still
    // exercised on every chunk; we're only removing the artificial pacing.
    frameIntervalMs: 0,
    responseDelayMs: 0,
    chunkSize: 7
  })
  const runtime = new ArduPilotConfiguratorRuntime(
    new MavlinkSession(transport, new MavlinkV2Codec()),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 500 })
    // 120s budget for the param-sync alone — locally this completes in
    // single-digit seconds even at chunkSize:7. The 120s budget keeps a
    // real stall honest (any genuine deadlock still trips well inside the
    // 180s per-test wrapper) while letting transient CI contention drift
    // freely instead of flaking the suite.
    const stats = await runtime.waitForParameterSync({ timeoutMs: 120000 })

    assert.equal(stats.status, 'complete')
    assert.equal(stats.downloaded, 1080)
    assert.equal(stats.total, 1080)
    assert.equal(runtime.getSnapshot().parameters.find((parameter) => parameter.id === 'FRAME_CLASS')?.value, 1)
    assert.equal(runtime.getSnapshot().parameters.find((parameter) => parameter.id === 'FRAME_TYPE')?.value, 1)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('MockTransport whole-frame delivery does not starve a post-connect solicited response behind the connect backlog', async () => {
  // Regression for the documented single-cursor starvation defect: with
  // whole-frame delivery (chunkSize 0) a small solicited response issued right
  // after connect must NOT be queued behind the large connect-time backlog.
  // MockTransport forwards raw bytes without parsing, so opaque Uint8Arrays are
  // a faithful stand-in for frames here.
  const REQUEST = new Uint8Array([0x01])
  const RESPONSE = new Uint8Array([0xde, 0xad]) // 2 bytes -> distinguishable from the 1-byte backlog
  const backlog = Array.from({ length: 300 }, (_, index) => new Uint8Array([index & 0xff]))
  const transport = new MockTransport('starvation-regression', {
    initialFrames: backlog,
    frameIntervalMs: 5, // 300 frames * 5ms => ~1500ms of backlog
    responseDelayMs: 20,
    respondToOutbound: (frame) => (frame[0] === REQUEST[0] ? [RESPONSE] : [])
    // chunkSize defaults to 0 (whole-frame delivery)
  })

  let responseAtMs = null
  transport.onFrame((chunk) => {
    if (chunk.length === RESPONSE.length && chunk[0] === RESPONSE[0] && chunk[1] === RESPONSE[1]) {
      responseAtMs = Date.now()
    }
  })

  try {
    await transport.connect()
    const sentAtMs = Date.now()
    await transport.send(REQUEST)

    const deadline = Date.now() + 3000
    while (responseAtMs === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    assert.notEqual(responseAtMs, null, 'solicited response was never delivered')
    const latency = responseAtMs - sentAtMs
    // Pre-fix this would be ~1500ms (queued behind the whole 300-frame backlog);
    // post-fix it arrives at ~responseDelay. 500ms leaves generous CI headroom
    // while still failing the old single-cursor behavior.
    assert.ok(latency < 500, `solicited response should not wait behind the backlog (latency ${latency}ms)`)
  } finally {
    await transport.disconnect().catch(() => {})
  }
})

test('MockTransport chunked delivery still serializes frames (no interleave) when chunkSize is set', async () => {
  // Guards the other half of the gate: with chunkSize > 0 the cursor must still
  // serialize so chunks of different frames never interleave in the byte stream.
  const FRAME_A = new Uint8Array([0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5])
  const FRAME_B = new Uint8Array([0xb0, 0xb1, 0xb2, 0xb3, 0xb4, 0xb5])
  const transport = new MockTransport('chunk-serialization', {
    initialFrames: [FRAME_A, FRAME_B],
    frameIntervalMs: 1,
    chunkSize: 2 // splits each 6-byte frame into 3 chunks
  })

  const received = []
  transport.onFrame((chunk) => received.push(...chunk))

  try {
    await transport.connect()
    const deadline = Date.now() + 2000
    while (received.length < FRAME_A.length + FRAME_B.length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    // All of FRAME_A's bytes precede all of FRAME_B's bytes (no interleave).
    assert.deepEqual(received, [...FRAME_A, ...FRAME_B])
  } finally {
    await transport.disconnect().catch(() => {})
  }
})

test('Bundled WebSocket bridge can drive runtime heartbeat and parameter sync from the demo source', {
  // Same chunkSize:7 + 1072-param amplifier as the sibling chunked-stress
  // test above. Structurally flaky on contended CI runners (~10x slowdown
  // vs local). Skip on CI; the local run validates the bridge ↔ runtime
  // end-to-end on every push, and the WebSocket-bridge unit tests in this
  // file already cover the bridge's auth/upgrade/route logic without the
  // chunked-transport amplifier.
  skip: process.env.CI === 'true'
}, async (t) => {
  const scenario = createArduCopterMockScenario()
  let bridge
  try {
    bridge = await startWebSocketBridgeServer({
      host: '127.0.0.1',
      port: 0,
      route: '/mavlink',
      transport: new MockTransport('bridge-demo-transport', {
        initialFrames: scenario.initialFrames,
        respondToOutbound: scenario.respondToOutbound,
        frameIntervalMs: 12,
        responseDelayMs: 20,
        chunkSize: 7
      })
    })
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      t.skip('Listening sockets are not available in the current sandbox.')
      return
    }
    throw error
  }

  const runtime = new ArduPilotConfiguratorRuntime(
    new MavlinkSession(
      new WebSocketTransport('bridge-client', {
        url: bridge.url
      }),
      new MavlinkV2Codec()
    ),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 1000 })
    const stats = await runtime.waitForParameterSync({ timeoutMs: 15000 })

    assert.equal(runtime.getSnapshot().connection.kind, 'connected')
    assert.equal(runtime.getSnapshot().vehicle?.vehicle, 'ArduCopter')
    assert.equal(stats.status, 'complete')
    assert.equal(stats.downloaded, 1080)
    assert.equal(runtime.getSnapshot().parameters.find((parameter) => parameter.id === 'FRAME_CLASS')?.value, 1)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
    await bridge?.close().catch(() => {})
  }
})

test('NativeSerialTransport surfaces an error status when opening the port fails', async () => {
  const statuses = []
  const transport = new NativeSerialTransport(
    'failing-native-serial',
    {
      path: '/dev/tty.invalid',
      baudRate: 115200
    },
    {
      createPort: () => new FailingNativeSerialPort(new Error('Permission denied'))
    }
  )

  transport.onStatus((status) => {
    statuses.push(status)
  })

  await assert.rejects(() => transport.connect(), /Permission denied/)
  assert.deepEqual(statuses, [
    { kind: 'idle' },
    { kind: 'connecting' },
    { kind: 'error', message: 'Permission denied' }
  ])
  assert.deepEqual(transport.getStatus(), { kind: 'error', message: 'Permission denied' })
})

test('NativeSerialTransport: a concurrent connect() while still connecting returns the in-flight promise (audit-34)', async () => {
  // Pre-audit-34 the early-return only checked `this.port?.isOpen`; a
  // second connect() while port.open() was still callback-pending built
  // a SECOND SerialPort, attached duplicate data/error/close listeners,
  // and left this.port pointing at whichever set finished last. Same
  // bug class as audit-33 (WebSocketTransport) — fixed by the same
  // `connectPromise` latch pattern that WebSerialTransport has always had.
  let createPortCalls = 0
  // Hold the open() callback until releaseOpen() is called so we can
  // overlap a second connect() while the first is still connecting.
  const port = new DeferredOpenNativeSerialPort()
  const transport = new NativeSerialTransport(
    'double-connect-native',
    { path: '/dev/tty.fake', baudRate: 115200 },
    {
      createPort: () => {
        createPortCalls += 1
        return port
      }
    }
  )

  const firstPromise = transport.connect()
  const secondPromise = transport.connect()
  // Same port build for both calls — the latch deduped them.
  assert.equal(createPortCalls, 1, 'exactly one SerialPort built across both connect() calls')

  port.releaseOpen()
  await Promise.all([firstPromise, secondPromise])
  assert.equal(transport.getStatus().kind, 'connected')

  await transport.disconnect()
  assert.equal(transport.getStatus().kind, 'disconnected')

  // After settling, a NEW connect() goes through createPort again — the
  // latch was cleared in .finally(), so idempotency is scoped to the
  // in-flight window, not a permanent gate.
  const port2 = new DeferredOpenNativeSerialPort()
  let createPort2Calls = 0
  const transport2 = new NativeSerialTransport(
    'post-disconnect-native',
    { path: '/dev/tty.fake', baudRate: 115200 },
    {
      createPort: () => {
        createPort2Calls += 1
        return port2
      }
    }
  )
  const p = transport2.connect()
  port2.releaseOpen()
  await p
  assert.equal(createPort2Calls, 1)
  await transport2.disconnect()
})

test('NativeSerialTransport: a concurrent connect() during open() rejection both reject (audit-34)', async () => {
  // The latch must surface a failed connect to all in-flight awaiters,
  // not just the first one. Without it the second caller would silently
  // succeed (or hang) because the first call's reject path doesn't
  // propagate to the second's separate Promise.
  let createPortCalls = 0
  const transport = new NativeSerialTransport(
    'fail-double-native',
    { path: '/dev/tty.invalid', baudRate: 115200 },
    {
      createPort: () => {
        createPortCalls += 1
        return new FailingNativeSerialPort(new Error('Permission denied'))
      }
    }
  )

  const firstPromise = transport.connect()
  const secondPromise = transport.connect()
  assert.equal(createPortCalls, 1, 'exactly one SerialPort attempted across both connect() calls')
  await assert.rejects(() => firstPromise, /Permission denied/)
  await assert.rejects(() => secondPromise, /Permission denied/)
  assert.equal(transport.getStatus().kind, 'error')
})

test('TcpTransport: a concurrent connect() while still connecting opens ONE socket (audit-35)', async () => {
  // Same bug class as audit-33 (WebSocket) and audit-34 (NativeSerial):
  // the early-return only checked status === 'connected'. A second
  // connect() during the connecting window constructed a second
  // net.Socket and listened on it; the first call's awaiter was
  // stranded on a socket the second call had already overwritten out
  // of this.socket. The fix is the same `connectPromise` latch
  // WebSerialTransport has always had.
  //
  // We verify by running a real localhost TCP server and counting the
  // accepted connections: with the fix in place exactly ONE socket
  // gets opened across both transport.connect() calls.
  let acceptedConnections = 0
  const server = createServer((socket) => {
    acceptedConnections += 1
    socket.on('error', () => {}) // tolerate the abrupt destroy on disconnect
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const transport = new TcpTransport('test-double-tcp', {
    host: '127.0.0.1',
    port,
    connectTimeoutMs: 1000
  })
  try {
    const firstPromise = transport.connect()
    const secondPromise = transport.connect()
    await Promise.all([firstPromise, secondPromise])
    assert.equal(transport.getStatus().kind, 'connected')
    // Settle one extra microtask so the server's 'connection' event has
    // chance to fire — accept happens before connect() resolves on the
    // client, but the counter increment is in a separate stack frame.
    await wait(20)
    assert.equal(
      acceptedConnections,
      1,
      `exactly one TCP socket accepted across both connect() calls (saw ${acceptedConnections})`
    )

    await transport.disconnect()
    // The latch is cleared in .finally(), so a fresh connect goes
    // through and opens a NEW socket.
    await transport.connect()
    await wait(20)
    assert.equal(acceptedConnections, 2, 'post-disconnect connect builds a fresh TCP socket')
  } finally {
    await transport.disconnect().catch(() => {})
    await new Promise((resolve) => server.close(resolve))
  }
})

test('UdpTransport: a concurrent connect() while still binding produces ONE socket (audit-35)', async () => {
  // UdpTransport has the same bug — `connect()` early-returns only on
  // 'connected', so a second call during bind() leaks a second dgram
  // socket. We verify by pinning the bind port: with the fix in place
  // exactly one socket binds and the second connect() returns the
  // same in-flight promise.
  const transport = new UdpTransport('test-double-udp', {
    bindHost: '127.0.0.1',
    bindPort: 0 // ephemeral
  })
  try {
    const firstPromise = transport.connect()
    const secondPromise = transport.connect()
    // Both await the same in-flight bind. Without the latch the second
    // call would race against bind() on the first and one of them would
    // fail (or the second would leak a separate dgram socket).
    await Promise.all([firstPromise, secondPromise])
    assert.equal(transport.getStatus().kind, 'connected')

    await transport.disconnect()
    // Fresh connect builds a fresh dgram socket — the latch was scoped
    // to the in-flight window only.
    await transport.connect()
    assert.equal(transport.getStatus().kind, 'connected')
  } finally {
    await transport.disconnect().catch(() => {})
  }
})

test('NativeSerialTransport: disconnect() during port.open() never lands in `connected` (audit-38)', async () => {
  // Symmetric pair to audit-34 (connect latch). Pre-audit-38:
  // doConnect() was awaiting port.open() with this.port still undefined,
  // so a concurrent disconnect() hit `if (!this.port) return` and
  // short-circuited. doConnect then resumed, set this.port and emitted
  // 'connected' — the user clicked Disconnect but ended up connected
  // and the runtime started sending HEARTBEATs over the link.
  //
  // The fix: intentionalDisconnect flag flipped synchronously by
  // disconnect(), checked by doConnect() after the open() await; on
  // abort, port is closed and the connect promise rejects without ever
  // marking 'connected'. disconnect() also awaits connectPromise so it
  // observes the final state before tearing down.
  const port = new DeferredOpenNativeSerialPort()
  const transport = new NativeSerialTransport(
    'test-native-cancel',
    { path: '/dev/ttyTEST', baudRate: 57600 },
    { createPort: () => port }
  )
  const statuses = []
  transport.onStatus((status) => statuses.push(status.kind))

  const connectPromise = transport.connect()
  // disconnect() runs synchronously up to its first await — flipping
  // intentionalDisconnect before port.open()'s callback can fire.
  const disconnectPromise = transport.disconnect()

  // Release the deferred open(). doConnect resumes, sees
  // intentionalDisconnect=true, closes the port, rejects with our
  // "aborted by disconnect" message.
  port.releaseOpen()

  await assert.rejects(() => connectPromise, /aborted by disconnect/)
  await disconnectPromise

  assert.equal(transport.getStatus().kind, 'disconnected')
  assert.ok(
    !statuses.includes('connected'),
    `status should never reach 'connected' on aborted connect, saw ${statuses.join(' -> ')}`
  )
})

test('TcpTransport: disconnect() during socket.connect() never lands in `connected` (audit-38)', async () => {
  // Same race shape as NativeSerial (audit-38). Pre-fix: this.socket is
  // assigned only inside the 'connect' event handler (after handshake
  // completes). disconnect() called mid-handshake found this.socket
  // undefined and short-circuited; the TCP connect then completed and
  // marked 'connected' — the user's Disconnect click was ignored.
  //
  // Fix: intentionalDisconnect flag checked at handleConnect's entry;
  // if true, socket.destroy() + reject without touching this.socket /
  // emitting 'connected'.
  let acceptedConnections = 0
  const server = createServer((socket) => {
    acceptedConnections += 1
    socket.on('error', () => {}) // tolerate the destroy() that aborts the connect
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  const transport = new TcpTransport('test-tcp-cancel', {
    host: '127.0.0.1',
    port,
    connectTimeoutMs: 1000
  })
  const statuses = []
  transport.onStatus((status) => statuses.push(status.kind))

  try {
    const connectPromise = transport.connect()
    const disconnectPromise = transport.disconnect()

    await assert.rejects(() => connectPromise, /aborted by disconnect/)
    await disconnectPromise

    assert.equal(transport.getStatus().kind, 'disconnected')
    assert.ok(
      !statuses.includes('connected'),
      `status should never reach 'connected' on aborted connect, saw ${statuses.join(' -> ')}`
    )
    // The server still saw the TCP handshake — that's expected (no way
    // for the client to "uncomplete" a handshake). The point is the
    // transport never exposed the socket to the runtime.
    await wait(20)
    assert.ok(acceptedConnections >= 1, 'server should have observed the aborted handshake')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('UdpTransport: disconnect() during socket.bind() never lands in `connected` (audit-38)', async () => {
  // Same race shape — pre-fix the 'listening' handler set this.socket
  // and marked 'connected' regardless of whether disconnect() had been
  // requested in the meantime. Fix: check intentionalDisconnect on
  // 'listening' entry; on abort, close the socket and reject.
  const transport = new UdpTransport('test-udp-cancel', {
    bindHost: '127.0.0.1',
    bindPort: 0 // ephemeral
  })
  const statuses = []
  transport.onStatus((status) => statuses.push(status.kind))

  const connectPromise = transport.connect()
  const disconnectPromise = transport.disconnect()

  await assert.rejects(() => connectPromise, /aborted by disconnect/)
  await disconnectPromise

  assert.equal(transport.getStatus().kind, 'disconnected')
  assert.ok(
    !statuses.includes('connected'),
    `status should never reach 'connected' on aborted connect, saw ${statuses.join(' -> ')}`
  )
})

test('MavlinkSession broadcasts a 1 Hz GCS HEARTBEAT while connected (mandatory heartbeat microservice)', async () => {
  // Conformance fix: ArduPilot's GCS failsafe keys on seeing HEARTBEAT
  // from the GCS sysid (GCS_Common.cpp handle_heartbeat ->
  // sysid_mygcs_seen). Pre-fix nothing in the codebase ever sent one,
  // so the failsafe was never armed by our sessions — or, after a prior
  // Mission Planner session HAD armed it, it fired mid-session because
  // we went silent. This locks: immediate beat on link-up, correct GCS
  // field set, stop on disconnect, and the gcsHeartbeat:false opt-out.
  const sentFrames = []
  let statusListener
  const fakeTransport = {
    kind: 'mock',
    id: 'hb-test',
    getStatus: () => ({ kind: 'connected' }),
    onFrame: () => () => {},
    onStatus: (listener) => {
      statusListener = listener
      return () => {}
    },
    connect: async () => statusListener?.({ kind: 'connected' }),
    disconnect: async () => statusListener?.({ kind: 'disconnected', reason: 'test' }),
    send: async (frame) => {
      sentFrames.push(frame)
    }
  }

  const session = new MavlinkSession(fakeTransport, new MavlinkV2Codec(), undefined, {
    gcsHeartbeat: { intervalMs: 25 }
  })
  await session.connect()
  // Immediate beat + at least one interval beat inside the wait window.
  await wait(80)
  assert.ok(sentFrames.length >= 2, `expected immediate + interval beats, got ${sentFrames.length}`)

  // Decode the first frame and verify the GCS field set.
  const decoder = new MavlinkV2Codec()
  const [envelope] = decoder.push(sentFrames[0])
  assert.ok(envelope, 'first outbound frame decodes')
  assert.equal(envelope.message.type, 'HEARTBEAT')
  assert.equal(envelope.header.systemId, 255, 'GCS sysid matches ArduPilot _GCS_SYSID default')
  assert.equal(envelope.header.componentId, 190, 'MAV_COMP_ID_MISSIONPLANNER')
  assert.equal(envelope.message.vehicleType, 6, 'MAV_TYPE_GCS')
  assert.equal(envelope.message.autopilot, 8, 'MAV_AUTOPILOT_INVALID — not a flight controller')
  assert.equal(envelope.message.systemStatus, 4, 'MAV_STATE_ACTIVE')

  // Disconnect stops the loop.
  await session.disconnect()
  const countAtDisconnect = sentFrames.length
  await wait(80)
  assert.equal(sentFrames.length, countAtDisconnect, 'no beats after disconnect')
  session.destroy()

  // Opt-out: gcsHeartbeat:false never beats (strict-replay fidelity).
  const silentFrames = []
  let silentStatusListener
  const silentTransport = {
    ...fakeTransport,
    onStatus: (listener) => {
      silentStatusListener = listener
      return () => {}
    },
    connect: async () => silentStatusListener?.({ kind: 'connected' }),
    send: async (frame) => {
      silentFrames.push(frame)
    }
  }
  const silentSession = new MavlinkSession(silentTransport, new MavlinkV2Codec(), undefined, {
    gcsHeartbeat: false
  })
  await silentSession.connect()
  await wait(60)
  assert.equal(silentFrames.length, 0, 'gcsHeartbeat:false sends nothing')
  silentSession.destroy()
})

test('Desktop Electron web preferences keep the renderer sandbox enabled', () => {
  const webPreferences = createDesktopWebPreferences('/tmp/arduconfig-preload.js')

  assert.equal(webPreferences.contextIsolation, true)
  assert.equal(webPreferences.nodeIntegration, false)
  assert.equal(webPreferences.sandbox, true)
  assert.equal(webPreferences.preload, '/tmp/arduconfig-preload.js')
})

class FakeWebSocket {
  binaryType = 'blob'
  readyState = 0
  sentFrames = []

  #listeners = {
    open: new Set(),
    message: new Set(),
    error: new Set(),
    close: new Set()
  }

  send(data) {
    this.sentFrames.push(data instanceof Uint8Array ? data : new Uint8Array(data))
  }

  close() {
    this.readyState = 3
  }

  addEventListener(type, listener) {
    this.#listeners[type].add(listener)
  }

  removeEventListener(type, listener) {
    this.#listeners[type].delete(listener)
  }

  emitOpen() {
    this.readyState = 1
    this.#listeners.open.forEach((listener) => listener({ type: 'open' }))
  }

  emitMessage(data) {
    this.#listeners.message.forEach((listener) => listener({ type: 'message', data }))
  }

  emitError() {
    this.#listeners.error.forEach((listener) => listener({ type: 'error' }))
  }

  // audit-41: simulate the close event that browsers (and the bridge)
  // fire after socket.close(1000) — used to assert that a stale close
  // on an aborted socket does NOT touch the transport once disconnect
  // has detached the connect-phase listeners.
  emitClose({ code = 1000, reason = '' } = {}) {
    this.readyState = 3
    this.#listeners.close.forEach((listener) => listener({ type: 'close', code, reason }))
  }

  // audit-41: introspection — true if any of the connect-phase or
  // runtime listener slots still hold a callback. The audit-41 fix
  // requires that disconnect() drains ALL of them so a late close
  // event has nobody to deliver to.
  hasAnyListener() {
    return Object.values(this.#listeners).some((set) => set.size > 0)
  }
}

// audit-34: holds the open() callback until releaseOpen() so a test can
// overlap a second connect() while the first port.open() is still
// pending. Tracks listeners to verify no leak.
class DeferredOpenNativeSerialPort {
  constructor() {
    this.isOpen = false
    this.pendingOpenCallback = undefined
    this.listenerCounts = { data: 0, error: 0, close: 0 }
  }

  on(event) {
    this.listenerCounts[event] = (this.listenerCounts[event] ?? 0) + 1
    return this
  }

  open(callback) {
    this.pendingOpenCallback = callback
  }

  releaseOpen(error) {
    if (!this.pendingOpenCallback) return
    const cb = this.pendingOpenCallback
    this.pendingOpenCallback = undefined
    if (!error) this.isOpen = true
    cb(error)
  }

  close(callback) {
    this.isOpen = false
    callback(undefined)
  }

  write(_data, callback) {
    callback(undefined)
  }
}

class FailingNativeSerialPort {
  constructor(error) {
    this.error = error
    this.isOpen = false
  }

  on() {
    return this
  }

  open(callback) {
    callback(this.error)
  }

  close(callback) {
    callback(undefined)
  }

  write(_data, callback) {
    callback(undefined)
  }
}

class RecoveringWebSerialPort {
  constructor(steps) {
    this.steps = steps
    this.readable = {
      getReader: () => new RecoveringWebSerialReader(this.steps)
    }
    this.writable = {
      getWriter: () => ({
        releaseLock() {},
        async write() {}
      })
    }
  }

  async open() {}

  async close() {}
}

class RecoveringWebSerialReader {
  constructor(steps) {
    this.steps = steps
  }

  async read() {
    const step = this.steps.shift() ?? { type: 'done' }
    if (step.type === 'throw') {
      throw step.error
    }
    if (step.type === 'done') {
      return { value: undefined, done: true }
    }
    return { value: step.value, done: false }
  }

  async cancel() {}

  releaseLock() {}
}

function wait(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
}
