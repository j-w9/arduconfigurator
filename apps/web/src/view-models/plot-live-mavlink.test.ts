import { describe, expect, it } from 'vitest'

import { mavlinkRecordForPlot } from './plot-live-mavlink'

describe('live MAVLink for plotting', () => {
  it('puts decoded fields back under the MAVLink spec names', () => {
    expect(
      mavlinkRecordForPlot({ type: 'ATTITUDE', timeBootMs: 10, rollRad: 0.1, pitchRad: -0.2, yawRad: 1, rollSpeedRadS: 0, pitchSpeedRadS: 0, yawSpeedRadS: 0 })
    ).toEqual({ name: 'ATTITUDE', record: { time_boot_ms: 10, roll: 0.1, pitch: -0.2, yaw: 1, rollspeed: 0, pitchspeed: 0, yawspeed: 0 } })
    expect(mavlinkRecordForPlot({ type: 'RC_CHANNELS', timeBootMs: 1, channelCount: 2, channels: [1500, 1100], rssi: 200 })?.record).toEqual({
      time_boot_ms: 1,
      chancount: 2,
      chan1_raw: 1500,
      chan2_raw: 1100,
      rssi: 200
    })
    expect(mavlinkRecordForPlot({ type: 'SCALED_IMU', timeBootMs: 1, accelMg: { x: 1, y: 2, z: -1000 }, temperatureCdeg: 3500 })?.record).toEqual({
      time_boot_ms: 1,
      xacc: 1,
      yacc: 2,
      zacc: -1000,
      temperature: 3500
    })
  })

  it('snake-cases fields it has no table for, and leaves plumbing out', () => {
    expect(mavlinkRecordForPlot({ type: 'HEARTBEAT', customMode: 5, baseMode: 81, systemStatus: 4, vehicleType: 'ArduCopter' })?.record).toEqual({
      custom_mode: 5,
      base_mode: 81,
      system_status: 4
    })
    expect(mavlinkRecordForPlot({ type: 'PARAM_VALUE', paramValue: 1 })).toBeUndefined()
    expect(mavlinkRecordForPlot({ type: 'STATUSTEXT', text: 'x' })).toBeUndefined()
  })

  it('takes generically decoded messages as they come, arrays kept for indexing', () => {
    expect(
      mavlinkRecordForPlot({ type: 'GENERIC', name: 'BATTERY_STATUS', messageId: 147, fields: { voltages: [4100, 4090], current_battery: 750, battery_function: 0, name_text: 'x' } })
    ).toEqual({ name: 'BATTERY_STATUS', record: { voltages: [4100, 4090], current_battery: 750, battery_function: 0 } })
    expect(mavlinkRecordForPlot({ type: 'GENERIC', name: 'STATUSTEXT', messageId: 253, fields: { severity: 1 } })).toBeUndefined()
  })
})
