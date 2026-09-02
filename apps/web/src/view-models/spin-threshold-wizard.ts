// Finding MOT_SPIN_ARM and MOT_SPIN_MIN by measurement instead of guessing.
//
// Both are normalised points in the output range, not PWM:
//
//   MOT_SPIN_ARM  "Point at which the motors start to spin"   range 0.0-0.2
//   MOT_SPIN_MIN  "Point at which the thrust starts"          range 0.0-0.25
//
// (AP_MotorsMulticopter.cpp). Firmware requires ARM < MIN and fails pre-arm with
// "SPIN_ARM > SPIN_MIN" otherwise. The library defaults -- 0.10 and 0.15 -- were
// never measured against any particular build, and where a motor actually breaks
// away is a property of that ESC and that motor. Too low and a motor may not
// start on arming; too high and it lurches.
//
// The measurement is a staircase: drive every motor at a rising output until the
// operator says they are all turning, then add margin. The scale lines up with
// the motor test, whose THROTTLE_PERCENT maps linearly across pwm_min..pwm_max
// (ArduCopter/motor_test.cpp) -- the same normalised range these express -- so a
// step of 0.01 here is 1% there.

/** Where the staircase begins. Below any real ESC's break-away point. */
export const SPIN_WIZARD_START = 0.01

/** One increment, matching the parameters' own @Increment of 0.01. */
export const SPIN_WIZARD_STEP = 0.01

/** Margin above the observed break-away, and again above ARM for MIN. */
export const SPIN_WIZARD_MARGIN = 0.03

/** Firmware's own ceilings (@Range). Refuse to climb past what it accepts. */
export const SPIN_ARM_MAX = 0.2
export const SPIN_MIN_MAX = 0.25

export type SpinWizardStatus = 'idle' | 'stepping' | 'ready' | 'failed'

export interface SpinWizardState {
  status: SpinWizardStatus
  /** Output currently being commanded, normalised 0..1. */
  currentValue: number
  /** Where the operator said every motor was turning. */
  observedValue?: number
  failureReason?: string
}

export function createIdleSpinWizardState(): SpinWizardState {
  return { status: 'idle', currentValue: SPIN_WIZARD_START }
}

export function startSpinWizard(): SpinWizardState {
  return { status: 'stepping', currentValue: SPIN_WIZARD_START }
}

/**
 * The operator says nothing is turning yet: climb one step.
 *
 * Stops at the ARM ceiling rather than walking into values firmware will not
 * take. A build that has not broken away by 0.20 has something else wrong --
 * an unpowered ESC, a wrong protocol, a motor not wired -- and telling the
 * operator that is more use than continuing to ramp.
 */
export function stepSpinWizard(state: SpinWizardState): SpinWizardState {
  if (state.status !== 'stepping') {
    return state
  }

  const next = roundToStep(state.currentValue + SPIN_WIZARD_STEP)
  if (next > SPIN_ARM_MAX) {
    return {
      ...state,
      status: 'failed',
      failureReason: `No motor movement by ${formatSpinValue(SPIN_ARM_MAX)}, which is as high as MOT_SPIN_ARM goes. Check the ESCs are powered, the protocol matches, and every motor lead is connected.`
    }
  }

  return { ...state, currentValue: next }
}

/** The operator confirms every motor is turning at the current value. */
export function confirmSpinWizard(state: SpinWizardState): SpinWizardState {
  if (state.status !== 'stepping') {
    return state
  }

  return { ...state, status: 'ready', observedValue: state.currentValue }
}

export function failSpinWizard(state: SpinWizardState, reason: string): SpinWizardState {
  return { ...state, status: 'failed', failureReason: reason }
}

export interface SpinWizardResult {
  /** Observed break-away plus one margin. */
  spinArm: number
  /** ARM plus another margin, so thrust starts above where motors merely turn. */
  spinMin: number
  /** True when a ceiling clamped a value, so the UI can say so. */
  clamped: boolean
}

/**
 * Turn the observed break-away into the two parameters.
 *
 * Margin is added twice on purpose: once so ARM sits clear of the point where
 * motors only just start, and again so MIN -- where thrust is expected -- sits
 * clear of ARM. That ordering is what firmware requires.
 */
export function deriveSpinThresholds(observedValue: number): SpinWizardResult {
  const rawArm = roundToStep(observedValue + SPIN_WIZARD_MARGIN)
  const rawMin = roundToStep(rawArm + SPIN_WIZARD_MARGIN)
  const spinArm = Math.min(rawArm, SPIN_ARM_MAX)
  const spinMin = Math.min(rawMin, SPIN_MIN_MAX)

  return {
    spinArm,
    spinMin,
    clamped: rawArm > SPIN_ARM_MAX || rawMin > SPIN_MIN_MAX
  }
}

/**
 * Whether a pair the operator has edited is still one firmware will accept.
 * Returns the reason it will not, or undefined when it is fine.
 */
export function describeSpinThresholdProblem(spinArm: number, spinMin: number): string | undefined {
  if (!Number.isFinite(spinArm) || !Number.isFinite(spinMin)) {
    return 'Both values must be numbers between 0 and 1.'
  }
  if (spinArm < 0 || spinArm > SPIN_ARM_MAX) {
    return `MOT_SPIN_ARM must be between 0 and ${formatSpinValue(SPIN_ARM_MAX)}.`
  }
  if (spinMin < 0 || spinMin > SPIN_MIN_MAX) {
    return `MOT_SPIN_MIN must be between 0 and ${formatSpinValue(SPIN_MIN_MAX)}.`
  }
  if (spinArm >= spinMin) {
    // AP_MotorsMulticopter.cpp fails pre-arm with "SPIN_ARM > SPIN_MIN".
    return 'MOT_SPIN_ARM must stay below MOT_SPIN_MIN, or the flight controller will refuse to arm.'
  }
  return undefined
}

/** Two decimals, matching the parameters' increment. */
export function formatSpinValue(value: number): string {
  return value.toFixed(2)
}

/** The commanded output as the motor test expresses it. */
export function spinValueToThrottlePercent(value: number): number {
  return Math.round(value * 100)
}

/** Kill floating-point drift from repeated 0.01 additions. */
function roundToStep(value: number): number {
  return Math.round(value * 100) / 100
}
