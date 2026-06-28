import { describe, expect, it } from 'vitest'

import { poseErrorDegrees, validationStateForPose } from './accelerometer-pose-guide'

// The pose check compares the gravity-in-body vector (what the accelerometer
// measures) rather than raw Euler roll/pitch. The key property: at ±90° pitch
// (nose-down/up) roll is gimbal-locked, and the old hypot(rollErr, pitchErr)
// injected a phantom error that kept those poses from ever reading aligned.
describe('accelerometer pose detection (gravity-vector math)', () => {
  it('nose-down reads aligned at pitch -90 for ANY roll (no gimbal-lock phantom error)', () => {
    for (const roll of [0, 30, -45, 90, 175]) {
      expect(poseErrorDegrees('nose-down', roll, -90)).toBeLessThan(1)
      expect(validationStateForPose('nose-down', roll, -90, true).tone).toBe('ready')
    }
  })

  it('nose-up reads aligned at pitch +90 for any roll', () => {
    for (const roll of [0, 60, -120]) {
      expect(poseErrorDegrees('nose-up', roll, 90)).toBeLessThan(1)
      expect(validationStateForPose('nose-up', roll, 90, true).tone).toBe('ready')
    }
  })

  it('each pose is a distinct gravity direction (~90° from level, back is opposite)', () => {
    expect(poseErrorDegrees('level', 0, 0)).toBeLessThan(1)
    for (const pose of ['nose-down', 'nose-up', 'left', 'right'] as const) {
      expect(poseErrorDegrees(pose, 0, 0)).toBeGreaterThan(85)
    }
    expect(poseErrorDegrees('back', 0, 0)).toBeGreaterThan(175)
  })

  it('flags a clearly different pose as wrong (held on its side, asked nose-down)', () => {
    expect(validationStateForPose('nose-down', 90, 0, true).tone).toBe('mismatch')
  })

  it('uses the tightened ~17deg acceptance window for "aligned"', () => {
    // A level pose tilted 15deg (within the window) still reads ready; 20deg
    // (outside the tightened window) now reads "adjust" rather than aligned.
    expect(validationStateForPose('level', 15, 0, true).tone).toBe('ready')
    expect(validationStateForPose('level', 20, 0, true).tone).toBe('adjust')
  })

  it('waits when live attitude is not yet verified', () => {
    expect(validationStateForPose('level', 0, 0, false).tone).toBe('waiting')
  })
})
