import { describe, expect, it } from 'vitest'

import { deriveBoardOrientationVisual } from './board-orientation-visual'

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

  it('parses the odd combined angle (Yaw 293 Pitch 68 Roll 180)', () => {
    expect(deriveBoardOrientationVisual(38, 'Yaw 293 Pitch 68 Roll 180')).toMatchObject({
      yaw: 293,
      pitch: 68,
      roll: 180
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
