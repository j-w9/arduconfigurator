// Relay tab view-model. Groups the controller's RELAYx_* parameters by
// instance so the Relays surface can render one card per relay. Pure
// derivation over the parameter list (no React, no runtime) — the tab body
// just maps the result. The per-field order (FUNCTION, PIN, DEFAULT, INVERTED)
// matches the AP_Relay_Params definition order.

import type { ParameterState } from '@arduconfig/ardupilot-core'

// Canonical per-instance field order (AP_Relay_Params var_info order). A field
// only renders if the controller actually reported it.
const RELAY_FIELD_ORDER = ['FUNCTION', 'PIN', 'DEFAULT', 'INVERTED'] as const

export interface RelayInstanceGroup {
  instance: number
  label: string
  parameters: ParameterState[]
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
      return { instance, label: `Relay ${instance}`, parameters: ordered }
    })
}
