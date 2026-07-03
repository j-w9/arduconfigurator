import { describe, expect, it } from 'vitest'

import type { DronecanParamEntry } from '@arduconfig/ardupilot-core'

import {
  endpointLabel,
  groupPassthroughBlocks,
  intValueLike,
  isUartEndpoint,
  paramInt,
  passthroughEndpointOptions
} from './passthrough'

function intEntry(name: string, value: number): DronecanParamEntry {
  return { index: 0, name, value: { tag: 'int64', int64: String(value) }, lastFetchedAtMs: 0 }
}

describe('passthrough view-model', () => {
  it('labels endpoint IDs by their serial-manager range', () => {
    expect(endpointLabel(0)).toMatch(/Serial 0/)
    expect(endpointLabel(2)).toBe('Serial 2')
    expect(endpointLabel(21)).toBe('Network port 1')
    expect(endpointLabel(41)).toBe('CAN1 tunnel 1')
    expect(endpointLabel(51)).toBe('CAN2 tunnel 1')
    // Every option is uniquely labelled.
    const options = passthroughEndpointOptions()
    expect(new Set(options.map((o) => o.label)).size).toBe(options.length)
  })

  it('treats only 0-9 as UART endpoints (baud/opts apply)', () => {
    expect(isUartEndpoint(0)).toBe(true)
    expect(isUartEndpoint(9)).toBe(true)
    expect(isUartEndpoint(21)).toBe(false)
    expect(isUartEndpoint(41)).toBe(false)
    expect(isUartEndpoint(undefined)).toBe(false)
  })

  it('groups NET_PASSn_ params into blocks and reads their values', () => {
    const blocks = groupPassthroughBlocks([
      intEntry('NET_PASS1_ENABLE', 1),
      intEntry('NET_PASS1_EP1', 2),
      intEntry('NET_PASS1_EP2', 21),
      intEntry('NET_PASS1_BAUD1', 57600),
      intEntry('NET_ENABLE', 1), // not a passthrough param — ignored
      intEntry('NET_PASS3_ENABLE', 0),
      intEntry('NET_PASS3_EP1', 3)
    ])
    expect(blocks.map((b) => b.index)).toEqual([1, 3]) // sorted, non-passthrough dropped
    expect(blocks[0]).toMatchObject({ enable: 1, ep1: 2, ep2: 21, baud1: 57600 })
  })

  it('reads/writes values preserving the original tag', () => {
    expect(paramInt({ tag: 'int64', int64: '21' })).toBe(21)
    expect(paramInt({ tag: 'bool', bool: true })).toBe(1)
    expect(intValueLike({ tag: 'int64', int64: '0' }, 21)).toEqual({ tag: 'int64', int64: '21' })
    expect(intValueLike({ tag: 'bool', bool: false }, 1)).toEqual({ tag: 'bool', bool: true })
  })
})
