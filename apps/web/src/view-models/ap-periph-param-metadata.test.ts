import { describe, expect, it } from 'vitest'

import { AP_PERIPH_CURATED_METADATA, loadApPeriphParamMetadata } from './ap-periph-param-metadata'
import { AP_PERIPH_GENERATED_PARAMS, AP_PERIPH_PARAMS_ARDUPILOT_COMMIT } from './generated/ap-periph-params'

const optionLabel = (name: string, value: number) =>
  AP_PERIPH_PARAM_METADATA[name]?.options?.find((option) => option.value === value)?.label

const AP_PERIPH_PARAM_METADATA = await loadApPeriphParamMetadata()

describe('AP_Periph metadata (generated from ArduPilot + curated overlay, loaded on first use)', () => {
  it('the curated entries are there without loading, and win over the generated ones', () => {
    expect(AP_PERIPH_CURATED_METADATA.CAN_NODE?.label).toBe('DroneCAN node ID')
    expect(AP_PERIPH_PARAM_METADATA.CAN_NODE?.label).toBe('DroneCAN node ID')
  })

  it('records the pinned ArduPilot commit and covers the whole AP_Periph param set', () => {
    expect(AP_PERIPH_PARAMS_ARDUPILOT_COMMIT).toMatch(/^[0-9a-f]{40}$/)
    expect(Object.keys(AP_PERIPH_GENERATED_PARAMS).length).toBeGreaterThan(2000)
  })

  it('CAN_NODE: 0..127, reboot required, curated label wins', () => {
    const def = AP_PERIPH_PARAM_METADATA.CAN_NODE
    expect(def?.minimum).toBe(0)
    expect(def?.maximum).toBe(127)
    expect(def?.rebootRequired).toBe(true)
    expect(def?.label).toBe('DroneCAN node ID')
    expect(AP_PERIPH_GENERATED_PARAMS.CAN_NODE?.label).toBe('DroneCAN node ID used by this node on all networks')
  })

  it('FLASH_BOOTLOADER: 0..1 with the source DANGER description', () => {
    const def = AP_PERIPH_PARAM_METADATA.FLASH_BOOTLOADER
    expect(def?.label).toBe('Trigger bootloader update')
    expect(def?.minimum).toBe(0)
    expect(def?.maximum).toBe(1)
    expect(def?.description).toMatch(/^DANGER!/)
  })

  it('CAN_BAUDRATE: 10000..1000000, reboot required', () => {
    const def = AP_PERIPH_PARAM_METADATA.CAN_BAUDRATE
    expect(def?.minimum).toBe(10000)
    expect(def?.maximum).toBe(1000000)
    expect(def?.rebootRequired).toBe(true)
  })

  it('CAN_PROTOCOL keeps the curated "DroneCAN" over the source "UAVCAN"', () => {
    expect(optionLabel('CAN_PROTOCOL', 1)).toBe('DroneCAN')
    expect(AP_PERIPH_GENERATED_PARAMS.CAN_PROTOCOL?.options?.find((o) => o.value === 1)?.label).toBe('UAVCAN')
  })

  it('GPS_ and RNGFND1_ library params come with their enums', () => {
    expect(optionLabel('GPS_AUTO_CONFIG', 0)).toBe('Disables automatic configuration')
    expect(optionLabel('RNGFND1_TYPE', 0)).toBe('None')
    expect(optionLabel('RNGFND1_TYPE', 24)).toBe('DroneCAN')
    // Instances share the family definition.
    expect(optionLabel('RNGFND2_TYPE', 24)).toBe('DroneCAN')
    // Enum is sorted numerically, not lexically ("100" after "28").
    const values = AP_PERIPH_PARAM_METADATA.RNGFND1_TYPE?.options?.map((o) => o.value) ?? []
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })

  it('BRD_SERIAL_NUM: range from source', () => {
    const def = AP_PERIPH_PARAM_METADATA.BRD_SERIAL_NUM
    expect(def?.minimum).toBe(0)
    expect(def?.maximum).toBe(2147483648)
  })

  it('bitmask params carry `bits`, never `options`', () => {
    const debug = AP_PERIPH_PARAM_METADATA.DEBUG
    expect(debug?.options).toBeUndefined()
    expect(debug?.bits).toContainEqual({ bit: 1, label: 'Auto Reboot after 15sec' })
    expect(AP_PERIPH_PARAM_METADATA.BATT_HIDE_MASK?.options).toBeUndefined()
    expect(AP_PERIPH_PARAM_METADATA.BATT_HIDE_MASK?.bits?.length).toBe(16)
  })

  it('maps the AP_Stats group to its real STAT_ prefix and drops SITL / Lua applet params', () => {
    expect(AP_PERIPH_PARAM_METADATA.STAT_BOOTCNT?.readOnly).toBe(true)
    expect(AP_PERIPH_PARAM_METADATA.Node_BOOTCNT).toBeUndefined()
    expect(Object.keys(AP_PERIPH_PARAM_METADATA).some((name) => name.startsWith('SIM_'))).toBe(false)
    expect(AP_PERIPH_PARAM_METADATA.AEROM_ANG_ACCEL).toBeUndefined()
  })
})
