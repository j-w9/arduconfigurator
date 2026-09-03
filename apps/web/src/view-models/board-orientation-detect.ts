// Work out how the flight controller is actually mounted, from the gravity
// vectors an accelerometer calibration already collects.
//
// ArduPilot will not do this for you, by design. The accel calibrator is fed
// samples with the board rotation divided back out --
//
//     cal_sample.rotate_inverse(_imu._board_orientation);   // AP_InertialSensor_Backend.cpp
//
// -- so its offsets and scales are independent of AHRS_ORIENTATION, and the
// only write to _board_orientation anywhere in the firmware is a 2021 parameter
// conversion. Orientation is an INPUT the calibration cancels out; it is never
// an output. But the calibration does ask the operator to place the vehicle in
// known poses, and that labelled data is exactly what identifies the mounting.
//
// Two things are worth being precise about:
//
//  1. Gravity alone cannot give you yaw. One still sample fixes which way is
//     down -- roll and pitch -- and leaves rotation about the gravity vector
//     completely unobservable. A second, non-parallel pose (nose down, on its
//     side) is REQUIRED, and this module refuses rather than guessing.
//
//  2. What we can read over MAVLink is already rotated by whatever
//     AHRS_ORIENTATION is set to right now (accel.rotate(_imu._board_orientation)
//     in the same backend), so a measurement yields the mounting only in
//     combination with the current setting. That is composed in below rather
//     than assumed to be zero.
//
// The reference reading comes from the firmware's own simple accel cal:
// `Vector3f rotated_gravity(0, 0, -GRAVITY_MSS)` -- a correctly-oriented level
// board reads negative Z.

import { BOARD_ROTATIONS, type BoardRotation } from '@arduconfig/param-metadata'

/** The poses ArduPilot prompts for (MAV_CMD_ACCELCAL_VEHICLE_POS 1..6). */
export type AccelCalPose = 'level' | 'left' | 'right' | 'nose-down' | 'nose-up' | 'back'

export type Vector3 = readonly [number, number, number]

/**
 * What a correctly-oriented board reads in each pose, as a unit vector.
 *
 * Level is (0,0,-1) per the firmware line above; the rest follow from which
 * vehicle axis is pointing at the ground. "Left" means the vehicle's left side
 * is down, so gravity runs along -Y and the reaction reads +Y.
 */
export const POSE_EXPECTED_ACCEL: Record<AccelCalPose, Vector3> = {
  level: [0, 0, -1],
  back: [0, 0, 1],
  'nose-down': [-1, 0, 0],
  'nose-up': [1, 0, 0],
  left: [0, 1, 0],
  right: [0, -1, 0]
}

export interface OrientationSample {
  pose: AccelCalPose
  /** Accelerometer reading in m/s^2, as published (already board-rotated). */
  accel: Vector3
}

export interface OrientationCandidate {
  rotation: BoardRotation
  /**
   * WORST disagreement between predicted and measured gravity across the
   * poses, in degrees -- not the mean.
   *
   * The mean flatters a wrong answer: a level pose reads the same whatever the
   * yaw is, so it contributes zero error to every yaw candidate and halves the
   * score of one that is 30 degrees out on the pose that actually carries the
   * information. "Every pose agrees" is the property worth measuring.
   */
  residualDeg: number
}

export type OrientationDetectionStatus =
  | 'detected'
  | 'insufficient-poses'
  | 'unsteady-samples'
  | 'poses-inconsistent'
  | 'no-standard-match'
  | 'custom-current-rotation'

export interface OrientationDetection {
  status: OrientationDetectionStatus
  /** Best match, present when status is 'detected' or 'no-standard-match'. */
  best?: OrientationCandidate
  /** Next best, so the UI can say how clear-cut the answer was. */
  runnerUp?: OrientationCandidate
  /** True when the detected rotation is what AHRS_ORIENTATION already says. */
  alreadySet?: boolean
  /** Operator-facing explanation of a non-'detected' status. */
  reason?: string
}

/**
 * Above this the poses disagree with every fixed rotation, which means either
 * the vehicle was not in the pose it was said to be in, or the board is mounted
 * at an angle that only CUST_ROT1/2 can express. Either way, do not propose a
 * 90-degree value: a wrong AHRS_ORIENTATION rotates the compass too.
 *
 * 10 degrees, and the ceiling is what sets it. The fixed rotations step 45
 * degrees in yaw, so a board mounted exactly between two of them sits 22.5 from
 * either -- anything at or above that is unreachable as a threshold, and 20 was
 * loose enough to accept a 30-degree skew as "Yaw45, near enough". A hand-held
 * calibration pose is off by a few degrees at most, so 10 keeps real mounts
 * while still refusing a board that genuinely sits between values.
 */
export const ORIENTATION_MATCH_LIMIT_DEG = 10

/**
 * How far the angle BETWEEN two captured poses may sit from the angle between
 * the poses they claim to be.
 *
 * Rotation preserves angles. Whatever the board's mounting and whatever
 * AHRS_ORIENTATION is set to, level and nose-down are 90 degrees apart in the
 * readings, because both are the same rigid rotation of the same pair of
 * physical directions. So this check is independent of everything the detection
 * is trying to work out, which makes it the one thing that can say "these
 * samples are not the poses they are labelled as" with certainty.
 *
 * That happens for a real reason: the pose auto-advance matches an expected
 * ATTITUDE, which is rotated by AHRS_ORIENTATION, so on a board whose
 * orientation is wrong it stalls and the operator confirms each step by hand --
 * often after already moving the frame to the next position, which labels the
 * sample with the previous pose. Without this check that shows up as a
 * nonsensical best fit and gets blamed on the mounting.
 */
export const POSE_PAIR_TOLERANCE_DEG = 25

const GRAVITY_MSS = 9.80665

/**
 * How far a reading may sit from 1g and still be usable.
 *
 * Loose on purpose. Measured on a real board resting on a bench, an
 * uncalibrated accelerometer read 9.48-9.60 m/s^2 -- about 3% low -- so a
 * tolerance that looked precise would reject a vehicle that was not moving at
 * all. This is a coarse sanity gate only; STEADY_SPREAD_LIMIT_MSS is the check
 * that actually decides whether the vehicle was still.
 */
const GRAVITY_TOLERANCE = 0.15

/**
 * Maximum spread on any axis, across a window of readings, for the vehicle to
 * count as still.
 *
 * Magnitude alone cannot do this job, which the bench proved: while the board
 * was being picked up and turned, its readings sat 7.3% to 13.5% off 1g --
 * inside the tolerance above, and overlapping the 3% a resting uncalibrated
 * board shows. Spread separates them cleanly. Same session, same board:
 * 2.26-4.11 m/s^2 of spread while handled, 0.01-0.06 at rest.
 */
export const STEADY_SPREAD_LIMIT_MSS = 0.5

export interface SteadyWindow {
  steady: boolean
  /** Mean of the window, when it is steady enough to use as a pose sample. */
  accel?: Vector3
  /** Largest per-axis spread across the window, in m/s^2. */
  spreadMss: number
  reason?: string
}

/**
 * Decide whether a run of consecutive readings represents a held pose, and
 * average them if it does.
 *
 * Callers capturing a pose should feed roughly a second of samples rather than
 * whatever arrived last: a single frame taken mid-handling looks perfectly
 * plausible on its own.
 */
export function summariseSteadyWindow(window: readonly Vector3[]): SteadyWindow {
  if (window.length < 3) {
    return { steady: false, spreadMss: 0, reason: 'Not enough readings yet — hold the pose still.' }
  }

  const spreadMss = Math.max(
    ...[0, 1, 2].map((axis) => {
      const values = window.map((sample) => sample[axis])
      return Math.max(...values) - Math.min(...values)
    })
  )
  if (spreadMss > STEADY_SPREAD_LIMIT_MSS) {
    return { steady: false, spreadMss, reason: 'The vehicle is still moving — hold the pose steady.' }
  }

  const mean = [0, 1, 2].map(
    (axis) => window.reduce((sum, sample) => sum + sample[axis], 0) / window.length
  ) as unknown as Vector3
  if (Math.abs(magnitude(mean) - GRAVITY_MSS) > GRAVITY_TOLERANCE * GRAVITY_MSS) {
    return {
      steady: false,
      spreadMss,
      reason: `Reading is ${magnitude(mean).toFixed(1)} m/s² rather than about 9.8 — check the accelerometer calibration.`
    }
  }

  return { steady: true, accel: mean, spreadMss }
}

function magnitude(v: Vector3): number {
  return Math.hypot(v[0], v[1], v[2])
}

function normalise(v: Vector3): Vector3 | undefined {
  const m = magnitude(v)
  return m > 1e-6 ? [v[0] / m, v[1] / m, v[2] / m] : undefined
}

function applyMatrix(matrix: readonly (readonly number[])[], v: Vector3): Vector3 {
  return [
    matrix[0][0] * v[0] + matrix[0][1] * v[1] + matrix[0][2] * v[2],
    matrix[1][0] * v[0] + matrix[1][1] * v[1] + matrix[1][2] * v[2],
    matrix[2][0] * v[0] + matrix[2][1] * v[1] + matrix[2][2] * v[2]
  ]
}

function transpose(matrix: readonly (readonly number[])[]): readonly (readonly number[])[] {
  return [0, 1, 2].map((row) => [0, 1, 2].map((col) => matrix[col][row]))
}

function angleBetweenDeg(a: Vector3, b: Vector3): number {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))
  return (Math.acos(dot) * 180) / Math.PI
}

export function findRotation(value: number): BoardRotation | undefined {
  return BOARD_ROTATIONS.find((rotation) => rotation.value === value)
}

/**
 * Identify the board's mounting from labelled gravity samples.
 *
 * `currentOrientation` is the live AHRS_ORIENTATION value, because the samples
 * arrive already rotated by it. With published p, expected v and a candidate
 * mounting C, the prediction is p = R_current * transpose(C) * v -- so every
 * fixed rotation can simply be scored against the measurements. There are 44 of
 * them; brute force beats fitting a rotation and then snapping it to the
 * nearest legal value, which is where a solver would quietly pick a neighbour.
 */
export function detectBoardOrientation(
  samples: readonly OrientationSample[],
  currentOrientation: number
): OrientationDetection {
  const current = findRotation(currentOrientation)
  if (!current) {
    return {
      status: 'custom-current-rotation',
      reason:
        `AHRS_ORIENTATION is ${currentOrientation}, a custom rotation. The readings are rotated by it, ` +
        'so the mounting cannot be worked out without knowing the custom angles. Set a standard ' +
        'orientation (or None) and re-run the calibration to measure it.'
    }
  }

  // One reading per pose, latest wins, and only poses we have a reference for.
  const byPose = new Map<AccelCalPose, Vector3>()
  for (const sample of samples) {
    const unit = normalise(sample.accel)
    if (!unit) continue
    if (Math.abs(magnitude(sample.accel) - GRAVITY_MSS) > GRAVITY_TOLERANCE * GRAVITY_MSS) {
      // Moving, or a bad sample: it would drag the fit without being obvious.
      continue
    }
    byPose.set(sample.pose, unit)
  }

  if (byPose.size < 2) {
    return {
      status: byPose.size === samples.length ? 'insufficient-poses' : 'unsteady-samples',
      reason:
        byPose.size === samples.length
          ? 'At least two poses are needed. Gravity fixes which way is down but says nothing about ' +
            'yaw, so a level reading alone cannot tell a forward-facing board from a sideways one.'
          : 'Some readings were not a steady 1g — the vehicle moved during the pose. Re-run the ' +
            'calibration and hold each position still.'
    }
  }

  // Non-parallel check: two opposite poses (level + back) still only give one axis.
  const poses = [...byPose.keys()]
  const independent = poses.some((a) =>
    poses.some((b) => {
      const angle = angleBetweenDeg(POSE_EXPECTED_ACCEL[a], POSE_EXPECTED_ACCEL[b])
      return angle > 30 && angle < 150
    })
  )
  if (!independent) {
    return {
      status: 'insufficient-poses',
      reason:
        'The poses recorded are along the same axis, which leaves rotation about gravity ' +
        'undetermined. Include a nose-down/up or side pose as well as level.'
    }
  }

  // Angles between the captured readings must match the angles between the
  // poses they claim to be. This holds under ANY rotation, so a failure here is
  // proof the labels are wrong rather than evidence about the mounting.
  for (const [poseA, measuredA] of byPose) {
    for (const [poseB, measuredB] of byPose) {
      if (poseA === poseB) continue
      const expectedAngle = angleBetweenDeg(POSE_EXPECTED_ACCEL[poseA], POSE_EXPECTED_ACCEL[poseB])
      const measuredAngle = angleBetweenDeg(measuredA, measuredB)
      if (Math.abs(measuredAngle - expectedAngle) > POSE_PAIR_TOLERANCE_DEG) {
        return {
          status: 'poses-inconsistent',
          reason:
            `The ${poseA} and ${poseB} readings are ${measuredAngle.toFixed(0)}° apart, but those poses ` +
            `are ${expectedAngle.toFixed(0)}° apart — so at least one was recorded while the vehicle was ` +
            'in a different position than the step asked for. That happens when a step is confirmed after ' +
            'the frame has already been moved on. Re-run the calibration, confirming each step while the ' +
            'vehicle is still in that position.'
        }
      }
    }
  }

  const scored: OrientationCandidate[] = BOARD_ROTATIONS.map((rotation) => {
    let worst = 0
    for (const [pose, measured] of byPose) {
      const expected = POSE_EXPECTED_ACCEL[pose]
      const predicted = applyMatrix(current.matrix, applyMatrix(transpose(rotation.matrix), expected))
      const unit = normalise(predicted)
      worst = Math.max(worst, unit ? angleBetweenDeg(unit, measured) : 180)
    }
    return { rotation, residualDeg: worst }
  }).sort((a, b) => a.residualDeg - b.residualDeg)

  const [best, runnerUp] = scored
  if (best.residualDeg > ORIENTATION_MATCH_LIMIT_DEG) {
    return {
      status: 'no-standard-match',
      best,
      runnerUp,
      reason:
        `The readings are ${best.residualDeg.toFixed(0)}° from the closest standard rotation ` +
        `(${best.rotation.name}). Either a pose was not held as described, or the board is mounted ` +
        'at an angle that needs a custom rotation (CUST_ROT1/2) rather than one of the fixed values.'
    }
  }

  return {
    status: 'detected',
    best,
    runnerUp,
    alreadySet: best.rotation.value === currentOrientation
  }
}

/**
 * What, if anything, to tell the operator after a calibration.
 *
 * Separated from the component because this is the judgement call, not the
 * markup: when to stay quiet, when to propose a change, and when to say the
 * measurement was not usable. Silence is the right output for "the poses agree
 * with the setting" -- announcing that on every calibration would train people
 * to skip past it the one time it matters.
 */
export type OrientationRecommendation =
  | { kind: 'silent' }
  | { kind: 'unusable'; reason: string; samples: readonly OrientationSample[] }
  | {
      kind: 'mismatch'
      detection: OrientationDetection
      best: OrientationCandidate
      /** Set when the next-closest rotation is near enough to be worth naming. */
      closeCall?: OrientationCandidate
    }

export function orientationRecommendation(
  samples: readonly OrientationSample[],
  currentOrientation: number | undefined
): OrientationRecommendation {
  if (samples.length < 2 || currentOrientation === undefined) {
    return { kind: 'silent' }
  }

  const detection = detectBoardOrientation(samples, currentOrientation)

  if (detection.status === 'detected' && detection.alreadySet) {
    return { kind: 'silent' }
  }

  if (detection.status === 'no-standard-match' || detection.status === 'poses-inconsistent') {
    // Worth surfacing: the board may need a custom rotation, or the poses were
    // not recorded where they were meant to be. Either way the operator should
    // know the measurement did not land on anything -- and should see what it
    // actually measured, because "45 degrees from the nearest rotation" with
    // nothing behind it is a dead end for whoever has to work out why.
    return {
      kind: 'unusable',
      reason: detection.reason ?? 'The poses did not match a standard rotation.',
      samples
    }
  }

  if (detection.status !== 'detected' || !detection.best) {
    // Not enough poses, or a moving vehicle. Nothing went wrong that the
    // operator needs to act on -- they simply did not produce a measurement.
    return { kind: 'silent' }
  }

  const closeCall =
    detection.runnerUp &&
    detection.runnerUp.residualDeg - detection.best.residualDeg < ORIENTATION_MATCH_LIMIT_DEG
      ? detection.runnerUp
      : undefined

  return { kind: 'mismatch', detection, best: detection.best, closeCall }
}
