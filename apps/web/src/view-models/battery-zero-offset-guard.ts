// Whether the current-sensor zero offset may be taken right now.
//
// BATT_AMP_OFFSET is the sensor voltage at ZERO amps. Taking the sample with a
// flight pack connected bakes whatever the aircraft is already drawing — FC,
// VTX, receiver, LEDs — into the definition of "zero", so every later current
// reading is low by that amount, and the battery failsafe and consumed-mAh
// budget are wrong in the direction that strands you.
//
// The offset is meant to be taken on USB power alone, with no pack on the
// aircraft.

/** Sense-line volts above which a flight pack is certainly attached. */
const PACK_PRESENT_VOLTS = 4.5
/**
 * Amps above which something is clearly drawing from the pack.
 *
 * Deliberately small: a bare FC on USB reads a hair above zero from sensor
 * noise, while even an idle aircraft on a pack draws hundreds of milliamps.
 */
const DRAWING_CURRENT_AMPS = 0.35

export interface BatteryZeroOffsetInputs {
  /** Live battery telemetry, when the vehicle is actually reporting it. */
  voltageV?: number
  currentA?: number
  /** False when no battery monitor is configured or nothing has arrived yet. */
  telemetryVerified: boolean
}

export type BatteryZeroOffsetVerdict =
  | { allowed: true }
  | { allowed: false; reason: string }

export function canZeroCurrentOffset(input: BatteryZeroOffsetInputs): BatteryZeroOffsetVerdict {
  if (!input.telemetryVerified) {
    // Without live telemetry there is nothing to zero against, and no way to
    // tell whether a pack is attached — refusing is the safe reading.
    return { allowed: false, reason: 'Waiting for live battery telemetry before the offset can be zeroed.' }
  }

  if (input.voltageV !== undefined && input.voltageV >= PACK_PRESENT_VOLTS) {
    return {
      allowed: false,
      reason:
        `A flight pack appears to be connected (${input.voltageV.toFixed(1)} V). The zero offset defines what ` +
        'no current looks like, so taking it now would record the aircraft’s idle draw as zero and make every ' +
        'later current reading low. Disconnect the pack, leave the board on USB, then zero the offset.'
    }
  }

  if (input.currentA !== undefined && input.currentA >= DRAWING_CURRENT_AMPS) {
    // Voltage can read low on an oddly-divided sense line, so a real draw is a
    // second, independent reason to refuse.
    return {
      allowed: false,
      reason:
        `The sensor is reporting ${input.currentA.toFixed(2)} A, so something is drawing current. Zero the ` +
        'offset with the pack disconnected and the board on USB.'
    }
  }

  return { allowed: true }
}
