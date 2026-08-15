// Where an output actually sits, relative to where it is allowed to go.
//
// The number on its own answers "is this output moving". Placing it inside the
// configured SERVOn_MIN..MAX range answers the more useful question — "is it
// moving as far as it should" — which is what separates a servo that is not
// being driven from one being driven into its own end stop, and neither of
// those looks wrong in the parameter table.
//
// Pure: live PWM + the range parameters in, a display model out.

export interface ServoLiveOutput {
  /** Live PWM in microseconds, or undefined when the output is not reported. */
  pwm?: number
  /**
   * Position within MIN..MAX as 0..1, for a bar. undefined when the range is
   * unknown or degenerate — a bar drawn from a guessed range is worse than no
   * bar, because it looks authoritative.
   */
  fraction?: number
  /**
   * True when the vehicle reports this output as 0.
   *
   * Zero is NOT a low PWM value; it is the firmware saying nothing is driving
   * this channel. Rendering it as "0 µs, hard against the minimum" would send
   * someone hunting a range problem that does not exist.
   */
  undriven: boolean
  /** At or beyond a configured limit — worth flagging while troubleshooting. */
  atLimit: boolean
}

export interface ServoLiveOutputInputs {
  pwm?: number
  min?: number
  max?: number
}

export function buildServoLiveOutput(inputs: ServoLiveOutputInputs): ServoLiveOutput {
  const { pwm, min, max } = inputs

  if (pwm === undefined || !Number.isFinite(pwm)) {
    return { undriven: false, atLimit: false }
  }
  if (pwm === 0) {
    return { pwm: 0, undriven: true, atLimit: false }
  }

  const hasRange =
    min !== undefined &&
    max !== undefined &&
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    max > min

  if (!hasRange) {
    return { pwm, undriven: false, atLimit: false }
  }

  const clamped = Math.min(Math.max(pwm, min), max)
  return {
    pwm,
    fraction: (clamped - min) / (max - min),
    undriven: false,
    // `<=` / `>=` rather than `===`: a vehicle can drive slightly outside the
    // configured range, and that is exactly the case worth flagging rather
    // than clamping quietly out of sight.
    atLimit: pwm <= min || pwm >= max
  }
}

/**
 * Live PWM for a 1-based output number, from the runtime's 0-based array.
 *
 * Off-the-end reads return undefined rather than 0, because "this board does
 * not report that output" and "that output is not being driven" are different
 * answers and only one of them is a fault.
 */
export function livePwmForOutput(pwm: readonly number[], outputNumber: number): number | undefined {
  if (outputNumber < 1) return undefined
  return pwm[outputNumber - 1]
}
