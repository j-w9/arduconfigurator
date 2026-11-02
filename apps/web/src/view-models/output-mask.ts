// Per-output bitmask helpers for the masks that address servo outputs one bit
// each (SERVO_BLH_BDMASK, SERVO_BLH_RVMASK: bit n-1 = output n).
//
// The Config ESC card shows one box per output the board has (not the mask's
// full 32), so a toggle must flip exactly that output's bit and leave every
// other bit -- higher outputs the vehicle may have set -- exactly as reported.

export interface MaskOutput {
  channelNumber: number
  /** Set when the output is mapped as a motor; tags the box "1 · M1". */
  motorNumber?: number
}

export interface MaskOutputRow extends MaskOutput {
  checked: boolean
  label: string
}

/** Bit for a 1-based output number, or 0 when the output cannot be addressed. */
function bitFor(channelNumber: number): number {
  return Number.isInteger(channelNumber) && channelNumber >= 1 && channelNumber <= 32 ? 2 ** (channelNumber - 1) : 0
}

/** Normalise a raw mask value (draft text or live number) to an unsigned 32-bit integer. */
export function normalizeMask(value: number | string | undefined): number {
  const numeric = typeof value === 'string' ? (value.trim() === '' ? NaN : Number(value)) : value
  if (numeric === undefined || !Number.isFinite(numeric)) return 0
  return Math.round(numeric) >>> 0
}

export function isOutputSet(mask: number, channelNumber: number): boolean {
  const bit = bitFor(channelNumber)
  return bit !== 0 && Math.floor(normalizeMask(mask) / bit) % 2 === 1
}

/** The mask with one output's bit set or cleared; every other bit unchanged. */
export function withOutputBit(mask: number, channelNumber: number, on: boolean): number {
  const current = normalizeMask(mask)
  const bit = bitFor(channelNumber)
  if (bit === 0) return current
  const isSet = Math.floor(current / bit) % 2 === 1
  if (isSet === on) return current
  return on ? current + bit : current - bit
}

/** One row per output, in output order, labelled "1", or "1 · M1" for a motor. */
export function buildMaskOutputRows(mask: number, outputs: readonly MaskOutput[]): MaskOutputRow[] {
  return [...outputs]
    .sort((left, right) => left.channelNumber - right.channelNumber)
    .map((output) => ({
      ...output,
      checked: isOutputSet(mask, output.channelNumber),
      label: output.motorNumber !== undefined ? `${output.channelNumber} · M${output.motorNumber}` : String(output.channelNumber)
    }))
}

/**
 * The outputs a board actually has: one per SERVOn_FUNCTION the vehicle
 * reports (typically 16, never the mask's full 32), with motors tagged.
 */
export function outputsFromServoFunctions(
  parameterIds: Iterable<string>,
  motors: readonly { channelNumber: number; motorNumber?: number }[]
): MaskOutput[] {
  const motorByChannel = new Map(motors.map((motor) => [motor.channelNumber, motor.motorNumber]))
  const channels: number[] = []
  for (const id of parameterIds) {
    const match = /^SERVO(\d+)_FUNCTION$/.exec(id)
    if (match) {
      const channel = Number(match[1])
      if (channel >= 1 && channel <= 32) channels.push(channel)
    }
  }
  return channels
    .sort((left, right) => left - right)
    .map((channelNumber) => {
      const motorNumber = motorByChannel.get(channelNumber)
      return motorNumber !== undefined ? { channelNumber, motorNumber } : { channelNumber }
    })
}
