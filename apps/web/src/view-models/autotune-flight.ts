// Autotune as a flight you come back from, rather than a screen you watch.
//
// Same shape as hover learning, and for the same reason: autotune happens in
// the air and saves on disarm, so the configurator cannot observe it happening.
// What it CAN do is remember the gains before the flight and compare afterwards.
//
// "Did autotune complete?" is answered the way hover learning's "did a flight
// happen?" is answered — by the values left behind, not by a flag. A flag would
// only say what was ASKED for; the gains say what was achieved.
//
// AUTOTUNE_AXES is a bitmask, from AC_AutoTune_Multi.cpp:
//   @Bitmask: 0:Roll,1:Pitch,2:Yaw,3:YawD    default 7 (roll+pitch+yaw)

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

export const AUTOTUNE_AXIS_BITS = {
  ROLL: 1 << 0,
  PITCH: 1 << 1,
  YAW: 1 << 2,
  YAW_D: 1 << 3
} as const

export interface AutotuneAxis {
  bit: number
  label: string
  /** The gains autotune rewrites for this axis. */
  paramIds: string[]
}

export const AUTOTUNE_AXES: AutotuneAxis[] = [
  {
    bit: AUTOTUNE_AXIS_BITS.ROLL,
    label: 'Roll',
    paramIds: ['ATC_RAT_RLL_P', 'ATC_RAT_RLL_I', 'ATC_RAT_RLL_D', 'ATC_ANG_RLL_P']
  },
  {
    bit: AUTOTUNE_AXIS_BITS.PITCH,
    label: 'Pitch',
    paramIds: ['ATC_RAT_PIT_P', 'ATC_RAT_PIT_I', 'ATC_RAT_PIT_D', 'ATC_ANG_PIT_P']
  },
  {
    bit: AUTOTUNE_AXIS_BITS.YAW,
    label: 'Yaw',
    paramIds: ['ATC_RAT_YAW_P', 'ATC_RAT_YAW_I', 'ATC_ANG_YAW_P']
  },
  {
    bit: AUTOTUNE_AXIS_BITS.YAW_D,
    label: 'Yaw D',
    paramIds: ['ATC_RAT_YAW_D']
  }
]

/**
 * Are two gains the same value?
 *
 * MAVLink carries parameters as float32, so a gain the firmware thinks is
 * exactly 0.135 arrives as 0.135000005364418. Comparing that against a float64
 * literal with a tight epsilon reports a difference that does not exist — the
 * zeroize hint claimed seven gains needed resetting on a vehicle where only
 * four did, because three I-terms were "different" purely by float32 rounding.
 *
 * A relative tolerance at float32's precision (~1.2e-7) is what actually
 * answers "is this the same number", and stays right across the range these
 * gains span: 0.0036 and 4.5 are both here.
 */
function sameGain(left: number, right: number): boolean {
  const scale = Math.max(Math.abs(left), Math.abs(right), 1e-6)
  return Math.abs(left - right) <= scale * 1e-6
}

/** A gain fingerprint, taken before a flight so it can be compared after one. */
export type AutotuneGains = Record<string, number>

export function readAutotuneGains(snapshot: ConfiguratorSnapshot, axisMask: number): AutotuneGains {
  const wanted = new Set(
    AUTOTUNE_AXES.filter((axis) => (axisMask & axis.bit) !== 0).flatMap((axis) => axis.paramIds)
  )
  const gains: AutotuneGains = {}
  for (const parameter of snapshot.parameters) {
    if (wanted.has(parameter.id) && typeof parameter.value === 'number') {
      gains[parameter.id] = parameter.value
    }
  }
  return gains
}

export interface AutotuneComparison {
  /** Axes whose gains moved — autotune ran and saved for these. */
  changedAxes: string[]
  /** Axes that were asked for but came back identical. */
  unchangedAxes: string[]
  /** True when every requested axis moved. */
  complete: boolean
}

/**
 * Compare the gains now against the fingerprint taken before the flight.
 *
 * A gain that did not move means autotune did not save that axis — the pilot
 * landed without accepting, the tune failed, or it never ran. Reporting per
 * axis matters because autotune can complete roll and pitch and give up on yaw,
 * and "it didn't work" would be wrong about two thirds of that.
 */
export function compareAutotuneGains(
  before: AutotuneGains,
  snapshot: ConfiguratorSnapshot,
  axisMask: number
): AutotuneComparison {
  const after = readAutotuneGains(snapshot, axisMask)
  const changedAxes: string[] = []
  const unchangedAxes: string[] = []

  for (const axis of AUTOTUNE_AXES) {
    if ((axisMask & axis.bit) === 0) continue
    // An axis counts as tuned when ANY of its gains moved: autotune does not
    // necessarily change every term, and requiring all of them would report a
    // successful tune as a failure.
    const moved = axis.paramIds.some((id) => {
      const wasKnown = before[id] !== undefined
      const isKnown = after[id] !== undefined
      if (!wasKnown || !isKnown) return false
      return !sameGain(before[id], after[id])
    })
    if (moved) {
      changedAxes.push(axis.label)
    } else {
      unchangedAxes.push(axis.label)
    }
  }

  return {
    changedAxes,
    unchangedAxes,
    complete: unchangedAxes.length === 0 && changedAxes.length > 0
  }
}

/**
 * ArduCopter's own gain defaults, for putting a tune back to stock.
 *
 * From AC_AttitudeControl_Multi.h (AC_ATC_MULTI_RATE_RP_P/I/D,
 * AC_ATC_MULTI_RATE_YAW_P/I/D) and AC_AttitudeControl.h
 * (AC_ATTITUDE_CONTROL_ANGLE_P = 4.5 for roll, pitch and yaw).
 *
 * Multirotor values. A heli or a Sub has its own set, which is why the card
 * that uses these is Copter-only — writing multi defaults onto a heli would be
 * worse than leaving a bad tune in place.
 */
export const AUTOTUNE_GAIN_DEFAULTS: Readonly<Record<string, number>> = {
  ATC_RAT_RLL_P: 0.135,
  ATC_RAT_RLL_I: 0.135,
  ATC_RAT_RLL_D: 0.0036,
  ATC_ANG_RLL_P: 4.5,
  ATC_RAT_PIT_P: 0.135,
  ATC_RAT_PIT_I: 0.135,
  ATC_RAT_PIT_D: 0.0036,
  ATC_ANG_PIT_P: 4.5,
  ATC_RAT_YAW_P: 0.18,
  ATC_RAT_YAW_I: 0.018,
  ATC_RAT_YAW_D: 0,
  ATC_ANG_YAW_P: 4.5
}

/**
 * The gains that would actually change if the selected axes went back to stock.
 *
 * Returns only what DIFFERS, so an axis already at defaults stages nothing and
 * the operator can see the size of what they are about to undo.
 */
export function autotuneGainsToReset(
  snapshot: ConfiguratorSnapshot,
  axisMask: number
): { id: string; from: number; to: number }[] {
  const current = readAutotuneGains(snapshot, axisMask)
  const reset: { id: string; from: number; to: number }[] = []
  for (const axis of AUTOTUNE_AXES) {
    if ((axisMask & axis.bit) === 0) continue
    for (const id of axis.paramIds) {
      const to = AUTOTUNE_GAIN_DEFAULTS[id]
      const from = current[id]
      if (to === undefined || from === undefined) continue
      if (!sameGain(from, to)) {
        reset.push({ id, from, to })
      }
    }
  }
  return reset
}

export function describeAxisMask(mask: number): string {
  const labels = AUTOTUNE_AXES.filter((axis) => (mask & axis.bit) !== 0).map((axis) => axis.label)
  return labels.length > 0 ? labels.join(', ') : 'none'
}
