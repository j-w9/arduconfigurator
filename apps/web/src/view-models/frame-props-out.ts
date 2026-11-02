// The Motors tab's "Want props out?" box. A quad X (FRAME_TYPE 1) spins its
// props in; the props-out quad ArduPilot offers with the same corners is
// Betaflight X Reversed (18) -- H (3) is props out too, but is a different
// airframe. 18 also numbers the motors in Betaflight order (M1 rear right),
// so the box says so. Spins and order: AP_MotorsMatrix.cpp setup_quad_matrix.

export const FRAME_CLASS_QUAD = 1
export const FRAME_TYPE_X = 1
export const FRAME_TYPE_BF_X_REV = 18

export interface PropsOutChoice {
  /** Shown only on a quad set to X or Betaflight X Reversed. */
  offered: boolean
  checked: boolean
}

export function propsOutChoice(frameClass: number | undefined, frameType: number | undefined): PropsOutChoice {
  const offered = frameClass === FRAME_CLASS_QUAD && (frameType === FRAME_TYPE_X || frameType === FRAME_TYPE_BF_X_REV)
  return { offered, checked: offered && frameType === FRAME_TYPE_BF_X_REV }
}

/** The FRAME_TYPE the box stages. */
export function propsOutFrameType(propsOut: boolean): number {
  return propsOut ? FRAME_TYPE_BF_X_REV : FRAME_TYPE_X
}
