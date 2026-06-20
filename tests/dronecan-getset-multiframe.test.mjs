import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DRONECAN_PARAM_GETSET_SERVICE_ID,
  DRONECAN_PARAM_GETSET_SIGNATURE,
  DronecanReassembler,
  decodeDronecanGetSetResponse,
  dronecanBuildServiceFrames,
  dronecanParseTailByte,
  encodeDronecanGetSetResponse
} from '../packages/protocol-mavlink/dist/index.js'

// Multi-frame reassembly for a GetSet response. dronecan-decoders.test.mjs
// already exercises the GetNodeInfo multi-frame path and single-frame GetSet
// decode; this covers the gap where a GetSet RESPONSE is large enough to span
// several CAN frames (a long parameter name pushes the byte-aligned payload past
// the 7-byte-per-frame limit), so the toggle/CRC reassembly must stitch it back.
test('a large GetSet response survives frame-split + reassembly', () => {
  const resp = {
    value: { tag: 'int64', int64: 1000000n },
    defaultValue: { tag: 'empty' },
    maxValue: { tag: 'empty' },
    minValue: { tag: 'empty' },
    // Long name guarantees the byte-aligned payload exceeds a single frame.
    name: 'GPS_DELAY_MS_PRIMARY_AND_SECONDARY_RECEIVER'
  }
  const payload = encodeDronecanGetSetResponse(resp)
  assert.ok(payload.length > 7, 'payload should be large enough to require multiple frames')

  const frames = dronecanBuildServiceFrames(
    {
      serviceTypeId: DRONECAN_PARAM_GETSET_SERVICE_ID,
      signature: DRONECAN_PARAM_GETSET_SIGNATURE,
      destinationNodeId: 127,
      sourceNodeId: 22,
      transferId: 5,
      isRequest: false
    },
    payload
  )
  assert.ok(frames.length > 1, 'a long GetSet response must span more than one frame')

  const reassembler = new DronecanReassembler({
    getDataTypeSignature: () => DRONECAN_PARAM_GETSET_SIGNATURE
  })
  let finished
  for (const frame of frames) {
    const tail = dronecanParseTailByte(frame.data[frame.data.length - 1])
    finished = reassembler.push(
      { sourceNodeId: 22, isService: true, typeId: DRONECAN_PARAM_GETSET_SERVICE_ID, isRequest: false, transferId: tail.transferId },
      frame.data
    )
  }
  assert.ok(finished, 'multi-frame GetSet transfer reassembled')

  const decoded = decodeDronecanGetSetResponse(finished.payload)
  assert.equal(decoded.name, resp.name)
  assert.equal(decoded.value.tag, 'int64')
  assert.equal(decoded.value.int64, 1000000n)
})

test('out-of-order / duplicate-toggle frames do not corrupt a GetSet reassembly', () => {
  const resp = {
    value: { tag: 'string', string: 'COPTER-PRIMARY-CONFIG' },
    defaultValue: { tag: 'empty' },
    maxValue: { tag: 'empty' },
    minValue: { tag: 'empty' },
    name: 'BRD_SERIAL_NUM_LONG_ENOUGH_TO_SPLIT'
  }
  const payload = encodeDronecanGetSetResponse(resp)
  const frames = dronecanBuildServiceFrames(
    {
      serviceTypeId: DRONECAN_PARAM_GETSET_SERVICE_ID,
      signature: DRONECAN_PARAM_GETSET_SIGNATURE,
      destinationNodeId: 127,
      sourceNodeId: 9,
      transferId: 2,
      isRequest: false
    },
    payload
  )
  assert.ok(frames.length > 1)

  const reassembler = new DronecanReassembler({
    getDataTypeSignature: () => DRONECAN_PARAM_GETSET_SIGNATURE
  })
  const pushFrame = (frame) => {
    const tail = dronecanParseTailByte(frame.data[frame.data.length - 1])
    return reassembler.push(
      { sourceNodeId: 9, isService: true, typeId: DRONECAN_PARAM_GETSET_SERVICE_ID, isRequest: false, transferId: tail.transferId },
      frame.data
    )
  }
  // Re-deliver the first frame (duplicate) before continuing — the toggle-bit
  // protocol must ignore the stale repeat rather than mis-stitch the transfer.
  pushFrame(frames[0])
  let finished
  for (const frame of frames) {
    finished = pushFrame(frame)
  }
  assert.ok(finished, 'reassembly still completes despite a duplicated start frame')
  const decoded = decodeDronecanGetSetResponse(finished.payload)
  assert.equal(decoded.name, resp.name)
  assert.equal(decoded.value.tag, 'string')
  assert.equal(decoded.value.string, 'COPTER-PRIMARY-CONFIG')
})
