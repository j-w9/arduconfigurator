import type { DronecanParamEntry } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import { loadApPeriphParamMetadata } from './ap-periph-param-metadata'

const AP_PERIPH_PARAM_METADATA = await loadApPeriphParamMetadata()
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

describe('AP_PERIPH_PARAM_METADATA fallback', () => {
  it('enriches periph-only params the FC catalog lacks (range + enum)', () => {
    const node = describeDronecanParam(entry({ name: 'CAN_NODE', value: int(125) }), AP_PERIPH_PARAM_METADATA.CAN_NODE)
    expect(node.label).toBe('DroneCAN node ID')
    expect(node.rangeLabel).toBe('0–127')

    const fd = describeDronecanParam(entry({ name: 'CAN_FDMODE', value: int(1) }), AP_PERIPH_PARAM_METADATA.CAN_FDMODE)
    expect(fd.valueLabel).toBe('Enabled')
    expect(fd.valueIsEnum).toBe(true)
  })
})

describe('bitmask, step, reboot and read-only', () => {
  it('names the set bits of a bitmask and never reads it as an enum', () => {
    const bits = [
      { bit: 0, label: 'Show free stack space' },
      { bit: 1, label: 'Auto reboot' },
      { bit: 2, label: 'Enable sending stats' }
    ]
    const display = describeDronecanParam(entry({ name: 'DEBUG', value: int(5) }), { bits, rebootRequired: true, step: 1 })
    expect(display.bitsLabel).toBe('Show free stack space, Enable sending stats')
    expect(display.valueIsEnum).toBe(false)
    expect(display.rebootRequired).toBe(true)
    expect(display.step).toBe(1)
    expect(describeDronecanParam(entry({ name: 'DEBUG', value: int(0) }), { bits }).bitsLabel).toBe('none')
  })

  it("treats the FC catalog's bitmask options as bits, not values", () => {
    // FC ParameterDefinition: bitmask: true, options = bit indexes.
    const fc = { bitmask: true, options: [{ value: 0, label: 'Bit zero' }, { value: 3, label: 'Bit three' }] }
    const display = describeDronecanParam(entry({ name: 'X', value: int(3) }), fc)
    // 3 = bits 0 and 1; "Bit three" (option value 3) must not be claimed.
    expect(display.valueIsEnum).toBe(false)
    expect(display.bitsLabel).toBe('Bit zero')
  })

  it('hides a node range that is only the int32 / float32 type limits', () => {
    const intEntry = {
      name: 'CAL_ACC0_ID',
      value: { tag: 'int64', int64: '0' },
      defaultValue: { tag: 'int64', int64: '0' },
      minValue: { tag: 'int64', int64: '-2147483648' },
      maxValue: { tag: 'int64', int64: '2147483647' }
    } as unknown as DronecanParamEntry
    expect(describeDronecanParam(intEntry, undefined).rangeLabel).toBeUndefined()
    expect(describeDronecanParam(intEntry, { label: 'x', minimum: 0, maximum: 10 }).rangeLabel).toBe('0–10')
    const floatEntry = {
      name: 'CAL_ACC0_XOFF',
      value: { tag: 'real32', real32: 0 },
      minValue: { tag: 'real32', real32: -3.4028234663852886e38 },
      maxValue: { tag: 'real32', real32: 3.4028234663852886e38 }
    } as unknown as DronecanParamEntry
    expect(describeDronecanParam(floatEntry, undefined).rangeLabel).toBeUndefined()
    const oneSided = { ...intEntry, minValue: { tag: 'int64', int64: '0' } } as unknown as DronecanParamEntry
    expect(describeDronecanParam(oneSided, undefined).rangeLabel).toBe('≥ 0')
  })
})
