import { describe, expect, it } from 'vitest'

import { deriveBoardOrientationVisual } from './board-orientation-visual'

describe('deriveBoardOrientationVisual', () => {
  it('None (0) is a flat, un-rotated board', () => {
    expect(deriveBoardOrientationVisual(0, 'None')).toEqual({ kind: 'flat', yawDeg: 0, inverted: false, label: 'None' })
  })

  it('pure yaw rotates the board flat', () => {
    expect(deriveBoardOrientationVisual(2, 'Yaw 90')).toMatchObject({ kind: 'flat', yawDeg: 90, inverted: false })
    expect(deriveBoardOrientationVisual(6, 'Yaw 270')).toMatchObject({ kind: 'flat', yawDeg: 270, inverted: false })
    expect(deriveBoardOrientationVisual(1, 'Yaw 45')).toMatchObject({ kind: 'flat', yawDeg: 45 })
  })

  it('Roll 180 mirrors left-right (nose stays forward); Pitch 180 mirrors top-bottom', () => {
    // The distinction matters: a Roll-180 board still points forward, a
    // Pitch-180 board points backward — the mirror axis is what encodes that.
    expect(deriveBoardOrientationVisual(8, 'Roll 180')).toMatchObject({
      kind: 'inverted',
      yawDeg: 0,
      inverted: true,
      mirror: 'x'
    })
    expect(deriveBoardOrientationVisual(12, 'Pitch 180')).toMatchObject({ kind: 'inverted', inverted: true, mirror: 'y' })
  })

  it('yaw + 180 flip keeps the yaw and marks it inverted', () => {
    expect(deriveBoardOrientationVisual(10, 'Yaw 90 Roll 180')).toMatchObject({
      kind: 'inverted',
      yawDeg: 90,
      inverted: true,
      mirror: 'x'
    })
  })

  it('a 90/270 roll or pitch is edge-mounted — no flat picture', () => {
    expect(deriveBoardOrientationVisual(16, 'Roll 90')).toMatchObject({ kind: 'edge', inverted: false })
    expect(deriveBoardOrientationVisual(24, 'Pitch 90')).toMatchObject({ kind: 'edge' })
    expect(deriveBoardOrientationVisual(28, 'Pitch 90 Roll 90')).toMatchObject({ kind: 'edge' })
    expect(deriveBoardOrientationVisual(16, 'Roll 90')?.note).toMatch(/side or at an angle/i)
  })

  it('odd combined angles (Yaw 293 Pitch 68 Roll 180) are edge-mounted', () => {
    expect(deriveBoardOrientationVisual(38, 'Yaw 293 Pitch 68 Roll 180')).toMatchObject({ kind: 'edge' })
  })

  it('45/315 roll are edge-mounted (tilted), not flat', () => {
    expect(deriveBoardOrientationVisual(42, 'Roll 45')).toMatchObject({ kind: 'edge' })
    expect(deriveBoardOrientationVisual(43, 'Roll 315')).toMatchObject({ kind: 'edge' })
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
