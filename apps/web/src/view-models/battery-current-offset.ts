// Calibrating the current sensor's zero point.
//
// BATT_AMP_OFFSET is the sensor voltage at zero amps, and the sensor reads
//
//   amps = (sensor_voltage - BATT_AMP_OFFSET) * BATT_AMP_PERVLT
//
// so shifting the offset shifts every current reading by a constant.
//
// This replaces an earlier "zero offset now" button that assumed the true
// current was zero and therefore had to REFUSE whenever a pack was connected —
// otherwise it baked the aircraft's idle draw into the definition of zero.
// That refusal was the wrong shape: an operator with a clamp meter knows the
// true current even when it is not zero, and 0.4 A on the bench is a perfectly
// good calibration point.
//
// So the operator states what their meter reads. Zero is just the common case
// (pack off, board on USB), not a requirement — which removes the need to
// guess from voltage whether a pack is attached.

export interface CurrentOffsetInputs {
  /** BATT_AMP_OFFSET now, in volts. */
  offsetV?: number
  /** BATT_AMP_PERVLT now, in amps per volt. Must be > 0 to be invertible. */
  perVolt?: number
  /** What the vehicle is reporting right now, in amps. */
  reportedA?: number
  /**
   * What the operator's meter actually reads, in amps.
   *
   * Zero when the pack is off and the board is on USB. Non-zero is equally
   * valid — it is the whole point of taking a reading.
   */
  actualA: number
}

export type CurrentOffsetResult =
  | { ok: true; offsetV: number; shiftA: number }
  | { ok: false; reason: string }

/**
 * The offset that would make the vehicle report `actualA`.
 *
 * From amps = (v - offset) * perVolt, holding the sensor voltage fixed:
 *   reported - actual = (offset' - offset) * perVolt
 *   offset' = offset + (reported - actual) / perVolt
 *
 * With actual = 0 this reduces to the old zeroing behaviour exactly, which is
 * what makes this a generalisation rather than a replacement.
 */
export function computeCurrentOffset(input: CurrentOffsetInputs): CurrentOffsetResult {
  const { offsetV, perVolt, reportedA, actualA } = input

  if (offsetV === undefined || perVolt === undefined || reportedA === undefined) {
    return { ok: false, reason: 'Waiting for live battery telemetry and the current calibration parameters.' }
  }
  if (!Number.isFinite(perVolt) || perVolt <= 0) {
    // Dividing by this is what converts an amp error into a volt shift; a zero
    // or negative per-volt makes the sensor model meaningless rather than just
    // imprecise.
    return { ok: false, reason: 'BATT_AMP_PERVLT must be greater than zero before the offset can be calibrated.' }
  }
  if (!Number.isFinite(actualA) || actualA < 0) {
    return { ok: false, reason: 'Enter the current your meter reads (0 A if the pack is disconnected).' }
  }

  const shiftA = reportedA - actualA
  return { ok: true, offsetV: offsetV + shiftA / perVolt, shiftA }
}

/**
 * Fit BATT_AMP_PERVLT from one operating point.
 *
 * `reportedA` is deliberately a CAPTURED value, not a live one. The reading is
 * taken while the motors are spinning, and the operator types their meter
 * value afterwards — by which time the live current has fallen back to idle
 * and the ratio would be nonsense. Reading it live is what made the Apply
 * button go dead unless the field was re-edited during the spin.
 */
export function computeCurrentPerVolt(input: {
  perVolt?: number
  reportedA?: number
  measuredA: number
}): { ok: true; perVolt: number } | { ok: false; reason: string } {
  const { perVolt, reportedA, measuredA } = input
  if (perVolt === undefined || !Number.isFinite(perVolt) || perVolt <= 0) {
    return { ok: false, reason: 'BATT_AMP_PERVLT must be greater than zero before it can be scaled.' }
  }
  if (reportedA === undefined || !Number.isFinite(reportedA) || reportedA <= 0) {
    return { ok: false, reason: 'Run the load step first — there is no reported current to scale against.' }
  }
  if (!Number.isFinite(measuredA) || measuredA <= 0) {
    return { ok: false, reason: 'Enter the current your meter read during the load.' }
  }
  return { ok: true, perVolt: perVolt * (measuredA / reportedA) }
}
