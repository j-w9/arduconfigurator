import { describe, expect, it } from 'vitest'

import { motorOutwardAngleDeg, motorSpinArcPath } from './motor-spin-arc'

// Parse "M x0 y0 A r r 0 0 sweep x1 y1" into its numbers.
function parseArc(path: string) {
  const m = path.match(
    /^M (-?\d+\.?\d*) (-?\d+\.?\d*) A (\d+) (\d+) 0 0 (\d) (-?\d+\.?\d*) (-?\d+\.?\d*)$/
  )
  if (!m) throw new Error(`unparseable arc: ${path}`)
  const [, x0, y0, , , sweep, x1, y1] = m
  return { x0: +x0, y0: +y0, sweep: +sweep, x1: +x1, y1: +y1 }
}

describe('motorOutwardAngleDeg', () => {
  it('points up for a front motor and down for a rear motor', () => {
    // Screen coords: y is DOWN, so a front motor (negative y) points up (+90),
    // a rear motor (positive y) points down (-90).
    expect(motorOutwardAngleDeg(0, -0.8)).toBeCloseTo(90)
    expect(motorOutwardAngleDeg(0, 0.8)).toBeCloseTo(-90)
    expect(motorOutwardAngleDeg(0.8, 0)).toBeCloseTo(0)
    // A left motor is ±180 (same angle either way, cos/sin is sign-agnostic).
    expect(Math.abs(motorOutwardAngleDeg(-0.8, 0))).toBeCloseTo(180)
  })

  it('falls back to the top (90) for a motor on the hub', () => {
    expect(motorOutwardAngleDeg(0, 0)).toBe(90)
  })
})

describe('motorSpinArcPath', () => {
  it('defaults to a 160° dome over the top when no outward angle is given', () => {
    // Endpoints at 90±80 = 170° / 10° (math) around a 100,100 ring, r=30.
    const cw = parseArc(motorSpinArcPath(100, 100, 30, 'cw'))
    // cw start at 170° math → x = 100 + 30cos170 ≈ 70.5, y = 100 - 30sin170 ≈ 94.8
    expect(cw.x0).toBeCloseTo(100 + 30 * Math.cos((170 * Math.PI) / 180), 0)
    expect(cw.y0).toBeCloseTo(100 - 30 * Math.sin((170 * Math.PI) / 180), 0)
    expect(cw.sweep).toBe(1)
    // Both endpoints sit above the ring centre (the dome caps the top).
    expect(cw.y0).toBeLessThan(100)
    expect(cw.y1).toBeLessThan(100)
  })

  it('flips the sweep flag between cw and ccw', () => {
    expect(parseArc(motorSpinArcPath(0, 0, 10, 'cw')).sweep).toBe(1)
    expect(parseArc(motorSpinArcPath(0, 0, 10, 'ccw')).sweep).toBe(0)
  })

  it('a rear motor domes BELOW its ring (outward = down)', () => {
    // Outward -90°: endpoints at -90±80 = -10° / -170°, belly straight down.
    // Both endpoints sit below the ring centre; the belly is further below.
    const cy = 100
    const r = 30
    const arc = parseArc(motorSpinArcPath(100, cy, r, 'cw', -90))
    expect(arc.y0).toBeGreaterThan(cy) // endpoint below centre
    expect(arc.y1).toBeGreaterThan(cy)
  })

  it('a front motor domes ABOVE its ring (mirror of the rear case)', () => {
    const cy = 100
    const r = 30
    const arc = parseArc(motorSpinArcPath(100, cy, r, 'cw', 90))
    expect(arc.y0).toBeLessThan(cy) // endpoint above centre
    expect(arc.y1).toBeLessThan(cy)
  })
})
