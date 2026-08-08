import assert from 'node:assert/strict'
import test from 'node:test'

import { MavftpService } from '../packages/ardupilot-core/dist/index.js'
import { MAV_FTP_ERR, MAV_FTP_OPCODE } from '../packages/protocol-mavlink/dist/index.js'

const VEHICLE = { systemId: 1, componentId: 1, firmware: 'ArduPilot', vehicle: 'ArduCopter', armed: false }
const ACK = MAV_FTP_OPCODE.ACK
const NAK = MAV_FTP_OPCODE.NAK
const SESSION_ID = 7
const BURST_DATA = 239

function encodeFrame({ seqNumber = 0, session = 0, opcode, size = 0, reqOpcode = 0, burstComplete = 0, offset = 0, data = new Uint8Array(0) }) {
  const bytes = new Uint8Array(251)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, seqNumber & 0xffff, true)
  bytes[2] = session & 0xff
  bytes[3] = opcode & 0xff
  bytes[4] = size & 0xff
  bytes[5] = reqOpcode & 0xff
  bytes[6] = burstComplete & 0xff
  view.setUint32(8, offset >>> 0, true)
  bytes.set(data.slice(0, Math.min(size, BURST_DATA)), 12)
  return bytes
}

function decodeFrame(payload) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const size = payload[4] ?? 0
  return {
    seqNumber: view.getUint16(0, true),
    session: payload[2] ?? 0,
    opcode: payload[3] ?? 0,
    size,
    reqOpcode: payload[5] ?? 0,
    burstComplete: payload[6] ?? 0,
    offset: view.getUint32(8, true),
    data: payload.slice(12, 12 + size)
  }
}

function ackFrame(req, { session, offset, data = new Uint8Array(0), burstComplete = 0 } = {}) {
  return encodeFrame({
    seqNumber: (req.seqNumber + 1) & 0xffff,
    session: session ?? req.session,
    opcode: ACK,
    size: data.length,
    reqOpcode: req.opcode,
    burstComplete,
    offset: offset ?? req.offset,
    data
  })
}

function nakFrame(req, errorCode) {
  return encodeFrame({
    seqNumber: (req.seqNumber + 1) & 0xffff,
    session: req.session,
    opcode: NAK,
    size: 1,
    reqOpcode: req.opcode,
    offset: req.offset,
    data: new Uint8Array([errorCode])
  })
}

// Stream a file from req.offset in 239-byte burst packets, burstComplete on
// the final one; NAK EOF when asked past the end. `dropOffsets` simulates a
// lost link packet (placed in neither round so recovery must re-request it).
function serveBurst(req, fileBytes, dropOffsets = new Set()) {
  if (req.offset >= fileBytes.length) {
    return [nakFrame(req, MAV_FTP_ERR.EOF)]
  }
  const frames = []
  let offset = req.offset
  while (offset < fileBytes.length) {
    const end = Math.min(offset + BURST_DATA, fileBytes.length)
    const isLast = end >= fileBytes.length
    if (!dropOffsets.has(offset)) {
      frames.push(ackFrame(req, { session: req.session, offset, data: fileBytes.slice(offset, end), burstComplete: isLast ? 1 : 0 }))
    }
    offset = end
  }
  return frames
}

function makeBytes(length, seed = 1) {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) bytes[i] = (i + seed) & 0xff
  return bytes
}

function createHarness(fileBytes, options = {}) {
  const sent = []
  let burstRounds = 0
  const declaredSize = options.declaredSize ?? fileBytes.length
  let service
  const respond = (req) => {
    switch (req.opcode) {
      case MAV_FTP_OPCODE.RESET_SESSIONS:
        service.handleFileTransferProtocol({ payload: ackFrame(req) })
        break
      case MAV_FTP_OPCODE.OPEN_FILE_RO: {
        const data = new Uint8Array(4)
        new DataView(data.buffer).setUint32(0, declaredSize, true)
        service.handleFileTransferProtocol({ payload: ackFrame(req, { session: SESSION_ID, data }) })
        break
      }
      case MAV_FTP_OPCODE.TERMINATE_SESSION:
        service.handleFileTransferProtocol({ payload: ackFrame(req, { session: req.session }) })
        break
      case MAV_FTP_OPCODE.BURST_READ_FILE: {
        burstRounds += 1
        const frames = (options.burstResponder ?? ((r, b) => serveBurst(r, b)))(req, fileBytes, burstRounds)
        for (const frame of frames) service.handleFileTransferProtocol({ payload: frame })
        break
      }
      default:
        break
    }
  }
  service = new MavftpService({
    session: {
      send: async (message) => {
        sent.push(message)
        if (message.type === 'FILE_TRANSFER_PROTOCOL') {
          const req = decodeFrame(message.payload)
          queueMicrotask(() => respond(req))
        }
      }
    },
    getVehicle: () => VEHICLE,
    ensureSupport: async () => {},
    requestTimeoutMs: 200
  })
  return {
    service,
    sent,
    get burstRounds() {
      return burstRounds
    }
  }
}

test('burst download assembles the streamed packets, reports progress, and terminates the session', async () => {
  const fileBytes = makeBytes(600)
  const { service, sent } = createHarness(fileBytes)
  const progress = []
  const bytes = await service.downloadRemoteFileBurst('/APM/LOGS/1.BIN', {
    onProgress: (p) => progress.push(p.bytesReceived)
  })

  assert.deepEqual(Array.from(bytes), Array.from(fileBytes))
  assert.deepEqual(progress, [239, 478, 600]) // contiguous frontier per packet
  // OPEN_FILE_RO before any burst, TERMINATE_SESSION at the end.
  assert.equal(sent.some((m) => decodeFrame(m.payload).opcode === MAV_FTP_OPCODE.OPEN_FILE_RO), true)
  assert.equal(decodeFrame(sent.at(-1).payload).opcode, MAV_FTP_OPCODE.TERMINATE_SESSION)
})

test('burst download recovers a dropped middle packet by re-requesting from the frontier', async () => {
  const fileBytes = makeBytes(600, 5)
  const harness = createHarness(fileBytes, {
    // Round 1 drops the packet at offset 239 (a hole); the re-request from the
    // contiguous frontier in round 2 fills it.
    burstResponder: (req, bytes, round) => (round === 1 ? serveBurst(req, bytes, new Set([239])) : serveBurst(req, bytes))
  })
  const bytes = await harness.service.downloadRemoteFileBurst('/APM/LOGS/1.BIN')

  assert.deepEqual(Array.from(bytes), Array.from(fileBytes))
  assert.ok(harness.burstRounds >= 2, 'a hole forces at least one re-request')
})

test('burst download retries from the frontier when a burst stalls with no data', async () => {
  const fileBytes = makeBytes(300, 9)
  const harness = createHarness(fileBytes, {
    // Round 1 sends nothing → the inactivity timer must retry.
    burstResponder: (req, bytes, round) => (round === 1 ? [] : serveBurst(req, bytes))
  })
  const bytes = await harness.service.downloadRemoteFileBurst('/APM/LOGS/1.BIN', { timeoutMs: 60 })

  assert.deepEqual(Array.from(bytes), Array.from(fileBytes))
  assert.ok(harness.burstRounds >= 2, 'a stall forces a retry')
})

test('burst download trims to the contiguous frontier when the FC over-reports size', async () => {
  const fileBytes = makeBytes(400, 3)
  // declaredSize is larger than the real file; an EOF NAK past the real end
  // means the file is exactly what was received, not corrupt.
  const harness = createHarness(fileBytes, { declaredSize: fileBytes.length + 256 })
  const bytes = await harness.service.downloadRemoteFileBurst('/APM/LOGS/1.BIN', { timeoutMs: 200 })

  assert.equal(bytes.length, fileBytes.length)
  assert.deepEqual(Array.from(bytes), Array.from(fileBytes))
})

test('burst download survives more stalls than the retry budget when it keeps making progress', async () => {
  // 8 packets. The server delivers exactly one packet per burst request with no
  // burst_complete, forcing the inactivity timer to fire and re-request for
  // every single packet — 7 stalls, well past MAX_MAVFTP_BURST_RETRIES (6).
  // The download must still complete because forward progress refunds the
  // per-stall retry budget (the regression that left real downloads stuck at
  // ~1% on a lossy USB link and then failed).
  const fileBytes = makeBytes(239 * 8, 4)
  const harness = createHarness(fileBytes, {
    burstResponder: (req, bytes) => {
      if (req.offset >= bytes.length) return [nakFrame(req, MAV_FTP_ERR.EOF)]
      const end = Math.min(req.offset + BURST_DATA, bytes.length)
      const isLast = end >= bytes.length
      return [
        ackFrame(req, {
          session: req.session,
          offset: req.offset,
          data: bytes.slice(req.offset, end),
          burstComplete: isLast ? 1 : 0
        })
      ]
    }
  })
  const bytes = await harness.service.downloadRemoteFileBurst('/APM/LOGS/big.BIN', { timeoutMs: 40 })

  assert.deepEqual(Array.from(bytes), Array.from(fileBytes))
  assert.ok(harness.burstRounds >= 8, 'one stall per packet means at least 8 burst rounds')
})

test('burst download recovers a hole revealed by an EOF NAK (small-file flow)', async () => {
  // ArduPilot streams a sub-2000-packet file as data packets (no burst_complete)
  // terminated by an EOF NAK. If a middle packet drops, the EOF arrives while a
  // hole sits below the high-water mark — the download must re-request the gap
  // instead of returning a truncated log.
  const fileBytes = makeBytes(239 * 4, 6)
  const harness = createHarness(fileBytes, {
    burstResponder: (req, bytes, round) => {
      const frames = []
      let offset = req.offset
      while (offset < bytes.length) {
        const end = Math.min(offset + BURST_DATA, bytes.length)
        // Round 1 drops the packet at offset 239 — a hole below the frontier.
        if (!(round === 1 && offset === 239)) {
          frames.push(ackFrame(req, { session: req.session, offset, data: bytes.slice(offset, end), burstComplete: 0 }))
        }
        offset = end
      }
      frames.push(nakFrame(req, MAV_FTP_ERR.EOF))
      return frames
    }
  })
  const bytes = await harness.service.downloadRemoteFileBurst('/APM/LOGS/hole.BIN', { timeoutMs: 200 })

  assert.deepEqual(Array.from(bytes), Array.from(fileBytes))
  assert.ok(harness.burstRounds >= 2, 'the EOF-revealed hole forces a re-request')
})

test('burst download rejects a file larger than the byte cap before allocating', async () => {
  const { service } = createHarness(makeBytes(10), { declaredSize: 5_000_000 })
  await assert.rejects(
    () => service.downloadRemoteFileBurst('/APM/LOGS/huge.BIN', { maxBytes: 1_000_000 }),
    /exceeds the .* cap/
  )
})

test('a second burst download waits for the one in flight instead of joining it', async () => {
  // This used to assert the second call was REJECTED. It was — but only as a
  // side effect of the bug: the session lock had a "already held, run straight
  // through" hatch that could not tell a nested call from an unrelated one, so
  // the second download barged in and tripped an internal guard. Every request
  // hardcodes session 0, so a caller that barges in repoints session 0 at its
  // own file and the download in flight dies on the FC's own FileNotFound.
  //
  // With the hatch gone the second download queues, which is what an operator
  // wants: it runs when the first is done rather than erroring.
  const fileBytes = makeBytes(600, 2)
  const harness = createHarness(fileBytes, { burstResponder: () => [] })
  const first = harness.service.downloadRemoteFileBurst('/APM/LOGS/1.BIN', { timeoutMs: 30 })
  // Let the first call reach the burst stage (OPEN resolved, activeBurst set).
  await new Promise((resolve) => setTimeout(resolve, 10))

  const second = harness.service.downloadRemoteFileBurst('/APM/LOGS/2.BIN', { timeoutMs: 30 })

  // Nothing for the second file may go on the wire while the first is running.
  const opensBeforeFirstFails = harness.sent.filter(
    (message) =>
      message.type === 'FILE_TRANSFER_PROTOCOL' &&
      new TextDecoder().decode(message.payload.subarray(12)).includes('2.BIN')
  )
  assert.equal(opensBeforeFirstFails.length, 0, 'the queued download touched the session mid-transfer')

  await assert.rejects(() => first, /No MAVFTP burst data/)
  // It waited its turn and then genuinely ran — serializing must not starve.
  await assert.rejects(() => second, /No MAVFTP burst data/)
})

/*
  A model of ArduPilot's FTP server for the one rule the seq_number handling
  turns on. The harness above is deliberately simple — it answers every burst
  packet with `request seq + 1` — but the real server keeps a single rising
  conversation counter and bumps it per STREAMED PACKET (GCS_FTP.cpp,
  `reply.seq_number++` inside the BurstReadFile loop). Two further behaviours
  follow from that counter and are modelled here:

    - a request whose `seq_number + 1` equals the last reply's seq_number is
      treated as a re-request and answered with a REPLAY of that last reply,
      never executed (GCS_FTP.cpp:823-829);
    - only one file may be open per session, and a second OpenFileRO while a
      descriptor is still held is NAKed with Fail (GCS_FTP.cpp:341-352).

  Together those turn a swallowed TerminateSession into a REFUSED NEXT
  DOWNLOAD. Rung 4 (tests/runtime.sitl.test.mjs) is the proof against real
  firmware; this is the cheap guard that catches a regression in the client's
  seq handling without needing a SITL to notice.
*/
function createArduPilotLikeHarness(fileBytes) {
  const sent = []
  let service
  let lastReply
  let openSession = -1
  let nextSessionId = 3

  const push = (frame) => {
    lastReply = decodeFrame(frame)
    service.handleFileTransferProtocol({ payload: frame })
  }

  const respond = (req) => {
    // The duplicate-request rule, applied before the opcode is even looked at.
    if (lastReply && ((req.seqNumber + 1) & 0xffff) === lastReply.seqNumber && req.session === lastReply.session) {
      service.handleFileTransferProtocol({ payload: encodeFrame(lastReply) })
      return
    }

    switch (req.opcode) {
      case MAV_FTP_OPCODE.RESET_SESSIONS:
        openSession = -1
        push(ackFrame(req))
        break
      case MAV_FTP_OPCODE.OPEN_FILE_RO: {
        if (openSession !== -1) {
          push(nakFrame(req, MAV_FTP_ERR.FAIL))
          break
        }
        openSession = nextSessionId
        nextSessionId += 1
        const data = new Uint8Array(4)
        new DataView(data.buffer).setUint32(0, fileBytes.length, true)
        push(ackFrame(req, { session: openSession, data }))
        break
      }
      case MAV_FTP_OPCODE.TERMINATE_SESSION:
        openSession = -1
        push(ackFrame(req, { session: req.session }))
        break
      case MAV_FTP_OPCODE.READ_FILE: {
        const end = Math.min(req.offset + req.size, fileBytes.length)
        if (req.offset >= fileBytes.length) {
          push(nakFrame(req, MAV_FTP_ERR.EOF))
          break
        }
        push(ackFrame(req, { session: req.session, offset: req.offset, data: fileBytes.slice(req.offset, end) }))
        break
      }
      case MAV_FTP_OPCODE.BURST_READ_FILE: {
        // One packet per 239 bytes, then the EOF NAK — each carrying the NEXT
        // seq_number in the conversation, exactly as the firmware does.
        let seq = (req.seqNumber + 1) & 0xffff
        let offset = req.offset
        while (offset < fileBytes.length) {
          const end = Math.min(offset + BURST_DATA, fileBytes.length)
          push(
            encodeFrame({
              seqNumber: seq,
              session: req.session,
              opcode: ACK,
              size: end - offset,
              reqOpcode: req.opcode,
              burstComplete: end >= fileBytes.length ? 1 : 0,
              offset,
              data: fileBytes.slice(offset, end)
            })
          )
          seq = (seq + 1) & 0xffff
          offset = end
        }
        push(
          encodeFrame({
            seqNumber: seq,
            session: req.session,
            opcode: NAK,
            size: 1,
            reqOpcode: req.opcode,
            burstComplete: 1,
            offset,
            data: new Uint8Array([MAV_FTP_ERR.EOF])
          })
        )
        break
      }
      default:
        break
    }
  }

  service = new MavftpService({
    session: {
      send: async (message) => {
        sent.push(message)
        if (message.type === 'FILE_TRANSFER_PROTOCOL') {
          const req = decodeFrame(message.payload)
          queueMicrotask(() => respond(req))
        }
      }
    },
    getVehicle: () => VEHICLE,
    ensureSupport: async () => {},
    requestTimeoutMs: 200
  })

  return {
    service,
    sent,
    get sessionIsOpen() {
      return openSession !== -1
    },
    // Strands a descriptor the way a close lost on the wire would.
    leakDescriptor() {
      openSession = nextSessionId
      nextSessionId += 1
    }
  }
}

test('a single-packet burst still closes its session, so the next download opens', async () => {
  // Small enough for ONE burst packet: the case that leaves the server exactly
  // two seq ahead of a client counting only its own sends, which is the offset
  // that makes the follow-up TerminateSession look like a re-request.
  const fileBytes = makeBytes(120, 4)
  const harness = createArduPilotLikeHarness(fileBytes)

  const first = await harness.service.downloadRemoteFileBurst('/logs/small-1.txt')
  assert.deepEqual(Array.from(first), Array.from(fileBytes))
  assert.equal(harness.sessionIsOpen, false, 'the TerminateSession was swallowed as a duplicate re-request')

  // Back to back, with no spacing between them — spacing is the workaround
  // this fix exists to make unnecessary.
  const second = await harness.service.downloadRemoteFileBurst('/logs/small-2.txt')
  assert.deepEqual(Array.from(second), Array.from(fileBytes))
  const third = await harness.service.downloadRemoteFileBurst('/logs/small-3.txt')
  assert.deepEqual(Array.from(third), Array.from(fileBytes))
})

test('an open refused with Fail is retried through RESET_SESSIONS instead of failing the download', async () => {
  const fileBytes = makeBytes(300, 6)
  const harness = createArduPilotLikeHarness(fileBytes)
  // A plain (non-burst) read first: it spends the one-shot startup
  // RESET_SESSIONS, so the leak below cannot be cleared by that instead of by
  // the safety net, and it keeps this test independent of the sequence fix.
  await harness.service.downloadRemoteFile('/logs/plain.txt')
  // Strand a descriptor the way a close lost on the wire would.
  harness.leakDescriptor()

  const bytes = await harness.service.downloadRemoteFileBurst('/logs/after-leak.BIN')
  assert.deepEqual(Array.from(bytes), Array.from(fileBytes))
})
