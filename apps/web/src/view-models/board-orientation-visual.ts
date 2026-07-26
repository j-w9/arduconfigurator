// Turn an AHRS_ORIENTATION value into what a top-down board picture should show.
//
// The enum labels encode Yaw/Roll/Pitch rotations (e.g. "Yaw 90 Roll 180").
// A flat top-down diagram can faithfully show:
//   - pure Yaw (the board rotated in its mounting plane), and
//   - a 180° flip (Roll 180 / Pitch 180 = mounted upside down),
// but NOT a 90°/270°/45° roll or pitch (the board is on its edge or tilted),
// where a flat rotation would mislead. Those get a "non-flat mounting" note
// instead of a wrong picture.

export type BoardOrientationKind = 'flat' | 'inverted' | 'edge' | 'custom'

export interface BoardOrientationVisual {
  kind: BoardOrientationKind
  /** Yaw to rotate the top-down board by, degrees clockwise. 0 for non-flat. */
  yawDeg: number
  /** True when the board is mounted upside down (a 180° roll or pitch). */
  inverted: boolean
  /**
   * Which axis a 180° flip mirrors, applied after the yaw rotation:
   *   - Roll 180 flips about the forward axis: nose stays forward, board sees
   *     its underside → mirror LEFT-RIGHT ('x').
   *   - Pitch 180 flips about the right axis: nose points backward → mirror
   *     TOP-BOTTOM ('y').
   * Undefined when not inverted.
   */
  mirror?: 'x' | 'y'
  /** The human label (e.g. "Yaw 90 Roll 180"). */
  label: string
  /** Set for 'edge'/'custom' — why no flat picture is drawn. */
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
    return { kind: 'custom', yawDeg: 0, inverted: false, label, note: 'Custom orientation — set by explicit angles.' }
  }

  if (value === 0 || /^none$/i.test(label)) {
    return { kind: 'flat', yawDeg: 0, inverted: false, label }
  }

  const { yaw, roll, pitch } = parseAngles(label)

  // A flat picture is only honest when roll and pitch are each either 0 or a
  // full 180° flip. Any 45/90/270/315 (or the odd 68/293/315) roll/pitch means
  // the board sits on its edge or at an angle — depict a note, not a rotation.
  const flipRoll = roll === 180
  const flipPitch = pitch === 180
  const rollIsFlatOrFlip = roll === 0 || roll === 180
  const pitchIsFlatOrFlip = pitch === 0 || pitch === 180

  if (!rollIsFlatOrFlip || !pitchIsFlatOrFlip) {
    return {
      kind: 'edge',
      yawDeg: 0,
      inverted: false,
      label,
      note: 'Board is mounted on its side or at an angle — see the label for the exact rotation.'
    }
  }

  const inverted = flipRoll || flipPitch
  return {
    kind: inverted ? 'inverted' : 'flat',
    yawDeg: yaw % 360,
    inverted,
    // Roll 180 mirrors left-right (nose stays forward); Pitch 180 mirrors
    // top-bottom (nose points backward).
    ...(flipRoll ? { mirror: 'x' as const } : flipPitch ? { mirror: 'y' as const } : {}),
    label
  }
}
