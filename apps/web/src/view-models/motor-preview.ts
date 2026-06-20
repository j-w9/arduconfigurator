// Motor-preview geometry for the Outputs view.
//
// First module of the App.tsx view-model decomposition: a self-contained,
// pure cluster (a frame layout → motor node positions) lifted out verbatim
// so App.tsx consumes `createMotorPreviewNodes` instead of carrying the
// geometry inline. Behavior-preserving — no caller-visible change.

export interface MotorPreviewNode {
  motorNumber: number
  x: number
  y: number
  stack?: 'top' | 'bottom'
  /** Prop rotation viewed from above, per the ArduPilot motor-order
   *  docs for this frame. Only set for frames whose direction table is
   *  known (quad X variants and quad +); omitted elsewhere so the
   *  diagram never GUESSES a direction the operator might build to. */
  spin?: 'cw' | 'ccw'
}

// Physical spin direction by CORNER for every quad-X numbering variant
// (X, Betaflight X, DJI X, Clockwise X — numbering differs, physics
// doesn't): front-right CCW, rear-right CW, rear-left CCW, front-left
// CW. "Reversed"/props-out frame types flip all four.
const QUAD_X_SPIN_BY_CORNER: ReadonlyArray<'cw' | 'ccw'> = ['ccw', 'cw', 'ccw', 'cw']
// Quad + by position [front, right, rear, left]: front CW (M3),
// right CCW (M1), rear CW (M4), left CCW (M2).
const QUAD_PLUS_SPIN_BY_POSITION: ReadonlyArray<'cw' | 'ccw'> = ['cw', 'ccw', 'cw', 'ccw']

function flipSpin(spin: 'cw' | 'ccw'): 'cw' | 'ccw' {
  return spin === 'cw' ? 'ccw' : 'cw'
}

function circularMotorPreviewNodes(motorCount: number, radius: number, rotationOffsetDeg = -90): MotorPreviewNode[] {
  if (motorCount <= 0) {
    return []
  }

  return Array.from({ length: motorCount }, (_, index) => {
    const angle = ((rotationOffsetDeg + (360 / motorCount) * index) * Math.PI) / 180
    return {
      motorNumber: index + 1,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius
    }
  })
}

function quadXPreviewNodes(
  motorNumbersByCorner: [number, number, number, number],
  reversedProps = false
): MotorPreviewNode[] {
  const positions = [
    { x: 0.64, y: -0.64 }, // front right
    { x: 0.64, y: 0.64 }, // rear right
    { x: -0.64, y: 0.64 }, // rear left
    { x: -0.64, y: -0.64 }, // front left
  ] as const

  return motorNumbersByCorner
    .map((motorNumber, index) => ({
      motorNumber,
      x: positions[index].x,
      y: positions[index].y,
      spin: reversedProps ? flipSpin(QUAD_X_SPIN_BY_CORNER[index]) : QUAD_X_SPIN_BY_CORNER[index]
    }))
    .sort((left, right) => left.motorNumber - right.motorNumber)
}

function quadPlusPreviewNodes(motorNumbersByPosition: [number, number, number, number]): MotorPreviewNode[] {
  const positions = [
    { x: 0, y: -0.78 }, // front
    { x: 0.78, y: 0 }, // right
    { x: 0, y: 0.78 }, // rear
    { x: -0.78, y: 0 }, // left
  ] as const

  return motorNumbersByPosition
    .map((motorNumber, index) => ({
      motorNumber,
      x: positions[index].x,
      y: positions[index].y,
      spin: QUAD_PLUS_SPIN_BY_POSITION[index]
    }))
    .sort((left, right) => left.motorNumber - right.motorNumber)
}

export function createMotorPreviewNodes(motorCount: number, frameTypeLabel: string): MotorPreviewNode[] {
  const normalizedFrameType = frameTypeLabel.toLowerCase()

  if (motorCount <= 0) {
    return []
  }

  if (motorCount === 2) {
    return [
      { motorNumber: 1, x: -0.72, y: 0 },
      { motorNumber: 2, x: 0.72, y: 0 }
    ]
  }

  if (motorCount === 3) {
    return [
      { motorNumber: 1, x: 0, y: -0.76 },
      { motorNumber: 2, x: 0.66, y: 0.48 },
      { motorNumber: 3, x: -0.66, y: 0.48 }
    ]
  }

  if (motorCount === 4) {
    // "Reversed" frame variants (props-out builds, e.g. BetaflightXReversed)
    // flip every motor's rotation relative to the standard table.
    const reversedProps = normalizedFrameType.includes('rev')

    if (normalizedFrameType.includes('betaflight x')) {
      return quadXPreviewNodes([2, 1, 3, 4], reversedProps)
    }

    if (normalizedFrameType.includes('dji x')) {
      return quadXPreviewNodes([1, 4, 3, 2], reversedProps)
    }

    if (normalizedFrameType.includes('clockwise x')) {
      return quadXPreviewNodes([1, 2, 3, 4], reversedProps)
    }

    if (normalizedFrameType.includes('+')) {
      return quadPlusPreviewNodes([3, 1, 4, 2])
    }

    if (normalizedFrameType.includes('y4') || normalizedFrameType.includes('tail')) {
      // Y4 / V-tail / A-tail fall through to the shape-specific tables
      // below (their rear-motor directions don't follow the X corner
      // rule; no arrows rather than wrong arrows).
    } else {
      return quadXPreviewNodes([1, 4, 2, 3], reversedProps)
    }
  }

  if (motorCount === 6 && normalizedFrameType.includes('+')) {
    return [
      { motorNumber: 1, x: 0.6, y: -0.36 },
      { motorNumber: 2, x: 0.6, y: 0.36 },
      { motorNumber: 3, x: -0.6, y: -0.36 },
      { motorNumber: 4, x: -0.6, y: 0.36 },
      { motorNumber: 5, x: 0, y: 0.78 },
      { motorNumber: 6, x: 0, y: -0.78 }
    ]
  }

  if (motorCount === 6 && normalizedFrameType.includes('y6')) {
    return [
      { motorNumber: 1, x: 0, y: -0.52, stack: 'top' },
      { motorNumber: 2, x: 0.56, y: 0.4, stack: 'top' },
      { motorNumber: 3, x: -0.56, y: 0.4, stack: 'top' },
      { motorNumber: 4, x: 0, y: -0.76, stack: 'bottom' },
      { motorNumber: 5, x: 0.76, y: 0.52, stack: 'bottom' },
      { motorNumber: 6, x: -0.76, y: 0.52, stack: 'bottom' }
    ]
  }

  if (motorCount === 8 && normalizedFrameType.includes('x8')) {
    return [
      { motorNumber: 1, x: 0.46, y: -0.46, stack: 'top' },
      { motorNumber: 2, x: 0.46, y: 0.46, stack: 'top' },
      { motorNumber: 3, x: -0.46, y: -0.46, stack: 'top' },
      { motorNumber: 4, x: -0.46, y: 0.46, stack: 'top' },
      { motorNumber: 5, x: 0.68, y: -0.68, stack: 'bottom' },
      { motorNumber: 6, x: 0.68, y: 0.68, stack: 'bottom' },
      { motorNumber: 7, x: -0.68, y: -0.68, stack: 'bottom' },
      { motorNumber: 8, x: -0.68, y: 0.68, stack: 'bottom' }
    ]
  }

  if (motorCount === 4 && normalizedFrameType.includes('y4')) {
    return [
      { motorNumber: 1, x: 0, y: -0.52, stack: 'top' },
      { motorNumber: 2, x: 0.76, y: 0.52 },
      { motorNumber: 3, x: 0, y: -0.78, stack: 'bottom' },
      { motorNumber: 4, x: -0.76, y: 0.52 }
    ]
  }

  if (motorCount === 4 && normalizedFrameType.includes('v-tail')) {
    return [
      { motorNumber: 1, x: 0.48, y: -0.6 },
      { motorNumber: 2, x: 0.76, y: 0.56 },
      { motorNumber: 3, x: -0.48, y: -0.6 },
      { motorNumber: 4, x: -0.76, y: 0.56 }
    ]
  }

  if (motorCount === 4 && normalizedFrameType.includes('a-tail')) {
    return [
      { motorNumber: 1, x: -0.48, y: -0.6 },
      { motorNumber: 2, x: 0.76, y: 0.56 },
      { motorNumber: 3, x: 0.48, y: -0.6 },
      { motorNumber: 4, x: -0.76, y: 0.56 }
    ]
  }

  return circularMotorPreviewNodes(motorCount, motorCount >= 8 ? 0.8 : 0.74)
}
