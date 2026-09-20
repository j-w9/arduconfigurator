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

const loaded = await loadSequence('ArduCopter')
const copter = loaded.steps
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
/** Runs carry the file too, which is where the phases come from. */
const file = loaded.file
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
    runSequence({ sequence: copter, file, fields, values, parameters })

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

  it('counts pending parameters, not the rows that set them', () => {
    // A parameter set by three steps is one draft, one line in the draft bar,
    // and one thing to decide about -- so counting rows would promise a number
    // the draft bar never shows.
    const summary = run({ [keyFor('Diameter_inches')]: '10' })
    const distinct = new Set(
      summary.rows.flatMap((row) => row.changes.filter((c) => !c.satisfied).map((c) => c.parameter))
    )
    expect(summary.totalPending).toBe(distinct.size)
    expect(summary.totalPending).toBeLessThan(summary.totalChanges)
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
    const summary = runSequence({ sequence: copter, file, fields, values, parameters: {} })
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
    // Twelve of the twenty-four fields are enumerations. The rest are
    // measurements and one version string, which are typed, not chosen.
    //
    // It was nine of twenty-one until the connection a step's parameters
    // belong to started counting as something the operator declares -- that
    // added the RC receiver, GNSS and telemetry connection types, all three of
    // which AMC also asks for as a choice.
    const lists = documentedFields.filter((field) => field.documented ?? field.suggested)
    expect(lists.length).toBe(12)
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

describe('values the documented range disputes', () => {
  // The sequence proposes values ArduPilot's firmware accepts but its published
  // *range* does not. Predicted here so the screen can say so before staging,
  // rather than the draft bar reporting an unexplained "N invalid" after.
  const upstream = JSON.parse(
    readFileSync(fileURLToPath(new URL('../generated/param-upstream/arducopter.json', import.meta.url)), 'utf8')
  ) as Record<string, { minimum?: number; maximum?: number; options?: { value: number; label: string }[]; bitmask?: boolean }>

  /** The vehicle as the app holds it: a value and the definition behind it. */
  const withVehicle = (parameters: Record<string, number>, values: Record<string, string> = {}) => {
    const states = Object.entries(parameters).map(([id, value]) => ({
      id,
      value,
      index: 0,
      count: 0,
      definition: { id, label: id, description: '', category: 'test', ...upstream[id] }
    }))
    return runSequence({ sequence: copter, file, fields: documentedFields, values, parameters, states, docs })
  }
  const keyFor = (label: string) => {
    const field = documentedFields.find((candidate) => candidate.label === label)
    if (!field) throw new Error(`no field named ${label}`)
    return field.key
  }

  // A vehicle declared well enough that the tuning steps compute.
  const DECLARED = {
    [keyFor('Diameter_inches')]: '10',
    [keyFor('Number of cells')]: '4',
    [keyFor('MCU Series')]: 'STM32H7xx',
    [keyFor('Version')]: '4.6.0',
    [keyFor('Frame class')]: 'Quad'
  }

  it('flags a 0 that means disabled on a parameter whose range starts higher', () => {
    // ATC_RAT_RLL_FLTE documents a minimum of 5; the sequence sets 0, which is
    // how the error filter is turned off. The firmware takes it; the published
    // range does not describe it.
    const summary = withVehicle({ ATC_RAT_RLL_FLTE: 20 }, DECLARED)
    const row = summary.rows
      .flatMap((r) => r.changes)
      .find((c) => c.parameter === 'ATC_RAT_RLL_FLTE' && c.value === 0)
    expect(row).toBeDefined()
    expect(row?.disputed?.reason).toMatch(/below the documented minimum of 5/)
    // Overridable, because it is the range that is wrong rather than the value.
    expect(row?.disputed?.overridable).toBe(true)
  })

  it('flags a notch filter the sequence disables the same way', () => {
    const summary = withVehicle({ ATC_RAT_RLL_NEF: 5 }, DECLARED)
    const row = summary.rows
      .flatMap((r) => r.changes)
      .find((c) => c.parameter === 'ATC_RAT_RLL_NEF' && c.value === 0)
    expect(row?.disputed?.reason).toMatch(/below the documented minimum of 1/)
  })

  it('says nothing at all when no vehicle is connected', () => {
    // With no vehicle there is no plan to check, so the tab shows the sequence
    // without pretending to know what any of it would be refused for.
    const summary = withVehicle({})
    expect(summary.totalDisputed).toBe(0)
    expect(summary.rows.flatMap((r) => r.changes).every((c) => c.disputed === undefined)).toBe(true)
  })

  it('reports a parameter this firmware does not have', () => {
    // The dominant reason the draft bar refuses the sequence: it proposes
    // parameters the connected vehicle never reported. Saying so here is the
    // difference between "12 invalid" and "your firmware has no such setting".
    const summary = withVehicle({ ATC_RAT_RLL_FLTE: 20 }, DECLARED)
    const absent = summary.rows
      .flatMap((r) => r.changes)
      .filter((c) => c.disputed?.reason.includes('not present in the synced snapshot'))
    expect(absent.length).toBeGreaterThan(0)
    // Nothing can rescue it, so the screen must not offer an override.
    expect(absent.every((c) => c.disputed?.overridable === false)).toBe(true)
  })

  it('counts disputed parameters the way the draft bar will', () => {
    const summary = withVehicle({ ATC_RAT_RLL_FLTE: 20, ATC_RAT_RLL_NEF: 5 }, DECLARED)
    const distinct = new Set(
      summary.rows.flatMap((r) => r.changes.filter((c) => c.disputed).map((c) => c.parameter))
    )
    expect(summary.totalDisputed).toBe(distinct.size)
    expect(summary.totalDisputed).toBeGreaterThan(0)
  })

  it('never disputes a value the vehicle already has', () => {
    // A satisfied row is not going to be staged, so flagging it would be noise.
    const summary = withVehicle({ ATC_RAT_RLL_FLTE: 0 }, DECLARED)
    const row = summary.rows.flatMap((r) => r.changes).find((c) => c.parameter === 'ATC_RAT_RLL_FLTE')
    expect(row?.satisfied).toBe(true)
    expect(row?.disputed).toBeUndefined()
  })
})

describe('phases', () => {
  const summary = runSequence({ sequence: copter, file, fields, values: {}, parameters: {} })

  it('groups every step under a phase heading, losing none', () => {
    const grouped = summary.groups.flatMap((group) => group.rows)
    expect(grouped.length).toBe(summary.rows.length)
    expect(grouped.map((r) => r.filename)).toEqual(summary.rows.map((r) => r.filename))
  })

  it('keeps the sequence in order across the groups', () => {
    const indexes = summary.groups.flatMap((group) => group.rows.map((r) => r.index))
    expect(indexes).toEqual([...indexes].sort((a, b) => a - b))
  })

  it('names the phases the sequence declares, and marks the optional ones', () => {
    const named = summary.groups.filter((group) => group.name !== '')
    expect(named.length).toBeGreaterThan(5)
    expect(named.map((g) => g.name)).toContain('Basic mandatory configuration')
    const tuning = named.find((g) => g.name === 'Standard tuning')
    expect(tuning?.optional).toBe(true)
    expect(named.find((g) => g.name === 'Basic mandatory configuration')?.optional).toBe(false)
  })

  it('does not run one phase into another', () => {
    // A heading appearing twice would mean the steps under it are not
    // contiguous, and the list would read as if the phase restarted.
    const names = summary.groups.map((g) => g.name).filter((n) => n !== '')
    expect(new Set(names).size).toBe(names.length)
  })

  it('lists the milestones that own no steps', () => {
    // "Assemble all components except the propellers" is something the
    // operator does, not a step the sequence can check -- so it is named
    // rather than silently absent.
    expect(summary.milestones.map((m) => m.name)).toContain('Assemble all components except the propellers')
    const phaseNames = new Set(summary.groups.map((g) => g.name))
    for (const milestone of summary.milestones) {
      expect(phaseNames.has(milestone.name)).toBe(false)
    }
  })

  it('still returns the whole sequence when the file is not supplied', () => {
    const without = runSequence({ sequence: copter, fields, values: {}, parameters: {} })
    expect(without.groups.flatMap((g) => g.rows).length).toBe(without.rows.length)
    expect(without.milestones).toEqual([])
  })
})

describe('what the sequence says about a step', () => {
  const summary = runSequence({ sequence: copter, file, fields, values: {}, parameters: {} })
  const step = (prefix: string) => {
    const row = summary.rows.find((r) => r.filename.startsWith(prefix))
    if (!row) throw new Error(`no step ${prefix}`)
    return row
  }

  it('carries the reasoning, not just the parameters', () => {
    // 252 steps of parameter tables is a spreadsheet; the sequence explains
    // itself and that explanation is most of its value.
    const withWhy = summary.rows.filter((r) => r.why)
    const withWhyNow = summary.rows.filter((r) => r.whyNow)
    expect(withWhy.length).toBe(summary.rows.length)
    expect(withWhyNow.length).toBe(summary.rows.length)
    expect(summary.rows.every((r) => r.mandatory)).toBe(true)
  })

  it('reads an instruction meant to be seen before starting', () => {
    const atc = step('13_')
    expect(atc.popup?.type).toBe('warning')
    expect(atc.popup?.msg).toMatch(/Only do this step once/)
  })

  it('treats work done outside this app as a precondition', () => {
    // "Close this application and go fly" is not a footnote.
    const withPrecondition = summary.rows.filter((r) => r.autoChangedBy)
    expect(withPrecondition.length).toBeGreaterThan(0)
    expect(step('14_').autoChangedBy).toMatch(/Mission Planner/)
  })

  it('gathers the further reading the sequence points at', () => {
    const links = step('02_').links
    expect(links.some((l) => l.kind === 'wiki')).toBe(true)
    expect(links.some((l) => l.kind === 'blog')).toBe(true)
    // Every link is labelled with the sequence's own words where it has them.
    expect(links.every((l) => l.label.length > 0 && l.url.startsWith('http'))).toBe(true)
  })

  it('does not use a sentence as a link label', () => {
    // Some of the sequence's link text is a title and some is a paragraph. A
    // 90-character link is unreadable, so the long ones become the tooltip.
    const all = summary.rows.flatMap((r) => r.links)
    expect(all.length).toBeGreaterThan(100)
    for (const l of all) expect(l.label.length).toBeLessThanOrEqual(48)
    // And nothing is lost: a shortened label keeps the full text.
    expect(all.some((l) => l.title && l.title.length > 48)).toBe(true)
  })

  it('names an external tool as a link, not as prose', () => {
    const tool = summary.rows.flatMap((r) => r.links).find((l) => l.kind === 'tool')
    expect(tool).toBeDefined()
    expect(tool?.label.length).toBeGreaterThan(0)
  })

  it('lists the log messages a step should produce', () => {
    const esc = step('09_')
    expect(esc.logMessages.length).toBeGreaterThan(0)
    const required = esc.logMessages.find((m) => m.required)
    expect(required?.id).toBe('ESC')
    expect(required?.name).toBe('ESC telemetry')
    // Optional ones are carried too, and marked as such.
    expect(esc.logMessages.some((m) => !m.required)).toBe(true)
  })

  it('knows which steps may be skipped, and what skipping costs', () => {
    const withJumps = summary.rows.filter((r) => r.jumps.length > 0)
    expect(withJumps.length).toBeGreaterThan(0)
    for (const row of withJumps) {
      for (const jump of row.jumps) {
        // A destination and a reason -- a jump with no stated cost would be an
        // invitation to skip something without knowing what it buys.
        expect(jump.to.length).toBeGreaterThan(0)
        expect(jump.cost.length).toBeGreaterThan(0)
      }
    }
  })

  it('names the file a step needs, what it is called, and where it goes', () => {
    const withFile = summary.rows.filter((r) => r.file)
    expect(withFile.length).toBeGreaterThan(0)
    for (const row of withFile) {
      expect(row.file?.url).toMatch(/^https?:/)
      expect(row.file?.destination).toMatch(/^\//)
      // The name is taken from what the step says to upload, not from the end
      // of the URL -- those are not always the same, and the flight controller
      // cares which one it gets.
      expect(row.file?.name.length).toBeGreaterThan(0)
      expect(row.file?.destination.endsWith(row.file.name)).toBe(true)
    }
  })

  it('points a step at the tool this app already has for it', () => {
    // AMC embeds these; here they exist as their own surfaces, so the step
    // names the destination rather than carrying a second copy.
    const orientation = step('05_')
    expect(orientation.tool?.name).toBe('ahrs_orientation')
    expect(orientation.tool?.label).toBe('Board orientation')
    // Board orientation is a Config category here, not its own tab.
    expect(orientation.tool?.view).toBe('config')

    const tools = summary.rows.filter((r) => r.tool)
    expect(tools.length).toBeGreaterThan(0)
    for (const row of tools) {
      expect(['config', 'motors', 'calibration']).toContain(row.tool?.view)
    }
  })

  it('does not invent content the sequence left empty', () => {
    // The step files carry these keys on every step, mostly as empty strings.
    // An empty string rendered as a heading is worse than nothing.
    for (const row of summary.rows) {
      for (const value of [row.why, row.whyNow, row.mandatory, row.component, row.autoChangedBy]) {
        if (value !== undefined) expect(value.trim().length).toBeGreaterThan(0)
      }
      expect(row.links.every((l) => l.url.trim().length > 0)).toBe(true)
    }
  })
})

describe('the sequence runs in order', () => {
  it('shows a step reading an earlier step\'s value, and says whose', () => {
    // Not theoretical: 13_initial_atc sets INS_GYRO_FILTER and MOT_THST_HOVER,
    // and the notch-filter and throttle-controller steps read them. Evaluated
    // against the live vehicle instead, those steps answer a question nobody
    // asked — and the number simply disagrees with the readout, which reads as
    // a bug rather than as the sequence doing its job.
    // A step that cannot be evaluated sets nothing, so nothing downstream can
    // inherit from it — the vehicle has to be declared for this to mean
    // anything at all.
    const values: Record<string, string> = {}
    for (const [match, value] of [
      [/Propellers\/Specifications\/Diameter_inches/, '10'],
      [/Battery\/Specifications\/Number of cells/, '4'],
      [/Flight Controller\/Specifications\/MCU Series/, 'STM32H7xx']
    ] as const) {
      const field = fields.find((f) => match.test(f.key))
      if (field) values[field.key] = value
    }

    const summary = runSequence({
      sequence: copter,
      fields,
      values,
      // A gyro filter the sequence will overwrite: if the later steps read
      // THIS rather than what 13_initial_atc computes, nothing is threaded.
      parameters: { INS_GYRO_FILTER: 20, MOT_THST_HOVER: 0.2 },
      docs
    })

    const inheriting = summary.rows.filter((row) => (row.inheritedFrom?.length ?? 0) > 0)
    expect(inheriting.length).toBeGreaterThan(0)

    for (const row of inheriting) {
      // Every step named must be a real step that runs BEFORE this one.
      const here = summary.rows.findIndex((r) => r.filename === row.filename)
      for (const from of row.inheritedFrom ?? []) {
        const there = summary.rows.findIndex((r) => r.filename === from)
        expect(there).toBeGreaterThanOrEqual(0)
        expect(there).toBeLessThan(here)
      }
    }
  })
})

describe('boot-time parameters', () => {
  it('names the parameters that need a reboot before later steps mean anything', () => {
    // The reason AMC's method is step-by-step rather than one bulk write: the
    // firmware reads these at startup, so a later step reading one gets the
    // OLD value until the vehicle has restarted.
    const summary = runSequence({
      sequence: copter,
      fields,
      values: {},
      parameters: { INS_TCAL1_ENABLE: 0, LOG_BITMASK: 1 },
      states: [
        { id: 'INS_TCAL1_ENABLE', value: 0, index: 0, count: 2, definition: { rebootRequired: true } },
        // Deliberately NOT reboot-required, so the filter is doing something.
        { id: 'LOG_BITMASK', value: 1, index: 1, count: 2, definition: {} }
      ] as never,
      docs
    })

    const flagged = summary.rows.filter((row) => (row.rebootParameters?.length ?? 0) > 0)
    expect(flagged.length).toBeGreaterThan(0)
    for (const row of flagged) {
      expect(row.rebootParameters).toContain('INS_TCAL1_ENABLE')
      expect(row.rebootParameters).not.toContain('LOG_BITMASK')
      // Only parameters the step actually sets.
      for (const name of row.rebootParameters ?? []) {
        expect(row.changes.some((change) => change.parameter === name)).toBe(true)
      }
    }
  })

  it('says nothing when the vehicle has not reported its parameters', () => {
    // Without metadata there is no basis for the claim, and inventing one
    // would put a reboot warning on every step.
    const summary = runSequence({ sequence: copter, fields, values: {}, parameters: {}, docs })
    expect(summary.rows.every((row) => row.rebootParameters === undefined)).toBe(true)
  })
})

describe('a flight log', () => {
  it('turns the list of messages a step should produce into a verdict', () => {
    // Several steps configure something whose only proof is in the log: ESC
    // telemetry either arrived or it did not.
    const withLog = runSequence({
      sequence: copter,
      fields,
      values: {},
      parameters: {},
      docs,
      logCounts: new Map([
        ['ESC', 1200],
        ['BAT', 900]
      ])
    })

    const escStep = withLog.rows.find((row) => row.filename === '09_esc_telemetry.param')
    expect(escStep?.logSatisfied).toBe(true)
    expect(escStep?.logMessages.find((m) => m.id === 'ESC')?.count).toBe(1200)

    // A step whose required message is absent says so.
    const gnss = withLog.rows.find((row) => row.filename === '12_gnss.param')
    expect(gnss?.logSatisfied).toBe(false)
    expect(gnss?.logMessages.find((m) => m.id === 'GPS')?.count).toBe(0)
  })

  it('says nothing about logs until one is loaded', () => {
    // A count of zero would be a claim we cannot make without a log, and it
    // would mark every step as failing.
    const withoutLog = runSequence({ sequence: copter, fields, values: {}, parameters: {}, docs })
    for (const row of withoutLog.rows) {
      expect(row.logSatisfied).toBeUndefined()
      for (const message of row.logMessages) expect(message.count).toBeUndefined()
    }
    // The list itself is still there — it is what the sequence says.
    const escStep = withoutLog.rows.find((row) => row.filename === '09_esc_telemetry.param')
    expect(escStep?.logMessages.length).toBeGreaterThan(0)
  })
})
