// Spin-direction arc geometry for the schematic motor maps. One arc per
// motor, drawn 150° over the top of the motor ring, sweeping the way the
// prop turns as seen in the diagram's top-down view. Pure string math so
// the three SVG surfaces (Outputs preview, reorder dialog, direction
// tab) share one tested implementation.

export function motorSpinArcPath(cx: number, cy: number, r: number, spin: 'cw' | 'ccw'): string {
  // Endpoints at 215° / -35° (math angles, y flipped to screen): the arc
  // runs lower-left ↔ lower-right across the TOP of the ring. SVG
  // sweep-flag 1 is clockwise in screen coordinates.
  const startDeg = spin === 'cw' ? 215 : -35
  const endDeg = spin === 'cw' ? -35 : 215
  const rad = (deg: number) => (deg * Math.PI) / 180
  const x0 = cx + r * Math.cos(rad(startDeg))
  const y0 = cy - r * Math.sin(rad(startDeg))
  const x1 = cx + r * Math.cos(rad(endDeg))
  const y1 = cy - r * Math.sin(rad(endDeg))
  const sweep = spin === 'cw' ? 1 : 0
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 ${sweep} ${x1.toFixed(1)} ${y1.toFixed(1)}`
}
