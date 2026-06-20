// Guided motor-reorder mapping math, extracted from App.tsx so the
// safety-critical inversion has a pure, unit-tested surface. A wrong
// inversion silently flips which output drives a motor — a crash on the
// first arm — so this is locked by motor-reorder-mapping.test.ts.
//
// Two coordinate spaces, both numbered 1..N, easy to confuse:
//   - OUTPUT CHANNEL: the physical SERVOn pin the configurator spins.
//   - MOTOR POSITION: the frame-layout slot the operator clicks on the
//     schematic (node.motorNumber) when they see that position move.
//
// Guided identify records mapping[outputChannel] = clickedMotorPosition
// ("spinning OUTc moved the motor at frame-position p"). The reorder
// table wants the inverse: selections[motorPosition] = outputChannel
// ("frame-position p must be driven by output c"). Staging then writes
// SERVOc_FUNCTION = Motor_p — i.e. the output that physically moves
// position p carries Motor_p's function. Verified correct for identity,
// transposition, 3-cycle, and already-remapped starting configs.

/** mapping: outputChannel → clicked motor position. */
export type GuidedReorderMapping = Record<string, number>

/** Invert an output→position identify map into the reorder table's
 *  motorPosition→outputChannel selection map. */
export function invertGuidedReorderMapping(mapping: GuidedReorderMapping): Record<string, string> {
  const selections: Record<string, string> = {}
  for (const [outputChannel, motorPosition] of Object.entries(mapping)) {
    selections[String(motorPosition)] = outputChannel
  }
  return selections
}

/**
 * A guided identify result is usable only if it is a BIJECTION: every
 * spun output was assigned, and no two outputs were assigned to the same
 * frame position (which would drop a motor and silently mis-map). The
 * UI prevents double-picking a position; this is the enforced backstop
 * before the inversion is trusted.
 */
export function isGuidedReorderComplete(
  mapping: GuidedReorderMapping,
  expectedOutputCount: number
): boolean {
  const positions = Object.values(mapping)
  if (positions.length !== expectedOutputCount) {
    return false
  }
  return new Set(positions).size === positions.length
}

/** Positions already claimed in this identify run — used to lock their
 *  schematic nodes so a second click can't overwrite an earlier pick. */
export function pickedReorderPositions(mapping: GuidedReorderMapping): Set<number> {
  return new Set(Object.values(mapping))
}
