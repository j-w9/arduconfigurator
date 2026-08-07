import { describe, expect, it } from 'vitest'

import { deriveCanEnablement } from './can-enablement'

function snap(params: Record<string, number>) {
  return {
    parameters: Object.entries(params).map(([id, value]) => ({ id, value }))
  } as unknown as Parameters<typeof deriveCanEnablement>[0]
}

describe('deriveCanEnablement', () => {
  it('prompts to enable both params when GPS is DroneCAN and the bus is off', () => {
    const r = deriveCanEnablement(snap({ GPS_TYPE: 9, CAN_P1_DRIVER: 0, CAN_D1_PROTOCOL: 0 }))
    expect(r.needsEnable).toBe(true)
    expect(r.triggerLabels).toEqual(['GPS is set to DroneCAN'])
    expect(r.writes).toEqual([
      { paramId: 'CAN_P1_DRIVER', paramValue: 1 },
      { paramId: 'CAN_D1_PROTOCOL', paramValue: 1 }
    ])
  })

  it('only writes the missing param when the driver is already on', () => {
    const r = deriveCanEnablement(snap({ GPS_TYPE: 9, CAN_P1_DRIVER: 1, CAN_D1_PROTOCOL: 0 }))
    expect(r.needsEnable).toBe(true)
    expect(r.writes).toEqual([{ paramId: 'CAN_D1_PROTOCOL', paramValue: 1 }])
  })

  it('does nothing once the bus is enabled for DroneCAN', () => {
    const r = deriveCanEnablement(snap({ GPS_TYPE: 9, CAN_P1_DRIVER: 1, CAN_D1_PROTOCOL: 1 }))
    expect(r.needsEnable).toBe(false)
    expect(r.writes).toEqual([])
  })

  it('does nothing when no driver is on DroneCAN', () => {
    const r = deriveCanEnablement(snap({ GPS_TYPE: 2, CAN_P1_DRIVER: 0, CAN_D1_PROTOCOL: 0 }))
    expect(r.needsEnable).toBe(false)
  })

  it('does nothing on a board with no CAN params (nothing to enable)', () => {
    const r = deriveCanEnablement(snap({ GPS_TYPE: 9 }))
    expect(r.needsEnable).toBe(false)
    expect(r.writes).toEqual([])
  })

  it('triggers on a DroneCAN battery monitor and the moving-baseline GPS variants', () => {
    expect(deriveCanEnablement(snap({ BATT_MONITOR: 8, CAN_P1_DRIVER: 0 })).needsEnable).toBe(true)
    expect(deriveCanEnablement(snap({ GPS_TYPE: 22, CAN_P1_DRIVER: 0 })).triggerLabels).toEqual(['GPS is set to DroneCAN'])
    expect(deriveCanEnablement(snap({ GPS_TYPE2: 23, CAN_P1_DRIVER: 0 })).triggerLabels).toEqual(['GPS 2 is set to DroneCAN'])
  })

  it('lists every trigger when several peripherals are on DroneCAN', () => {
    const r = deriveCanEnablement(snap({ GPS_TYPE: 9, BATT_MONITOR: 8, CAN_P1_DRIVER: 0, CAN_D1_PROTOCOL: 0 }))
    expect(r.triggerLabels).toEqual(['GPS is set to DroneCAN', 'Battery monitor is set to DroneCAN'])
  })

  // FLOW_TYPE 6 = DroneCAN (AP_OpticalFlow.h Type::UAVCAN). A CAN flow sensor on
  // a disabled bus is silent in exactly the way a CAN GPS is, and this is the
  // trigger the Servos ▸ Peripherals optical-flow section keys its own copy of
  // the prompt off — hence the triggerParamIds assertions.
  it('triggers on a DroneCAN optical flow sensor', () => {
    const r = deriveCanEnablement(snap({ FLOW_TYPE: 6, CAN_P1_DRIVER: 0, CAN_D1_PROTOCOL: 0 }))
    expect(r.needsEnable).toBe(true)
    expect(r.triggerLabels).toEqual(['Optical flow is set to DroneCAN'])
    expect(r.triggerParamIds).toEqual(['FLOW_TYPE'])
  })

  it('does not trigger on a directly-wired flow sensor', () => {
    // 4 = CXOF (serial), not a CAN device — nothing to enable.
    const r = deriveCanEnablement(snap({ FLOW_TYPE: 4, CAN_P1_DRIVER: 0, CAN_D1_PROTOCOL: 0 }))
    expect(r.needsEnable).toBe(false)
    expect(r.triggerParamIds).toEqual([])
  })

  it('reports which drivers fired so a scoped surface can filter the prompt', () => {
    const r = deriveCanEnablement(snap({ GPS_TYPE: 9, FLOW_TYPE: 6, CAN_P1_DRIVER: 0, CAN_D1_PROTOCOL: 0 }))
    expect(r.triggerParamIds).toEqual(['GPS_TYPE', 'FLOW_TYPE'])
    // A GPS-only trigger must NOT light up the optical-flow section.
    expect(deriveCanEnablement(snap({ GPS_TYPE: 9, CAN_P1_DRIVER: 0 })).triggerParamIds).toEqual(['GPS_TYPE'])
  })

  it('handles a missing CAN_D1_PROTOCOL param (writes only the driver)', () => {
    const r = deriveCanEnablement(snap({ GPS_TYPE: 9, CAN_P1_DRIVER: 0 }))
    expect(r.writes).toEqual([{ paramId: 'CAN_P1_DRIVER', paramValue: 1 }])
  })
})
