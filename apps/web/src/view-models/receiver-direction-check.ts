// Pure stick-direction detector for the receiver direction check. The operator
// is asked to move each axis in a NAMED direction (roll right, pitch up, throttle
// up, yaw right); we read the live channel and decide whether ArduPilot will
// interpret that movement correctly, or whether the channel needs RCn_REVERSED.
//
// Convention verified against ~/ardupilot:
//   - RCMAP defaults roll=1 pitch=2 throttle=3 yaw=4 (we use the live channel map,
//     so this stays correct even when RCMAP is customised).
//   - RC_Channel norm_input sign = (reversed ? -1 : 1) * sign(pwm - trim).
//   - Copter mode.cpp lean/velocity mapping: roll-right, pitch-back(up), and
//     yaw-right all want a POSITIVE norm_input; throttle-up wants MORE throttle.
// Roll/pitch/yaw rest at centre (trim), so a single sample vs trim tells us the
// direction. THROTTLE rests at an END of travel, so there is no fixed reference
// that separates "resting" from "moved" — instead we capture the resting pwm as
// a baseline and measure the RESPONSE to the up-push relative to it. That is
// correct regardless of the radio's wire polarity (a reversed throttle rests
// HIGH, so its up-push drops the pwm; the delta sign + RCn_REVERSED still give
// the right verdict). A fixed mid-range reference used to read a resting (low)
// throttle as a deliberate DOWN movement and falsely report it "reversed",
// steering the operator toward a flyaway-hazard RC3_REVERSED write.
// This is also why most Mode-2 transmitters need RC2_REVERSED=1: stick-back
// reads low on the wire, and the reverse flips it to the positive norm.

import type { RcAxisId } from '@arduconfig/ardupilot-core'

export type RcDirectionResult = 'idle' | 'correct' | 'reversed'

// How far (µs) a stick must move from its reference before we trust the reading,
// so centred jitter never registers as a movement.
export const RC_DIRECTION_MOVE_THRESHOLD_US = 150

export interface RcDirectionAxisInput {
  axisId: RcAxisId
  /** Live channel PWM, or undefined when this channel has no RC telemetry. */
  pwm: number | undefined
  /** Calibrated trim/centre (RCn_TRIM) — the reference for the centred axes. */
  trim: number
  /** Calibrated min (RCn_MIN). */
  min: number
  /** Calibrated max (RCn_MAX). */
  max: number
  /** Current RCn_REVERSED state. */
  reversed: boolean
  /**
   * Resting pwm captured while the axis was at rest — the reference for THROTTLE
   * (which rests at an end of travel, not centre). Ignored for the centred axes,
   * which reference trim. When absent for throttle we can't distinguish rest from
   * a reversed-radio push, so the throttle verdict stays `idle`.
   */
  restReference?: number
}

/** Operator-facing prompt copy per axis (the named positive direction). */
export const RC_DIRECTION_PROMPTS: Record<RcAxisId, { prompt: string; movement: string }> = {
  roll: { prompt: 'Roll right', movement: 'Move the roll stick to the right' },
  pitch: { prompt: 'Pitch up', movement: 'Pull the pitch stick back (pitch up)' },
  throttle: { prompt: 'Throttle up', movement: 'Push the throttle stick up' },
  yaw: { prompt: 'Yaw right', movement: 'Move the yaw stick to the right' }
}

/**
 * Decide, from a single live sample, whether the named-direction movement reads
 * correctly: `idle` until the stick clearly leaves its reference, then `correct`
 * or `reversed`. Reversal-aware, so the verdict reflects what ArduPilot will
 * actually do with the current RCn_REVERSED setting.
 */
export function evaluateRcDirection(input: RcDirectionAxisInput): RcDirectionResult {
  if (input.pwm === undefined) {
    return 'idle'
  }
  let reference: number
  if (input.axisId === 'throttle') {
    // No baseline yet ⇒ we can't tell a resting stick from a reversed-radio push,
    // so report nothing rather than a dangerous false "reversed".
    if (input.restReference === undefined) {
      return 'idle'
    }
    reference = input.restReference
  } else {
    reference = input.trim
  }
  const delta = input.pwm - reference
  if (Math.abs(delta) < RC_DIRECTION_MOVE_THRESHOLD_US) {
    return 'idle'
  }
  const rawSign = delta > 0 ? 1 : -1
  const normSign = input.reversed ? -rawSign : rawSign
  return normSign > 0 ? 'correct' : 'reversed'
}

/**
 * Fold a fresh sample into the latched per-axis result so the verdict survives
 * the operator releasing the stick back to centre. Once an axis reads `correct`
 * or `reversed` it stays there until reset; a later `reversed`/`correct` (e.g.
 * after toggling the reverse) supersedes it, but momentary `idle` does not.
 */
export function latchRcDirection(previous: RcDirectionResult, sample: RcDirectionResult): RcDirectionResult {
  return sample === 'idle' ? previous : sample
}
