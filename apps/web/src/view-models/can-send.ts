// Sending on the CAN bus: what is dangerous to send, the value a composed
// DroneCAN message starts from, and the frames a send becomes. Pure; the
// sender hook and the Send page use it.

import type {
  DronecanCatalogue,
  DronecanConstDesc,
  DronecanSectionDesc,
  DronecanTypeDesc,
  DronecanTypeInfo,
  DronecanValue
} from '@arduconfig/dronecan-dsdl'
import { dronecanBuildBroadcastFrames, dronecanBuildServiceFrames } from '@arduconfig/protocol-mavlink'

/**
 * What a send can do.
 * - 'motion': it can move something -- spin an ESC, drive an actuator,
 *   release a hardpoint, point a gimbal, or tell nodes the vehicle is armed.
 *   Requires the motor-safety acknowledgement (the one box everywhere motors
 *   spin). Every RAW frame counts: the app cannot know what an arbitrary id
 *   does to the devices on the bus.
 * - 'node': it changes a node -- restart, firmware update, save/erase its
 *   parameters, a shell command, a vendor id/baud change. Needs a confirm.
 */
export type CanSendHazard = 'motion' | 'node' | undefined

const MOTION_TYPES = [
  /\.esc\..*(RawCommand|RPMCommand|FocCtrl|SelfTest|SetAngle|SetDirection|SetThrottleSource)$/,
  /\.actuator\.ArrayCommand$/,
  /\.hardpoint\.Command$/,
  /\.camera_gimbal\..*Command$/,
  /\.safety\.ArmingStatus$/,
  /\.indication\.SafetyState$/
]

const NODE_TYPES = [
  /^uavcan\.protocol\.RestartNode$/,
  /^uavcan\.protocol\.file\.BeginFirmwareUpdate$/,
  /^uavcan\.protocol\.param\.ExecuteOpcode$/,
  /^uavcan\.protocol\.AccessCommandShell$/,
  /\.esc\.Set(ID|Baud|LED|ReportingFrequency)$/,
  /\.remoteid\.SecureCommand$/
]

export function dronecanSendHazard(fullName: string): CanSendHazard {
  if (MOTION_TYPES.some((pattern) => pattern.test(fullName))) return 'motion'
  if (NODE_TYPES.some((pattern) => pattern.test(fullName))) return 'node'
  return undefined
}

/** The shortest period a repeating send may use: the MAVLink link carries every frame. */
export const CAN_SEND_MIN_PERIOD_MS = 20

/** Every type that can go on the bus by itself (nested-only types have no data type id). */
export function canSendableTypes(catalogue: DronecanCatalogue): DronecanTypeInfo[] {
  return catalogue.list().filter((type) => type.dataTypeId !== null)
}

/**
 * The section's constants that name values for a field: NodeStatus's
 * HEALTH_OK.. for `health`, RestartNode's MAGIC_NUMBER for `magic_number`.
 */
export function dronecanFieldConstants(section: DronecanSectionDesc, fieldName: string): DronecanConstDesc[] {
  const upper = fieldName.toUpperCase()
  return section.consts.filter((entry) => entry.n === upper || entry.n.startsWith(`${upper}_`))
}

/**
 * A fresh value for a type's section: zeros, false, empty dynamic arrays, a
 * union's first field -- except a field with a constant of its own name
 * (RestartNode's magic_number), which starts at that constant: it is the only
 * value the node accepts.
 */
export function defaultDronecanValue(catalogue: DronecanCatalogue, section: DronecanSectionDesc): { [field: string]: DronecanValue } {
  const fields = section.fields.filter((field) => field.n !== null)
  const initial = (name: string, desc: DronecanTypeDesc): DronecanValue => {
    const own = section.consts.find((entry) => entry.n === name.toUpperCase())
    return own && 'p' in desc ? own.v : defaultFor(catalogue, desc)
  }
  if (section.union) {
    const first = fields[0]
    return first ? { [first.n!]: initial(first.n!, first.t) } : {}
  }
  return Object.fromEntries(fields.map((field) => [field.n!, initial(field.n!, field.t)]))
}

/** The range a primitive field holds; wider than 53 bits the number input takes text. */
export function dronecanPrimitiveLimits(desc: Extract<DronecanTypeDesc, { p: string }>): {
  integer: boolean
  min?: number
  max?: number
  wide: boolean
} {
  if (desc.p === 'b') return { integer: true, min: 0, max: 1, wide: false }
  if (desc.p === 'f') return { integer: false, wide: false }
  const wide = desc.bits > 53
  if (desc.p === 'u') return { integer: true, min: 0, max: wide ? undefined : 2 ** desc.bits - 1, wide }
  return { integer: true, min: wide ? undefined : -(2 ** (desc.bits - 1)), max: wide ? undefined : 2 ** (desc.bits - 1) - 1, wide }
}

/** A uint8 array: names, strings, blobs -- edited as text or hex, not number by number. */
export function isDronecanByteArray(desc: DronecanTypeDesc): boolean {
  return 'a' in desc && 'p' in desc.a && desc.a.p === 'u' && desc.a.bits === 8
}

function defaultFor(catalogue: DronecanCatalogue, desc: DronecanTypeDesc): DronecanValue {
  if ('p' in desc) return desc.p === 'b' ? false : 0
  if ('v' in desc) return 0
  if ('r' in desc) return defaultDronecanValue(catalogue, catalogue.section(desc.r, 'msg'))
  return desc.m === 's' ? Array.from({ length: desc.max }, () => defaultFor(catalogue, desc.a)) : []
}

/** A copy of `value` with the leaf at `path` replaced. */
export function setDronecanValueAt(
  value: DronecanValue,
  path: readonly (string | number)[],
  next: DronecanValue
): DronecanValue {
  if (path.length === 0) return next
  const [head, ...rest] = path
  if (Array.isArray(value)) {
    const copy = [...value]
    copy[head as number] = setDronecanValueAt(copy[head as number] ?? 0, rest, next)
    return copy
  }
  const record = value && typeof value === 'object' ? (value as Record<string, DronecanValue>) : {}
  return { ...record, [head as string]: setDronecanValueAt(record[head as string] ?? 0, rest, next) }
}

export interface CanSendFrame {
  id: number
  extended: boolean
  data: Uint8Array
  fd?: boolean
}

export interface DronecanSendSpec {
  fullName: string
  /** A broadcast message, or a request to `destinationNodeId`. */
  kind: 'message' | 'request'
  value: { [field: string]: DronecanValue }
  /** 0 (highest) .. 31; DroneCAN's default is 16. */
  priority: number
  sourceNodeId: number
  destinationNodeId?: number
  transferId: number
}

/** The frames (and the encoded payload) a DroneCAN send becomes. */
export function buildDronecanSendFrames(
  catalogue: DronecanCatalogue,
  spec: DronecanSendSpec
): { payload: Uint8Array; frames: CanSendFrame[] } {
  const info = catalogue.info(spec.fullName)
  if (!info || info.dataTypeId === null) {
    throw new Error(`${spec.fullName} has no data type id, so it cannot be sent on its own.`)
  }
  const payload = catalogue.encode(spec.fullName, spec.kind === 'message' ? 'msg' : 'req', spec.value)
  const built =
    spec.kind === 'message'
      ? dronecanBuildBroadcastFrames(
          { messageTypeId: info.dataTypeId, signature: info.signature, sourceNodeId: spec.sourceNodeId, transferId: spec.transferId, priority: spec.priority },
          payload
        )
      : dronecanBuildServiceFrames(
          {
            serviceTypeId: info.dataTypeId,
            signature: info.signature,
            destinationNodeId: spec.destinationNodeId ?? 0,
            sourceNodeId: spec.sourceNodeId,
            transferId: spec.transferId,
            priority: spec.priority,
            isRequest: true
          },
          payload
        )
  return { payload, frames: built.map((frame) => ({ id: frame.canId, extended: true, data: frame.data })) }
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** A raw frame from the composer's fields: hex id, hex bytes, standard / extended, FD. */
export function parseRawCanFrame(input: { idText: string; dataText: string; extended: boolean; fd: boolean }): ParseResult<CanSendFrame> {
  const idClean = input.idText.trim().replace(/^0x/i, '')
  if (!/^[0-9a-f]{1,8}$/i.test(idClean)) return { ok: false, error: 'ID is hex, e.g. 123 or 1E0A3C7F.' }
  const id = Number.parseInt(idClean, 16)
  const maxId = input.extended ? 0x1fffffff : 0x7ff
  if (id > maxId) {
    return { ok: false, error: input.extended ? 'An extended ID is at most 1FFFFFFF.' : 'A standard ID is at most 7FF; tick Extended for a 29-bit ID.' }
  }
  const dataClean = input.dataText.replace(/0x/gi, '').replace(/[\s,]+/g, '')
  if (dataClean.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(dataClean)) {
    return { ok: false, error: 'Data is whole hex bytes, e.g. "01 02 FF".' }
  }
  const data = new Uint8Array(dataClean.length / 2)
  for (let index = 0; index < data.length; index += 1) data[index] = Number.parseInt(dataClean.slice(index * 2, index * 2 + 2), 16)
  const max = input.fd ? 64 : 8
  if (data.length > max) return { ok: false, error: `${input.fd ? 'A CAN FD' : 'A classic'} frame carries at most ${max} bytes.` }
  return { ok: true, value: { id, extended: input.extended, data, fd: input.fd } }
}
