// Turn an AHRS_ORIENTATION value into a 3D board pose. The enum labels encode a
// composition of Yaw/Roll/Pitch rotations (e.g. "Yaw 90 Roll 180"); a 3D board
// can show every one — flat yaw, upside-down flips, and the edge/tilted mounts a
// flat 2D picture couldn't. Only the Custom orientations (>=100, set by explicit
// angles) aren't depictable.

export type BoardOrientationKind = 'depictable' | 'custom'

export interface BoardOrientationVisual {
  kind: BoardOrientationKind
  /** Rotation to pose the board by, degrees. Applied intrinsically roll→pitch→yaw
   *  (ArduPilot's order) by the 3D view. All 0 for "None". */
  roll: number
  pitch: number
  yaw: number
  /** The human label (e.g. "Yaw 90 Roll 180"). */
  label: string
  /** Set for 'custom' — why no board is posed. */
  note?: string
}

// Parse "Yaw 90 Roll 180" -> { yaw: 90, roll: 180, pitch: 0 }.
function parseAngles(label: string): { yaw: number; roll: number; pitch: number } {
  const angles = { yaw: 0, roll: 0, pitch: 0 }
  const re = /(Yaw|Roll|Pitch)\s+(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(label)) !== null) {
    const axis = m[1].toLowerCase() as 'yaw' | 'roll' | 'pitch'
    angles[axis] = Number(m[2])
  }
  return angles
}

export function deriveBoardOrientationVisual(
  value: number | undefined,
  label: string | undefined
): BoardOrientationVisual | undefined {
  if (value === undefined || label === undefined) {
    return undefined
  }

  // Custom orientations (100-102) are a quaternion/angle set we can't depict.
  if (value >= 100) {
    return { kind: 'custom', roll: 0, pitch: 0, yaw: 0, label, note: 'Custom orientation — set by explicit angles.' }
  }

  if (value === 0 || /^none$/i.test(label)) {
    return { kind: 'depictable', roll: 0, pitch: 0, yaw: 0, label }
  }

  // ArduPilot's label for 38 ("Yaw293Pitch68Roll180") does not match its own
  // rotation code, which rotations.h describes as "actually, roll 90, pitch
  // 68.8, yaw 293.3". The picture follows the code.
  if (value === 38) {
    return { kind: 'depictable', roll: 90, pitch: 68.8, yaw: 293.3, label }
  }

  const { yaw, roll, pitch } = parseAngles(label)
  return { kind: 'depictable', roll, pitch, yaw, label }
}

export interface BoardOrientationReadout {
  /** Where the board's arrow (its forward edge) points on the vehicle. */
  arrow: string
  /** Which way the component side (the top face) faces. */
  componentSide: string
}

type Vec3 = [number, number, number]

// The same rotation the 3D view draws (CSS rotateZ(yaw) rotateX(-pitch)
// rotateY(roll), applied to a column vector), so the words always match the
// picture. CSS axes: x = vehicle right, y = vehicle back (screen down),
// z = up (towards the camera looking down on the vehicle). Pitch is negated:
// CSS rotateX tips the top edge AWAY from the camera, and ArduPilot's
// positive pitch is nose up. Checked against AP_Math rotate() for every
// orientation in the test.
function rotate(v: Vec3, visual: Pick<BoardOrientationVisual, 'roll' | 'pitch' | 'yaw'>): Vec3 {
  const rad = (deg: number) => (deg * Math.PI) / 180
  const [x0, y0, z0] = v
  // rotateY(roll)
  const r = rad(visual.roll)
  const x1 = Math.cos(r) * x0 + Math.sin(r) * z0
  const y1 = y0
  const z1 = -Math.sin(r) * x0 + Math.cos(r) * z0
  // rotateX(pitch)
  const p = rad(-visual.pitch)
  const x2 = x1
  const y2 = Math.cos(p) * y1 - Math.sin(p) * z1
  const z2 = Math.sin(p) * y1 + Math.cos(p) * z1
  // rotateZ(yaw)
  const w = rad(visual.yaw)
  const x3 = Math.cos(w) * x2 - Math.sin(w) * y2
  const y3 = Math.sin(w) * x2 + Math.cos(w) * y2
  return [x3, y3, z2]
}

// Name a direction by its main components: "back", "forward and right", "down".
function describeDirection([x, y, z]: Vec3): string {
  const parts: string[] = []
  const threshold = 0.38
  if (y < -threshold) parts.push('forward')
  if (y > threshold) parts.push('back')
  if (x > threshold) parts.push('right')
  if (x < -threshold) parts.push('left')
  if (z > threshold) parts.push('up')
  if (z < -threshold) parts.push('down')
  return parts.join(' and ')
}

export function describeBoardOrientation(
  visual: Pick<BoardOrientationVisual, 'roll' | 'pitch' | 'yaw'>
): BoardOrientationReadout {
  return {
    arrow: describeDirection(rotate([0, -1, 0], visual)),
    componentSide: describeDirection(rotate([0, 0, 1], visual))
  }
}
