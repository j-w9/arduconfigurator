import { describe, expect, it } from 'vitest'

import {
  buildComponentsJson,
  draftsFrom,
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

// The same sequence with ArduPilot's documentation available, which is what
// turns the enumerated fields into dropdowns.
const { readFileSync } = await import('node:fs')
const { fileURLToPath } = await import('node:url')
const { parameterDocsFrom } = await import('@arduconfig/amc-steps')
const docs = parameterDocsFrom(
  JSON.parse(readFileSync(fileURLToPath(new URL('../generated/param-upstream/arducopter.json', import.meta.url)), 'utf8'))
)
const documentedFields = fieldsFor(copter, docs)
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
      for (const entry of row.blocked) {
        expect(entry.parameters.length).toBeGreaterThan(0)
        // The summary is what the step leads with, so it must never be the
        // evaluator's own vocabulary.
        expect(entry.summary).not.toBe('')
        expect(entry.summary).not.toMatch(/KeyError|PyError|undefined/)
        expect(entry.detail).not.toBe('')
      }
    }
  })

  it('names the field that unblocks the most steps', () => {
    const summary = run({})
    expect(summary.nextFields.length).toBeGreaterThan(0)
    const unblocks = summary.nextFields.map((entry) => entry.unblocks)
    expect(unblocks).toEqual([...unblocks].sort((left, right) => right - left))
    // Every suggestion has to be a field the form actually renders, or the
    // jump-to-field button would point at nothing.
    for (const entry of summary.nextFields) {
      expect(fields.some((field) => field.key === entry.field.key)).toBe(true)
    }
  })

  it('counts blocked parameters, not causes, beside the parameters it set', () => {
    const summary = run({})
    const parameters = summary.rows.reduce(
      (total, row) => total + row.blocked.reduce((sum, entry) => sum + entry.parameters.length, 0),
      0
    )
    const causes = summary.rows.reduce((total, row) => total + row.blocked.length, 0)
    expect(summary.totalFailures).toBe(parameters)
    expect(causes).toBeLessThan(parameters)
  })

  it('says a shared cause once rather than once per parameter', () => {
    // One undeclared ESC protocol blocks SERIAL1 through SERIAL9 plus more; as
    // separate lines that is ten ways of saying the same sentence.
    const rows = run({}).rows
    const grouped = rows.flatMap((row) => row.blocked).filter((entry) => entry.parameters.length > 1)
    expect(grouped.length).toBeGreaterThan(0)
    for (const entry of grouped) {
      expect(entry.summary).toMatch(/\d+ parameters/)
      expect(new Set(entry.parameters).size).toBe(entry.parameters.length)
    }

    const esc = rows.find((row) => row.filename.includes('esc_telemetry'))
    expect(esc).toBeDefined()
    // Eleven blocked directives, but far fewer distinct things to go and do.
    expect(esc?.blocked.length).toBeLessThan(
      esc?.blocked.reduce((total, entry) => total + entry.parameters.length, 0) ?? 0
    )
  })

  it('points a blocked step at a field the form renders', () => {
    const blocked = run({}).rows.flatMap((row) => row.blocked).filter((entry) => entry.declare.length > 0)
    expect(blocked.length).toBeGreaterThan(0)
    for (const entry of blocked.slice(0, 20)) {
      for (const target of entry.declare) {
        expect(fields.some((field) => field.key === target.key)).toBe(true)
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

describe('draftsFrom', () => {
  it('renders values the way the draft model expects them', () => {
    expect(draftsFrom([{ parameter: 'INS_GYRO_FILTER', value: 42 }])).toEqual({ INS_GYRO_FILTER: '42' })
    expect(draftsFrom([{ parameter: 'MOT_THST_EXPO', value: 0.6 }])).toEqual({ MOT_THST_EXPO: '0.6' })
  })

  it('lets the later step decide when two propose the same parameter', () => {
    expect(
      draftsFrom([
        { parameter: 'LOG_BITMASK', value: 1 },
        { parameter: 'LOG_BITMASK', value: 2 }
      ])
    ).toEqual({ LOG_BITMASK: '2' })
  })

  it('stages nothing for nothing', () => {
    expect(draftsFrom([])).toEqual({})
  })

  it('covers every pending change the sequence proposes', () => {
    const values = { [keyFor('Diameter_inches')]: '10', [keyFor('Number of cells')]: '4' }
    const summary = runSequence({ sequence: copter, fields, values, parameters: {} })
    const pending = summary.rows.flatMap((row) => row.changes.filter((change) => !change.satisfied))
    const drafts = draftsFrom(pending)
    // Deduplication is expected, so the draft count is the distinct parameters.
    expect(Object.keys(drafts).length).toBe(new Set(pending.map((change) => change.parameter)).size)
    for (const key of Object.keys(drafts)) {
      expect(Number.isNaN(Number(drafts[key]))).toBe(false)
    }
  })
})

describe('field choices', () => {
  const find = (label: string, source = documentedFields) => {
    const field = source.find((candidate) => candidate.label === label)
    if (!field) throw new Error(`no field named ${label}`)
    return field
  }

  it('makes an enumerated field a dropdown, from the documentation', () => {
    // Which parameter a field supplies is stated by the step files, so this
    // mapping is derived rather than kept here.
    expect(find('Frame class').documented).toContain('Quad')
    expect(find('Frame class').documented).toContain('Hexa')
    const escProtocol = documentedFields.find(
      (field) => field.component === 'ESC' && field.group === 'FC->ESC Connection' && field.label === 'Protocol'
    )
    expect(escProtocol?.documented).toContain('DShot600')
  })

  it('leaves a measurement as a number field, not a list', () => {
    // The templates give plenty of observed diameters and cell voltages, but a
    // list of other people's hardware is not how you enter your own.
    for (const label of ['Diameter_inches', 'Capacity mAh', 'Volt per cell max', 'Number of cells']) {
      const field = find(label)
      expect(field.documented, label).toBeUndefined()
      expect(field.suggested, label).toBeUndefined()
      expect(field.numeric, label).toBe(true)
    }
  })

  it('offers a dropdown for every enumeration and nothing else', () => {
    for (const field of documentedFields) {
      const isList = field.documented !== undefined || field.suggested !== undefined
      // Exactly one of the two: a list, or a number. Never both, never neither
      // without good reason.
      expect(isList && field.numeric, `${field.component} > ${field.label}`).toBe(false)
    }
    // Nine of the twenty-one fields are enumerations. The rest are
    // measurements and one version string, which are typed, not chosen.
    const lists = documentedFields.filter((field) => field.documented ?? field.suggested)
    expect(lists.length).toBe(9)
  })

  it('leaves a version as free text, not a list of other people\'s versions', () => {
    // The sequence compares versions (Version(x) > Version('4.6')), so the next
    // release has to be typeable -- and it is not in AMC's templates.
    const version = find('Version')
    expect(version.documented).toBeUndefined()
    expect(version.suggested).toBeUndefined()
  })

  it('suggests values from the templates where the documentation has none', () => {
    // MCU Series is an enumeration AMC keeps in code rather than in the
    // parameter documentation, so it stays free text with suggestions.
    const mcu = find('MCU Series')
    expect(mcu.documented).toBeUndefined()
    expect(mcu.suggested).toContain('STM32H7xx')
    expect(mcu.numeric).toBe(false)
  })

  it('offers no choices at all without documentation', () => {
    expect(find('Frame class', fields).documented).toBeUndefined()
  })

  it('never offers an empty list of choices', () => {
    for (const field of documentedFields) {
      if (field.documented) expect(field.documented.length).toBeGreaterThan(0)
      if (field.suggested) expect(field.suggested.length).toBeGreaterThan(0)
    }
  })

  it('turns a meaningful share of the form into dropdowns', () => {
    const dropdowns = documentedFields.filter((field) => field.documented)
    expect(dropdowns.length).toBeGreaterThanOrEqual(6)
  })
})
