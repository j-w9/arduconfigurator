// Where a vehicle is in the two-flight hover-learning sequence.
//
// Read from the LEARNED VALUES, not from the enable parameters.
//
// MOT_HOVER_LEARN defaults to HOVER_LEARN_AND_SAVE (2) on every ArduCopter
// (AP_MotorsMulticopter.cpp), so "is it 2?" answers "is this a stock copter?"
// rather than "has flight one been flown?" — a vehicle arriving with any
// previous calibration, or none at all, read as already past flight one.
//
// What actually proves a flight happened is the value it left behind:
//   flight 1 -> MOT_THST_HOVER moves off AP_MOTORS_THST_HOVER_DEFAULT (0.35)
//   flight 2 -> some INS*_ACC_VRFB_Z becomes non-zero
//
// Both are saved by the firmware on disarm, which is also why this has to
// survive a reconnect: the operator lands, plugs in, and the card must know
// where they are without having been running while they flew.
//
// A flight can also learn NOTHING and look identical to no flight at all.
// Copter::update_throttle_hover (ArduCopter/Attitude.cpp) returns early in any
// manual-throttle mode -- Stabilize, Acro, SystemID, Turtle -- and in Drift,
// which is exactly where an FPV pilot's first hover happens. That is a real
// field report ("it doesn't seem to be picking up that we ran the first
// hover"), so the mode is named in the instructions and flagged live.

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

/** AP_MOTORS_THST_HOVER_DEFAULT, AP_MotorsMulticopter.h. */
export const MOT_THST_HOVER_DEFAULT = 0.35

/** ACC_ZBIAS_LEARN bits, from ArduCopter/Attitude.cpp. */
export const ACC_ZBIAS_LEARN_SAVE = 1 << 0
export const ACC_ZBIAS_LEARN_USE = 1 << 1

/** MOT_HOVER_LEARN = 2, the firmware default: learn and save. */
export const MOT_HOVER_LEARN_AND_SAVE = 2

/**
 * Modes in which a hover throttle CANNOT be learned, however good the hover.
 * `flightmode->has_manual_throttle()` (ArduCopter/mode.h) plus the explicit
 * Drift exclusion in Copter::update_throttle_hover. Labels as
 * ARDUCOPTER_FLIGHT_MODE_LABELS renders them.
 */
export const HOVER_LEARN_BLIND_MODES: readonly string[] = [
  'Stabilize',
  'Acro',
  'Drift',
  'SystemID',
  'Turtle'
]

export type HoverLearnStage =
  /** MOT_THST_HOVER has not been reported, so nothing can be said yet. */
  | 'unknown'
  /** Nothing learned yet — go fly the first hover. */
  | 'flight-1'
  /** A hover throttle was learned. Was that flight any good? */
  | 'flight-1-review'
  /** Z-bias learning is armed — go fly the second hover. */
  | 'flight-2'
  /** A bias was learned. Was that flight any good? */
  | 'flight-2-review'
  /** Learned and being applied. */
  | 'complete'

export interface HoverLearnState {
  stage: HoverLearnStage
  /** MOT_HOVER_LEARN as reported. 2 is the firmware default. */
  hoverLearn?: number
  /**
   * Flight one will learn nothing unless MOT_HOVER_LEARN is Learn-and-Save.
   * It defaults to 2, but a vehicle someone has turned it off on looks exactly
   * like a fresh one — nothing learned — so the card has to check rather than
   * assume and send the operator up for a flight that records nothing.
   */
  hoverLearnArmed: boolean
  /** Whether the firmware carries the fork's Z-bias learning at all. */
  supported: boolean
  hoverThrottle?: number
  /** Ids of every reported INS*_ACC_VRFB_Z, so a reset can clear them all. */
  biasParamIds: string[]
  biasLearned: boolean
  ekfType?: number
  /**
   * The mode the vehicle is flying RIGHT NOW when that mode can learn no
   * hover throttle at all. Only set while armed: "you are in Stabilize" is
   * meaningless on a bench, where every disarmed copter sits in whatever mode
   * the switch happens to select.
   */
  blindMode?: string
}

function readValue(snapshot: ConfiguratorSnapshot, id: string): number | undefined {
  const parameter = snapshot.parameters.find((entry) => entry.id === id)
  return typeof parameter?.value === 'number' && Number.isFinite(parameter.value) ? parameter.value : undefined
}

export function deriveHoverLearnState(snapshot: ConfiguratorSnapshot): HoverLearnState {
  const zbias = readValue(snapshot, 'ACC_ZBIAS_LEARN')
  const hoverThrottle = readValue(snapshot, 'MOT_THST_HOVER')

  // Whatever the board reports, rather than a guessed instance list: the name
  // differs between the per-instance group and the legacy flat params, and a
  // board with three IMUs has three of them.
  const biasParams = snapshot.parameters.filter((parameter) => /ACC\d?_VRFB_Z$/.test(parameter.id))
  const biasParamIds = biasParams.map((parameter) => parameter.id)
  const biasLearned = biasParams.some(
    (parameter) => typeof parameter.value === 'number' && parameter.value !== 0
  )

  const hoverLearned =
    hoverThrottle !== undefined && Math.abs(hoverThrottle - MOT_THST_HOVER_DEFAULT) > 1e-6
  const zbiasArmed = ((zbias ?? 0) & ACC_ZBIAS_LEARN_SAVE) !== 0
  const zbiasApplied = ((zbias ?? 0) & ACC_ZBIAS_LEARN_USE) !== 0

  const stage: HoverLearnStage = zbiasApplied
    ? 'complete'
    : biasLearned && zbiasArmed
      ? 'flight-2-review'
      : zbiasArmed
        ? 'flight-2'
        : hoverLearned
          ? 'flight-1-review'
          : // An UNREPORTED MOT_THST_HOVER used to read as "still at the
            // default", i.e. as a vehicle that had never flown -- the card sent
            // the operator up for a flight on the strength of a parameter it
            // had never seen. Checked last so a vehicle already past flight one
            // is never dragged back by it.
            hoverThrottle !== undefined
            ? 'flight-1'
            : 'unknown'

  const hoverLearn = readValue(snapshot, 'MOT_HOVER_LEARN')

  return {
    stage,
    hoverLearn,
    hoverLearnArmed: (hoverLearn ?? MOT_HOVER_LEARN_AND_SAVE) >= MOT_HOVER_LEARN_AND_SAVE,
    supported: zbias !== undefined,
    hoverThrottle,
    biasParamIds,
    biasLearned,
    ekfType: readValue(snapshot, 'AHRS_EKF_TYPE'),
    blindMode:
      snapshot.vehicle?.armed && HOVER_LEARN_BLIND_MODES.includes(snapshot.vehicle.flightMode)
        ? snapshot.vehicle.flightMode
        : undefined
  }
}
