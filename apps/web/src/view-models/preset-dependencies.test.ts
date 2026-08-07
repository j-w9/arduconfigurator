import { describe, expect, it } from 'vitest'

import {
  PRESET_DEPENDENCY_CLASSES,
  detectPresetDependencies,
  evaluatePresetDependencies,
  inferBatteryCellCount,
  presetDependencyClass,
  remapPresetSerialPort,
  serialPortIndexOf,
  type PresetDependencyRecord
} from './preset-dependencies'

/** Convenience: a value reader over a plain object. */
const reader = (values: Record<string, number>) => (paramId: string) => values[paramId]

const detect = (paramIds: string[], values: Record<string, number> = {}) =>
  detectPresetDependencies({ paramIds, readParameter: reader(values) })

const classIds = (paramIds: string[], values: Record<string, number> = {}) =>
  detect(paramIds, values).dependencies.map((entry) => entry.classId)

describe('serialPortIndexOf', () => {
  it('reads the index out of a SERIALn param', () => {
    expect(serialPortIndexOf('SERIAL3_PROTOCOL')).toBe(3)
    expect(serialPortIndexOf('SERIAL10_BAUD')).toBe(10)
  })

  it('does not claim the SERIAL_PASS debug bridge', () => {
    // SERIAL_PASS1/PASS2/PASSTIMO are a USB<->UART passthrough, not a port
    // configuration. Treating them as port params would drag the whole
    // remap question onto an ELRS-flashing preset that has no port dependency.
    expect(serialPortIndexOf('SERIAL_PASS1')).toBeUndefined()
    expect(serialPortIndexOf('SERIAL_PASS2')).toBeUndefined()
    expect(serialPortIndexOf('SERIAL_PASSTIMO')).toBeUndefined()
  })

  it('does not claim unrelated params that merely start with SERIAL', () => {
    expect(serialPortIndexOf('SERIALMANAGER')).toBeUndefined()
    expect(serialPortIndexOf('BATT_SERIAL_NUM')).toBeUndefined()
  })
})

describe('detectPresetDependencies — classification', () => {
  it('classifies serial port params and records which UART they came from', () => {
    const result = detect(['SERIAL3_PROTOCOL', 'SERIAL3_BAUD', 'SERIAL3_OPTIONS'])
    expect(result.dependencies).toHaveLength(1)
    expect(result.dependencies[0].classId).toBe('serial-port')
    expect(result.dependencies[0].context.serialPorts).toEqual([3])
    expect(result.dependencies[0].detail).toContain('SERIAL3')
  })

  it('records every distinct port, ascending', () => {
    const result = detect(['SERIAL5_PROTOCOL', 'SERIAL1_BAUD', 'SERIAL5_BAUD'])
    expect(result.dependencies[0].context.serialPorts).toEqual([1, 5])
  })

  it('classifies battery voltage and capacity params together', () => {
    expect(classIds(['BATT_LOW_VOLT', 'BATT_CRT_VOLT', 'BATT_CAPACITY', 'MOT_BAT_VOLT_MAX'])).toEqual(['battery-pack'])
  })

  it('keeps battery MONITOR and pin wiring in the sensor-hardware class, not battery-pack', () => {
    // BATT_MONITOR names a device; BATT_VOLT_PIN names a board pin. Neither
    // changes with the pack, so grouping them under "4S or 6S?" would ask the
    // wrong question about them.
    expect(classIds(['BATT_MONITOR', 'BATT_VOLT_PIN', 'BATT2_CURR_PIN'])).toEqual(['sensor-hardware'])
  })

  it('separates the frame layout from the tune measured on it', () => {
    expect(classIds(['FRAME_CLASS', 'FRAME_TYPE'])).toEqual(['frame'])
    expect(classIds(['ATC_RAT_RLL_P', 'ATC_ANG_PIT_P', 'MOT_THST_EXPO', 'MOT_THST_HOVER', 'PSC_POSXY_P'])).toEqual([
      'airframe-tune'
    ])
  })

  it('classifies output mapping and CAN', () => {
    expect(classIds(['SERVO1_FUNCTION', 'SERVO_BLH_MASK', 'MOT_PWM_TYPE'])).toEqual(['output-mapping'])
    expect(classIds(['CAN_P1_DRIVER', 'CAN_D1_PROTOCOL'])).toEqual(['can-bus'])
  })

  it('classifies the sensor families the operator named', () => {
    expect(classIds(['RNGFND1_TYPE', 'FLOW_TYPE', 'GPS_TYPE', 'PRX1_TYPE'])).toEqual(['sensor-hardware'])
  })

  it('claims per-board calibration first, whatever else it looks like', () => {
    // COMPASS_OFS_X is a calibration value; nothing else may claim it.
    const result = detect(['COMPASS_OFS_X', 'INS_ACCOFFS_X', 'AHRS_TRIM_X'])
    expect(result.dependencies.map((entry) => entry.classId)).toEqual(['calibration'])
    expect(result.dependencies[0].paramIds).toHaveLength(3)
  })

  it('assigns each param to exactly one class so the counts do not double up', () => {
    const paramIds = ['SERIAL3_PROTOCOL', 'BATT_LOW_VOLT', 'MOT_BAT_VOLT_MAX', 'MOT_THST_EXPO', 'SERVO1_FUNCTION']
    const result = detect(paramIds)
    const claimed = result.dependencies.flatMap((entry) => entry.paramIds)
    expect(claimed).toHaveLength(new Set(claimed).size)
    expect(claimed.length + result.unclassifiedParamIds.length).toBe(paramIds.length)
  })

  it('reports params no rule claims rather than silently swallowing them', () => {
    const result = detect(['OSD1_ALTITUDE_EN', 'LOG_BITMASK'])
    expect(result.dependencies).toEqual([])
    expect(result.unclassifiedParamIds).toEqual(['OSD1_ALTITUDE_EN', 'LOG_BITMASK'])
  })

  it('asks the most consequential questions first regardless of selection order', () => {
    const order = classIds(['CAN_P1_DRIVER', 'SERVO1_FUNCTION', 'BATT_LOW_VOLT', 'SERIAL3_BAUD'])
    const canonical = PRESET_DEPENDENCY_CLASSES.map((entry) => entry.id).filter((id) => order.includes(id))
    expect(order).toEqual(canonical)
  })

  it('surfaces reboot-required params as a note, not a question', () => {
    const result = detectPresetDependencies({
      paramIds: ['SERIAL3_PROTOCOL', 'BATT_LOW_VOLT'],
      readParameter: reader({}),
      isRebootRequired: (paramId) => paramId === 'SERIAL3_PROTOCOL'
    })
    expect(result.rebootRequiredParamIds).toEqual(['SERIAL3_PROTOCOL'])
    expect(result.dependencies.map((entry) => entry.classId)).not.toContain('reboot')
  })

  it('records the source frame alongside a tune', () => {
    const result = detect(['ATC_RAT_RLL_P'], { FRAME_CLASS: 1, FRAME_TYPE: 3 })
    expect(result.dependencies[0].context).toEqual({ frameClass: 1, frameType: 3 })
  })
})

describe('inferBatteryCellCount', () => {
  it('reads a clean multiple off MOT_BAT_VOLT_MAX', () => {
    expect(inferBatteryCellCount(reader({ MOT_BAT_VOLT_MAX: 25.2 }))).toBe(6)
    expect(inferBatteryCellCount(reader({ MOT_BAT_VOLT_MAX: 16.8 }))).toBe(4)
  })

  it('tolerates the round numbers operators actually type', () => {
    expect(inferBatteryCellCount(reader({ MOT_BAT_VOLT_MAX: 25.0 }))).toBe(6)
  })

  it('gives up rather than guessing when the param is unset', () => {
    // MOT_BAT_VOLT_MAX defaults to 0 (compensation disabled) and plenty of
    // aircraft never set it. Silence here is what makes the dialog ASK.
    expect(inferBatteryCellCount(reader({}))).toBeUndefined()
    expect(inferBatteryCellCount(reader({ MOT_BAT_VOLT_MAX: 0 }))).toBeUndefined()
  })

  it('gives up on a value that sits between two cell counts', () => {
    expect(inferBatteryCellCount(reader({ MOT_BAT_VOLT_MAX: 19.0 }))).toBeUndefined()
  })

  it('rejects implausible pack sizes', () => {
    expect(inferBatteryCellCount(reader({ MOT_BAT_VOLT_MAX: 4.2 }))).toBeUndefined()
    expect(inferBatteryCellCount(reader({ MOT_BAT_VOLT_MAX: 210 }))).toBeUndefined()
  })
})

describe('evaluatePresetDependencies', () => {
  const ready = { status: 'ready', reasons: [] }

  it('is ready when a preset declares nothing', () => {
    expect(evaluatePresetDependencies([], reader({}))).toEqual(ready)
  })

  it('never blocks, only cautions', () => {
    const dependencies: PresetDependencyRecord[] = PRESET_DEPENDENCY_CLASSES.map((descriptor) => ({
      classId: descriptor.id,
      paramIds: ['X']
    }))
    const result = evaluatePresetDependencies(dependencies, reader({}))
    expect(result.status).toBe('caution')
    expect(result.reasons).toHaveLength(PRESET_DEPENDENCY_CLASSES.length)
  })

  it('names both cell counts when the packs differ', () => {
    const result = evaluatePresetDependencies(
      [{ classId: 'battery-pack', paramIds: ['BATT_LOW_VOLT'], context: { batteryCells: 6 } }],
      reader({ MOT_BAT_VOLT_MAX: 16.8 })
    )
    expect(result.status).toBe('caution')
    expect(result.reasons[0]).toContain('6S')
    expect(result.reasons[0]).toContain('4S')
  })

  it('says the cell count could not be checked rather than implying a match', () => {
    const result = evaluatePresetDependencies(
      [{ classId: 'battery-pack', paramIds: ['BATT_LOW_VOLT'], context: { batteryCells: 6 } }],
      reader({})
    )
    expect(result.reasons[0]).toContain('cannot be checked')
  })

  it('still warns when the packs match, because the thresholds are worth a look', () => {
    const result = evaluatePresetDependencies(
      [{ classId: 'battery-pack', paramIds: ['BATT_LOW_VOLT'], context: { batteryCells: 6 } }],
      reader({ MOT_BAT_VOLT_MAX: 25.2 })
    )
    // Matching packs produce no per-pack complaint at all — the class was
    // declared, so the operator still gets a line, but it must not claim a
    // mismatch that does not exist.
    expect(result.reasons.join(' ')).not.toContain('will be wrong')
  })

  it('names the frame classes when a tune moved airframe', () => {
    const result = evaluatePresetDependencies(
      [{ classId: 'airframe-tune', paramIds: ['ATC_RAT_RLL_P'], context: { frameClass: 1 } }],
      reader({ FRAME_CLASS: 2 })
    )
    expect(result.reasons[0]).toContain('FRAME_CLASS 1')
    expect(result.reasons[0]).toContain('FRAME_CLASS 2')
  })

  it('names the saved UART so the operator knows what to remap', () => {
    const result = evaluatePresetDependencies(
      [{ classId: 'serial-port', paramIds: ['SERIAL3_BAUD'], context: { serialPorts: [3] } }],
      reader({})
    )
    expect(result.reasons[0]).toContain('SERIAL3')
  })

  it('degrades gracefully on a dependency class this build does not know', () => {
    const result = evaluatePresetDependencies(
      [{ classId: 'from-the-future' as never, paramIds: ['X'] }],
      reader({})
    )
    expect(result.status).toBe('caution')
    expect(result.reasons[0]).toContain('from-the-future')
  })
})

describe('presetDependencyClass', () => {
  it('returns a usable descriptor for an unknown class rather than throwing', () => {
    const descriptor = presetDependencyClass('made-up' as never)
    expect(descriptor.label).toBe('made-up')
    expect(descriptor.question).toContain('made-up')
  })
})

describe('remapPresetSerialPort', () => {
  const values = [
    { paramId: 'SERIAL3_PROTOCOL', value: 23 },
    { paramId: 'SERIAL3_BAUD', value: 115 },
    { paramId: 'RC_OPTIONS', value: 32 }
  ]

  it('is a no-op when the target is the saved port', () => {
    const result = remapPresetSerialPort(values, 3, 3)
    expect(result.values).toEqual(values)
    expect(result.remapped).toEqual([])
  })

  it('rewrites only the matching port and leaves everything else alone', () => {
    const result = remapPresetSerialPort(values, 3, 4)
    expect(result.values.map((entry) => entry.paramId)).toEqual(['SERIAL4_PROTOCOL', 'SERIAL4_BAUD', 'RC_OPTIONS'])
    expect(result.remapped).toEqual([
      { from: 'SERIAL3_PROTOCOL', to: 'SERIAL4_PROTOCOL' },
      { from: 'SERIAL3_BAUD', to: 'SERIAL4_BAUD' }
    ])
  })

  it('preserves the values it moves', () => {
    const result = remapPresetSerialPort(values, 3, 4)
    expect(result.values[0].value).toBe(23)
    expect(result.values[1].value).toBe(115)
  })

  it('does not touch a different port that happens to be in the same preset', () => {
    const mixed = [{ paramId: 'SERIAL1_BAUD', value: 57 }, { paramId: 'SERIAL3_BAUD', value: 115 }]
    const result = remapPresetSerialPort(mixed, 3, 4)
    expect(result.values.map((entry) => entry.paramId)).toEqual(['SERIAL1_BAUD', 'SERIAL4_BAUD'])
  })

  it('reports remapped ids the target board does not have', () => {
    // A four-UART board has no SERIAL6_*. Silently producing writes to a
    // nonexistent param would look like the remap worked.
    const result = remapPresetSerialPort(values, 3, 6, new Set(['SERIAL1_BAUD', 'SERIAL3_BAUD', 'RC_OPTIONS']))
    expect(result.missingOnTarget).toEqual(['SERIAL6_PROTOCOL', 'SERIAL6_BAUD'])
  })

  it('reports nothing missing when the target ids all exist', () => {
    const result = remapPresetSerialPort(values, 3, 4, new Set(['SERIAL4_PROTOCOL', 'SERIAL4_BAUD']))
    expect(result.missingOnTarget).toEqual([])
  })

  it('does not mutate the input', () => {
    const input = [{ paramId: 'SERIAL3_BAUD', value: 115 }]
    remapPresetSerialPort(input, 3, 4)
    expect(input[0].paramId).toBe('SERIAL3_BAUD')
  })
})
