import type { DronecanParamEntry } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import { describeDronecanParam, type DronecanParamCatalogDef } from './dronecan-param-display'

const int = (n: number): DronecanParamEntry['value'] => ({ tag: 'int64', int64: String(n) })
const empty: DronecanParamEntry['value'] = { tag: 'empty' }

const entry = (over: Partial<DronecanParamEntry> = {}): DronecanParamEntry =>
  ({
    index: 0,
    name: 'GPS_TYPE',
    value: int(1),
    defaultValue: empty,
    minValue: empty,
    maxValue: empty,
    ...over
  }) as DronecanParamEntry

describe('describeDronecanParam', () => {
  it('fills range and enum label from the catalog when the node reports neither', () => {
    const def: DronecanParamCatalogDef = {
      label: 'GPS Type',
      description: 'GPS driver',
      options: [
        { value: 0, label: 'None' },
        { value: 1, label: 'UAVCAN' }
      ]
    }
    const d = describeDronecanParam(entry(), def)
    expect(d.label).toBe('GPS Type')
    expect(d.valueLabel).toBe('UAVCAN')
    expect(d.valueIsEnum).toBe(true)
    expect(d.description).toBe('GPS driver')
    expect(d.fromCatalog).toBe(true)
  })

  it('uses the catalog minimum..maximum (with unit) for the range when the node is empty', () => {
    const def: DronecanParamCatalogDef = { label: 'Min elevation', minimum: -100, maximum: 90, unit: 'deg' }
    const d = describeDronecanParam(entry({ name: 'GPS_MIN_ELEV', value: int(-100) }), def)
    expect(d.rangeLabel).toBe('-100–90 deg')
  })

  it('prefers the node-reported range over the catalog', () => {
    const def: DronecanParamCatalogDef = { minimum: 0, maximum: 10 }
    const d = describeDronecanParam(entry({ minValue: int(2), maxValue: int(8) }), def)
    expect(d.rangeLabel).toBe('2–8')
  })

  it('falls back cleanly with no catalog match (raw name + value, no range)', () => {
    const d = describeDronecanParam(entry({ name: 'CAN_NODE', value: int(125) }), undefined)
    expect(d.label).toBe('CAN_NODE')
    expect(d.valueLabel).toBe('125')
    expect(d.valueIsEnum).toBe(false)
    expect(d.rangeLabel).toBeUndefined()
    expect(d.fromCatalog).toBe(false)
  })
})
