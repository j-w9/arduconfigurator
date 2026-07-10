// Per-tab ArduPilot parameter-id groupings, extracted from App.tsx as part of
// its decomposition. These are the pure parameter-id sets each tab pulls,
// reviews, and stages drafts against — no React, no app state. (Tuning and OSD
// have their own larger modules: tuning-params.ts and osd-params.ts.)

export const OUTPUT_REVIEW_PARAM_IDS = ['MOT_PWM_TYPE', 'MOT_PWM_MIN', 'MOT_PWM_MAX', 'MOT_SPIN_ARM', 'MOT_SPIN_MIN', 'MOT_SPIN_MAX'] as const
// QuadPlane lift-motor ESC range — the Q_M_* mirror of the Copter MOT_* set above.
export const QUADPLANE_ESC_PARAM_IDS = ['Q_M_PWM_TYPE', 'Q_M_PWM_MIN', 'Q_M_PWM_MAX', 'Q_M_SPIN_ARM', 'Q_M_SPIN_MIN', 'Q_M_SPIN_MAX'] as const
export const OUTPUT_NOTIFICATION_PARAM_IDS = [
  'NTF_LED_TYPES',
  'NTF_LED_LEN',
  'NTF_LED_BRIGHT',
  'NTF_LED_OVERRIDE',
  'NTF_BUZZ_TYPES',
  'NTF_BUZZ_VOLUME'
] as const
export const GPS_PARAM_IDS = [
  'GPS_TYPE',
  'GPS_TYPE2',
  'GPS_AUTO_CONFIG',
  'GPS_AUTO_SWITCH',
  'GPS_PRIMARY',
  'GPS_RATE_MS'
] as const
export const LOGS_PARAM_IDS = [
  'LOG_BACKEND_TYPE',
  'LOG_BITMASK',
  'LOG_FILE_DSRMROT',
  'LOG_FILE_MB_FREE',
  'LOG_REPLAY',
  'LOG_DISARMED'
] as const
export const VTX_PARAM_IDS = [
  'VTX_ENABLE',
  'VTX_FREQ',
  'VTX_POWER',
  'VTX_MAX_POWER',
  'VTX_OPTIONS',
  'VTX_TYPES'
] as const
// Battery-monitor / capacity / arming knobs only. Every failsafe-shaped
// param (FS_*, BATT_FS_*, BATT_LOW_*, BATT_CRT_*) belongs on the Failsafe
// tab — the operator should have ONE place to think about loss-of-link
// behavior, and the Power tab was duplicating those fields here.
export const POWER_REVIEW_PARAM_IDS = [
  'BATT_MONITOR',
  'BATT_CAPACITY',
  'BATT_ARM_VOLT',
  'BATT_ARM_MAH'
] as const
export const RECEIVER_SUPPORT_PARAM_IDS = ['FLTMODE_CH', 'MODE_CH', 'RSSI_TYPE', 'RSSI_CHANNEL', 'RSSI_CHAN_LOW', 'RSSI_CHAN_HIGH', 'RC_OPTIONS'] as const

// AP_Relay per-instance params (RELAY1_FUNCTION/_PIN/_DEFAULT/_INVERTED ..
// RELAYn_*). Dynamic per-instance, so matched by shape rather than a static
// list — the Relays tab pulls every RELAYx_* the controller reports. RCn_OPTION
// is included so the tab's "RC Channel" control (which binds a relay's aux
// function to an RC switch by writing RCn_OPTION) stages + applies in the same
// scope. RCn_OPTION is also in isReceiverReviewParamId's scope below (the
// Receiver tab's arm-switch control writes it too) — a param can legitimately
// belong to more than one tab's review scope; either Apply button commits it.
export function isRelayParamId(parameterId: string): boolean {
  return /^RELAY\d+_(FUNCTION|PIN|DEFAULT|INVERTED)$/.test(parameterId) || /^RC\d+_OPTION$/.test(parameterId)
}
