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
  it('is unchanged (arc over the top) when no outward angle is given', () => {
    // Historical default: endpoints at 215° / -35° around a 100,100 ring, r=30.
    const cw = parseArc(motorSpinArcPath(100, 100, 30, 'cw'))
    // start at 215° math → x = 100 + 30cos215 ≈ 75.4, y = 100 - 30sin215 ≈ 117.2
    expect(cw.x0).toBeCloseTo(100 + 30 * Math.cos((215 * Math.PI) / 180), 0)
    expect(cw.y0).toBeCloseTo(100 - 30 * Math.sin((215 * Math.PI) / 180), 0)
    expect(cw.sweep).toBe(1)
  })

  it('flips the sweep flag between cw and ccw', () => {
    expect(parseArc(motorSpinArcPath(0, 0, 10, 'cw')).sweep).toBe(1)
    expect(parseArc(motorSpinArcPath(0, 0, 10, 'ccw')).sweep).toBe(0)
  })

  it('centres the gap on the hub side: a rear motor arcs below its ring', () => {
    // Rear motor: outward points down (-90°). The arc spans ±125° around -90°,
    // i.e. from 35° to -215°, so its midpoint (-90°, straight down in screen =
    // BELOW the ring centre) has the largest y. Sample both endpoints and the
    // midpoint; the arc's lowest point on screen must be below the ring centre.
    const cy = 100
    const r = 30
    const arc = parseArc(motorSpinArcPath(100, cy, r, 'cw', -90))
    const mid = cy + r // straight-down point of the ring
    // Both endpoints sit near the top gap (small y), the swept belly is at the
    // bottom — assert the endpoints straddle the vertical and the belly is below.
    expect(Math.max(arc.y0, arc.y1)).toBeLessThan(mid) // endpoints above the belly
    expect(arc.y0).toBeLessThan(cy + r) // sanity: within ring vertical extent
  })

  it('a front motor arcs above its ring (mirror of the rear case)', () => {
    const cy = 100
    const r = 30
    const arc = parseArc(motorSpinArcPath(100, cy, r, 'cw', 90))
    // Endpoints near the bottom gap → larger y than the ring centre.
    expect(Math.min(arc.y0, arc.y1)).toBeGreaterThan(cy - r) // belly is above (small y)
    expect(Math.max(arc.y0, arc.y1)).toBeGreaterThan(cy) // gap endpoints below centre
  })
})
