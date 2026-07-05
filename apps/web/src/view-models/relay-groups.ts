// Relay tab view-model. Groups the controller's RELAYx_* parameters by
// instance so the Relays surface can render one card per relay. Pure
// derivation over the parameter list (no React, no runtime) — the tab body
// just maps the result. The per-field order (FUNCTION, PIN, DEFAULT, INVERTED)
// matches the AP_Relay_Params definition order.

import type { ParameterState } from '@arduconfig/ardupilot-core'

// Canonical per-instance field order (AP_Relay_Params var_info order). A field
// only renders if the controller actually reported it.
const RELAY_FIELD_ORDER = ['FUNCTION', 'PIN', 'DEFAULT', 'INVERTED'] as const

// RC aux-function (RCn_OPTION) value that toggles each relay, from the ArduPilot
// RC_Channel::AUX_FUNC enum (RC_Channel.h, verified 2026-07). Binding "Relay 1 to
// Ch10" means writing RC10_OPTION = 28. Instances beyond these have no RC toggle.
export const RELAY_AUX_FUNCS: Readonly<Record<number, number>> = {
  1: 28,
  2: 34,
  3: 35,
  4: 36,
  5: 66,
  6: 67
}

/** RC channels an aux function can live on (RC1..RC16). */
export const RELAY_RC_CHANNEL_COUNT = 16

export interface RelayInstanceGroup {
  instance: number
  label: string
  parameters: ParameterState[]
  /** The RCn_OPTION aux-func value that toggles this relay, or undefined when the
   *  instance has no RC-toggle aux function. */
  auxFunc: number | undefined
}

/**
 * The lowest RC channel currently bound to `auxFunc` (its RCn_OPTION == auxFunc),
 * or `undefined` when none is. `rcOptionByChannel` maps channel number → the
 * effective RCn_OPTION value (caller overlays staged edits over live values).
 */
export function relayRcChannelBinding(
  auxFunc: number | undefined,
  rcOptionByChannel: ReadonlyMap<number, number>
): number | undefined {
  if (auxFunc === undefined) {
    return undefined
  }
  for (let channel = 1; channel <= RELAY_RC_CHANNEL_COUNT; channel += 1) {
    if (rcOptionByChannel.get(channel) === auxFunc) {
      return channel
    }
  }
  return undefined
}

/**
 * The parameter writes to rebind a relay's aux function to a new RC channel:
 * set the new channel's RCn_OPTION to `auxFunc`, and clear the previously-bound
 * channel (RCn_OPTION → 0) so only one switch owns the relay. `newChannel = 0`
 * unbinds (clears the current channel only).
 */
export function planRelayRcChannelChange(
  auxFunc: number,
  newChannel: number,
  currentChannel: number | undefined
): Array<{ id: string; value: string }> {
  const writes: Array<{ id: string; value: string }> = []
  if (newChannel >= 1 && newChannel <= RELAY_RC_CHANNEL_COUNT) {
    writes.push({ id: `RC${newChannel}_OPTION`, value: String(auxFunc) })
  }
  if (currentChannel !== undefined && currentChannel !== newChannel) {
    writes.push({ id: `RC${currentChannel}_OPTION`, value: '0' })
  }
  return writes
}

/**
 * Builds the per-instance relay groups from the parameter list. Only instances
 * with at least one reported RELAYx_* parameter are returned, ordered by
 * instance number; within each group the fields follow the source order.
 */
export function buildRelayGroups(parameters: readonly ParameterState[]): RelayInstanceGroup[] {
  const byInstance = new Map<number, Map<string, ParameterState>>()
  for (const parameter of parameters) {
    const match = /^RELAY(\d+)_(FUNCTION|PIN|DEFAULT|INVERTED)$/.exec(parameter.id)
    if (!match) continue
    const instance = Number(match[1])
    let fields = byInstance.get(instance)
    if (fields === undefined) {
      fields = new Map<string, ParameterState>()
      byInstance.set(instance, fields)
    }
    fields.set(match[2], parameter)
  }

  return Array.from(byInstance.keys())
    .sort((a, b) => a - b)
    .map((instance) => {
      const fields = byInstance.get(instance)!
      const ordered = RELAY_FIELD_ORDER.map((field) => fields.get(field)).filter(
        (parameter): parameter is ParameterState => parameter !== undefined
      )
      return { instance, label: `Relay ${instance}`, parameters: ordered, auxFunc: RELAY_AUX_FUNCS[instance] }
    })
}
