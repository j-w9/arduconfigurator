import type { ParameterDefinition, ParameterValueOption } from './types.js'
import {
  ARDUCOPTER_BATTERY_FAILSAFE_ACTION_LABELS,
  ARDUCOPTER_FS_GCS_LABELS,
  ARDUCOPTER_MOT_PWM_TYPE_LABELS,
  ARDUCOPTER_RSSI_TYPE_LABELS,
  ARDUCOPTER_THROTTLE_FAILSAFE_LABELS
} from './arducopter-enums.js'

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

// SERVO_DSHOT_RATE (SRV_Channels.cpp): 0 is a FIXED 1 kHz rate; 1..4 are
// multiples of the main loop rate. (The 4.6 catalog carries an off-by-one
// 1x..8x map with 3 phantom values — kept as-is for 4.6.)
const DSHOT_RATE_LABELS_4_7: Record<number, string> = {
  0: '1 kHz (fixed)',
  1: 'Loop rate',
  2: '2× loop rate',
  3: '3× loop rate',
  4: '4× loop rate'
}

// MOT_PWM_TYPE gains 9:PWMAngle; RSSI_TYPE gains 5:TelemetryRadioRSSI.
const MOT_PWM_TYPE_LABELS_4_7: Record<number, string> = {
  ...ARDUCOPTER_MOT_PWM_TYPE_LABELS,
  9: 'PWMAngle'
}
const RSSI_TYPE_LABELS_4_7: Record<number, string> = {
  ...ARDUCOPTER_RSSI_TYPE_LABELS,
  5: 'Telemetry Radio RSSI'
}

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

/**
 * ArduCopter parameter metadata that changed in the 4.7 release line, keyed by
 * parameter id. Each value is a partial patch (options / range / description)
 * merged OVER the base 4.6 definition, and ONLY when a >= 4.7 firmware build is
 * detected — so 4.6 / pre-connect / Unknown keep the old values (byte-identical).
 */
export const ARDUCOPTER_4_7_PARAMETER_OVERRIDES: Record<string, Partial<ParameterDefinition>> = {
  SERVO_DSHOT_RATE: {
    maximum: 4,
    description:
      'How often DShot ESC frames are sent. 0 fixes the rate at 1 kHz (for low loop rates); 1–4 are multiples of the main loop rate. Higher rates need a capable FC + ESC.',
    options: enumOptions(DSHOT_RATE_LABELS_4_7)
  },
  MOT_PWM_TYPE: { maximum: 9, options: enumOptions(MOT_PWM_TYPE_LABELS_4_7) },
  RSSI_TYPE: { maximum: 5, options: enumOptions(RSSI_TYPE_LABELS_4_7) },
  RSSI_CHAN_LOW: { minimum: 0, maximum: 2000 },
  RSSI_CHAN_HIGH: { minimum: 0, maximum: 2000 },
  VTX_POWER: { minimum: 1, maximum: 1000 },
  VTX_MAX_POWER: { minimum: 25, maximum: 1000 },
  FS_THR_ENABLE: { options: enumOptions(THROTTLE_FAILSAFE_LABELS_4_7) },
  FS_GCS_ENABLE: { options: enumOptions(FS_GCS_LABELS_4_7) },
  BATT_FS_LOW_ACT: { options: enumOptions(BATTERY_FAILSAFE_ACTION_LABELS_4_7) },
  BATT_FS_CRT_ACT: { options: enumOptions(BATTERY_FAILSAFE_ACTION_LABELS_4_7) }
}
