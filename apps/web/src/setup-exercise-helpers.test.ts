import { describe, expect, it } from 'vitest'

import {
  RC_CALIBRATION_SWITCH_CHANNELS,
  createIdleRcCalibrationSessionState,
  rcSwitchCaptureComplete
} from './setup-exercise-helpers'

describe('RC calibration switch captures (CH5/CH6)', () => {
  it('seeds an idle session with a switch capture per configured switch channel', () => {
    const session = createIdleRcCalibrationSessionState()
    expect(Object.keys(session.switchCaptures).map(Number).sort()).toEqual([...RC_CALIBRATION_SWITCH_CHANNELS].sort())
    for (const channelNumber of RC_CALIBRATION_SWITCH_CHANNELS) {
      const capture = session.switchCaptures[channelNumber]
      expect(capture).toMatchObject({
        channelNumber,
        label: `CH${channelNumber}`,
        lowObserved: false,
        highObserved: false
      })
      expect(capture.observedMin).toBeUndefined()
      expect(capture.observedMax).toBeUndefined()
    }
  })

  it('keeps the four control axes as the only completion gate (switches are optional)', () => {
    // The switch captures live alongside the axis captures but must not appear
    // in the axis map — a 4-channel radio must still be able to finish.
    const session = createIdleRcCalibrationSessionState()
    expect(Object.keys(session.captures).sort()).toEqual(['pitch', 'roll', 'throttle', 'yaw'])
  })

  it('marks a switch complete only once both ends are seen', () => {
    expect(rcSwitchCaptureComplete({ channelNumber: 5, label: 'CH5', lowObserved: false, highObserved: false })).toBe(false)
    expect(rcSwitchCaptureComplete({ channelNumber: 5, label: 'CH5', lowObserved: true, highObserved: false })).toBe(false)
    expect(rcSwitchCaptureComplete({ channelNumber: 5, label: 'CH5', lowObserved: false, highObserved: true })).toBe(false)
    expect(
      rcSwitchCaptureComplete({
        channelNumber: 5,
        label: 'CH5',
        lowObserved: true,
        highObserved: true,
        observedMin: 1100,
        observedMax: 1900
      })
    ).toBe(true)
  })
})
