import { describe, expect, it } from 'vitest'
import { dronecanCatalogue } from '@arduconfig/dronecan-dsdl'

import { buildDronecanFieldTree, formatDronecanNumber, summarizeDronecanValue } from './dronecan-field-tree'

const catalogue = dronecanCatalogue()

describe('buildDronecanFieldTree', () => {
  it('names enum-like values from the type\'s own constants', () => {
    const tree = buildDronecanFieldTree(catalogue, 'uavcan.protocol.NodeStatus', 'msg', {
      uptime_sec: 12,
      health: 0,
      mode: 3,
      sub_mode: 0,
      vendor_specific_status_code: 7
    })
    expect(tree.map((entry) => entry.label)).toEqual(['uptime_sec', 'health', 'mode', 'sub_mode', 'vendor_specific_status_code'])
    expect(tree[1]).toMatchObject({ text: '0', meaning: 'OK', typeLabel: 'uint2' })
    expect(tree[2]).toMatchObject({ text: '3', meaning: 'SOFTWARE_UPDATE' })
    expect(summarizeDronecanValue(tree)).toBe('uptime_sec 12 · health OK · mode SOFTWARE_UPDATE')
  })

  it('shows uint8 arrays as text when printable, nested types as children, unions by their active field', () => {
    const tree = buildDronecanFieldTree(catalogue, 'uavcan.protocol.param.GetSet', 'res', {
      value: { integer_value: 9 },
      default_value: { empty: {} },
      max_value: { empty: {} },
      min_value: { empty: {} },
      name: Array.from(new TextEncoder().encode('GPS_TYPE'))
    })
    const name = tree.find((entry) => entry.label === 'name')
    expect(name?.text).toBe('"GPS_TYPE"')
    const value = tree.find((entry) => entry.label === 'value')
    expect(value?.children?.[0]).toMatchObject({ label: 'integer_value', text: '9', typeLabel: 'int64' })
  })

  it('formats floats to their precision', () => {
    expect(formatDronecanNumber(16.200000762939453, { p: 'f', bits: 32 })).toBe('16.2')
    expect(formatDronecanNumber(0.1, { p: 'f', bits: 16 })).toBe('0.1')
    expect(formatDronecanNumber(10n)).toBe('10')
  })
})
