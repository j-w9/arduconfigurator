// Pilot stick feel, from ArduPilot's own model of it (copter docs:
// input-shaping.rst, acro-mode.rst, stabilize-mode.rst; source:
// AC_CommandModel, AP_Math/control.cpp input_expo).
//
// Each stick model (ACRO_RP_*, ACRO_Y_*, PILOT_Y_*) is a max rate, an expo and
// a time constant. Stick -> rate is input_expo(); the named values below are
// the @Values the firmware declares for those parameters.

export interface NamedValue {
  value: number
  label: string
}

/** ATC_INPUT_TC and every *_RATE_TC (AC_AttitudeControl / AC_CommandModel @Values). */
export const RESPONSE_TC_CHOICES: readonly NamedValue[] = [
  { value: 0.5, label: 'Very soft' },
  { value: 0.2, label: 'Soft' },
  { value: 0.15, label: 'Medium' },
  { value: 0.1, label: 'Crisp' },
  { value: 0.05, label: 'Very crisp' }
]

/** *_EXPO (AC_CommandModel @Values). */
export const EXPO_CHOICES: readonly NamedValue[] = [
  { value: 0, label: 'Off' },
  { value: 0.1, label: 'Very low' },
  { value: 0.2, label: 'Low' },
  { value: 0.3, label: 'Medium' },
  { value: 0.4, label: 'High' },
  { value: 0.5, label: 'Very high' }
]

/** The named choice a value sits on, if any. */
export function matchingChoice(choices: readonly NamedValue[], value: number | undefined): NamedValue | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return choices.find((choice) => Math.abs(choice.value - value) < 1e-4)
}

/** AP_Math input_expo: stick (-1..1) to a fraction of max rate. */
export function inputExpo(input: number, expo: number): number {
  const x = Math.max(-1, Math.min(1, input))
  if (expo < 0.95) return ((1 - expo) * x) / (1 - expo * Math.abs(x))
  return x
}

/** Stick 0..1 to deg/s, `points` samples. */
export function stickCurve(rateDegS: number, expo: number, points = 41): Array<{ stick: number; rate: number }> {
  return Array.from({ length: points }, (_, index) => {
    const stick = index / (points - 1)
    return { stick, rate: rateDegS * inputExpo(stick, expo) }
  })
}

/**
 * An accel limit in deg/s². 4.7's ATC_ACC_*_MAX are deg/s²; the older
 * ATC_ACCEL_*_MAX are centidegrees/s².
 */
export function accelDegS2(paramId: string, value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined
  return paramId.startsWith('ATC_ACCEL_') ? value / 100 : value
}

/** Time to reach a rate at a constant accel limit, in seconds. */
export function secondsToRate(rateDegS: number | undefined, accel: number | undefined): number | undefined {
  if (rateDegS === undefined || accel === undefined || rateDegS <= 0 || accel <= 0) return undefined
  return rateDegS / accel
}

/**
 * input-shaping.rst: "PILOT_Y_RATE should be set to be approximately 0.5 x
 * ATC_ACC_Y_MAX to ensure that the aircraft can achieve full yaw rate in
 * approximately half a second." True when the yaw rate is well past that.
 */
export function yawRateOutrunsAccel(pilotYawRate: number | undefined, yawAccel: number | undefined): boolean {
  const seconds = secondsToRate(pilotYawRate, yawAccel)
  return seconds !== undefined && seconds > 0.75
}

export function formatSeconds(seconds: number): string {
  return seconds < 1 ? `${seconds.toFixed(2)} s` : `${seconds.toFixed(1)} s`
}

/**
 * Display units for the Pilot cards. Older firmware stores several of these in
 * centi-units (cm, cm/s, centidegrees/s²); they show and edit in metres and
 * degrees, and write back x100. The 4.6+/4.7 SI renames are already in the
 * shown units (scale 1).
 */
export const PILOT_FEEL_DISPLAY: Readonly<Record<string, { unit: string; scale: number }>> = {
  ATC_ACCEL_R_MAX: { unit: 'deg/s²', scale: 100 },
  ATC_ACCEL_P_MAX: { unit: 'deg/s²', scale: 100 },
  ATC_ACCEL_Y_MAX: { unit: 'deg/s²', scale: 100 },
  ATC_ACC_R_MAX: { unit: 'deg/s²', scale: 1 },
  ATC_ACC_P_MAX: { unit: 'deg/s²', scale: 1 },
  ATC_ACC_Y_MAX: { unit: 'deg/s²', scale: 1 },
  PILOT_SPEED_UP: { unit: 'm/s', scale: 100 },
  PILOT_SPEED_DN: { unit: 'm/s', scale: 100 },
  PILOT_SPD_UP: { unit: 'm/s', scale: 1 },
  PILOT_SPD_DN: { unit: 'm/s', scale: 1 },
  PILOT_ACCEL_Z: { unit: 'm/s²', scale: 100 },
  PILOT_ACC_Z: { unit: 'm/s²', scale: 1 },
  PILOT_TKOFF_ALT: { unit: 'm', scale: 100 },
  PILOT_TKO_ALT_M: { unit: 'm', scale: 1 },
  LOIT_SPEED: { unit: 'm/s', scale: 100 },
  LOIT_SPEED_MS: { unit: 'm/s', scale: 1 },
  LOIT_ACC_MAX: { unit: 'm/s²', scale: 100 },
  LOIT_ACC_MAX_M: { unit: 'm/s²', scale: 1 },
  LOIT_BRK_ACCEL: { unit: 'm/s²', scale: 100 },
  LOIT_BRK_ACC_M: { unit: 'm/s²', scale: 1 },
  LOIT_BRK_JERK: { unit: 'm/s³', scale: 100 },
  LOIT_BRK_JRK_M: { unit: 'm/s³', scale: 1 }
}

/** A raw parameter value in display units. */
export function toDisplay(paramId: string, raw: number): number {
  const scale = paramId === 'ANGLE_MAX' ? 100 : PILOT_FEEL_DISPLAY[paramId]?.scale ?? 1
  return Number((raw / scale).toFixed(4))
}

/** Display text back to the raw value text the draft path takes. */
export function fromDisplayText(paramId: string, text: string): string {
  const scale = PILOT_FEEL_DISPLAY[paramId]?.scale ?? 1
  if (scale === 1 || text.trim() === '') return text
  const n = Number(text)
  return Number.isFinite(n) ? String(Math.round(n * scale * 100) / 100) : text
}

/** Values where zero means something other than zero (the params' own descriptions). */
export const ZERO_MEANS: Readonly<Record<string, string>> = {
  PILOT_SPEED_DN: 'Same as climb',
  PILOT_SPD_DN: 'Same as climb',
  PILOT_THR_FILT: 'Off',
  LOIT_ANG_MAX: 'Auto (⅔ of max lean)',
  ACRO_RP_RATE_TC: 'Off',
  ACRO_Y_RATE_TC: 'Off',
  PILOT_Y_RATE_TC: 'Off'
}

/** True when a shown value differs from the firmware default (both in display units). */
export function isChangedFromDefault(current: number | undefined, defaultValue: number | undefined): boolean {
  if (current === undefined || defaultValue === undefined) return false
  return Math.abs(current - defaultValue) > 1e-6 * Math.max(1, Math.abs(defaultValue))
}
