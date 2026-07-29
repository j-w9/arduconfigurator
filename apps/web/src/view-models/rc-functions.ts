// Receiver -> Functions tab: the RCn_OPTION assignment for every AUX channel.
//
// Before this, the only RCn_OPTION an operator could set from this app was the
// Arm switch (a dedicated control for one hard-coded pair of values). Every
// other auxiliary function — RTL, gripper, camera trigger, motor emergency
// stop — was reachable only by hand-editing raw parameters, which means
// knowing both the parameter name and the numeric function id.
//
// Pure derivation over the snapshot + staged edits, so it unit-tests off the
// runtime like the other view-models here.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import { readRoundedParameter } from '../selectors/parameter-read'

/** AUX range. 1-4 are the primary stick axes; an aux function on those is a
 *  configuration error, not a choice, so they are not offered. */
export const RC_FUNCTION_MIN_CHANNEL = 5
export const RC_FUNCTION_MAX_CHANNEL = 16

/** RCn_OPTION value meaning "unused". */
export const RC_FUNCTION_NONE = 0

export interface RcFunctionRow {
  channelNumber: number
  paramId: string
  /** Effective value: a staged edit wins over the live value, so the row
   *  reflects a just-made selection before Apply. */
  value: number | undefined
  /** Live PWM for this channel, when RC telemetry is present — lets the
   *  operator identify which physical switch they are looking at. */
  pwm: number | undefined
  /** True when this channel carries a real function (not 0 / unset). */
  assigned: boolean
  /** Other channels carrying the SAME non-zero function. ArduPilot does not
   *  define which wins, so a duplicate is a real misconfiguration worth
   *  surfacing rather than a cosmetic nag. */
  duplicateChannels: number[]
}

function effectiveOptionValue(
  snapshot: ConfiguratorSnapshot,
  editedValues: Record<string, string>,
  channelNumber: number
): number | undefined {
  const paramId = `RC${channelNumber}_OPTION`
  const staged = editedValues[paramId]
  if (staged !== undefined && staged !== '') {
    const parsed = Number(staged)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return readRoundedParameter(snapshot, paramId)
}

export function buildRcFunctionRows(
  snapshot: ConfiguratorSnapshot,
  editedValues: Record<string, string>
): RcFunctionRow[] {
  const channels = snapshot.liveVerification.rcInput.channels ?? []
  const values = new Map<number, number | undefined>()
  for (let channelNumber = RC_FUNCTION_MIN_CHANNEL; channelNumber <= RC_FUNCTION_MAX_CHANNEL; channelNumber += 1) {
    values.set(channelNumber, effectiveOptionValue(snapshot, editedValues, channelNumber))
  }

  return [...values.entries()].map(([channelNumber, value]) => {
    const assigned = value !== undefined && value !== RC_FUNCTION_NONE
    const duplicateChannels = assigned
      ? [...values.entries()]
          .filter(([otherChannel, otherValue]) => otherChannel !== channelNumber && otherValue === value)
          .map(([otherChannel]) => otherChannel)
      : []
    const pwm = channels[channelNumber - 1]
    return {
      channelNumber,
      paramId: `RC${channelNumber}_OPTION`,
      value,
      pwm: typeof pwm === 'number' && pwm >= 800 ? pwm : undefined,
      assigned,
      duplicateChannels
    }
  })
}

/** Count of channels carrying a real function — drives the task-card summary. */
export function countAssignedRcFunctions(rows: RcFunctionRow[]): number {
  return rows.filter((row) => row.assigned).length
}

/** Every channel involved in a duplicate assignment. */
export function rcFunctionConflicts(rows: RcFunctionRow[]): RcFunctionRow[] {
  return rows.filter((row) => row.duplicateChannels.length > 0)
}
