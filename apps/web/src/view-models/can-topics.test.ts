import { describe, expect, it } from 'vitest'
import { matchesCanFilter, EMPTY_CAN_FRAME_FILTER, parseCanIdFilter, canFrameFromRawId } from '@arduconfig/can-core'
import type { DronecanTransfer } from '@arduconfig/dronecan-dsdl'
import { dronecanEncodeMessageCanId, dronecanEncodeServiceCanId } from '@arduconfig/protocol-mavlink'

import { CanTopicTable, canTopicIdFilter, formatCanTopicRate, isCanTopicStale } from './can-topics'

const transfer = (overrides: Partial<DronecanTransfer>): DronecanTransfer => ({
  bus: 1,
  kind: 'message',
  priority: 24,
  dataTypeId: 341,
  sourceNodeId: 124,
  transferId: 0,
  frameSeqs: [1],
  timestampMs: 0,
  direction: 'rx',
  payload: new Uint8Array(0),
  ...overrides
})

describe('CanTopicTable', () => {
  it('keeps one row per stream with its count, rate and latest transfer', () => {
    const table = new CanTopicTable()
    table.add(transfer({ timestampMs: 0, transferId: 0 }))
    table.add(transfer({ timestampMs: 500, transferId: 1 }))
    table.add(transfer({ timestampMs: 1000, transferId: 2 }))
    table.add(transfer({ dataTypeId: 1034, sourceNodeId: 50, timestampMs: 100 }))
    const [esc, status] = [table.list().find((entry) => entry.dataTypeId === 1034)!, table.list().find((entry) => entry.dataTypeId === 341)!]
    expect(status.count).toBe(3)
    expect(status.rateHz).toBe(2)
    expect(status.last.transferId).toBe(2)
    expect(esc.rateHz).toBeUndefined()
    expect(table.list(50).map((entry) => entry.dataTypeId)).toEqual([1034])
    expect(table.list()[0].sourceNodeId).toBe(50)
  })

  it('lists a service stream under both its source and its destination', () => {
    const table = new CanTopicTable()
    table.add(transfer({ kind: 'request', dataTypeId: 11, sourceNodeId: 127, destinationNodeId: 124 }))
    expect(table.list(124)).toHaveLength(1)
    expect(table.list(127)).toHaveLength(1)
    expect(table.list(50)).toHaveLength(0)
  })
})

describe('stream helpers', () => {
  it('calls a stream stale after three periods, never sooner than 3 s', () => {
    const table = new CanTopicTable()
    table.add(transfer({ timestampMs: 0 }))
    table.add(transfer({ timestampMs: 100 }))
    const [entry] = table.list()
    expect(isCanTopicStale(entry, 2000)).toBe(false)
    expect(isCanTopicStale(entry, 3200)).toBe(true)
  })

  it('builds an id filter that matches the stream at any priority and nothing else', () => {
    const filter = (text: string) => ({ ...EMPTY_CAN_FRAME_FILTER, idTerms: (parseCanIdFilter(text) as { ok: true; value: never[] }).value })
    const statusFilter = filter(canTopicIdFilter({ kind: 'message', dataTypeId: 341, sourceNodeId: 124 }))
    const frame = (id: number) => canFrameFromRawId({ timestampMs: 0, bus: 1, rawId: (id | 0x80000000) >>> 0, data: Uint8Array.from([0xc0]) })
    expect(matchesCanFilter(frame(dronecanEncodeMessageCanId(24, 341, 124)), statusFilter)).toBe(true)
    expect(matchesCanFilter(frame(dronecanEncodeMessageCanId(16, 341, 124)), statusFilter)).toBe(true)
    expect(matchesCanFilter(frame(dronecanEncodeMessageCanId(24, 341, 50)), statusFilter)).toBe(false)
    const getSet = filter(canTopicIdFilter({ kind: 'response', dataTypeId: 11, sourceNodeId: 124, destinationNodeId: 127 }))
    expect(matchesCanFilter(frame(dronecanEncodeServiceCanId(30, 11, false, 127, 124)), getSet)).toBe(true)
    expect(matchesCanFilter(frame(dronecanEncodeServiceCanId(30, 11, true, 124, 127)), getSet)).toBe(false)
  })

  it('formats rates', () => {
    expect(formatCanTopicRate(undefined)).toBe('—')
    expect(formatCanTopicRate(1)).toBe('1.0 Hz')
    expect(formatCanTopicRate(49.7)).toBe('50 Hz')
  })
})
