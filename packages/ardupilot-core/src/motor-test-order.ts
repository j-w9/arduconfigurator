// DO_MOTOR_TEST motor-number → frame-test-order translation.
//
// Conformance finding (upstream-conformance audit, P1): ArduCopter's
// GCS_MAVLINK_Copter::handle_MAV_CMD_DO_MOTOR_TEST forwards only
// param1..param5 — the param6 "test order" field is IGNORED, so
// MOTOR_TEST_ORDER.BOARD never did anything. The FC matches param1
// against each motor's TESTING ORDER from the AP_MotorsMatrix MotorDef
// tables (`_test_order[i] == motor_seq`), NOT the MOT_n motor number.
// On QUAD_X the test orders are M1:1, M2:3, M3:4, M4:2 — so sending the
// motor number spun the wrong physical motor for 3 of 4 requests.
//
// Empirically validated on real ArduCopter SITL (2026-06-10):
//   QUAD_X    seq→motor observed {1:M1, 2:M4, 3:M2, 4:M3}
//   QUAD_PLUS seq→motor observed {1:M3, 2:M1, 3:M4, 4:M2}
// — both exactly matching the MotorDef tables transcribed below.
//
// Tables transcribed verbatim from ArduPilot
// libraries/AP_Motors/AP_MotorsMatrix.cpp setup_*_matrix(): the MotorDef
// array POSITION is the motor number (add_motors registers them as
// MOT_1..MOT_n in array order) and the last field is the testing order.
// Arrays below are indexed by (motorNumber - 1) and hold that motor's
// testing order — i.e. the param1 value DO_MOTOR_TEST needs.

/** AP_Motors_Class.h motor_frame_class values used as FRAME_CLASS. */
const FRAME_CLASS_QUAD = 1
const FRAME_CLASS_HEXA = 2
const FRAME_CLASS_OCTA = 3
const FRAME_CLASS_OCTAQUAD = 4
const FRAME_CLASS_Y6 = 5
const FRAME_CLASS_DODECAHEXA = 12
const FRAME_CLASS_DECA = 14

/** AP_Motors_Class.h motor_frame_type values used as FRAME_TYPE. */
const TYPE_PLUS = 0
const TYPE_X = 1
const TYPE_V = 2
const TYPE_H = 3
const TYPE_Y6B = 10
const TYPE_Y6F = 11
const TYPE_BF_X = 12
const TYPE_DJI_X = 13
const TYPE_CW_X = 14
const TYPE_I = 15
const TYPE_NYT_PLUS = 16
const TYPE_NYT_X = 17
const TYPE_BF_X_REV = 18
const TYPE_X_COR = 20

const IDENTITY_6 = [1, 2, 3, 4, 5, 6]
const IDENTITY_8 = [1, 2, 3, 4, 5, 6, 7, 8]
const IDENTITY_10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const IDENTITY_12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

/** motorNumber-1 → testing order, per FRAME_CLASS then FRAME_TYPE. */
const TEST_ORDER_TABLES: Record<number, Record<number, readonly number[]>> = {
  [FRAME_CLASS_QUAD]: {
    [TYPE_PLUS]: [2, 4, 1, 3],
    [TYPE_X]: [1, 3, 4, 2],
    [TYPE_V]: [1, 3, 4, 2],
    [TYPE_H]: [1, 3, 4, 2],
    [TYPE_BF_X]: [2, 1, 3, 4],
    [TYPE_DJI_X]: [1, 4, 3, 2],
    [TYPE_CW_X]: [1, 2, 3, 4],
    [TYPE_NYT_PLUS]: [2, 4, 1, 3],
    [TYPE_NYT_X]: [1, 3, 4, 2],
    [TYPE_BF_X_REV]: [2, 1, 3, 4]
  },
  [FRAME_CLASS_HEXA]: {
    [TYPE_PLUS]: [1, 4, 5, 2, 6, 3],
    [TYPE_X]: [2, 5, 6, 3, 1, 4],
    [TYPE_H]: [2, 5, 6, 3, 1, 4],
    [TYPE_DJI_X]: [1, 6, 5, 4, 3, 2],
    [TYPE_CW_X]: IDENTITY_6
  },
  [FRAME_CLASS_OCTA]: {
    [TYPE_PLUS]: [1, 5, 2, 4, 8, 6, 7, 3],
    [TYPE_X]: [1, 5, 2, 4, 8, 6, 7, 3],
    [TYPE_V]: [7, 3, 6, 4, 8, 2, 1, 5],
    [TYPE_H]: [1, 5, 2, 4, 8, 6, 7, 3],
    [TYPE_I]: [5, 1, 6, 8, 4, 2, 3, 7],
    [TYPE_DJI_X]: [1, 8, 7, 6, 5, 4, 3, 2],
    [TYPE_CW_X]: IDENTITY_8
  },
  [FRAME_CLASS_OCTAQUAD]: {
    [TYPE_PLUS]: [1, 7, 5, 3, 8, 2, 4, 6],
    [TYPE_X]: [1, 7, 5, 3, 8, 2, 4, 6],
    [TYPE_V]: [1, 7, 5, 3, 8, 2, 4, 6],
    [TYPE_H]: [1, 7, 5, 3, 8, 2, 4, 6],
    [TYPE_BF_X]: [3, 1, 5, 7, 4, 2, 6, 8],
    [TYPE_BF_X_REV]: [3, 1, 5, 7, 4, 2, 6, 8],
    [TYPE_CW_X]: IDENTITY_8,
    [TYPE_X_COR]: [1, 7, 5, 3, 8, 2, 4, 6]
  },
  [FRAME_CLASS_Y6]: {
    // setup_y6_matrix: Y6B and Y6F have explicit tables; EVERY other
    // frame type (including PLUS/X defaults) falls to the legacy Y6
    // layout in its `default:` arm.
    [TYPE_Y6B]: IDENTITY_6,
    [TYPE_Y6F]: [3, 1, 5, 4, 2, 6]
  },
  [FRAME_CLASS_DODECAHEXA]: {
    [TYPE_PLUS]: IDENTITY_12,
    [TYPE_X]: IDENTITY_12
  },
  [FRAME_CLASS_DECA]: {
    [TYPE_PLUS]: IDENTITY_10,
    [TYPE_X]: IDENTITY_10,
    [TYPE_CW_X]: IDENTITY_10
  }
}

/** Y6 legacy layout — setup_y6_matrix `default:` arm (covers PLUS/X/...). */
const Y6_DEFAULT_TEST_ORDER = [2, 5, 6, 4, 1, 3] as const

export interface MotorTestSequenceResult {
  /** The DO_MOTOR_TEST param1 value that spins `motorNumber` on this frame. */
  sequence: number
  /**
   * True when the frame's MotorDef table was found and applied. False =
   * unknown frame class/type — the motor number is passed through
   * unchanged (the pre-fix behaviour) and the caller should surface
   * that motor identity is unverified for this frame.
   */
  mapped: boolean
}

/**
 * Translate an ArduCopter MOT_n motor number into the DO_MOTOR_TEST
 * param1 sequence (the frame's testing order) for the given
 * FRAME_CLASS / FRAME_TYPE. Unknown frames fall back to the raw motor
 * number — identical bytes to the pre-fix behaviour — with mapped:false.
 */
export function motorTestSequenceForMotor(
  frameClass: number | undefined,
  frameType: number | undefined,
  motorNumber: number
): MotorTestSequenceResult {
  if (
    frameClass === undefined ||
    frameType === undefined ||
    !Number.isInteger(motorNumber) ||
    motorNumber < 1
  ) {
    return { sequence: motorNumber, mapped: false }
  }

  const classTables = TEST_ORDER_TABLES[Math.round(frameClass)]
  let table = classTables?.[Math.round(frameType)]
  if (table === undefined && Math.round(frameClass) === FRAME_CLASS_Y6) {
    table = Y6_DEFAULT_TEST_ORDER
  }
  if (table === undefined || motorNumber > table.length) {
    return { sequence: motorNumber, mapped: false }
  }
  return { sequence: table[motorNumber - 1], mapped: true }
}
