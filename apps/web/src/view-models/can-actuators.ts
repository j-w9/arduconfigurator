// The CAN tab's ESC and Servo tools: what a bench test sends, and when it must
// not start. Pure; CanActuatorsView and the App wiring use it.
//
// These are bench tools in the spirit of the DroneCAN GUI Tool's ESC and
// Actuator panels: the operator drives DroneCAN ESCs and servos directly,
// with no autopilot mixing in between. Two facts from the firmware shape them:
//
// * ArduPilot keeps broadcasting esc.RawCommand (zeros while disarmed) for
//   every ESC in CAN_Dn_UC_ESC_BM, and actuator commands for every servo in
//   CAN_Dn_UC_SRV_BM, unless its safety switch masks them
//   (AP_DroneCAN::SRV_push_servos). A command sent over the forwarded bus
//   would fight that stream, so a tool refuses to start while another node is
//   commanding outputs. With an autopilot in the loop, Motors is the test.
// * AP_Periph boots with outputs off when it has a safety switch, until it
//   hears ardupilot.indication.SafetyState = OFF (rc_out.cpp), and takes its
//   armed flag from uavcan.equipment.safety.ArmingStatus. While running, the
//   tools send both; on stop they send safety ON and disarmed.

import type { DronecanValue } from '@arduconfig/dronecan-dsdl'

export const ESC_RAW_COMMAND = 'uavcan.equipment.esc.RawCommand'
export const ACTUATOR_ARRAY_COMMAND = 'uavcan.equipment.actuator.ArrayCommand'
export const SAFETY_STATE = 'ardupilot.indication.SafetyState'
export const ARMING_STATUS = 'uavcan.equipment.safety.ArmingStatus'

/** RawCommand's full scale (int14, 0..8191 forward). */
export const ESC_RAW_MAX = 8191
/** RawCommand carries at most 20 ESCs. */
export const ESC_MAX_CHANNELS = 20
/** ArrayCommand carries at most 15 actuators. */
export const ACTUATOR_MAX_PER_MESSAGE = 15
/** Default ESC throttle ceiling for a bench test, percent. Raise it on purpose. */
export const ESC_DEFAULT_LIMIT_PCT = 20
/** Send rate while a tool runs. AP_Periph zeroes ESCs after ESC_CMD_TIMO (default 200 ms) of silence. */
export const ACTUATOR_SEND_PERIOD_MS = 50

/** DataTypeIds of messages that command outputs: another sender of one of these means a conflict. */
export const OUTPUT_COMMAND_TYPE_IDS: ReadonlySet<number> = new Set([1030, 1010, 20000, 1100])

export type ServoCommandType = 'pwm' | 'unitless'

/** ArrayCommand command_type values (uavcan.equipment.actuator.Command). */
export const SERVO_COMMAND_TYPE: Record<ServoCommandType, number> = { unitless: 0, pwm: 4 }

export const SERVO_PWM_MIN = 800
export const SERVO_PWM_MAX = 2200
export const SERVO_PWM_CENTER = 1500

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** A throttle percent (0..100), capped at the limit, as a RawCommand value. */
export function escRawFromPercent(percent: number, limitPct: number): number {
  const capped = clamp(Number.isFinite(percent) ? percent : 0, 0, clamp(limitPct, 0, 100))
  return Math.round((capped / 100) * ESC_RAW_MAX)
}

/** RawCommand for `count` ESCs (index 0..count-1), each from its percent, capped. */
export function buildEscRawCommandValue(
  percents: readonly number[],
  count: number,
  limitPct: number
): { [field: string]: DronecanValue } {
  const channels = clamp(Math.round(count), 0, ESC_MAX_CHANNELS)
  const cmd: number[] = []
  for (let index = 0; index < channels; index += 1) cmd.push(escRawFromPercent(percents[index] ?? 0, limitPct))
  return { cmd }
}

/** All ESCs stopped: what a stop sends (a few times) before the tool goes quiet. */
export function buildEscStopValue(count: number): { [field: string]: DronecanValue } {
  return { cmd: new Array(clamp(Math.round(count), 0, ESC_MAX_CHANNELS)).fill(0) }
}

export interface ServoChannel {
  /** AP_Periph maps actuator_id n to the output whose function is RCINn. 1-based. */
  actuatorId: number
  value: number
}

/** A servo value kept in range for its command type. */
export function clampServoValue(type: ServoCommandType, value: number): number {
  if (!Number.isFinite(value)) return type === 'pwm' ? SERVO_PWM_CENTER : 0
  return type === 'pwm' ? Math.round(clamp(value, SERVO_PWM_MIN, SERVO_PWM_MAX)) : clamp(value, -1, 1)
}

/** ArrayCommand messages for the channels (15 per message). */
export function buildServoArrayCommandValues(
  channels: readonly ServoChannel[],
  type: ServoCommandType
): Array<{ [field: string]: DronecanValue }> {
  const commands = channels
    .filter((channel) => channel.actuatorId >= 1 && channel.actuatorId <= 255)
    .map((channel) => ({
      actuator_id: Math.round(channel.actuatorId),
      command_type: SERVO_COMMAND_TYPE[type],
      command_value: clampServoValue(type, channel.value)
    }))
  const messages: Array<{ [field: string]: DronecanValue }> = []
  for (let start = 0; start < commands.length; start += ACTUATOR_MAX_PER_MESSAGE) {
    messages.push({ commands: commands.slice(start, start + ACTUATOR_MAX_PER_MESSAGE) })
  }
  return messages
}

export function safetyStateValue(safetyOff: boolean): { [field: string]: DronecanValue } {
  return { status: safetyOff ? 255 : 0 }
}

export function armingStatusValue(armed: boolean): { [field: string]: DronecanValue } {
  return { status: armed ? 255 : 0 }
}

/** A recent stream on the bus: who sent which type, and when last. */
export interface BusStreamSeen {
  dataTypeId: number
  sourceNodeId: number
  lastSeenMs: number
}

export interface ActuatorConflict {
  nodeId: number
  dataTypeId: number
}

/** How recent another sender's output command must be to count. */
export const CONFLICT_WINDOW_MS = 2000

/**
 * Another node commanding outputs on this bus, if any: a tool must not start
 * (its commands would be fought, and a motor would stutter between them).
 * The app's own node is not a conflict.
 */
export function findActuatorConflict(
  streams: readonly BusStreamSeen[],
  ownNodeId: number,
  nowMs: number
): ActuatorConflict | undefined {
  const hit = streams.find(
    (stream) =>
      OUTPUT_COMMAND_TYPE_IDS.has(stream.dataTypeId) &&
      stream.sourceNodeId !== ownNodeId &&
      stream.sourceNodeId !== 0 &&
      nowMs - stream.lastSeenMs <= CONFLICT_WINDOW_MS
  )
  return hit ? { nodeId: hit.sourceNodeId, dataTypeId: hit.dataTypeId } : undefined
}

export function actuatorConflictText(conflict: ActuatorConflict, nodeLabel: string): string {
  const what = conflict.dataTypeId === 1030 ? 'ESC commands' : conflict.dataTypeId === 1010 ? 'servo commands' : 'safety and arming state'
  return `${nodeLabel} is sending ${what} on this bus, so a test here would be fought. Test motors from the Motors tab, or connect the ESCs and servos through a USB-CAN adapter without the autopilot.`
}

/** Why a tool cannot start, or undefined when it can. Order: the most basic first. */
export function actuatorBlockedReason(input: {
  busActive: boolean
  armed: boolean
  acknowledged: boolean
  conflict?: string
}): string | undefined {
  if (input.armed) return 'Disarm the vehicle first.'
  if (!input.busActive) return 'Connect to the bus on Devices first.'
  if (input.conflict) return input.conflict
  if (!input.acknowledged) return 'Tick the safety box first.'
  return undefined
}
