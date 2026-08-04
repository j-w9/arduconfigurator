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

// ---------------------------------------------------------------------------
// SFD fork feature gate: the VALT flight mode.
//
// The fork adds `VALT = 29, // Velocity-controlled alt hold` (ArduCopter
// mode.h), compile-gated on MODE_VALT_ENABLED. Stock ArduCopter's mode enum
// stops at 28 (Turtle), so 29 fails enum validation everywhere — the Modes
// dropdown AND the raw parameter editor, since draft validation reads the same
// options.
//
// Detection is by PARAMETER PRESENCE, not by sniffing "-SFD" out of the version
// string: VALT_POS_EXPO (ArduCopter Parameters.cpp, ParametersG2 index 30)
// lives inside the same `#if MODE_VALT_ENABLED` block as the mode itself, so it
// exists on the wire exactly when the mode does. A version-string match would
// break on any rebuild, rename or backport; presence cannot.
//
// Stock firmware never sees a changed enum — the catalog is returned by
// identity — which is what keeps the ArduCopter byte-identical invariant.

/** The fork parameter whose presence proves MODE_VALT_ENABLED was compiled in. */
export const SFD_VALT_DETECTION_PARAM_ID = 'VALT_POS_EXPO'

/** ArduCopter mode number for VALT (mode.h: `VALT = 29`). */
export const SFD_VALT_FLIGHT_MODE_VALUE = 29

/** Label shown for mode 29. Mirrors the fork's full mode name ("VALT Hold"). */
export const SFD_VALT_FLIGHT_MODE_LABEL = 'VALT Hold'

/** The FLTMODEn params whose enum gains VALT when the fork feature is present. */
const FLIGHT_MODE_PARAM_IDS = ['FLTMODE1', 'FLTMODE2', 'FLTMODE3', 'FLTMODE4', 'FLTMODE5', 'FLTMODE6']

/**
 * True when the synced parameter set proves this build has VALT compiled in.
 * Takes the ids rather than the snapshot so it stays free of runtime types.
 */
export function detectSfdValtMode(parameterIds: Iterable<string>): boolean {
  for (const id of parameterIds) {
    if (id === SFD_VALT_DETECTION_PARAM_ID) {
      return true
    }
  }
  return false
}

/**
 * Add VALT (29) to the flight-mode enums when the fork feature is detected.
 *
 * Returns the SAME catalog object when it is not, so stock ArduCopter — and
 * every pre-connect / Unknown path — is untouched by identity.
 */
export function applySfdValtCatalogOverrides<
  T extends { parameters: Record<string, ParameterDefinition> }
>(catalog: T, valtModeAvailable: boolean): T {
  if (!valtModeAvailable) {
    return catalog
  }

  const parameters = { ...catalog.parameters }
  // The detection param itself would otherwise render as a bare number in the
  // parameter list. Copy comes from the fork's @Param block.
  if (!parameters[SFD_VALT_DETECTION_PARAM_ID]) {
    parameters[SFD_VALT_DETECTION_PARAM_ID] = {
      id: SFD_VALT_DETECTION_PARAM_ID,
      label: 'VALT position-authority blend expo',
      description:
        'In VALT (velocity alt hold) this blends position control back in near stick centre and near the stick edges. 0 disables the blend (pure velocity control whenever the stick is off centre). With a positive value the position authority follows a valley in stick deflection: full at centre (altitude hold) and at full deflection, lowest in between. Higher values widen the velocity region.',
      category: 'modes',
      minimum: 0,
      maximum: 8,
      step: 0.5
    }
  }
  for (const id of FLIGHT_MODE_PARAM_IDS) {
    const base = parameters[id]
    if (!base?.options) {
      continue
    }
    // Idempotent: never append a duplicate if the enum already carries VALT.
    if (base.options.some((option) => option.value === SFD_VALT_FLIGHT_MODE_VALUE)) {
      continue
    }
    parameters[id] = {
      ...base,
      options: [...base.options, { value: SFD_VALT_FLIGHT_MODE_VALUE, label: SFD_VALT_FLIGHT_MODE_LABEL }]
    }
  }
  return { ...catalog, parameters }
}
