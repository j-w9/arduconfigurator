import { describe, expect, it } from 'vitest'

import { detectDominantRcChannelChange } from '@arduconfig/ardupilot-core'

import {
  RC_CALIBRATION_AXIS_ORDER,
  RC_CALIBRATION_SWITCH_CHANNELS,
  createIdleRcCalibrationSessionState,
  createRcMappingSessionState,
  describeRcMappingRejectedCandidate,
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

/*
 * A whole guided-mapping run, end to end.
 *
 * Every piece of this was unit-tested in isolation, but nothing walked the
 * four axes in sequence the way an operator does — start, move one stick,
 * capture, advance, repeat — which is the part that has to hold for the
 * feature to work at all. The stick positions below are a normal Mode 2
 * transmitter on a normal receiver: sticks sprung to centre, throttle resting
 * low, two aux switches parked.
 */
describe('guided RC mapping, full four-axis session', () => {
  const AT_REST = [1500, 1500, 1000, 1500, 1000, 1500, 2000, 1000]

  const snapshotWith = (channels: number[]) =>
    ({
      liveVerification: { rcInput: { verified: true, channels } }
    }) as unknown as Parameters<typeof createRcMappingSessionState>[0]

  /** Move one channel off the resting position, leaving the rest alone. */
  const deflect = (channelNumber: number, pwm: number) =>
    AT_REST.map((rest, index) => (index === channelNumber - 1 ? pwm : rest))

  it('walks roll → pitch → throttle → yaw and lands on a complete map', () => {
    let session = createRcMappingSessionState(snapshotWith(AT_REST))
    expect(session.status).toBe('running')
    expect(session.currentTargetAxis).toBe('roll')

    // The operator's four moves, in the order the app asks for them. Throttle
    // gets a full sweep because it has no centring spring and is held to a
    // higher threshold than the sprung axes.
    const moves: Array<[number, number]> = [
      [1, 1800], // roll right
      [2, 1200], // pitch forward
      [3, 1900], // throttle up
      [4, 1800] // yaw right
    ]

    for (const [channelNumber, pwm] of moves) {
      const targetAxis = session.currentTargetAxis
      expect(targetAxis).toBeDefined()

      const excluded = Object.values(session.captures)
        .map((capture) => capture.detectedChannelNumber)
        .filter((value): value is number => value !== undefined)

      const candidate = detectDominantRcChannelChange(deflect(channelNumber, pwm), session.baselineChannels, {
        excludedChannelNumbers: excluded,
        targetAxis
      })

      // The axis the app is asking for resolves to the channel that moved.
      expect(candidate, `no candidate while moving CH${channelNumber} for ${targetAxis}`).toBeDefined()
      expect(candidate?.channelNumber).toBe(channelNumber)

      session = {
        ...session,
        captures: {
          ...session.captures,
          [targetAxis!]: {
            ...session.captures[targetAxis!],
            detectedChannelNumber: candidate!.channelNumber,
            deltaUs: candidate!.deltaUs
          }
        }
      }
      const nextTargetAxis = RC_CALIBRATION_AXIS_ORDER.find(
        (axisId) => session.captures[axisId].detectedChannelNumber === undefined
      )
      session = { ...session, currentTargetAxis: nextTargetAxis, status: nextTargetAxis ? 'running' : 'ready' }
    }

    expect(session.status).toBe('ready')
    expect(
      Object.fromEntries(RC_CALIBRATION_AXIS_ORDER.map((a) => [a, session.captures[a].detectedChannelNumber]))
    ).toEqual({ roll: 1, pitch: 2, throttle: 3, yaw: 4 })
  })

  it('will not start without live RC, and says so rather than failing silently', () => {
    const session = createRcMappingSessionState({
      liveVerification: { rcInput: { verified: false, channels: [] } }
    } as unknown as Parameters<typeof createRcMappingSessionState>[0])
    expect(session.status).toBe('failed')
    expect(session.failureReason).toMatch(/telemetry/i)
  })

  it('ignores a stick that has not moved far enough to be deliberate', () => {
    const session = createRcMappingSessionState(snapshotWith(AT_REST))
    // 100us of roll — a knock or a trim, not an intentional sweep.
    const candidate = detectDominantRcChannelChange(deflect(1, 1600), session.baselineChannels, { targetAxis: 'roll' })
    expect(candidate).toBeUndefined()
  })

  it('does not mistake the throttle for a sprung axis, or vice versa', () => {
    const session = createRcMappingSessionState(snapshotWith(AT_REST))
    // Throttle moved while the app is asking for roll: rejected, because the
    // throttle channel's baseline is nowhere near centre.
    expect(
      detectDominantRcChannelChange(deflect(3, 1900), session.baselineChannels, { targetAxis: 'roll' })
    ).toBeUndefined()
    // A roll-sized nudge on the throttle step: rejected, because throttle is
    // held to a 250us sweep.
    expect(
      detectDominantRcChannelChange(deflect(3, 1150), session.baselineChannels, { targetAxis: 'throttle' })
    ).toBeUndefined()
  })
})

/*
 * The RC-mapping capture has three refusal paths and, before the 2026-09 audit,
 * only one of them could explain itself. The other two fell through to a
 * generic "keep moving only that control" — which is wrong advice in the
 * dominance case, where the operator IS moving only that control and their
 * radio is driving a second channel from it.
 */
describe('RC mapping refusals explain themselves', () => {
  const candidate = (channelNumber: number, deltaUs: number, baselinePwm = 1500) => ({
    channelNumber,
    deltaUs,
    baselinePwm,
    livePwm: baselinePwm + deltaUs
  })

  it('names both channels when two move together', () => {
    const reason = describeRcMappingRejectedCandidate('roll', undefined, [
      candidate(1, 300),
      candidate(7, 290)
    ])
    expect(reason).toMatch(/CH1 and CH7 are moving together/)
    expect(reason).toMatch(/mix or a shared lead/)
  })

  it('says move further when the stick barely moved', () => {
    const reason = describeRcMappingRejectedCandidate('roll', undefined, [candidate(1, 100)])
    expect(reason).toMatch(/too small to identify a channel/)
    expect(reason).toMatch(/all the way to one end/)
  })

  it('still explains a baseline that is nowhere near centre', () => {
    const reason = describeRcMappingRejectedCandidate('roll', candidate(3, 300, 1000), [candidate(3, 300, 1000)])
    expect(reason).toMatch(/throttle or another switch channel/)
  })

  it('has nothing to say when one channel cleanly dominates', () => {
    expect(
      describeRcMappingRejectedCandidate('roll', undefined, [candidate(1, 300), candidate(7, 40)])
    ).toBeUndefined()
  })
})
