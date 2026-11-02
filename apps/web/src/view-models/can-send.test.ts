import { describe, expect, it } from 'vitest'
import { canFrameFromRawId } from '@arduconfig/can-core'
import { DronecanTransferDecoder, dronecanCatalogue } from '@arduconfig/dronecan-dsdl'

import {
  buildDronecanSendFrames,
  canSendableTypes,
  dronecanFieldConstants,
  dronecanPrimitiveLimits,
  isDronecanByteArray,
  defaultDronecanValue,
  dronecanSendHazard,
  parseRawCanFrame,
  setDronecanValueAt
} from './can-send'

const catalogue = dronecanCatalogue()

describe('dronecanSendHazard', () => {
  it('flags what can move something, and what changes a node', () => {
    expect(dronecanSendHazard('uavcan.equipment.esc.RawCommand')).toBe('motion')
    expect(dronecanSendHazard('uavcan.equipment.actuator.ArrayCommand')).toBe('motion')
    expect(dronecanSendHazard('uavcan.equipment.safety.ArmingStatus')).toBe('motion')
    expect(dronecanSendHazard('com.hobbywing.esc.RawCommand')).toBe('motion')
    expect(dronecanSendHazard('uavcan.protocol.RestartNode')).toBe('node')
    expect(dronecanSendHazard('uavcan.protocol.param.ExecuteOpcode')).toBe('node')
    expect(dronecanSendHazard('uavcan.protocol.NodeStatus')).toBeUndefined()
    expect(dronecanSendHazard('uavcan.equipment.esc.Status')).toBeUndefined()
  })
})

describe('composing a DroneCAN message', () => {
  it('starts from zeros, a union\'s first field, empty dynamic arrays', () => {
    const value = defaultDronecanValue(catalogue, catalogue.section('uavcan.protocol.param.GetSet', 'req'))
    expect(value).toEqual({ index: 0, value: { empty: {} }, name: [] })
    expect(setDronecanValueAt(value, ['value'], { integer_value: 5 })).toEqual({ index: 0, value: { integer_value: 5 }, name: [] })
    const raw = defaultDronecanValue(catalogue, catalogue.section('uavcan.equipment.esc.RawCommand', 'msg'))
    expect(raw).toEqual({ cmd: [] })
    expect(setDronecanValueAt({ cmd: [0, 0] }, ['cmd', 1], 100)).toEqual({ cmd: [0, 100] })
  })

  it('builds frames that decode back to the composed value, broadcast and request alike', () => {
    const decoder = new DronecanTransferDecoder(catalogue)
    const push = (frames: { id: number; extended: boolean; data: Uint8Array }[]) => {
      let done
      let seq = 0
      for (const frame of frames) {
        done = decoder.push({ ...canFrameFromRawId({ timestampMs: 0, bus: 1, rawId: (frame.id | 0x80000000) >>> 0, data: frame.data, direction: 'tx' }), seq: ++seq })
      }
      return done
    }
    const status = buildDronecanSendFrames(catalogue, {
      fullName: 'uavcan.protocol.NodeStatus',
      kind: 'message',
      value: { uptime_sec: 99, health: 1, mode: 0, sub_mode: 0, vendor_specific_status_code: 0 },
      priority: 16,
      sourceNodeId: 127,
      transferId: 3
    })
    expect(push(status.frames)?.value).toMatchObject({ uptime_sec: 99, health: 1 })

    const getSet = buildDronecanSendFrames(catalogue, {
      fullName: 'uavcan.protocol.param.GetSet',
      kind: 'request',
      value: { index: 0, value: { empty: {} }, name: Array.from(new TextEncoder().encode('GPS_TYPE')) },
      priority: 30,
      sourceNodeId: 127,
      destinationNodeId: 124,
      transferId: 4
    })
    expect(getSet.frames.length).toBeGreaterThan(1)
    const transfer = push(getSet.frames)
    expect(transfer?.kind).toBe('request')
    expect(transfer?.destinationNodeId).toBe(124)
    expect(transfer?.problem).toBeUndefined()
  })
})

describe('the composer form', () => {
  it('offers only types with an id, and names values from the type\'s constants', () => {
    const sendable = canSendableTypes(catalogue)
    expect(sendable.some((type) => type.fullName === 'uavcan.protocol.NodeStatus')).toBe(true)
    expect(sendable.some((type) => type.fullName === 'uavcan.protocol.param.Value')).toBe(false)
    const status = catalogue.section('uavcan.protocol.NodeStatus', 'msg')
    expect(dronecanFieldConstants(status, 'health').map((entry) => entry.n)).toEqual(
      expect.arrayContaining(['HEALTH_OK', 'HEALTH_WARNING', 'HEALTH_ERROR', 'HEALTH_CRITICAL'])
    )
    // RestartNode starts at the magic number: the only value a node accepts.
    const restart = defaultDronecanValue(catalogue, catalogue.section('uavcan.protocol.RestartNode', 'req'))
    expect(restart.magic_number).toBe(0xacce551b1e)
  })

  it('knows each primitive\'s range and which arrays are bytes', () => {
    expect(dronecanPrimitiveLimits({ p: 'u', bits: 8 })).toEqual({ integer: true, min: 0, max: 255, wide: false })
    expect(dronecanPrimitiveLimits({ p: 'i', bits: 14 })).toEqual({ integer: true, min: -8192, max: 8191, wide: false })
    expect(dronecanPrimitiveLimits({ p: 'u', bits: 56 }).wide).toBe(true)
    expect(dronecanPrimitiveLimits({ p: 'f', bits: 16 }).integer).toBe(false)
    expect(isDronecanByteArray({ a: { p: 'u', bits: 8 }, m: 'd', max: 92, eMin: 8 })).toBe(true)
    expect(isDronecanByteArray({ a: { p: 'i', bits: 14 }, m: 'd', max: 20, eMin: 14 })).toBe(false)
  })
})

describe('parseRawCanFrame', () => {
  it('reads hex ids and bytes, and says what is wrong', () => {
    expect(parseRawCanFrame({ idText: '123', dataText: '01 02 ff', extended: false, fd: false })).toEqual({
      ok: true,
      value: { id: 0x123, extended: false, data: Uint8Array.from([1, 2, 255]), fd: false }
    })
    expect(parseRawCanFrame({ idText: '800', dataText: '', extended: false, fd: false })).toMatchObject({ ok: false, error: expect.stringMatching(/Extended/) })
    expect(parseRawCanFrame({ idText: '1E0A3C7F', dataText: '', extended: true, fd: false }).ok).toBe(true)
    expect(parseRawCanFrame({ idText: '1', dataText: '0102030405060708 09', extended: false, fd: false })).toMatchObject({ ok: false })
    expect(parseRawCanFrame({ idText: '1', dataText: '00'.repeat(12), extended: false, fd: true }).ok).toBe(true)
    expect(parseRawCanFrame({ idText: 'xyz', dataText: '', extended: false, fd: false }).ok).toBe(false)
  })
})
