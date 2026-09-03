// Collect the gravity vectors an accelerometer calibration already produces.
//
// The calibration walks the operator through six known poses. That is exactly
// the labelled data board-orientation detection needs, so there is no reason to
// ask them to hold the vehicle level and nose-down a second time afterwards --
// they just did it.
//
// The pose label comes from the autopilot's own prompt, not from our attitude
// readout, and that distinction is load-bearing. Attitude is derived through
// AHRS_ORIENTATION, so on a board whose orientation is wrong -- precisely the
// case worth detecting -- the attitude check disagrees with the operator about
// which pose they are in. The firmware's prompt says what they were ASKED to
// do, which is what makes the sample meaningful.

import type { AccelerometerPoseId } from '@arduconfig/ardupilot-core'

import { summariseSteadyWindow, type Vector3 } from './board-orientation-detect'

/** ~1s at the boosted 10 Hz stream. */
const WINDOW_SAMPLES = 10

export interface AccelCalCaptureState {
  /** Steadiest reading seen for each pose the calibration asked for. */
  samples: Partial<Record<AccelerometerPoseId, Vector3>>
  /** Readings for the pose currently being asked for. */
  window: readonly Vector3[]
  pose?: AccelerometerPoseId
  /** Whether a calibration was running at the last observation. */
  wasRunning: boolean
}

export function createAccelCalCaptureState(): AccelCalCaptureState {
  return { samples: {}, window: [], wasRunning: false }
}

export interface AccelCalObservation {
  /** Is the accelerometer calibration running right now? */
  running: boolean
  /** The pose the autopilot is currently asking for. */
  pose: AccelerometerPoseId | undefined
  /** Latest accelerometer reading, m/s², or undefined if none has arrived. */
  accel: Vector3 | undefined
}

/**
 * Fold one observation into the capture state.
 *
 * Pure so the whole capture can be tested without a vehicle: the interesting
 * behaviour is which readings are kept and which are thrown away, and that
 * should not require a calibration to exercise.
 */
export function observeAccelCalSample(
  state: AccelCalCaptureState,
  observation: AccelCalObservation
): AccelCalCaptureState {
  const { running, pose, accel } = observation

  // A calibration starting clears whatever the last one measured. Carrying
  // samples across runs would let a pose captured before the vehicle was
  // remounted contribute to the answer.
  if (running && !state.wasRunning) {
    return { samples: {}, window: accel ? [accel] : [], pose, wasRunning: true }
  }

  if (!running) {
    // Keep the samples: the recommendation is read AFTER the calibration ends.
    return { ...state, window: [], pose: undefined, wasRunning: false }
  }

  if (pose !== state.pose) {
    return { ...state, window: accel ? [accel] : [], pose, wasRunning: true }
  }

  if (!accel || !pose) {
    return { ...state, wasRunning: true }
  }

  const window = [...state.window, accel].slice(-WINDOW_SAMPLES)
  const summary = summariseSteadyWindow(window)
  if (!summary.steady || !summary.accel) {
    return { ...state, window, wasRunning: true }
  }

  // Latest steady window wins: the operator settles into a pose, and the
  // reading just before they move on is the one they actually held.
  return {
    ...state,
    window,
    pose,
    wasRunning: true,
    samples: { ...state.samples, [pose]: summary.accel }
  }
}

/** Poses captured so far, as detectBoardOrientation wants them. */
export function capturedSamples(
  state: AccelCalCaptureState
): { pose: AccelerometerPoseId; accel: Vector3 }[] {
  return (Object.entries(state.samples) as [AccelerometerPoseId, Vector3][]).map(([pose, accel]) => ({
    pose,
    accel
  }))
}
