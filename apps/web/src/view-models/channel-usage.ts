// Cross-subsystem channel usage — so the RC Mixer can warn that a channel is
// already claimed by arm / flight-mode / another RCn_OPTION aux function, and
// (the reverse) so the Receiver / Modes / arm-switch surfaces can warn that a
// channel already carries an RC Mixer (AP_RC_Logic) term. Keeps the user from
// unknowingly layering two mechanisms on one channel.

import { RC_LOGIC_AUX_FUNCTION_OPTIONS } from '@arduconfig/param-metadata'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import { getModeChannelNumber } from '../rc-channel-helpers'
import { readRoundedParameter } from '../selectors/parameter-read'
import type { RcMixerAssignment } from './rc-mixer'

const AUX_LABEL_BY_VALUE = new Map<number, string>(
  RC_LOGIC_AUX_FUNCTION_OPTIONS.map((option) => [option.value, option.label])
)

/** Human label for an RCn_OPTION / RCL FUNC aux-function value. */
export function auxFunctionLabel(value: number): string {
  return AUX_LABEL_BY_VALUE.get(value) ?? `Option ${value}`
}

/**
 * Non-RCL claims on each channel: the flight-mode switch (FLTMODE_CH / MODE_CH)
 * and any standard RCn_OPTION aux function. Keyed by channel number; the value
 * is the list of claim labels (usually one, occasionally both). RCL terms are
 * intentionally excluded — they are the RC Mixer's own rows, not an "external"
 * claim. Consumed by the RC Mixer to badge each channel.
 */
export function deriveExternalChannelClaims(snapshot: ConfiguratorSnapshot): Map<number, string[]> {
  const claims = new Map<number, string[]>()
  const add = (channel: number, label: string): void => {
    const existing = claims.get(channel)
    if (existing) {
      existing.push(label)
    } else {
      claims.set(channel, [label])
    }
  }

  const modeChannel = getModeChannelNumber(snapshot)
  if (modeChannel !== undefined) {
    add(modeChannel, 'Flight mode switch')
  }

  for (let channel = 1; channel <= 16; channel += 1) {
    const option = readRoundedParameter(snapshot, `RC${channel}_OPTION`)
    if (option !== undefined && option !== 0) {
      add(channel, auxFunctionLabel(option))
    }
  }

  return claims
}

/**
 * RC Mixer (RCL) function labels per channel — the reverse direction. Keyed by
 * channel; the value is the list of RCL function labels the channel drives.
 * Consumed by the Receiver / Modes / arm-switch surfaces to warn that a channel
 * already carries an RC Mixer term. A row with FUNC = 0 (pending, no function
 * picked yet) is skipped — it is not yet an active claim.
 */
export function deriveRcLogicChannelClaims(
  assignments: readonly RcMixerAssignment[]
): Map<number, string[]> {
  const claims = new Map<number, string[]>()
  for (const assignment of assignments) {
    if (assignment.functionId === 0) {
      continue
    }
    const label = auxFunctionLabel(assignment.functionId)
    const existing = claims.get(assignment.channel)
    if (existing) {
      if (!existing.includes(label)) {
        existing.push(label)
      }
    } else {
      claims.set(assignment.channel, [label])
    }
  }
  return claims
}
