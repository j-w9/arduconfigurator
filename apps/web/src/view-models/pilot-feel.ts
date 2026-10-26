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
