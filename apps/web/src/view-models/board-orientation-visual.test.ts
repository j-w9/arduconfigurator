import { describe, expect, it } from 'vitest'

import { AHRS_ORIENTATION_OPTIONS } from '@arduconfig/param-metadata'

import { deriveBoardOrientationVisual, describeBoardOrientation, rotateBoardOrientation } from './board-orientation-visual'

describe('deriveBoardOrientationVisual', () => {
  it('None (0) is an un-rotated board', () => {
    expect(deriveBoardOrientationVisual(0, 'None')).toEqual({
      kind: 'depictable',
      roll: 0,
      pitch: 0,
      yaw: 0,
      label: 'None'
    })
  })

  it('parses pure yaw', () => {
    expect(deriveBoardOrientationVisual(2, 'Yaw 90')).toMatchObject({ kind: 'depictable', yaw: 90, roll: 0, pitch: 0 })
    expect(deriveBoardOrientationVisual(6, 'Yaw 270')).toMatchObject({ yaw: 270 })
  })

  it('parses a 180 flip', () => {
    expect(deriveBoardOrientationVisual(8, 'Roll 180')).toMatchObject({ roll: 180, pitch: 0, yaw: 0 })
    expect(deriveBoardOrientationVisual(12, 'Pitch 180')).toMatchObject({ pitch: 180, roll: 0, yaw: 0 })
  })

  it('parses combined yaw + roll', () => {
    expect(deriveBoardOrientationVisual(10, 'Yaw 90 Roll 180')).toMatchObject({ yaw: 90, roll: 180, pitch: 0 })
  })

  it('parses edge/tilted mounts (now depictable in 3D)', () => {
    expect(deriveBoardOrientationVisual(16, 'Roll 90')).toMatchObject({ kind: 'depictable', roll: 90 })
    expect(deriveBoardOrientationVisual(24, 'Pitch 90')).toMatchObject({ kind: 'depictable', pitch: 90 })
    expect(deriveBoardOrientationVisual(28, 'Pitch 90 Roll 90')).toMatchObject({ pitch: 90, roll: 90 })
    expect(deriveBoardOrientationVisual(42, 'Roll 45')).toMatchObject({ roll: 45 })
  })

  it('poses 38 from the rotation code, not its label (Yaw 293 Pitch 68 Roll 180)', () => {
    // rotations.h: "this is actually, roll 90, pitch 68.8, yaw 293.3".
    expect(deriveBoardOrientationVisual(38, 'Yaw 293 Pitch 68 Roll 180')).toMatchObject({
      yaw: 293.3,
      pitch: 68.8,
      roll: 90
    })
  })

  it('custom orientations (>=100) are not depictable', () => {
    expect(deriveBoardOrientationVisual(101, 'Custom 1')).toMatchObject({ kind: 'custom' })
    expect(deriveBoardOrientationVisual(100, 'Custom (4.1 and older)')?.note).toMatch(/custom/i)
  })

  it('returns undefined without a value/label', () => {
    expect(deriveBoardOrientationVisual(undefined, 'Yaw 90')).toBeUndefined()
    expect(deriveBoardOrientationVisual(2, undefined)).toBeUndefined()
  })
})

describe('describeBoardOrientation', () => {
  // Generated from ~/ardupilot AP_Math/vector3.cpp rotate(): the board's +X
  // (the arrow) and its -Z (the component side) mapped into the vehicle frame.
  // Value 41 (Pitch 7) is in the rotation code but not in AHRS_ORIENTATION's
  // documented values, so it has no label here.
  const FROM_ARDUPILOT: Array<[number, string, string]> = [
    [0, 'forward', 'up'], // NONE
    [1, 'forward and right', 'up'], // YAW_45
    [2, 'right', 'up'], // YAW_90
    [3, 'back and right', 'up'], // YAW_135
    [4, 'back', 'up'], // YAW_180
    [5, 'back and left', 'up'], // YAW_225
    [6, 'left', 'up'], // YAW_270
    [7, 'forward and left', 'up'], // YAW_315
    [8, 'forward', 'down'], // ROLL_180
    [9, 'forward and right', 'down'], // ROLL_180_YAW_45
    [10, 'right', 'down'], // ROLL_180_YAW_90
    [11, 'back and right', 'down'], // ROLL_180_YAW_135
    [12, 'back', 'down'], // PITCH_180
    [13, 'back and left', 'down'], // ROLL_180_YAW_225
    [14, 'left', 'down'], // ROLL_180_YAW_270
    [15, 'forward and left', 'down'], // ROLL_180_YAW_315
    [16, 'forward', 'right'], // ROLL_90
    [17, 'forward and right', 'back and right'], // ROLL_90_YAW_45
    [18, 'right', 'back'], // ROLL_90_YAW_90
    [19, 'back and right', 'back and left'], // ROLL_90_YAW_135
    [20, 'forward', 'left'], // ROLL_270
    [21, 'forward and right', 'forward and left'], // ROLL_270_YAW_45
    [22, 'right', 'forward'], // ROLL_270_YAW_90
    [23, 'back and right', 'forward and right'], // ROLL_270_YAW_135
    [24, 'up', 'back'], // PITCH_90
    [25, 'down', 'forward'], // PITCH_270
    [26, 'left', 'down'], // PITCH_180_YAW_90
    [27, 'right', 'down'], // PITCH_180_YAW_270
    [28, 'up', 'right'], // ROLL_90_PITCH_90
    [29, 'up', 'forward'], // ROLL_180_PITCH_90
    [30, 'up', 'left'], // ROLL_270_PITCH_90
    [31, 'back', 'right'], // ROLL_90_PITCH_180
    [32, 'back', 'left'], // ROLL_270_PITCH_180
    [33, 'down', 'right'], // ROLL_90_PITCH_270
    [34, 'down', 'back'], // ROLL_180_PITCH_270
    [35, 'down', 'left'], // ROLL_270_PITCH_270
    [36, 'left', 'back'], // ROLL_90_PITCH_180_YAW_90
    [37, 'left', 'forward'], // ROLL_90_YAW_270
    [38, 'up', 'forward and right'], // ROLL_90_PITCH_68_YAW_293
    [39, 'forward and down', 'forward and up'], // PITCH_315
    [40, 'forward and down', 'right'], // ROLL_90_PITCH_315
    [41, 'forward', 'up'], // PITCH_7
    [42, 'forward', 'right and up'], // ROLL_45
    [43, 'forward', 'left and up'], // ROLL_315
  ]

  it('says where the arrow and the components point, matching ArduPilot for every orientation', () => {
    const labels = new Map(AHRS_ORIENTATION_OPTIONS.map((option) => [option.value, option.label]))
    for (const [value, arrow, componentSide] of FROM_ARDUPILOT) {
      const label = labels.get(value)
      if (label === undefined) continue
      const visual = deriveBoardOrientationVisual(value, label)
      expect(visual?.kind, label).toBe('depictable')
      expect(describeBoardOrientation(visual!), `${value} ${label}`).toEqual({ arrow, componentSide })
    }
  })
})

describe('rotateBoardOrientation', () => {
  const turn = (value: number, axis: 'roll' | 'pitch' | 'yaw', degrees: number) =>
    rotateBoardOrientation(value, axis, degrees, AHRS_ORIENTATION_OPTIONS)
  it('turns the board about the vehicle axes and lands on the matching setting', () => {
    expect(turn(0, 'pitch', 180)).toBe(12) // Pitch 180
    expect(turn(0, 'pitch', 90)).toBe(24) // nose up = Pitch 90
    expect(turn(0, 'pitch', -90)).toBe(25) // Pitch 270
    expect(turn(0, 'roll', 90)).toBe(16) // Roll 90
    expect(turn(0, 'roll', 180)).toBe(8) // Roll 180
    expect(turn(0, 'yaw', 90)).toBe(2) // Yaw 90
    expect(turn(0, 'yaw', 45)).toBe(1) // Yaw 45
    expect(turn(1, 'yaw', 45)).toBe(2) // 45° steps reach Yaw 90
    expect(turn(8, 'yaw', 45)).toBe(9) // upside down: Roll 180 Yaw 45
    expect(turn(16, 'yaw', 45)).toBeDefined() // on its edge: a Roll 90 Yaw setting
    expect(turn(0, 'yaw', -90)).toBe(6) // Yaw 270
    // Upside down, then nose right.
    expect(turn(8, 'yaw', 90)).toBe(10) // Roll 180 Yaw 90
    // A full turn comes back.
    expect(turn(turn(turn(turn(0, 'pitch', 90)!, 'pitch', 90)!, 'pitch', 90)!, 'pitch', 90)).toBe(0)
  })

  it('every square-on pose is reachable from every other with 90° turns', () => {
    for (const option of AHRS_ORIENTATION_OPTIONS) {
      if (option.value >= 100) continue
      const visual = deriveBoardOrientationVisual(option.value, option.label)!
      const squareOn = [visual.roll, visual.pitch, visual.yaw].every((angle) => angle % 90 === 0)
      if (!squareOn) continue
      for (const axis of ['roll', 'pitch', 'yaw'] as const) {
        for (const degrees of [90, -90]) {
          expect(turn(option.value, axis, degrees), `${option.label} ${axis} ${degrees}`).toBeDefined()
        }
      }
    }
  })

  it('says no when ArduPilot has no setting, or the value is Custom', () => {
    expect(turn(24, 'yaw', 45)).toBeUndefined() // nose up, then 45° yaw
    expect(turn(101, 'roll', 90)).toBeUndefined()
  })
})
