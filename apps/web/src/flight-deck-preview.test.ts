import { describe, expect, it } from 'vitest'

import { buildVisualQuaternionFromEulerRad, buildVisualQuaternionFromFc } from './flight-deck-preview'

const DEG2RAD = Math.PI / 180

// ArduPilot Quaternion::from_euler (Hamilton, 3-2-1 yaw-pitch-roll, body->NED) —
// the exact convention ATTITUDE_QUATERNION ships. Generates the quaternion the
// FC would send for a given roll/pitch/yaw so we can check our scene transform
// reproduces the established Euler-based visual mapping.
function eulerToFcQuaternion(rollRad: number, pitchRad: number, yawRad: number) {
  const cr = Math.cos(rollRad / 2)
  const sr = Math.sin(rollRad / 2)
  const cp = Math.cos(pitchRad / 2)
  const sp = Math.sin(pitchRad / 2)
  const cy = Math.cos(yawRad / 2)
  const sy = Math.sin(yawRad / 2)
  return {
    w: cy * cp * cr + sy * sp * sr,
    x: cy * cp * sr - sy * sp * cr,
    y: cy * sp * cr + sy * cp * sr,
    z: sy * cp * cr - cy * sp * sr
  }
}

describe('craft view quaternion sourcing', () => {
  it('maps the FC attitude quaternion to the same scene orientation as the Euler path, at every attitude', () => {
    // Grid spans well beyond the ±70° Euler clamp and through ±90° pitch — the
    // exact region where deriving orientation from Euler angles degrades. The
    // quaternion path must agree with the Euler composition everywhere.
    for (let rollDeg = -170; rollDeg <= 170; rollDeg += 17) {
      for (let pitchDeg = -90; pitchDeg <= 90; pitchDeg += 9) {
        for (let yawDeg = 0; yawDeg < 360; yawDeg += 29) {
          const r = rollDeg * DEG2RAD
          const p = pitchDeg * DEG2RAD
          const y = yawDeg * DEG2RAD
          const fromEuler = buildVisualQuaternionFromEulerRad(r, p, y)
          const fromFc = buildVisualQuaternionFromFc(eulerToFcQuaternion(r, p, y))
          // angleTo handles quaternion double-cover (q and -q are equal).
          expect(fromEuler.angleTo(fromFc)).toBeLessThan(1e-3)
        }
      }
    }
  })

  it('applies the bench heading offset consistently with the Euler path', () => {
    const r = 12 * DEG2RAD
    const p = 25 * DEG2RAD
    const y = 200 * DEG2RAD
    const offsetDeg = 40
    // Euler path offsets yaw by subtracting the trim before building.
    const fromEuler = buildVisualQuaternionFromEulerRad(r, p, (200 - offsetDeg) * DEG2RAD)
    const fromFc = buildVisualQuaternionFromFc(eulerToFcQuaternion(r, p, y), offsetDeg)
    expect(fromEuler.angleTo(fromFc)).toBeLessThan(1e-3)
  })
})
