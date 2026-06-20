// Demo DroneCAN bus simulator. Synthesizes a couple of peripheral nodes so the
// CAN inspector populates without hardware: it answers the runtime's
// MAV_CMD_CAN_FORWARD + the DroneCAN service requests the CanBusService issues
// (GetNodeInfo, param GetSet read/write, ExecuteOpcode save) and periodically
// broadcasts NodeStatus. All frames are produced with the same codec the
// runtime decodes with, and the encoders are round-trip tested
// (tests/dronecan-decoders.test.mjs), so a simulated node populates the
// inspector identically to a real one.

import type { CanFrameMessage, MavlinkMessage } from './messages.js'
import {
  DRONECAN_GET_NODE_INFO_SERVICE_ID,
  DRONECAN_GET_NODE_INFO_SIGNATURE,
  DRONECAN_NODE_STATUS_DT_ID,
  DRONECAN_NODE_STATUS_SIGNATURE,
  DRONECAN_PARAM_EXECUTE_OPCODE_SERVICE_ID,
  DRONECAN_PARAM_EXECUTE_OPCODE_SIGNATURE,
  DRONECAN_PARAM_GETSET_SERVICE_ID,
  DRONECAN_PARAM_GETSET_SIGNATURE,
  DronecanReassembler,
  dronecanBuildBroadcastFrames,
  dronecanBuildServiceFrames,
  dronecanIsServiceFrame,
  dronecanIsServiceRequest,
  dronecanParseTailByte,
  dronecanServiceDestinationNodeId,
  dronecanServiceTypeId,
  encodeDronecanExecuteOpcodeResponse,
  encodeDronecanGetNodeInfoResponse,
  encodeDronecanGetSetResponse,
  encodeDronecanNodeStatus,
  type DronecanGetSetResponse,
  type DronecanParamValue
} from './dronecan.js'

const MAV_CMD_CAN_FORWARD = 32000
const GCS_DRONECAN_NODE_ID = 127
const CAN_FRAME_FLAG_EFF = 0x80000000

interface MockDronecanParam {
  name: string
  value: DronecanParamValue
  default: DronecanParamValue
  min: DronecanParamValue
  max: DronecanParamValue
}

interface MockDronecanNode {
  nodeId: number
  name: string
  swMajor: number
  swMinor: number
  vcsCommit: number
  hwMajor: number
  hwMinor: number
  uniqueId: Uint8Array
  /** NodeStatus health: 0 OK, 1 WARNING, 2 ERROR, 3 CRITICAL. */
  health: number
  /** NodeStatus mode: 0 OPERATIONAL, 1 INITIALIZATION, ... */
  mode: number
  params: MockDronecanParam[]
}

const int = (n: number): DronecanParamValue => ({ tag: 'int64', int64: BigInt(n) })
const real = (n: number): DronecanParamValue => ({ tag: 'real32', real32: n })
const empty: DronecanParamValue = { tag: 'empty' }

function uid(seed: number): Uint8Array {
  return Uint8Array.from({ length: 16 }, (_, i) => (seed * 31 + i * 7) & 0xff)
}

// Two representative peripherals: a GPS/compass and a power monitor. Names and
// params mirror what these nodes really advertise on a DroneCAN bus.
const NODES: MockDronecanNode[] = [
  {
    nodeId: 124,
    name: 'com.hex.here3',
    swMajor: 1,
    swMinor: 12,
    vcsCommit: 0x4a7c3f01,
    hwMajor: 1,
    hwMinor: 0,
    uniqueId: uid(124),
    health: 0,
    mode: 0,
    params: [
      { name: 'NODEID', value: int(124), default: int(0), min: int(0), max: int(127) },
      { name: 'GPS_TYPE', value: int(1), default: int(0), min: int(0), max: int(26) },
      { name: 'MAG_ENABLE', value: int(1), default: int(1), min: int(0), max: int(1) },
      { name: 'NTF_LED_OVERRIDE', value: int(0), default: int(0), min: int(0), max: int(1) }
    ]
  },
  {
    nodeId: 50,
    name: 'org.ardupilot.ap_periph',
    swMajor: 1,
    swMinor: 6,
    vcsCommit: 0x9be21044,
    hwMajor: 2,
    hwMinor: 1,
    uniqueId: uid(50),
    health: 0,
    mode: 0,
    params: [
      { name: 'NODEID', value: int(50), default: int(0), min: int(0), max: int(127) },
      { name: 'BATT_MONITOR', value: int(4), default: int(0), min: int(0), max: int(20) },
      { name: 'BATT_CAPACITY', value: real(5200), default: real(0), min: real(0), max: real(64000) }
    ]
  }
]

export interface DronecanBusSimulator {
  /** True once the GCS has sent MAV_CMD_CAN_FORWARD. */
  isActive: () => boolean
  /** Feed an outbound (GCS→FC) MAVLink message; returns inbound CAN_FRAME
   *  responses to emit (empty for unrelated messages). */
  handleOutbound: (message: MavlinkMessage) => CanFrameMessage[]
  /** Periodic NodeStatus broadcasts for every simulated node (empty until
   *  forwarding is active). */
  broadcasts: () => CanFrameMessage[]
}

/** Build a fresh simulator. State (active flag, transfer ids, param edits) is
 *  per-instance so each demo connection starts clean. */
export function createDronecanBusSimulator(): DronecanBusSimulator {
  let active = false
  let wireBus = 0
  let bootMs = Date.now()
  const statusTransferId = new Map<number, number>()
  // Requests can be multi-frame (a param write carries value + name), so
  // reassemble GCS→node service transfers before acting on them.
  const reassembler = new DronecanReassembler({
    getDataTypeSignature: (ctx) => {
      if (!ctx.isService) return undefined
      switch (ctx.typeId) {
        case DRONECAN_GET_NODE_INFO_SERVICE_ID:
          return DRONECAN_GET_NODE_INFO_SIGNATURE
        case DRONECAN_PARAM_GETSET_SERVICE_ID:
          return DRONECAN_PARAM_GETSET_SIGNATURE
        case DRONECAN_PARAM_EXECUTE_OPCODE_SERVICE_ID:
          return DRONECAN_PARAM_EXECUTE_OPCODE_SIGNATURE
        default:
          return undefined
      }
    }
  })

  const uptimeSec = (): number => Math.max(1, Math.floor((Date.now() - bootMs) / 1000))

  const nextStatusTransferId = (nodeId: number): number => {
    const next = (statusTransferId.get(nodeId) ?? 0) & 0x1f
    statusTransferId.set(nodeId, next + 1)
    return next
  }

  const toCanFrame = (canId: number, data: Uint8Array): CanFrameMessage => {
    const padded = new Uint8Array(8)
    padded.set(data.subarray(0, Math.min(8, data.length)), 0)
    return {
      type: 'CAN_FRAME',
      targetSystem: 0,
      targetComponent: 0,
      bus: wireBus,
      len: Math.min(8, data.length),
      id: (canId | CAN_FRAME_FLAG_EFF) >>> 0,
      data: padded
    }
  }

  const serviceResponseFrames = (
    node: MockDronecanNode,
    serviceTypeId: number,
    signature: bigint,
    payload: Uint8Array,
    transferId: number
  ): CanFrameMessage[] =>
    dronecanBuildServiceFrames(
      {
        serviceTypeId,
        signature,
        destinationNodeId: GCS_DRONECAN_NODE_ID,
        sourceNodeId: node.nodeId,
        transferId,
        isRequest: false
      },
      payload
    ).map((frame) => toCanFrame(frame.canId, frame.data))

  const nodeInfoResponse = (node: MockDronecanNode): Uint8Array =>
    encodeDronecanGetNodeInfoResponse({
      status: { uptimeSec: uptimeSec(), health: node.health, mode: node.mode, subMode: 0, vendorSpecificStatusCode: 0 },
      softwareVersion: { major: node.swMajor, minor: node.swMinor, optionalFieldFlags: 0, vcsCommit: node.vcsCommit, imageCrc: 0n },
      hardwareVersion: { major: node.hwMajor, minor: node.hwMinor, uniqueId: node.uniqueId, certificateOfAuthenticity: new Uint8Array(0) },
      name: node.name
    })

  const paramResponse = (param: MockDronecanParam): DronecanGetSetResponse => ({
    value: param.value,
    defaultValue: param.default,
    maxValue: param.max,
    minValue: param.min,
    name: param.name
  })

  const endOfParamsResponse: DronecanGetSetResponse = {
    value: empty,
    defaultValue: empty,
    maxValue: empty,
    minValue: empty,
    name: ''
  }

  // GetSet request (BYTE-ALIGNED, matching real ArduPilot DroneCAN nodes and
  // encodeDronecanGetSetRequest): uint8 index, Value (1-byte union tag +
  // content), then the name tail. A read sends an empty value (+ optional
  // name); a write sends a value + name. (The wire is NOT the canonical
  // bit-packed DSDL — see encodeDronecanGetSetRequest for why.)
  const handleGetSet = (node: MockDronecanNode, request: Uint8Array): DronecanGetSetResponse => {
    if (request.length < 2) {
      return endOfParamsResponse
    }
    const index = request[0]
    const tag = request[1]
    let cursor = 2
    let writeValue: DronecanParamValue | undefined
    if (tag === 1) {
      let raw = 0n
      for (let i = 0; i < 8; i += 1) raw |= BigInt(request[cursor + i] ?? 0) << BigInt(8 * i)
      if (raw >= 0x8000000000000000n) raw -= 1n << 64n
      writeValue = { tag: 'int64', int64: raw }
      cursor += 8
    } else if (tag === 2) {
      const buf = new Uint8Array(4)
      for (let i = 0; i < 4; i += 1) buf[i] = request[cursor + i] ?? 0
      writeValue = { tag: 'real32', real32: new DataView(buf.buffer).getFloat32(0, true) }
      cursor += 4
    } else if (tag === 3) {
      writeValue = { tag: 'bool', bool: (request[cursor] ?? 0) !== 0 }
      cursor += 1
    } else if (tag === 4) {
      const len = request[cursor] ?? 0
      cursor += 1
      writeValue = {
        tag: 'string',
        string: new TextDecoder('utf-8', { fatal: false }).decode(request.subarray(cursor, cursor + len))
      }
      cursor += len
    }
    const name = new TextDecoder('utf-8', { fatal: false }).decode(request.subarray(cursor)).replace(/[\s\0]+$/, '')

    if (writeValue && name.length > 0) {
      const param = node.params.find((p) => p.name === name)
      if (param) {
        param.value = writeValue
        return paramResponse(param)
      }
      return endOfParamsResponse
    }

    // Read by index — an out-of-range index returns the empty-named entry that
    // terminates the runtime's parameter walk.
    if (index < node.params.length) {
      return paramResponse(node.params[index])
    }
    return endOfParamsResponse
  }

  const emitNodeStatus = (): CanFrameMessage[] => {
    if (!active) {
      return []
    }
    return NODES.map((node) => {
      const frames = dronecanBuildBroadcastFrames(
        { messageTypeId: DRONECAN_NODE_STATUS_DT_ID, signature: DRONECAN_NODE_STATUS_SIGNATURE, sourceNodeId: node.nodeId, transferId: nextStatusTransferId(node.nodeId) },
        encodeDronecanNodeStatus({ uptimeSec: uptimeSec(), health: node.health, mode: node.mode, subMode: 0, vendorSpecificStatusCode: 0 })
      )
      return toCanFrame(frames[0].canId, frames[0].data)
    })
  }

  return {
    isActive: () => active,
    handleOutbound: (message: MavlinkMessage): CanFrameMessage[] => {
      if (message.type === 'COMMAND_LONG' && message.command === MAV_CMD_CAN_FORWARD) {
        active = true
        bootMs = Date.now()
        statusTransferId.clear()
        reassembler.reset()
        // MAV_CMD_CAN_FORWARD param1 is the 1-indexed bus; the CAN_FRAME wire
        // field is 0-indexed.
        wireBus = Math.max(0, Math.round(message.params?.[0] ?? 1) - 1)
        // Discover the bus immediately rather than waiting for the next ~1 Hz
        // emitter tick — the inspector populates right after the user clicks
        // Connect. Periodic broadcasts then keep uptimes ticking.
        return emitNodeStatus()
      }
      if (!active || message.type !== 'CAN_FRAME') {
        return []
      }
      const canId = message.id >>> 0
      if (!dronecanIsServiceFrame(canId) || !dronecanIsServiceRequest(canId)) {
        return []
      }
      const destinationNodeId = dronecanServiceDestinationNodeId(canId)
      const node = NODES.find((n) => n.nodeId === destinationNodeId)
      if (!node) {
        return []
      }
      const serviceTypeId = dronecanServiceTypeId(canId)
      const requestFrame = message.data.subarray(0, message.len)
      if (requestFrame.length === 0) {
        return []
      }
      const tail = dronecanParseTailByte(requestFrame[requestFrame.length - 1])
      const finished = reassembler.push(
        { sourceNodeId: GCS_DRONECAN_NODE_ID, isService: true, typeId: serviceTypeId, isRequest: true, transferId: tail.transferId },
        requestFrame
      )
      if (!finished) {
        // Mid-transfer (multi-frame write) — wait for the rest.
        return []
      }

      switch (serviceTypeId) {
        case DRONECAN_GET_NODE_INFO_SERVICE_ID:
          return serviceResponseFrames(node, DRONECAN_GET_NODE_INFO_SERVICE_ID, DRONECAN_GET_NODE_INFO_SIGNATURE, nodeInfoResponse(node), tail.transferId)
        case DRONECAN_PARAM_GETSET_SERVICE_ID:
          return serviceResponseFrames(
            node,
            DRONECAN_PARAM_GETSET_SERVICE_ID,
            DRONECAN_PARAM_GETSET_SIGNATURE,
            encodeDronecanGetSetResponse(handleGetSet(node, finished.payload)),
            tail.transferId
          )
        case DRONECAN_PARAM_EXECUTE_OPCODE_SERVICE_ID:
          return serviceResponseFrames(node, DRONECAN_PARAM_EXECUTE_OPCODE_SERVICE_ID, DRONECAN_PARAM_EXECUTE_OPCODE_SIGNATURE, encodeDronecanExecuteOpcodeResponse(0n, true), tail.transferId)
        default:
          return []
      }
    },
    broadcasts: (): CanFrameMessage[] => emitNodeStatus()
  }
}
