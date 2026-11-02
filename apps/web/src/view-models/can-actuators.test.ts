import { describe, expect, it } from 'vitest'
import { dronecanCatalogue } from '@arduconfig/dronecan-dsdl'

import {
  ACTUATOR_ARRAY_COMMAND,
  ARMING_STATUS,
  ESC_RAW_COMMAND,
  SAFETY_STATE,
  actuatorBlockedReason,
  armingStatusValue,
  buildEscRawCommandValue,
  buildEscStopValue,
  buildServoArrayCommandValues,
  clampServoValue,
  escRawFromPercent,
  findActuatorConflict,
  safetyStateValue
} from './can-actuators'

describe('ESC commands', () => {
  it('maps percent to RawCommand and caps at the limit', () => {
    expect(escRawFromPercent(0, 20)).toBe(0)
    expect(escRawFromPercent(10, 20)).toBe(819)
    expect(escRawFromPercent(50, 20)).toBe(1638)
    expect(escRawFromPercent(100, 100)).toBe(8191)
    expect(escRawFromPercent(-5, 100)).toBe(0)
    expect(escRawFromPercent(Number.NaN, 100)).toBe(0)
  })
  it('builds one cmd per ESC, missing ones at zero', () => {
    expect(buildEscRawCommandValue([10, 0, 5], 4, 20)).toEqual({ cmd: [819, 0, 410, 0] })
    expect(buildEscRawCommandValue([], 25, 20).cmd).toHaveLength(20)
    expect(buildEscStopValue(4)).toEqual({ cmd: [0, 0, 0, 0] })
  })
  it('encodes with the DSDL catalogue', () => {
    const catalogue = dronecanCatalogue()
    expect(() => catalogue.encode(ESC_RAW_COMMAND, 'msg', buildEscRawCommandValue([10, 20], 4, 30))).not.toThrow()
    expect(() => catalogue.encode(SAFETY_STATE, 'msg', safetyStateValue(true))).not.toThrow()
    expect(() => catalogue.encode(ARMING_STATUS, 'msg', armingStatusValue(false))).not.toThrow()
  })
})

describe('servo commands', () => {
  it('clamps by type', () => {
    expect(clampServoValue('pwm', 3000)).toBe(2200)
    expect(clampServoValue('pwm', 1499.6)).toBe(1500)
    expect(clampServoValue('unitless', -2)).toBe(-1)
    expect(clampServoValue('pwm', Number.NaN)).toBe(1500)
  })
  it('splits into messages of 15 and encodes', () => {
    const channels = Array.from({ length: 17 }, (_, index) => ({ actuatorId: index + 1, value: 1500 }))
    const messages = buildServoArrayCommandValues(channels, 'pwm')
    expect(messages).toHaveLength(2)
    expect((messages[0].commands as unknown[]).length).toBe(15)
    expect((messages[1].commands as unknown[])[0]).toEqual({ actuator_id: 16, command_type: 4, command_value: 1500 })
    const catalogue = dronecanCatalogue()
    for (const message of messages) expect(() => catalogue.encode(ACTUATOR_ARRAY_COMMAND, 'msg', message)).not.toThrow()
  })
  it('drops actuator id 0 (AP_Periph ids are 1-based)', () => {
    expect(buildServoArrayCommandValues([{ actuatorId: 0, value: 1500 }], 'pwm')).toEqual([])
  })
})

describe('conflicts and blocks', () => {
  const now = 10_000
  it('another node sending ESC commands recently is a conflict; our own and stale ones are not', () => {
    expect(findActuatorConflict([{ dataTypeId: 1030, sourceNodeId: 10, lastSeenMs: now - 500 }], 127, now)).toEqual({ nodeId: 10, dataTypeId: 1030 })
    expect(findActuatorConflict([{ dataTypeId: 1030, sourceNodeId: 127, lastSeenMs: now }], 127, now)).toBeUndefined()
    expect(findActuatorConflict([{ dataTypeId: 1030, sourceNodeId: 10, lastSeenMs: now - 5000 }], 127, now)).toBeUndefined()
    expect(findActuatorConflict([{ dataTypeId: 1034, sourceNodeId: 50, lastSeenMs: now }], 127, now)).toBeUndefined()
  })
  it('blocks in order: armed, bus, conflict, safety box', () => {
    expect(actuatorBlockedReason({ busActive: true, armed: true, acknowledged: true })).toBe('Disarm the vehicle first.')
    expect(actuatorBlockedReason({ busActive: false, armed: false, acknowledged: true })).toBe('Connect to the bus on Devices first.')
    expect(actuatorBlockedReason({ busActive: true, armed: false, acknowledged: false, conflict: 'X' })).toBe('X')
    expect(actuatorBlockedReason({ busActive: true, armed: false, acknowledged: false })).toBe('Tick the safety box first.')
    expect(actuatorBlockedReason({ busActive: true, armed: false, acknowledged: true })).toBeUndefined()
  })
})
