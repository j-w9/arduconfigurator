import { describe, expect, it } from 'vitest'
import { BOARD_ROTATIONS } from '@arduconfig/param-metadata'

import {
  ORIENTATION_MATCH_LIMIT_DEG,
  orientationRecommendation,
  POSE_EXPECTED_ACCEL,
  detectBoardOrientation,
  findRotation,
  summariseSteadyWindow,
  type AccelCalPose,
  type OrientationSample,
  type Vector3
} from './board-orientation-detect'

const GRAVITY = 9.80665

function apply(matrix: readonly (readonly number[])[], v: Vector3): Vector3 {
  return [
    matrix[0][0] * v[0] + matrix[0][1] * v[1] + matrix[0][2] * v[2],
    matrix[1][0] * v[0] + matrix[1][1] * v[1] + matrix[1][2] * v[2],
    matrix[2][0] * v[0] + matrix[2][1] * v[1] + matrix[2][2] * v[2]
  ]
}

function transpose(matrix: readonly (readonly number[])[]): readonly (readonly number[])[] {
  return [0, 1, 2].map((row) => [0, 1, 2].map((col) => matrix[col][row]))
}

/**
 * What the vehicle would actually publish: the reading is produced in board
 * axes by the true mounting, then rotated by whatever AHRS_ORIENTATION is set
 * to. p = R_current * transpose(R_true) * expected.
 */
function publishedSample(
  pose: AccelCalPose,
  trueOrientation: number,
  currentOrientation: number
): OrientationSample {
  const trueRotation = findRotation(trueOrientation)!
  const current = findRotation(currentOrientation)!
  const vehicle = POSE_EXPECTED_ACCEL[pose]
  const board = apply(transpose(trueRotation.matrix), vehicle)
  const published = apply(current.matrix, board)
  return { pose, accel: published.map((component) => component * GRAVITY) as unknown as Vector3 }
}

describe('detectBoardOrientation', () => {
  it('recovers every standard rotation from a level and a nose-down pose', () => {
    // The round trip that matters: for each of ArduPilot's fixed rotations,
    // synthesise what a board mounted that way would publish and check we name
    // it again. Catches a transposed matrix or a flipped convention across the
    // whole table rather than at one spot-checked value.
    for (const rotation of BOARD_ROTATIONS) {
      const samples = [
        publishedSample('level', rotation.value, 0),
        publishedSample('nose-down', rotation.value, 0)
      ]
      const result = detectBoardOrientation(samples, 0)
      expect(result.status, `${rotation.name} should be detected`).toBe('detected')
      // Several rotations are geometrically identical for a given pose pair;
      // accept any that reproduces the same measurements exactly.
      expect(result.best!.residualDeg).toBeLessThan(1)
    }
  })

  it('composes with a non-zero AHRS_ORIENTATION already set', () => {
    // The readings arrive already rotated, so a measurement only identifies the
    // mounting together with the current setting. With the right answer already
    // in place the board reads exactly like a correctly-oriented one.
    const samples = [
      publishedSample('level', 6, 6),
      publishedSample('nose-down', 6, 6)
    ]
    const result = detectBoardOrientation(samples, 6)
    expect(result.status).toBe('detected')
    expect(result.best!.rotation.value).toBe(6)
    expect(result.alreadySet).toBe(true)
  })

  it('finds the true mounting when the current setting is wrong', () => {
    // Board is really Yaw90; AHRS_ORIENTATION currently says None.
    const samples = [
      publishedSample('level', 2, 0),
      publishedSample('nose-down', 2, 0)
    ]
    const result = detectBoardOrientation(samples, 0)
    expect(result.status).toBe('detected')
    expect(result.best!.rotation.value).toBe(2)
    expect(result.alreadySet).toBe(false)
  })

  it('refuses a level-only measurement, because gravity cannot give yaw', () => {
    const result = detectBoardOrientation([publishedSample('level', 0, 0)], 0)
    expect(result.status).toBe('insufficient-poses')
    expect(result.best).toBeUndefined()
    expect(result.reason).toMatch(/yaw/i)
  })

  it('refuses two poses along the same axis', () => {
    // Level and back are opposite ends of one axis: still no yaw information.
    const result = detectBoardOrientation(
      [publishedSample('level', 0, 0), publishedSample('back', 0, 0)],
      0
    )
    expect(result.status).toBe('insufficient-poses')
  })

  describe('summariseSteadyWindow', () => {
    // Both sets are real readings from a bench probe of a connected flight
    // controller, in m/s^2, as logged by apps/desktop probe:orientation.
    const restingOnBench: Vector3[] = [
      [0.30, -0.07, -9.51],
      [0.31, -0.06, -9.49],
      [0.32, -0.07, -9.53],
      [0.31, -0.07, -9.47]
    ]
    const beingHandled: Vector3[] = [
      [0.74, 1.10, -10.63],
      [0.55, 1.29, -8.37],
      [0.37, -1.01, -10.49],
      [-0.88, -1.03, -8.47],
      [1.84, -2.82, -9.97]
    ]

    it('accepts a real resting board despite its accelerometer reading 3% low', () => {
      const result = summariseSteadyWindow(restingOnBench)
      expect(result.steady).toBe(true)
      expect(result.spreadMss).toBeLessThan(0.1)
      // ~9.5, not 9.807: an uncalibrated accel. Rejecting this would reject a
      // vehicle sitting perfectly still.
      expect(Math.hypot(...result.accel!)).toBeGreaterThan(9.4)
      expect(Math.hypot(...result.accel!)).toBeLessThan(9.6)
    })

    it('rejects a board being handled, which magnitude alone would accept', () => {
      // Every one of these frames is within the 1g tolerance — 7.3% to 13.5%
      // off — so a magnitude check passes them all while the board is being
      // turned over in someone's hands. Spread is what catches it.
      for (const frame of beingHandled) {
        expect(Math.abs(Math.hypot(...frame) - 9.80665) / 9.80665).toBeLessThan(0.15)
      }
      const result = summariseSteadyWindow(beingHandled)
      expect(result.steady).toBe(false)
      expect(result.spreadMss).toBeGreaterThan(2)
      expect(result.reason).toMatch(/still moving/i)
    })

    it('will not average a window too short to show movement', () => {
      const result = summariseSteadyWindow(restingOnBench.slice(0, 2))
      expect(result.steady).toBe(false)
      expect(result.accel).toBeUndefined()
    })
  })

  it('names the mounting of a real board measured on the bench', () => {
    // Rung-5 evidence, not synthesised: both windows are consecutive readings
    // logged by apps/desktop probe:orientation from a connected flight
    // controller whose AHRS_ORIENTATION reads 0. The board was laid flat, then
    // stood on its nose and held.
    const level = summariseSteadyWindow([
      [0.30, -0.07, -9.51],
      [0.31, -0.06, -9.49],
      [0.32, -0.07, -9.53],
      [0.31, -0.07, -9.47]
    ])
    const noseDown = summariseSteadyWindow([
      [-9.84, 0.19, 0.21],
      [-9.89, 0.24, 0.11],
      [-9.76, 0.19, 0.26],
      [-9.83, 0.19, 0.17],
      [-9.86, 0.22, 0.08]
    ])
    expect(level.steady).toBe(true)
    expect(noseDown.steady).toBe(true)

    const result = detectBoardOrientation(
      [
        { pose: 'level', accel: level.accel! },
        { pose: 'nose-down', accel: noseDown.accel! }
      ],
      0
    )

    expect(result.status).toBe('detected')
    expect(result.best!.rotation.value).toBe(0)
    expect(result.alreadySet).toBe(true)
    // A hand-placed pose on a bench, so a couple of degrees is expected; this
    // is the number that says the whole chain agrees with reality.
    expect(result.best!.residualDeg).toBeLessThan(5)
  })

  it('rejects samples taken while the vehicle was moving', () => {
    const samples: OrientationSample[] = [
      { pose: 'level', accel: [0, 0, -GRAVITY * 1.6] },
      { pose: 'nose-down', accel: [-GRAVITY * 1.6, 0, 0] }
    ]
    const result = detectBoardOrientation(samples, 0)
    expect(result.status).toBe('unsteady-samples')
    expect(result.best).toBeUndefined()
  })

  it('reports no standard match for a board mounted at an odd angle', () => {
    // 30 degrees about Z is not one of the fixed rotations; proposing the
    // nearest 45-degree value would rotate the compass wrongly.
    const angle = (30 * Math.PI) / 180
    const skew: readonly (readonly number[])[] = [
      [Math.cos(angle), -Math.sin(angle), 0],
      [Math.sin(angle), Math.cos(angle), 0],
      [0, 0, 1]
    ]
    const samples: OrientationSample[] = (['level', 'nose-down'] as const).map((pose) => ({
      pose,
      accel: apply(transpose(skew), POSE_EXPECTED_ACCEL[pose]).map((c) => c * GRAVITY) as unknown as Vector3
    }))
    const result = detectBoardOrientation(samples, 0)
    expect(result.status).toBe('no-standard-match')
    expect(result.best!.residualDeg).toBeGreaterThan(ORIENTATION_MATCH_LIMIT_DEG)
    expect(result.reason).toMatch(/custom rotation/i)
  })

  it('will not guess when AHRS_ORIENTATION is a custom rotation', () => {
    const result = detectBoardOrientation(
      [publishedSample('level', 0, 0), publishedSample('nose-down', 0, 0)],
      101
    )
    expect(result.status).toBe('custom-current-rotation')
    expect(result.best).toBeUndefined()
  })

  describe('orientationRecommendation', () => {
    const level = publishedSample('level', 0, 0)
    const noseDown = publishedSample('nose-down', 0, 0)

    it('says nothing when the poses agree with the setting', () => {
      // Announcing "orientation correct" after every calibration teaches people
      // to skip past it the one time it is not.
      expect(orientationRecommendation([level, noseDown], 0)).toEqual({ kind: 'silent' })
    })

    it('says nothing when there is not enough to go on', () => {
      expect(orientationRecommendation([level], 0).kind).toBe('silent')
      expect(orientationRecommendation([], 0).kind).toBe('silent')
      expect(orientationRecommendation([level, noseDown], undefined).kind).toBe('silent')
    })

    it('proposes the measured rotation when it differs from the setting', () => {
      // Board really mounted Yaw90 while AHRS_ORIENTATION still says None.
      const samples = [publishedSample('level', 2, 0), publishedSample('nose-down', 2, 0)]
      const recommendation = orientationRecommendation(samples, 0)
      expect(recommendation.kind).toBe('mismatch')
      if (recommendation.kind !== 'mismatch') throw new Error('expected a mismatch')
      expect(recommendation.best.rotation.value).toBe(2)
    })

    it('reports a measurement that matches no standard rotation', () => {
      const angle = (30 * Math.PI) / 180
      const skew: readonly (readonly number[])[] = [
        [Math.cos(angle), -Math.sin(angle), 0],
        [Math.sin(angle), Math.cos(angle), 0],
        [0, 0, 1]
      ]
      const samples: OrientationSample[] = (['level', 'nose-down'] as const).map((pose) => ({
        pose,
        accel: apply(transpose(skew), POSE_EXPECTED_ACCEL[pose]).map((c) => c * GRAVITY) as unknown as Vector3
      }))
      const recommendation = orientationRecommendation(samples, 0)
      expect(recommendation.kind).toBe('unusable')
      if (recommendation.kind !== 'unusable') throw new Error('expected unusable')
      expect(recommendation.reason).toMatch(/custom rotation/i)
    })
  })
})
