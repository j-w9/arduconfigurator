import { describe, expect, it } from 'vitest'

import {
  CRSF_RC_CENTER_US,
  CRSF_RC_MAX_US,
  CRSF_RC_MIN_US,
  RC_CALIBRATION_TOLERANCE_US,
  RC_CHANNEL_OPTIONS,
  assessTransmitterCalibration,
  buildAxisAssignmentDrafts,
  buildCrsfEndpointDrafts,
  detectRcLinkProtocol,
  withRcChannelOptions
} from './receiver-channels'

describe('withRcChannelOptions', () => {
  it('lists CH1..CH16 while keeping the parameter id and metadata', () => {
    const parameter = withRcChannelOptions({
      id: 'RCMAP_ROLL',
      value: 1,
      type: 'uint8',
      definition: { id: 'RCMAP_ROLL', label: 'Roll Channel Map', description: 'd', category: 'radio', rebootRequired: true }
    } as never)
    expect(parameter.id).toBe('RCMAP_ROLL')
    expect(parameter.definition?.rebootRequired).toBe(true)
    expect(parameter.definition?.options).toBe(RC_CHANNEL_OPTIONS)
    expect(RC_CHANNEL_OPTIONS).toHaveLength(16)
    expect(RC_CHANNEL_OPTIONS[0]).toEqual({ value: 1, label: 'CH1' })
    expect(RC_CHANNEL_OPTIONS[15]).toEqual({ value: 16, label: 'CH16' })
  })
})

describe('CRSF range', () => {
  it('matches what AP_RCProtocol_CRSF decodes (ticks * 5 / 8 + 880)', () => {
    expect(CRSF_RC_MIN_US).toBe(987)
    expect(CRSF_RC_MAX_US).toBe(2011)
    expect(CRSF_RC_CENTER_US).toBe(1500)
  })
})

describe('detectRcLinkProtocol', () => {
  it('is CRSF when the allow-list admits only CRSF', () => {
    expect(detectRcLinkProtocol({ rcProtocolsMask: 512, statusTexts: [] })).toBe('crsf')
  })

  it('is unknown on the default "All" list or a wider list', () => {
    expect(detectRcLinkProtocol({ rcProtocolsMask: 1, statusTexts: [] })).toBe('unknown')
    expect(detectRcLinkProtocol({ rcProtocolsMask: 512 | 8, statusTexts: [] })).toBe('unknown')
    expect(detectRcLinkProtocol({ rcProtocolsMask: undefined, statusTexts: [] })).toBe('unknown')
  })

  it('is CRSF when the boot STATUSTEXT said so', () => {
    expect(
      detectRcLinkProtocol({ rcProtocolsMask: 1, statusTexts: [{ text: 'RCInput: decoding CRSF(23)' }] })
    ).toBe('crsf')
    expect(detectRcLinkProtocol({ rcProtocolsMask: 1, statusTexts: [{ text: 'RCInput: decoding SBUS' }] })).toBe(
      'unknown'
    )
  })
})

describe('buildCrsfEndpointDrafts', () => {
  it('stages MIN/MAX/TRIM only for the channels the controller reports', () => {
    const present = new Set(['RC1_MIN', 'RC1_MAX', 'RC1_TRIM', 'RC2_MIN', 'RC2_MAX', 'RC7_MIN', 'RC7_MAX'])
    const drafts = buildCrsfEndpointDrafts((id) => present.has(id))
    expect(drafts).toEqual({
      RC1_MIN: '987',
      RC1_MAX: '2011',
      RC1_TRIM: '1500',
      RC2_MIN: '987',
      RC2_MAX: '2011',
      RC7_MIN: '987',
      RC7_MAX: '2011'
    })
  })
})

describe('assessTransmitterCalibration', () => {
  const good = { channelNumber: 1, observedMin: 987, observedMax: 2011, centerPwm: 1500, complete: true }

  it('says nothing until the stick has been swept both ways or the capture is complete', () => {
    // 1400..1600 is a nudged stick: not judged.
    expect(
      assessTransmitterCalibration({ ...good, observedMin: 1400, observedMax: 1600, complete: false })
    ).toBeUndefined()
    // 1200..1800 is a deliberate sweep that still falls short: judged without
    // waiting for a "both ends" that a short stick can never deliver.
    expect(assessTransmitterCalibration({ ...good, observedMin: 1200, observedMax: 1800, complete: false })).toContain(
      '1200..1800'
    )
  })

  it('accepts a radio that reaches the CRSF range within the tolerance', () => {
    expect(assessTransmitterCalibration(good)).toBeUndefined()
    expect(
      assessTransmitterCalibration({
        ...good,
        observedMin: 987 + RC_CALIBRATION_TOLERANCE_US,
        observedMax: 2011 - RC_CALIBRATION_TOLERANCE_US,
        centerPwm: 1500 + RC_CALIBRATION_TOLERANCE_US
      })
    ).toBeUndefined()
  })

  it('flags a short end, naming the channel, the reach and the centre', () => {
    expect(assessTransmitterCalibration({ ...good, observedMin: 1200, observedMax: 1800 })).toBe(
      'CH1: 1200..1800, centre 1500. Calibrate the radio.'
    )
  })

  it('flags a centre that rests off 1500 by more than the tolerance', () => {
    expect(assessTransmitterCalibration({ ...good, centerPwm: 1500 + RC_CALIBRATION_TOLERANCE_US + 1 })).toContain(
      'centre 1521'
    )
  })

  it('does not judge the centre of a throttle (no centre)', () => {
    expect(assessTransmitterCalibration({ ...good, channelNumber: 3, centerPwm: undefined })).toBeUndefined()
    expect(assessTransmitterCalibration({ ...good, channelNumber: 3, centerPwm: undefined, observedMax: 1900 })).toBe(
      'CH3: 987..1900. Calibrate the radio.'
    )
  })
})

describe('buildAxisAssignmentDrafts', () => {
  const map = { roll: 1, pitch: 2, throttle: 3, yaw: 4 }
  const noOptions = (): number | undefined => undefined

  it('swaps two axes so all four stay on distinct channels', () => {
    expect(buildAxisAssignmentDrafts(map, 'roll', 2, noOptions)).toEqual({ RCMAP_ROLL: '2', RCMAP_PITCH: '1' })
  })

  it('moves an axis onto a free channel and clears the function there', () => {
    expect(buildAxisAssignmentDrafts(map, 'throttle', 6, (channel) => (channel === 6 ? 153 : 0))).toEqual({
      RCMAP_THROTTLE: '6',
      RC6_OPTION: '0'
    })
  })

  it('leaves a channel with no function, or Do Nothing, alone', () => {
    expect(buildAxisAssignmentDrafts(map, 'yaw', 7, () => 0)).toEqual({ RCMAP_YAW: '7' })
  })

  it('stages nothing when the axis is already there', () => {
    expect(buildAxisAssignmentDrafts(map, 'pitch', 2, noOptions)).toEqual({})
  })
})
