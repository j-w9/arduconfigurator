// Live FC probe: tunnel CAN1 over the Cube, request a GetSet param from
// the Here4 (node 125), and DUMP the raw response payload bytes so we can
// see exactly how the param name is encoded on the wire vs. how our
// decoder interprets it.
//
// Usage: node scripts/dronecan-name-probe.mjs [/dev/cu.usbmodemXXXX] [nodeId]

import { NativeSerialTransport } from '../apps/desktop/dist/native-serial-transport.js'
import { MavlinkSession, MavlinkV2Codec } from '../packages/protocol-mavlink/dist/index.js'
import {
  DRONECAN_PARAM_GETSET_SERVICE_ID,
  DRONECAN_PARAM_GETSET_SIGNATURE,
  DronecanReassembler,
  decodeDronecanGetSetResponse,
  dronecanBuildServiceFrames,
  dronecanServiceTypeId,
  dronecanSourceNodeId,
  dronecanIsServiceFrame,
  dronecanIsServiceRequest,
  encodeDronecanGetSetRequest
} from '../packages/protocol-mavlink/dist/index.js'

const PORT = process.argv[2] ?? '/dev/cu.usbmodem1101'
const TARGET_NODE = Number(process.argv[3] ?? 125)
const BUS = 1
const GCS_NODE = 127
const MAV_CMD_CAN_FORWARD = 32000
const CAN_FRAME_FLAG_EFF = 0x80000000

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ')
}

async function main() {
  const transport = new NativeSerialTransport('probe', { path: PORT, baudRate: 115200 })
  const session = new MavlinkSession(transport, new MavlinkV2Codec())

  const reassembler = new DronecanReassembler({
    getDataTypeSignature: (ctx) =>
      ctx.isService && ctx.typeId === DRONECAN_PARAM_GETSET_SERVICE_ID
        ? DRONECAN_PARAM_GETSET_SIGNATURE
        : undefined
  })

  let targetSystem = 1
  let targetComponent = 1
  let gotHeartbeat = false
  const responses = []

  session.onMessage((env) => {
    // The codec delivers { header, message, timestampMs }; the actual
    // MAVLink message + its `type` live on env.message, and the source
    // ids are on env.header.
    const msg = env.message ?? env
    const header = env.header ?? {}
    if (msg.type === 'HEARTBEAT' && !gotHeartbeat) {
      gotHeartbeat = true
      targetSystem = header.systemId ?? 1
      targetComponent = header.componentId ?? 1
      console.log(`[probe] heartbeat from sys=${targetSystem} comp=${targetComponent}`)
    }
    if (msg.type === 'CAN_FRAME') {
      const id = msg.id >>> 0
      const sourceNodeId = dronecanSourceNodeId(id)
      const isService = dronecanIsServiceFrame(id)
      if (!isService || sourceNodeId !== TARGET_NODE) return
      const typeId = dronecanServiceTypeId(id)
      const isRequest = dronecanIsServiceRequest(id)
      if (isRequest || typeId !== DRONECAN_PARAM_GETSET_SERVICE_ID) return
      const payload = msg.data.subarray(0, msg.len)
      const transferId = payload[payload.length - 1] & 0x1f
      const finished = reassembler.push(
        { sourceNodeId, isService: true, typeId, isRequest: false, transferId },
        payload
      )
      if (finished) responses.push(finished.payload)
    }
  })

  console.log(`[probe] opening ${PORT}…`)
  await session.connect()

  // Wait for heartbeat.
  const heartbeatDeadline = Date.now() + 8000
  while (!gotHeartbeat && Date.now() < heartbeatDeadline) {
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!gotHeartbeat) {
    console.error('[probe] no heartbeat — wrong port?')
    await session.disconnect()
    process.exit(1)
  }

  // Start CAN forwarding for bus 1.
  console.log(`[probe] requesting CAN_FORWARD bus ${BUS}…`)
  await session.send({
    type: 'COMMAND_LONG',
    command: MAV_CMD_CAN_FORWARD,
    targetSystem,
    targetComponent,
    confirmation: 0,
    params: [BUS, 0, 0, 0, 0, 0, 0]
  })

  // Issue GetSet requests for the first few indexes and capture responses.
  let transferId = 0
  for (let index = 0; index < 4; index += 1) {
    const reqPayload = encodeDronecanGetSetRequest({ index, value: { tag: 'empty' }, name: '' })
    const frames = dronecanBuildServiceFrames(
      {
        serviceTypeId: DRONECAN_PARAM_GETSET_SERVICE_ID,
        signature: DRONECAN_PARAM_GETSET_SIGNATURE,
        destinationNodeId: TARGET_NODE,
        sourceNodeId: GCS_NODE,
        transferId: transferId++ & 0x1f,
        isRequest: true
      },
      reqPayload
    )
    for (const frame of frames) {
      const data = new Uint8Array(8)
      data.set(frame.data.subarray(0, Math.min(frame.data.length, 8)), 0)
      await session.send({
        type: 'CAN_FRAME',
        targetSystem,
        targetComponent,
        bus: BUS - 1,
        len: frame.data.length,
        id: (frame.canId | CAN_FRAME_FLAG_EFF) >>> 0,
        data
      })
    }
    await new Promise((r) => setTimeout(r, 600))
  }

  await new Promise((r) => setTimeout(r, 500))
  await session.disconnect()

  console.log(`\n[probe] captured ${responses.length} GetSet response(s) from node ${TARGET_NODE}\n`)
  responses.forEach((payload, i) => {
    console.log(`=== response #${i} (${payload.length} bytes) ===`)
    console.log(`raw hex: ${hex(payload)}`)
    const decoded = decodeDronecanGetSetResponse(payload)
    if (decoded) {
      console.log(`decoded value: ${JSON.stringify(decoded.value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}`)
      console.log(`decoded name : ${JSON.stringify(decoded.name)}`)
      console.log(`name bytes   : ${hex(new TextEncoder().encode(decoded.name))}`)
    } else {
      console.log('decoder returned undefined')
    }
    // Also dump the tail of the payload as ASCII to eyeball the real name.
    const asciiTail = [...payload].map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')
    console.log(`ascii dump  : ${asciiTail}`)
    console.log('')
  })
  process.exit(0)
}

main().catch((err) => {
  console.error('[probe] error:', err)
  process.exit(1)
})
