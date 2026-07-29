// Accelerometer-calibration pose geometry.
//
// Lifted out of the web layer's pose guide so the runtime can use the SAME
// alignment maths the UI draws with. The runtime needs it to auto-confirm a
// posture once the frame is actually in it; keeping a second copy in the UI
// would let the picture and the capture disagree about what "aligned" means,
// which on a calibration is a silently bad result rather than a visible bug.
//
// Pure geometry: no MAVLink, no state.

export type AccelerometerPoseId = 'level' | 'left' | 'right' | 'nose-down' | 'nose-up' | 'back'

/** Pose order matches ACCELEROMETER_CALIBRATION_STEPS (commandValue 1..6). */
export const ACCELEROMETER_POSE_ORDER: AccelerometerPoseId[] = [
  'level',
  'left',
  'right',
  'nose-down',
  'nose-up',
  'back'
]

export const ACCELEROMETER_POSE_TARGETS: Record<AccelerometerPoseId, { rollDeg: number; pitchDeg: number }> = {
  level: { rollDeg: 0, pitchDeg: 0 },
  left: { rollDeg: -90, pitchDeg: 0 },
  right: { rollDeg: 90, pitchDeg: 0 },
  'nose-down': { rollDeg: 0, pitchDeg: -90 },
  'nose-up': { rollDeg: 0, pitchDeg: 90 },
  back: { rollDeg: 180, pitchDeg: 0 }
}

/**
 * Acceptance window for "pose aligned", in degrees of gravity-vector error.
 * Shared by the UI's ready/adjust indicator and the runtime's auto-confirm so
 * the operator never sees "aligned" while the capture disagrees.
 */
export const ACCELEROMETER_POSE_ALIGNED_DEG = 17

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI

export function normalizeSignedDegrees(value: number): number {
  let normalized = value % 360
  if (normalized > 180) {
    normalized -= 360
  } else if (normalized < -180) {
    normalized += 360
  }
  return normalized
}

/**
 * Gravity direction in the body frame for a given attitude (standard aircraft
 * convention: roll about +X/nose, pitch about +Y/right wing). This is the third
 * column of the earth->body rotation and depends ONLY on roll+pitch — yaw is a
 * rotation about the gravity axis, so it leaves gravity-in-body unchanged.
 */
export function gravityBody(rollDeg: number, pitchDeg: number): [number, number, number] {
  const r = rollDeg * DEG2RAD
  const p = pitchDeg * DEG2RAD
  return [-Math.sin(p), Math.sin(r) * Math.cos(p), Math.cos(r) * Math.cos(p)]
}

/**
 * Pose error = the angle between the live gravity-in-body vector and the pose's
 * target gravity vector. This is the physically meaningful quantity for accel
 * calibration (the accelerometer measures gravity), and unlike comparing raw
 * Euler roll/pitch it is singularity-free: at ±90° pitch (nose-down/up) the
 * cos(pitch) factor zeroes the roll term, so a gimbal-locked / jittery roll no
 * longer injects a phantom error that kept those poses from ever reading
 * aligned. Each of the six poses maps to a distinct ±axis gravity vector.
 */
export function poseErrorDegrees(poseId: AccelerometerPoseId, rollDeg: number, pitchDeg: number): number {
  const target = ACCELEROMETER_POSE_TARGETS[poseId]
  const live = gravityBody(rollDeg, pitchDeg)
  const want = gravityBody(target.rollDeg, target.pitchDeg)
  const dot = live[0] * want[0] + live[1] * want[1] + live[2] * want[2]
  return Math.acos(Math.max(-1, Math.min(1, dot))) * RAD2DEG
}

/** Angle between two attitudes, used to decide whether the frame is holding still. */
export function attitudeDeltaDegrees(
  a: { rollDeg: number; pitchDeg: number },
  b: { rollDeg: number; pitchDeg: number }
): number {
  const left = gravityBody(a.rollDeg, a.pitchDeg)
  const right = gravityBody(b.rollDeg, b.pitchDeg)
  const dot = left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
  return Math.acos(Math.max(-1, Math.min(1, dot))) * RAD2DEG
}
