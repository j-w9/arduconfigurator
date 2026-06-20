import { describe, expect, it } from 'vitest'

import { createMotorPreviewNodes } from './motor-preview'

const motorNumbers = (frame: string, count: number): number[] =>
  createMotorPreviewNodes(count, frame).map((node) => node.motorNumber)

describe('createMotorPreviewNodes', () => {
  it('returns nothing for a non-positive motor count', () => {
    expect(createMotorPreviewNodes(0, 'Quad X')).toEqual([])
    expect(createMotorPreviewNodes(-3, 'Quad X')).toEqual([])
  })

  it('places one node per motor, numbered 1..N, with finite coordinates', () => {
    for (const count of [2, 3, 4, 6]) {
      const nodes = createMotorPreviewNodes(count, 'Plus')
      expect(nodes).toHaveLength(count)
      expect([...nodes.map((node) => node.motorNumber)].sort((a, b) => a - b)).toEqual(
        Array.from({ length: count }, (_, index) => index + 1)
      )
      for (const node of nodes) {
        expect(Number.isFinite(node.x)).toBe(true)
        expect(Number.isFinite(node.y)).toBe(true)
      }
    }
  })

  it('a quad lists motors 1..4 in order regardless of frame convention', () => {
    expect(motorNumbers('Betaflight X', 4)).toEqual([1, 2, 3, 4])
    expect(motorNumbers('Clockwise X', 4)).toEqual([1, 2, 3, 4])
  })

  it('the frame convention changes which corner each motor sits in', () => {
    const betaflight = createMotorPreviewNodes(4, 'Betaflight X')
    const clockwise = createMotorPreviewNodes(4, 'Clockwise X')
    const dji = createMotorPreviewNodes(4, 'DJI X')
    // Same motor numbering, different motor->position mapping per convention.
    expect(betaflight).not.toEqual(clockwise)
    expect(betaflight).not.toEqual(dji)
    expect(clockwise).not.toEqual(dji)
  })

  it('a + quad uses a different layout than an X quad', () => {
    expect(createMotorPreviewNodes(4, 'Quad +')).not.toEqual(createMotorPreviewNodes(4, 'Quad X'))
  })

  it('is case-insensitive on the frame label', () => {
    expect(createMotorPreviewNodes(4, 'BETAFLIGHT X')).toEqual(createMotorPreviewNodes(4, 'betaflight x'))
  })
})

describe('spin directions (ArduPilot motor-order tables)', () => {
  const byMotor = (nodes: ReturnType<typeof createMotorPreviewNodes>) =>
    Object.fromEntries(nodes.map((node) => [node.motorNumber, node.spin]))

  it('quad X: M1/M2 CCW, M3/M4 CW regardless of numbering variant', () => {
    expect(byMotor(createMotorPreviewNodes(4, 'Quad X'))).toEqual({ 1: 'ccw', 2: 'ccw', 3: 'cw', 4: 'cw' })
    expect(byMotor(createMotorPreviewNodes(4, 'Betaflight X'))).toEqual({ 1: 'cw', 2: 'ccw', 3: 'ccw', 4: 'cw' })
  })

  it('quad +: M1/M2 (right/left) CCW, M3/M4 (front/rear) CW', () => {
    expect(byMotor(createMotorPreviewNodes(4, 'Quad +'))).toEqual({ 1: 'ccw', 2: 'ccw', 3: 'cw', 4: 'cw' })
  })

  it('reversed (props-out) X variants flip every direction', () => {
    expect(byMotor(createMotorPreviewNodes(4, 'Betaflight X Reversed'))).toEqual({
      1: 'ccw',
      2: 'cw',
      3: 'cw',
      4: 'ccw'
    })
  })

  it('frames without a known direction table get NO arrows (never guess)', () => {
    createMotorPreviewNodes(6, 'Hexa X').forEach((node) => expect(node.spin).toBeUndefined())
    createMotorPreviewNodes(4, 'V-Tail').forEach((node) => expect(node.spin).toBeUndefined())
    createMotorPreviewNodes(4, 'Y4').forEach((node) => expect(node.spin).toBeUndefined())
  })
})
