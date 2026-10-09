import { describe, expect, it } from 'vitest'
import { canFrameFromRawId } from '@arduconfig/can-core'
import { dronecanEncodeMessageCanId, dronecanEncodeServiceCanId } from '@arduconfig/protocol-mavlink'

import {
  DEFAULT_CAN_MONITOR_FILTER_FORM,
  buildCanMonitorFilter,
  canByteRows,
  describeCanFrame,
  dronecanFrameHeader,
  formatCaptureTime
} from './can-bus-monitor'

const frame = (rawId: number, bytes: number[], extra: Partial<{ fd: boolean }> = {}) =>
  canFrameFromRawId({ timestampMs: 0, bus: 1, rawId, data: Uint8Array.from(bytes), ...extra })

describe('dronecanFrameHeader', () => {
  it('reads a NodeStatus broadcast: priority, type, source and a single-frame tail', () => {
    const canId = dronecanEncodeMessageCanId(24, 341, 124)
    const header = dronecanFrameHeader(frame(0x80000000 | canId, [0, 0, 0, 0, 0, 0, 0, 0xc3]))
    expect(header).toMatchObject({ priority: 24, kind: 'message', typeId: 341, typeName: 'NodeStatus', sourceNodeId: 124 })
    expect(header).toMatchObject({ sot: true, eot: true, transferId: 3 })
  })

  it('reads a service request with its destination', () => {
    const canId = dronecanEncodeServiceCanId(30, 11, true, 124, 127)
    expect(dronecanFrameHeader(frame(0x80000000 | canId, [1, 0x80]))).toMatchObject({
      kind: 'service',
      typeName: 'GetSet',
      request: true,
      sourceNodeId: 127,
      destinationNodeId: 124
    })
  })

  it('is undefined for frames DroneCAN cannot be: standard, remote, FD, empty', () => {
    expect(dronecanFrameHeader(frame(0x123, [1]))).toBeUndefined()
    expect(dronecanFrameHeader(frame(0xc0000123, []))).toBeUndefined()
    expect(dronecanFrameHeader(frame(0x80000123, [1], { fd: true }))).toBeUndefined()
    expect(dronecanFrameHeader(frame(0x80000123, []))).toBeUndefined()
  })
})

describe('describeCanFrame', () => {
  it('names known types, numbers unknown ones, and marks multi-frame parts', () => {
    const status = dronecanEncodeMessageCanId(24, 341, 50)
    expect(describeCanFrame(frame(0x80000000 | status, [0xc0]))).toBe('NodeStatus ← 50')
    // Names come from the bundled DSDL: 1030 is uavcan.equipment.esc.RawCommand.
    const rawCommand = dronecanEncodeMessageCanId(24, 1030, 10)
    expect(describeCanFrame(frame(0x80000000 | rawCommand, [0x80]))).toBe('RawCommand ← 10 (start)')
    // An id the DSDL does not define keeps its number.
    const unknown = dronecanEncodeMessageCanId(24, 60000, 10)
    expect(describeCanFrame(frame(0x80000000 | unknown, [0xc0]))).toBe('msg 60000 ← 10')
    expect(describeCanFrame(frame(0x123, [1]))).toBe('')
    expect(describeCanFrame(frame(0x321, [1], { fd: true }))).toBe('CAN FD')
    expect(describeCanFrame(frame(0x40000123, []))).toBe('Remote request')
  })
})

describe('buildCanMonitorFilter', () => {
  it('is inactive by default and keeps a bad field from blanking the table', () => {
    expect(buildCanMonitorFilter(DEFAULT_CAN_MONITOR_FILTER_FORM).active).toBe(false)
    const state = buildCanMonitorFilter({ ...DEFAULT_CAN_MONITOR_FILTER_FORM, idText: '12z', dataText: '1F' })
    expect(state.idError).toMatch(/not a hex CAN id/)
    expect(state.filter.idTerms).toEqual([])
    expect(state.filter.dataContains).toEqual([0x1f])
    expect(state.active).toBe(true)
  })

  it('maps direction and kinds into the filter', () => {
    const state = buildCanMonitorFilter({
      ...DEFAULT_CAN_MONITOR_FILTER_FORM,
      direction: 'tx',
      kinds: { ...DEFAULT_CAN_MONITOR_FILTER_FORM.kinds, fd: false }
    })
    expect(state.filter.direction).toBe('tx')
    expect(state.filter.kinds.fd).toBe(false)
    expect(state.active).toBe(true)
  })
})

describe('formatting', () => {
  it('formats capture time and byte rows', () => {
    expect(formatCaptureTime(12_345.6, 0)).toBe('12.346')
    expect(formatCaptureTime(5, 10)).toBe('0.000')
    expect(canByteRows(Uint8Array.from([0x41, 0x00]))).toEqual([
      { index: 0, hex: '41', dec: '65', bin: '01000001', ascii: 'A' },
      { index: 1, hex: '00', dec: '0', bin: '00000000', ascii: '·' }
    ])
  })
})
