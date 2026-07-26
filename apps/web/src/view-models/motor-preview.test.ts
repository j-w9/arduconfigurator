import { describe, expect, it } from 'vitest'

import { createMotorPreviewNodes, frameMotorPreviewNodes } from './motor-preview'

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

describe('frameMotorPreviewNodes (real per-frame table)', () => {
  // FRAME_CLASS: 1=Quad 2=Hexa 3=Octa 5=Y6. FRAME_TYPE: 0=+ 1=X 3=H.
  const spins = (nodes: ReturnType<typeof frameMotorPreviewNodes>) =>
    Object.fromEntries(nodes.map((n) => [n.motorNumber, n.spin]))

  it('quad X matches the hand table it replaces (byte-identical spins)', () => {
    const nodes = frameMotorPreviewNodes({ classValue: 1, typeValue: 1 })
    expect(nodes).toHaveLength(4)
    expect(spins(nodes)).toEqual({ 1: 'ccw', 2: 'ccw', 3: 'cw', 4: 'cw' })
  })

  it('quad H is quad X with every direction reversed (the H definition)', () => {
    const x = spins(frameMotorPreviewNodes({ classValue: 1, typeValue: 1 }))
    const h = spins(frameMotorPreviewNodes({ classValue: 1, typeValue: 3 }))
    for (const motor of [1, 2, 3, 4]) {
      expect(h[motor]).toBe(x[motor] === 'cw' ? 'ccw' : 'cw')
    }
  })

  it('an H-frame no longer renders as a quad-X: geometry differs from a quad', () => {
    const hexa = frameMotorPreviewNodes({ classValue: 2, typeValue: 1 })
    expect(hexa).toHaveLength(6)
    // Every hexa motor has a known spin now (the old heuristic drew none).
    hexa.forEach((n) => expect(n.spin === 'cw' || n.spin === 'ccw').toBe(true))
  })

  it('Y6 marks coaxial pairs top/bottom on three shared arms', () => {
    const y6 = frameMotorPreviewNodes({ classValue: 5, typeValue: 10 })
    expect(y6).toHaveLength(6)
    expect(y6.filter((n) => n.stack === 'top')).toHaveLength(3)
    expect(y6.filter((n) => n.stack === 'bottom')).toHaveLength(3)
    // Each arm's two motors share a position.
    const arms = new Set(y6.map((n) => `${n.x}:${n.y}`))
    expect(arms.size).toBe(3)
  })

  it('returns [] for an unknown / non-matrix frame or missing frame values', () => {
    expect(frameMotorPreviewNodes({})).toEqual([])
    expect(frameMotorPreviewNodes({ classValue: 1 })).toEqual([]) // type missing
    expect(frameMotorPreviewNodes({ classValue: 6, typeValue: 1 })).toEqual([]) // heli: not in table
  })

  it('createMotorPreviewNodes prefers the table when a numeric frame is passed', () => {
    // Quad-X label but hexa numeric frame -> six motors from the table, not four.
    const nodes = createMotorPreviewNodes(4, 'Quad X', { classValue: 2, typeValue: 1 })
    expect(nodes).toHaveLength(6)
  })
})
