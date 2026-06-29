import assert from 'node:assert/strict'
import test from 'node:test'

import { CanBusService } from '../packages/ardupilot-core/dist/runtime-can-bus-service.js'
import {
  DRONECAN_FILE_BEGIN_FIRMWARE_UPDATE_SERVICE_ID,
  DRONECAN_FILE_BFU_ERROR_IN_PROGRESS,
  DRONECAN_FILE_READ_SERVICE_ID,
  DRONECAN_FILE_READ_SIGNATURE,
  DronecanReassembler,
  decodeDronecanBeginFirmwareUpdateResponse,
  decodeDronecanFileReadRequest,
  decodeDronecanFileReadResponse,
  dronecanIsServiceFrame,
  dronecanIsServiceRequest,
  dronecanParseTailByte,
  dronecanServiceTypeId,
  dronecanSourceNodeId,
  encodeDronecanBeginFirmwareUpdateRequest,
  encodeDronecanBeginFirmwareUpdateResponse,
  encodeDronecanFileReadRequest,
  encodeDronecanFileReadResponse
} from '../packages/protocol-mavlink/dist/index.js'
import { createDronecanBusSimulator } from '../packages/protocol-mavlink/dist/mock-dronecan.js'

const GCS_NODE_ID = 127

const hex = (bytes) => Buffer.from(bytes).toString('hex')

// ---------------------------------------------------------------------------
// Codec wire-format tests. Reference vectors generated with pydronecan's
// canonical TAO marshaller (`payload._pack(tao=True)`) against the DSDL at
// modules/DroneCAN/DSDL/uavcan/protocol/file/{40.BeginFirmwareUpdate,48.Read}.
// ---------------------------------------------------------------------------

test('BeginFirmwareUpdate request encodes source_node_id + Path tail (DSDL/pydronecan)', () => {
  // pydronecan: BeginFirmwareUpdate.Request(source_node_id=125, path="abc") -> 7d616263
  assert.equal(hex(encodeDronecanBeginFirmwareUpdateRequest({ sourceNodeId: 125, imageFileRemotePath: 'abc' })), '7d616263')
  // Our GCS source node id (127 = 0x7f) with a realistic path.
  assert.equal(
    hex(encodeDronecanBeginFirmwareUpdateRequest({ sourceNodeId: GCS_NODE_ID, imageFileRemotePath: 'fw.bin' })),
    '7f66772e62696e'
  )
})

test('BeginFirmwareUpdate response decodes error + optional message (DSDL/pydronecan)', () => {
  // pydronecan: Response(error=OK) -> 00
  assert.deepEqual(decodeDronecanBeginFirmwareUpdateResponse(Uint8Array.of(0x00)), {
    error: 0,
    optionalErrorMessage: undefined
  })
  // pydronecan: Response(error=IN_PROGRESS, optional_error_message="busy") -> 0262757379
  const decoded = decodeDronecanBeginFirmwareUpdateResponse(Uint8Array.from(Buffer.from('0262757379', 'hex')))
  assert.equal(decoded.error, DRONECAN_FILE_BFU_ERROR_IN_PROGRESS)
  assert.equal(decoded.optionalErrorMessage, 'busy')
  // Round-trip the encoder we use on the mock/server side.
  assert.equal(hex(encodeDronecanBeginFirmwareUpdateResponse(2, 'busy')), '0262757379')
})

test('file.Read request decodes uint40 offset (LE) + Path tail (DSDL/pydronecan)', () => {
  // pydronecan: Read.Request(offset=256, path="abc") -> 0001000000616263
  const req = decodeDronecanFileReadRequest(Uint8Array.from(Buffer.from('0001000000616263', 'hex')))
  assert.equal(req.offset, 256)
  assert.equal(req.path, 'abc')
  // Encoder round-trips, including a large (multi-byte) offset.
  assert.equal(hex(encodeDronecanFileReadRequest({ offset: 256, path: 'abc' })), '0001000000616263')
  const big = encodeDronecanFileReadRequest({ offset: 0x12345678, path: '' })
  assert.equal(decodeDronecanFileReadRequest(big).offset, 0x12345678)
})

test('file.Read response encodes int16 error (LE) + data tail; EOF = short data (DSDL/pydronecan)', () => {
  // pydronecan: Read.Response(error=OK, data=[1,2,3,4,5]) -> 00000102030405
  assert.equal(hex(encodeDronecanFileReadResponse(0, Uint8Array.of(1, 2, 3, 4, 5))), '00000102030405')
  // pydronecan: Read.Response(error=NOT_FOUND(2), data=[]) -> 0200
  assert.equal(hex(encodeDronecanFileReadResponse(2, new Uint8Array(0))), '0200')
  // Round-trip decode.
  const decoded = decodeDronecanFileReadResponse(Uint8Array.from(Buffer.from('00000102030405', 'hex')))
  assert.equal(decoded.error, 0)
  assert.deepEqual(Array.from(decoded.data), [1, 2, 3, 4, 5])
  // The encoder clamps to the 256-byte capacity (never serves past a full chunk).
  const clamped = decodeDronecanFileReadResponse(encodeDronecanFileReadResponse(0, new Uint8Array(300).fill(7)))
  assert.equal(clamped.data.length, 256)
})

// ---------------------------------------------------------------------------
// End-to-end: the GCS-side file server (CanBusService) drives a real mock node
// (createDronecanBusSimulator) through a full firmware update — BeginFirmware-
// Update, every file.Read chunk, and completion — over the same CAN_FORWARD
// envelope the runtime uses. Asserts the served bytes equal the image and
// progress reaches 100%.
// ---------------------------------------------------------------------------

test('CanBusService serves a complete firmware image to a mock node via file.Read', async () => {
  const sim = createDronecanBusSimulator()

  // Reassemble the file.Read RESPONSES the GCS emits so the test can confirm
  // the bytes served to the node reconstruct the original image exactly.
  const responseReassembler = new DronecanReassembler({
    getDataTypeSignature: (ctx) =>
      ctx.isService && ctx.typeId === DRONECAN_FILE_READ_SERVICE_ID ? DRONECAN_FILE_READ_SIGNATURE : undefined
  })
  const served = []

  const captureServedChunk = (msg) => {
    if (msg.type !== 'CAN_FRAME') {
      return
    }
    const canId = msg.id >>> 0
    if (!dronecanIsServiceFrame(canId) || dronecanIsServiceRequest(canId)) {
      return
    }
    if (dronecanServiceTypeId(canId) !== DRONECAN_FILE_READ_SERVICE_ID) {
      return
    }
    const frame = msg.data.subarray(0, msg.len)
    const tail = dronecanParseTailByte(frame[frame.length - 1])
    const finished = responseReassembler.push(
      {
        sourceNodeId: dronecanSourceNodeId(canId),
        isService: true,
        typeId: DRONECAN_FILE_READ_SERVICE_ID,
        isRequest: false,
        transferId: tail.transferId
      },
      frame
    )
    if (finished) {
      const decoded = decodeDronecanFileReadResponse(finished.payload)
      if (decoded) {
        for (const byte of decoded.data) served.push(byte)
      }
    }
  }

  const session = {
    send: async (msg) => {
      captureServedChunk(msg)
      // The autopilot (mock) consumes the message and produces inbound frames.
      for (const inbound of sim.handleOutbound(msg)) {
        // Deliver back to the GCS off the current stack so the request/response
        // chain advances across microtasks (multi-frame sends interleave).
        queueMicrotask(() => service.processCanFrame(inbound))
      }
    }
  }

  const service = new CanBusService({
    session,
    emit: () => {},
    appendStatusEntry: () => {},
    getTargetSystem: () => 1,
    getTargetComponent: () => 1
  })

  await service.start(1)
  // Seed the node inventory from the simulator's NodeStatus broadcasts.
  for (const frame of sim.broadcasts()) {
    service.processCanFrame(frame)
  }
  const targetNode = 50 // org.ardupilot.ap_periph in the simulator
  assert.ok(
    service.getSnapshot().nodes.some((n) => n.nodeId === targetNode),
    'expected the mock ap_periph node to be discovered before updating it'
  )

  // A multi-chunk image: [256, 256, 188] bytes — the last chunk is short, the
  // EOF handshake. Deterministic content so the comparison is meaningful.
  const image = Uint8Array.from({ length: 700 }, (_, i) => (i * 37 + 11) & 0xff)
  await service.startFirmwareUpdate(targetNode, 'periph-fw.bin', image)

  // Pump the event loop until the update terminates (bounded so a stuck flow
  // fails fast rather than hanging the suite).
  const deadline = Date.now() + 5000
  let snapshot = service.getSnapshot()
  while (
    snapshot.firmwareUpdate &&
    snapshot.firmwareUpdate.status !== 'completed' &&
    snapshot.firmwareUpdate.status !== 'error' &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 1))
    snapshot = service.getSnapshot()
  }

  const update = snapshot.firmwareUpdate
  assert.ok(update, 'expected a firmware-update entry in the snapshot')
  assert.equal(update.status, 'completed', `update did not complete: ${update.error ?? '(no error)'}`)
  assert.equal(update.nodeId, targetNode)
  assert.equal(update.fileSize, image.length)
  assert.equal(update.bytesServed, image.length, 'bytesServed should reach the full image size (100%)')

  // The bytes the server actually put on the wire reconstruct the image.
  assert.equal(served.length, image.length, 'served byte count should equal the image size')
  assert.deepEqual(Uint8Array.from(served), image, 'served bytes should match the image exactly')

  service.destroy()
})

test('startFirmwareUpdate refuses a second concurrent update', async () => {
  const sim = createDronecanBusSimulator()
  const session = {
    send: async (msg) => {
      for (const inbound of sim.handleOutbound(msg)) {
        queueMicrotask(() => service.processCanFrame(inbound))
      }
    }
  }
  const service = new CanBusService({
    session,
    emit: () => {},
    appendStatusEntry: () => {},
    getTargetSystem: () => 1,
    getTargetComponent: () => 1
  })
  await service.start(1)
  for (const frame of sim.broadcasts()) service.processCanFrame(frame)

  const image = Uint8Array.from({ length: 512 }, (_, i) => i & 0xff)
  await service.startFirmwareUpdate(50, 'a.bin', image)
  const first = service.getSnapshot().firmwareUpdate
  assert.ok(first && first.nodeId === 50)

  // A second update while the first is starting/in-progress is rejected and
  // does not replace the active session.
  await service.startFirmwareUpdate(124, 'b.bin', image)
  const after = service.getSnapshot().firmwareUpdate
  assert.equal(after.nodeId, 50, 'the in-flight update must not be replaced by a concurrent request')

  service.destroy()
})
