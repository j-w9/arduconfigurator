import type { ParameterDefinition, ParameterValueOption } from './types.js'
import {
  ARDUCOPTER_BATTERY_FAILSAFE_ACTION_LABELS,
  ARDUCOPTER_BATTERY_MONITOR_LABELS,
  ARDUCOPTER_FS_GCS_LABELS,
  ARDUCOPTER_THROTTLE_FAILSAFE_LABELS
} from './arducopter-enums.js'
import { OPTICAL_FLOW_TYPE_OPTIONS_4_7 } from './shared-optical-flow.js'

// Local copy of arducopter.ts's (unexported) enumOptions.
function enumOptions(labelMap: Record<number, string>): ParameterValueOption[] {
  return Object.entries(labelMap)
    .map(([value, label]) => ({ value: Number(value), label }))
    .sort((left, right) => left.value - right.value)
}

// ── ArduPilot 4.7 metadata deltas ───────────────────────────────────────────
// The base catalog (arducopter-enums.ts / arducopter.ts) stays at the 4.6
// values so a 4.6 FC — the validated trust anchor — and the pre-connect /
// Unknown default are byte-identical. Everything here is applied ONLY when a
// >= 4.7 build is detected (applyArducopter47Override in @arduconfig/ardupilot-core).

// Four entries were REMOVED from this table: SERVO_DSHOT_RATE, MOT_PWM_TYPE,
// RSSI_TYPE and RSSI_CHAN_LOW/HIGH. They were authored as 4.7 deltas, but
// diffing regenerated apm.pdef.json from tag Copter-4.6.3 against branch
// ArduPilot-4.7 showed all four are IDENTICAL across the two — they were base
// catalog errors, not version differences. Patching them here meant the wrong
// metadata was served to 4.6, the firmware line this repo treats as its
// validated trust anchor, while 4.7 got the right one: exactly backwards from
// what this mechanism is for. They now live in the base and this table is
// correct by subsumption.

// Failsafe-action value 6 gains DO_RETURN_PATH_START; battery value 0 becomes
// "Warn only" (4.6: "None"). Source: ArduCopter/Parameters.cpp,
// AP_BattMonitor_Params.cpp @Values{Copter}.
const FAILSAFE_6_LABEL_4_7 = 'Auto DO_LAND_START/DO_RETURN_PATH_START or RTL'
const THROTTLE_FAILSAFE_LABELS_4_7: Record<number, string> = {
  ...ARDUCOPTER_THROTTLE_FAILSAFE_LABELS,
  6: FAILSAFE_6_LABEL_4_7
}
const FS_GCS_LABELS_4_7: Record<number, string> = {
  ...ARDUCOPTER_FS_GCS_LABELS,
  6: FAILSAFE_6_LABEL_4_7
}
const BATTERY_FAILSAFE_ACTION_LABELS_4_7: Record<number, string> = {
  ...ARDUCOPTER_BATTERY_FAILSAFE_ACTION_LABELS,
  0: 'Warn only',
  6: FAILSAFE_6_LABEL_4_7
}

// BATT_MONITOR gains 30:INA3221, 31:Analog Current Only, 32:TIBQ76952 after 4.6.
// Source: libraries/AP_BattMonitor/AP_BattMonitor_Params.cpp @Values.
const BATTERY_MONITOR_LABELS_4_7: Record<number, string> = {
  ...ARDUCOPTER_BATTERY_MONITOR_LABELS,
  30: 'INA3221',
  31: 'Analog Current Only',
  32: 'TIBQ76952-I2C'
}

/**
 * ArduCopter parameter metadata that changed in the 4.7 release line, keyed by
 * parameter id. Each value is a partial patch (options / range / description)
 * merged OVER the base 4.6 definition, and ONLY when a >= 4.7 firmware build is
 * detected — so 4.6 / pre-connect / Unknown keep the old values (byte-identical).
 */
export const ARDUCOPTER_4_7_PARAMETER_OVERRIDES: Record<string, Partial<ParameterDefinition>> = {
  VTX_POWER: { minimum: 1, maximum: 1000 },
  VTX_MAX_POWER: { minimum: 25, maximum: 1000 },
  FS_THR_ENABLE: { options: enumOptions(THROTTLE_FAILSAFE_LABELS_4_7) },
  FS_GCS_ENABLE: { options: enumOptions(FS_GCS_LABELS_4_7) },
  BATT_FS_LOW_ACT: { options: enumOptions(BATTERY_FAILSAFE_ACTION_LABELS_4_7) },
  BATT_FS_CRT_ACT: { options: enumOptions(BATTERY_FAILSAFE_ACTION_LABELS_4_7) },
  BATT_MONITOR: { maximum: 32, options: enumOptions(BATTERY_MONITOR_LABELS_4_7) },
  // FLOW_TYPE gains 10:SITL after 4.6. Verified by reading
  // libraries/AP_OpticalFlow/AP_OpticalFlow.cpp at BOTH refs: the @Values line
  // ends at `8:UPFLOW` on tag Copter-4.6.3 and at `8:UPFLOW, 10:SITL` on branch
  // origin/ArduPilot-4.7 (AP_OpticalFlow.h `Type::SITL = 10`; 9 is unassigned).
  // Base catalog stays 0..8 so a 4.6 FC — and pre-connect / Unknown — is
  // byte-identical and never offers a value its firmware cannot decode.
  //
  // FLOW_OPTIONS is likewise 4.7-only, but needs no entry here: it is a new
  // PARAMETER, not a changed one, so a 4.6 board simply never reports it and
  // the curated definition never renders.
  FLOW_TYPE: { maximum: 10, options: OPTICAL_FLOW_TYPE_OPTIONS_4_7 }
}
