import { describe, expect, it } from 'vitest'

import {
  buildComponentsJson,
  fieldsFor,
  loadSequence,
  runSequence,
  sequenceForFirmware
} from './amc-guided'

// The sequence and the evaluator are proven against CPython and against AMC's
// own vehicle templates in the arduconfig-amc fork's test suite. These tests
// cover the part that lives here: turning the sequence into something the tab
// can render, and getting the declared vehicle into it without losing meaning.

const copter = await loadSequence('ArduCopter')
const fields = fieldsFor(copter)
const keyFor = (label: string): string => {
  const field = fields.find((candidate) => candidate.label === label)
  if (!field) throw new Error(`no field named ${label}`)
  return field.key
}

describe('sequenceForFirmware', () => {
  it('maps the firmware names that have a sequence', () => {
    expect(sequenceForFirmware('ArduCopter')).toBe('ArduCopter')
    expect(sequenceForFirmware('ArduRover')).toBe('Rover')
  })

  it('has nothing for firmware AMC does not cover', () => {
    expect(sequenceForFirmware('ArduSub')).toBeUndefined()
    expect(sequenceForFirmware(undefined)).toBeUndefined()
  })
})

describe('fieldsFor', () => {
  it('derives the form from the sequence rather than a hand-kept list', () => {
    const labels = fields.map((field) => `${field.component} > ${field.label}`)
    expect(labels).toContain('Propellers > Diameter_inches')
    expect(labels).toContain('Battery > Number of cells')
    expect(labels).toContain('Flight Controller > MCU Series')
  })

  it('orders by how much of the sequence a field unlocks', () => {
    const uses = fields.map((field) => field.uses)
    expect(uses).toEqual([...uses].sort((left, right) => right - left))
  })
})

describe('buildComponentsJson', () => {
  it('nests values under their component path', () => {
    const json = buildComponentsJson(fields, { [keyFor('Number of cells')]: '4' })
    expect(JSON.parse(json).Components.Battery.Specifications['Number of cells']).toBe(4)
  })

  it('keeps a whole number written as a float a float', () => {
    // 4 and 4.0 are different types to the sequence, and the difference reaches
    // the flight controller -- so the text has to preserve what was typed.
    const key = keyFor('Volt per cell max')
    expect(buildComponentsJson(fields, { [key]: '4.0' })).toContain('4.0')
    expect(buildComponentsJson(fields, { [key]: '4' })).not.toContain('4.0')
  })

  it('quotes anything that is not a number', () => {
    const json = buildComponentsJson(fields, { [keyFor('Frame class')]: 'Quad' })
    expect(JSON.parse(json).Components.Frame.Specifications['Frame class']).toBe('Quad')
  })

  it('leaves undeclared fields out entirely', () => {
    expect(JSON.parse(buildComponentsJson(fields, {})).Components).toEqual({})
    expect(JSON.parse(buildComponentsJson(fields, { [keyFor('Number of cells')]: '  ' })).Components).toEqual({})
  })
})

describe('runSequence', () => {
  const run = (values: Record<string, string>, parameters: Record<string, number> = {}) =>
    runSequence({ sequence: copter, fields, values, parameters })

  it('returns every step, including the ones it cannot compute', () => {
    const summary = run({})
    expect(summary.rows.length).toBe(copter.length)
    expect(summary.rows[0]?.title).not.toMatch(/\.param$/)
  })

  it('reports an undeclared vehicle as blocked steps rather than throwing', () => {
    const summary = run({})
    expect(summary.totalFailures).toBeGreaterThan(0)
    expect(summary.missing.length).toBeGreaterThan(0)
    for (const row of summary.rows) {
      for (const failure of row.failures) {
        expect(failure.error).not.toBe('')
      }
    }
  })

  it('unblocks steps as the vehicle is declared', () => {
    const blocked = run({}).totalFailures
    const declared = run({
      [keyFor('Diameter_inches')]: '10',
      [keyFor('Number of cells')]: '4',
      [keyFor('MCU Series')]: 'STM32H7xx'
    }).totalFailures
    expect(declared).toBeLessThan(blocked)
  })

  it('marks a parameter the vehicle already matches as satisfied', () => {
    const values = { [keyFor('Diameter_inches')]: '10', [keyFor('Number of cells')]: '4' }
    const first = run(values)
    const change = first.rows.flatMap((row) => row.changes).find((candidate) => candidate.reason !== undefined)
    expect(change).toBeDefined()
    if (!change) return

    const matched = run(values, { [change.parameter]: change.value })
    const seen = matched.rows.flatMap((row) => row.changes).find((c) => c.parameter === change.parameter)
    expect(seen?.satisfied).toBe(true)
    expect(seen?.current).toBe(change.value)
    expect(matched.totalPending).toBeLessThan(first.totalPending)
  })

  it('counts pending changes only against a connected vehicle', () => {
    // With no parameters known, nothing can be satisfied, so every change is
    // pending -- which is what the tab shows when nothing is plugged in.
    const summary = run({ [keyFor('Diameter_inches')]: '10' })
    expect(summary.totalPending).toBe(summary.totalChanges)
  })
})
