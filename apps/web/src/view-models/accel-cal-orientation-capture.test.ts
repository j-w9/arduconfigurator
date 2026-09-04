import { describe, expect, it } from 'vitest'

import {
  createAccelCalCaptureState,
  capturedSamples,
  observeAccelCalSample,
  type AccelCalCaptureState
} from './accel-cal-orientation-capture'
import { detectBoardOrientation, type Vector3 } from './board-orientation-detect'

/** Real bench readings, m/s², from a connected flight controller. */
const LEVEL: Vector3 = [0.31, -0.07, -9.5]
const NOSE_DOWN: Vector3 = [-9.83, 0.19, 0.17]

function hold(
  state: AccelCalCaptureState,
  pose: 'level' | 'nose-down' | 'left',
  accel: Vector3,
  frames = 10
): AccelCalCaptureState {
  let next = state
  for (let i = 0; i < frames; i += 1) {
    next = observeAccelCalSample(next, { running: true, pose, accel })
  }
  return next
}

describe('observeAccelCalSample', () => {
  it('captures each pose the calibration asks for, without a second pass', () => {
    let state = createAccelCalCaptureState()
    state = hold(state, 'level', LEVEL)
    state = hold(state, 'nose-down', NOSE_DOWN)
    // Calibration finishes; the samples must outlive it, because the
    // recommendation is read afterwards.
    state = observeAccelCalSample(state, { running: false, pose: undefined, accel: undefined })

    const samples = capturedSamples(state)
    expect(samples.map((sample) => sample.pose).sort()).toEqual(['level', 'nose-down'])

    const detection = detectBoardOrientation(samples, 0)
    expect(detection.status).toBe('detected')
    expect(detection.best!.rotation.value).toBe(0)
  })

  it('keeps nothing from a pose the vehicle was moving through', () => {
    let state = createAccelCalCaptureState()
    // Being carried into position: every frame differs.
    for (const accel of [
      [0.74, 1.1, -10.63],
      [0.55, 1.29, -8.37],
      [0.37, -1.01, -10.49],
      [-0.88, -1.03, -8.47]
    ] as Vector3[]) {
      state = observeAccelCalSample(state, { running: true, pose: 'level', accel })
    }
    expect(capturedSamples(state)).toEqual([])
  })

  it('starts clean when a new calibration begins', () => {
    let state = createAccelCalCaptureState()
    state = hold(state, 'level', LEVEL)
    state = observeAccelCalSample(state, { running: false, pose: undefined, accel: undefined })
    expect(capturedSamples(state)).toHaveLength(1)

    // A second run must not inherit a pose measured before the board was
    // possibly remounted.
    state = observeAccelCalSample(state, { running: true, pose: 'level', accel: LEVEL })
    expect(capturedSamples(state)).toEqual([])
  })

  it('does not let one pose bleed into the next', () => {
    let state = createAccelCalCaptureState()
    // Half a window of level, then the prompt advances before it was steady.
    state = hold(state, 'level', LEVEL, 2)
    state = observeAccelCalSample(state, { running: true, pose: 'nose-down', accel: NOSE_DOWN })
    expect(state.window).toHaveLength(1)
    expect(capturedSamples(state)).toEqual([])
  })
})
