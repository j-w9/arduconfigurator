import { ARDUCOPTER_4_7_PARAMETER_OVERRIDES, type ParameterDefinition } from '@arduconfig/param-metadata'

import { firmwareVersionAtLeast, type FlightSwVersionParts } from './mavftp.js'

// Version-gated ArduCopter metadata overrides. The base catalog stays at the
// 4.6 values (byte-identical for a 4.6 FC / pre-connect / Unknown); these merge
// the 4.7-release-line deltas over the base ONLY when a >= 4.7 build is
// detected. Copter-only — callers gate on vehicle === 'ArduCopter'.

/**
 * Apply the ArduCopter 4.7+ override for a single definition. Returns the
 * definition UNCHANGED (by identity) for <= 4.6 / unknown firmware, or when the
 * param has no override — so callers can cheaply skip untouched params.
 */
export function applyArducopter47Override(
  definition: ParameterDefinition,
  versionParts: FlightSwVersionParts | undefined
): ParameterDefinition {
  if (firmwareVersionAtLeast(versionParts, 4, 7) !== true) {
    return definition
  }
  const patch = ARDUCOPTER_4_7_PARAMETER_OVERRIDES[definition.id]
  return patch ? { ...definition, ...patch } : definition
}

/**
 * Apply the ArduCopter 4.7+ overrides across a normalized catalog's parameter
 * map. Returns the SAME catalog object for <= 4.6 / unknown / non-copter, so the
 * default (pre-connect) and 4.6 paths are untouched.
 */
export function applyArducopter47CatalogOverrides<
  T extends { parameters: Record<string, ParameterDefinition> }
>(catalog: T, versionParts: FlightSwVersionParts | undefined, isCopter: boolean): T {
  if (!isCopter || firmwareVersionAtLeast(versionParts, 4, 7) !== true) {
    return catalog
  }
  const parameters = { ...catalog.parameters }
  for (const [id, patch] of Object.entries(ARDUCOPTER_4_7_PARAMETER_OVERRIDES)) {
    const base = parameters[id]
    if (base) {
      parameters[id] = { ...base, ...patch }
    }
  }
  return { ...catalog, parameters }
}
