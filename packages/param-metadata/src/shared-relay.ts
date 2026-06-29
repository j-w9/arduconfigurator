// Shared relay (RELAY1_/…/RELAYn_) parameter family. AP_Relay exposes an
// identical per-instance parameter set across Copter/Plane/Rover/Sub/Blimp, so
// the definitions are generated once here and spread into each vehicle bundle.
// Values/ranges verified against libraries/AP_Relay/AP_Relay_Params.cpp (the
// FUNCTION/DEFAULT/INVERTED @Values and the PIN @Range) — see RELAY_*_OPTIONS
// below for the verbatim source mapping.

import type { FirmwareMetadataBundle, ParameterValueOption } from './types.js'

// Number of relay instances. AP_RELAY_NUM_RELAYS defaults to 6
// (libraries/AP_Relay/AP_Relay.h), so RELAY1_*..RELAY6_* ship by default.
export const RELAY_INSTANCE_COUNT = 6

// RELAYx_FUNCTION @Values — copied verbatim from AP_Relay_Params.cpp. The list
// is a union across vehicles (the source tags each value with the vehicles it
// applies to); we curate the whole set so any reported value renders with a
// label rather than a raw number. Values 10-25 are AP_Periph DroneCAN
// Hardpoint IDs. Gaps are preserved exactly — never renumbered.
const RELAY_FUNCTION_OPTIONS: ParameterValueOption[] = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Relay' },
  { value: 2, label: 'Ignition' },
  { value: 3, label: 'Parachute' },
  { value: 4, label: 'Camera' },
  { value: 5, label: 'Brushed motor reverse 1 (throttle / throttle-left / omni motor 1)' },
  { value: 6, label: 'Brushed motor reverse 2 (throttle-right / omni motor 2)' },
  { value: 7, label: 'Brushed motor reverse 3 (omni motor 3)' },
  { value: 8, label: 'Brushed motor reverse 4 (omni motor 4)' },
  { value: 9, label: 'ICE Starter' },
  { value: 10, label: 'DroneCAN Hardpoint ID 0' },
  { value: 11, label: 'DroneCAN Hardpoint ID 1' },
  { value: 12, label: 'DroneCAN Hardpoint ID 2' },
  { value: 13, label: 'DroneCAN Hardpoint ID 3' },
  { value: 14, label: 'DroneCAN Hardpoint ID 4' },
  { value: 15, label: 'DroneCAN Hardpoint ID 5' },
  { value: 16, label: 'DroneCAN Hardpoint ID 6' },
  { value: 17, label: 'DroneCAN Hardpoint ID 7' },
  { value: 18, label: 'DroneCAN Hardpoint ID 8' },
  { value: 19, label: 'DroneCAN Hardpoint ID 9' },
  { value: 20, label: 'DroneCAN Hardpoint ID 10' },
  { value: 21, label: 'DroneCAN Hardpoint ID 11' },
  { value: 22, label: 'DroneCAN Hardpoint ID 12' },
  { value: 23, label: 'DroneCAN Hardpoint ID 13' },
  { value: 24, label: 'DroneCAN Hardpoint ID 14' },
  { value: 25, label: 'DroneCAN Hardpoint ID 15' }
]

// RELAYx_DEFAULT @Values — applies only to the "Relay" (1) function; other
// functions pick their default from the controlling feature's parameters.
const RELAY_DEFAULT_OPTIONS: ParameterValueOption[] = [
  { value: 0, label: 'Off' },
  { value: 1, label: 'On' },
  { value: 2, label: 'NoChange' }
]

// RELAYx_INVERTED @Values — whether the output signal is inverted.
const RELAY_INVERTED_OPTIONS: ParameterValueOption[] = [
  { value: 0, label: 'Normal' },
  { value: 1, label: 'Inverted' }
]

/**
 * Builds the RELAY{instance}_* parameter family (category `relays`). The set is
 * identical for every instance; each instance's labels are suffixed with the
 * instance number so the relays stay distinguishable in the shared Relays
 * section. FUNCTION/DEFAULT/INVERTED are enums; PIN is the digital GPIO number
 * (numeric field; -1 disables the relay).
 */
export function buildRelayParameterDefinitions(instance: number): FirmwareMetadataBundle['parameters'] {
  const p = `RELAY${instance}_`
  const n = ` ${instance}`
  const which = `relay ${instance}`
  return {
    [`${p}FUNCTION`]: {
      id: `${p}FUNCTION`,
      label: `Relay${n} Function`,
      description: `The function ${which} is mapped to. "Relay" is a plain GPIO output you control directly; the other functions are driven by their owning feature (parachute, camera, ICE, etc.).`,
      category: 'relays',
      options: RELAY_FUNCTION_OPTIONS
    },
    [`${p}PIN`]: {
      id: `${p}PIN`,
      label: `Relay${n} Pin`,
      description: `Digital GPIO pin number for ${which}. Set to -1 to disable. See the autopilot's "GPIOs" wiki page for the pin numbers (AUXOUT pins are typically 50+).`,
      category: 'relays',
      minimum: -1,
      maximum: 1015,
      step: 1
    },
    [`${p}DEFAULT`]: {
      id: `${p}DEFAULT`,
      label: `Relay${n} Default State`,
      description: `Power-on state for ${which}. Only applies to the "Relay" function; if INVERTED is set the default is inverted too.`,
      category: 'relays',
      options: RELAY_DEFAULT_OPTIONS,
      visibleWhen: { paramId: `${p}FUNCTION`, in: [1] }
    },
    [`${p}INVERTED`]: {
      id: `${p}INVERTED`,
      label: `Relay${n} Inverted`,
      description: `Invert the output signal for ${which}. When inverted, relay-on drives the pin low and relay-off drives it high. Note this also affects DEFAULT.`,
      category: 'relays',
      options: RELAY_INVERTED_OPTIONS
    }
  }
}
