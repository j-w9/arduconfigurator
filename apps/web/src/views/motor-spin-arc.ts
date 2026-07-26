// Spin-direction arc geometry for the schematic motor maps. One arc per motor,
// drawn ~250° around the motor ring and sweeping the way the prop turns as seen
// in the diagram's top-down view. Pure string math so the SVG surfaces (Outputs
// preview, reorder dialog, motor-test tab) share one tested implementation.
//
// The arc is centred on the motor's OUTWARD direction (radially away from the
// hub), so a rear motor's arrow curves below its ring and a front motor's above
// — matching how operators draw prop directions on a frame. Callers that don't
// know a motor's position keep the historical default (centred over the top).

// Half-span of the arc, degrees. 80° each side → a 160° sweep: a compact curved
// arrow that sits as a dome ABOVE a front motor / BELOW a rear one (rather than a
// band wrapping the whole ring), matching how spin direction is sketched on a
// frame. The wide hub-facing gap keeps the glyph clearly outside the ring.
const ARC_HALF_SPAN_DEG = 80

/**
 * @param outwardAngleDeg math angle (y-up, 0°=+x/right, 90°=up) pointing from
 *   the hub out through this motor. Defaults to 90° (arc over the top) for
 *   callers with no position — preserves the original look.
 */
export function motorSpinArcPath(
  cx: number,
  cy: number,
  r: number,
  spin: 'cw' | 'ccw',
  outwardAngleDeg = 90
): string {
  // Wind from one edge of the gap to the other. Which edge is the start (and so
  // which end carries the arrowhead) is what reads as cw vs ccw; SVG sweep-flag
  // 1 is clockwise in screen coordinates.
  const startDeg = outwardAngleDeg + (spin === 'cw' ? ARC_HALF_SPAN_DEG : -ARC_HALF_SPAN_DEG)
  const endDeg = outwardAngleDeg + (spin === 'cw' ? -ARC_HALF_SPAN_DEG : ARC_HALF_SPAN_DEG)
  const rad = (deg: number) => (deg * Math.PI) / 180
  const x0 = cx + r * Math.cos(rad(startDeg))
  const y0 = cy - r * Math.sin(rad(startDeg))
  const x1 = cx + r * Math.cos(rad(endDeg))
  const y1 = cy - r * Math.sin(rad(endDeg))
  const sweep = spin === 'cw' ? 1 : 0
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 ${sweep} ${x1.toFixed(1)} ${y1.toFixed(1)}`
}

/**
 * Outward math-angle (for {@link motorSpinArcPath}) of a motor at unit-diagram
 * offset (x right, y down) from the hub. Returns 90° (top) for a motor sitting
 * exactly on the hub, where "outward" is undefined.
 */
export function motorOutwardAngleDeg(x: number, y: number): number {
  if (x === 0 && y === 0) {
    return 90
  }
  return (Math.atan2(-y, x) * 180) / Math.PI
}
