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

  const { yaw, roll, pitch } = parseAngles(label)
  return { kind: 'depictable', roll, pitch, yaw, label }
}
