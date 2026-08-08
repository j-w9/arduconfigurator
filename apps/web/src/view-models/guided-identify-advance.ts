// Guided motor-identify "advance on selection" state machine, kept pure so
// the ordering it dictates can be unit-tested off the runtime. An ordering
// bug here spins the WRONG motor (or two at once), so every branch is
// enumerated and locked by guided-identify-advance.test.ts.
//
// WHY this exists: identify used to leave the motor spinning for the whole
// test window after the operator had already answered "that one moved". The
// answer ends the spin's usefulness, so the flow now stops the motor the
// instant the position is picked and starts the next one behind that stop.
//
// The plan this returns is deliberately declarative — App.tsx executes it in
// a fixed order (record mapping -> stop -> await ACK -> start next). Keeping
// the decision separate from the I/O is what makes the ordering testable.

import { pickedReorderPositions, type GuidedReorderMapping } from './motor-reorder-mapping'

export interface GuidedIdentifyAdvanceInput {
  /** Is a guided identify run in progress? */
  active: boolean
  /** True while a previous selection's stop/start pair is still in flight.
   *  Double-clicks and impatient repeat clicks land here — two starts racing
   *  would spin an unexpected motor, so the second click is dropped. */
  advanceInFlight: boolean
  /** Index into `outputChannels` of the output currently being identified. */
  step: number
  /** Output channel numbers in identify order (effectiveMotorOutputs). */
  outputChannels: number[]
  /** Accumulated outputChannel -> clicked motor position map. */
  mapping: GuidedReorderMapping
  /** The frame position the operator just clicked. */
  clickedMotorPosition: number
  /** Operator's "auto-spin each motor after the first" preference. With it
   *  off, a selection still STOPS the pointless spin — it just doesn't start
   *  the next motor, leaving the operator their manual Spin click. */
  autoSpin: boolean
  /** Props-off AND area-clear, re-read at selection time. A run that lost its
   *  acknowledgement mid-sequence stops the current motor but starts nothing. */
  safetyAcknowledged: boolean
}

export type GuidedIdentifyAdvanceIgnoreReason =
  | 'inactive'
  | 'advance-in-flight'
  | 'no-current-output'
  | 'position-already-picked'

export type GuidedIdentifyAdvancePlan =
  | { kind: 'ignore'; reason: GuidedIdentifyAdvanceIgnoreReason }
  | {
      /** More outputs remain: record the pick, stop the spinning motor, and
       *  (when allowed) start `startStep` once the stop is acknowledged. */
      kind: 'advance'
      nextMapping: GuidedReorderMapping
      nextStep: number
      /** Index to spin after the stop, or undefined to wait for a manual
       *  Spin click (auto-spin off, or the safety ack was withdrawn). */
      startStep: number | undefined
    }
  | {
      /** Last output identified: stop the spinning motor and start NOTHING. */
      kind: 'complete'
      nextMapping: GuidedReorderMapping
    }

/**
 * Decide what a click on a frame position during guided identify should do.
 * Pure: no timers, no I/O, no snapshot reads — the caller supplies the live
 * safety/busy facts as plain booleans.
 */
export function planGuidedIdentifyAdvance(input: GuidedIdentifyAdvanceInput): GuidedIdentifyAdvancePlan {
  const { active, advanceInFlight, step, outputChannels, mapping, clickedMotorPosition } = input

  if (!active) {
    return { kind: 'ignore', reason: 'inactive' }
  }
  // Ordering guard, not a cosmetic debounce: while the stop for the previous
  // pick is still on the wire, a second pick would queue a second start.
  if (advanceInFlight) {
    return { kind: 'ignore', reason: 'advance-in-flight' }
  }
  const currentOutputChannel = outputChannels[step]
  if (currentOutputChannel === undefined) {
    return { kind: 'ignore', reason: 'no-current-output' }
  }
  // Backstop the UI's already-picked lock: reassigning a claimed position
  // would drop a motor and silently mis-map the reorder.
  if (pickedReorderPositions(mapping).has(clickedMotorPosition)) {
    return { kind: 'ignore', reason: 'position-already-picked' }
  }

  const nextMapping: GuidedReorderMapping = {
    ...mapping,
    [String(currentOutputChannel)]: clickedMotorPosition
  }
  const nextStep = step + 1
  if (nextStep >= outputChannels.length) {
    return { kind: 'complete', nextMapping }
  }

  return {
    kind: 'advance',
    nextMapping,
    nextStep,
    startStep: input.autoSpin && input.safetyAcknowledged ? nextStep : undefined
  }
}
