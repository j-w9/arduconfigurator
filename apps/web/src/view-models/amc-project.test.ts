import { describe, expect, it } from 'vitest'

import schemaJson from '@amc/data/vehicle_components_schema.json'

import { fieldsFor, loadSequence } from './amc-guided'
import {
  buildProject,
  importFromVehicle,
  projectArchive,
  projectFilename,
  readProject,
  templateComponents,
  templateValues,
  vehicleTemplates
} from './amc-project'

// The writing and reading halves are proven against AMC's own directories in
// the fork's test suite. What lives here is the part that closes the loop for
// an operator: a vehicle declared in this form, written out, and picked back
// up with the declarations intact.

const { steps: copter } = await loadSequence('ArduCopter')
const fields = fieldsFor(copter)

/** A declaration good enough for most of the sequence to evaluate. */
function declare(): Record<string, string> {
  const values: Record<string, string> = {}
  const set = (match: RegExp, value: string) => {
    const field = fields.find((f) => match.test(f.key))
    if (field) values[field.key] = value
  }
  set(/Propellers\/Specifications\/Diameter_inches/, '10')
  set(/Battery\/Specifications\/Number of cells/, '4')
  set(/Flight Controller\/Specifications\/MCU Series/, 'STM32H7xx')
  return values
}

describe('buildProject', () => {
  it('writes a file for every step, plus the declaration it was derived from', () => {
    const project = buildProject({ sequence: copter, fields, values: declare(), parameters: {} })

    // vehicle_components.json is not a nicety: without it the parameter files
    // are values with no account of why any of them are what they are.
    expect(project.files.some((f) => f.filename === 'vehicle_components.json')).toBe(true)
    // A step that decides nothing still gets a file — "considered, nothing to
    // set" is a different statement from the file being absent.
    expect(project.files.length).toBe(copter.length + 1)
  })

  it('leaves out 00_default.param when the firmware defaults are unknown', () => {
    // An empty defaults file would assert that the firmware's defaults are
    // known to be nothing, which is worse than its absence.
    const without = buildProject({ sequence: copter, fields, values: declare(), parameters: {} })
    expect(without.files.some((f) => f.filename === '00_default.param')).toBe(false)

    const withDefaults = buildProject({
      sequence: copter,
      fields,
      values: declare(),
      parameters: { INS_GYR_CAL: 1 },
      defaults: new Map([['INS_GYR_CAL', 0]])
    })
    expect(withDefaults.files.some((f) => f.filename === '00_default.param')).toBe(true)
  })
})

describe('the round trip', () => {
  it('gives back the vehicle that was declared', () => {
    const values = declare()
    const project = buildProject({ sequence: copter, fields, values, parameters: {} })
    const read = readProject(copter, project.files, fields)

    expect(read.unmatched).toEqual([])
    expect(read.missing).toEqual([])
    expect(read.componentValues).toEqual(values)
  })

  it('carries a recorded decision through a rewrite', () => {
    // An @manual_override is the operator overruling the sequence. Losing it
    // on the way back in means the next export silently reverts their choice.
    const values = declare()
    const first = buildProject({
      sequence: copter,
      fields,
      values,
      parameters: {},
      overrides: new Map([['LOG_BITMASK', { value: 407519, reason: 'kept for notch tuning' }]])
    })
    const read = readProject(copter, first.files, fields)
    expect(read.overrides.get('LOG_BITMASK')?.value).toBe(407519)

    const second = buildProject({
      sequence: copter,
      fields,
      values,
      parameters: {},
      overrides: read.overrides
    })
    expect(readProject(copter, second.files, fields).overrides.get('LOG_BITMASK')?.value).toBe(407519)
  })

  it('reports a file it cannot place rather than dropping it', () => {
    // The operator's work sitting unread in the directory is the failure that
    // matters, so it has to be something the screen can say.
    const project = buildProject({ sequence: copter, fields, values: declare(), parameters: {} })
    const read = readProject(
      copter,
      [...project.files, { filename: '99_handwritten.param', text: 'FOO,1\n' }],
      fields
    )
    expect(read.unmatched).toEqual(['99_handwritten.param'])
  })

  it('still reads the parameter files when the declaration is corrupt', () => {
    // Partly readable beats an error: the steps are the bulk of the work.
    const project = buildProject({ sequence: copter, fields, values: declare(), parameters: {} })
    const read = readProject(
      copter,
      project.files.map((f) =>
        f.filename === 'vehicle_components.json' ? { ...f, text: '{not json' } : f
      ),
      fields
    )
    expect(read.componentValues).toBeUndefined()
    expect(read.steps.length).toBe(copter.length)
  })
})

describe('the download', () => {
  it('is an archive holding every file', () => {
    const project = buildProject({ sequence: copter, fields, values: declare(), parameters: {} })
    const bytes = projectArchive(project)
    // Local file header signature, so it is a zip at all.
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
    // Entry count sits in the end-of-central-directory record.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    expect(view.getUint16(bytes.length - 12, true)).toBe(project.files.length)
  })

  it('reduces whatever the operator typed to a safe filename', () => {
    expect(projectFilename('My Copter')).toBe('My_Copter.zip')
    expect(projectFilename('../../etc/passwd')).toBe('.._.._etc_passwd.zip')
    expect(projectFilename('')).toBe('vehicle.zip')
    expect(projectFilename(undefined)).toBe('vehicle.zip')
  })
})

describe('reading the declaration off the vehicle', () => {
  /** A configured quadcopter, as its parameters would report it. */
  const configured = {
    FRAME_CLASS: 1,
    GPS1_TYPE: 2,
    SERIAL3_PROTOCOL: 5,
    SERIAL1_PROTOCOL: 2,
    RC_PROTOCOLS: 8,
    MOT_PWM_TYPE: 6,
    BATT_MONITOR: 4,
    BATT_CAPACITY: 5000,
    MOT_BAT_VOLT_MAX: 16.8
  }

  it('fills in what the vehicle can answer', () => {
    const result = importFromVehicle({ fields, values: {}, parameters: configured, kind: 'ArduCopter' })

    // The point of the feature: a configured vehicle answers most of the form.
    expect(Object.keys(result.values).length).toBeGreaterThan(8)
    expect(result.values['Frame/Specifications/Frame class']).toBe('Quad')
    expect(result.values['Battery/Specifications/Number of cells']).toBe('4')
    expect(result.values['Battery/Specifications/Capacity mAh']).toBe('5000')
    expect(result.values['RC Receiver/FC Connection/Protocol']).toBe('SBUS')
    // Three derived fields have no box on this form, and that is correct: the
    // field list is built from what the SEQUENCE reads ("exactly what the
    // sequence reads, nothing more"), and no ArduCopter expression reads the
    // telemetry protocol, the ESC's connection type or the battery chemistry.
    // Reported rather than dropped, so a derived value never disappears
    // silently — and a sequence that starts reading one will show up here.
    expect([...result.unmapped].sort()).toEqual([
      'Battery/Specifications/Chemistry',
      'ESC/FC->ESC Connection/Type',
      'Telemetry/FC Connection/Protocol'
    ])
  })

  it('says which answers it would replace', () => {
    // A parameter says how the vehicle is CONFIGURED, not how it is wired, so
    // overwriting the operator is the one outcome worth calling out.
    const declared = { 'Frame/Specifications/Frame class': 'Hexa' }
    const result = importFromVehicle({
      fields,
      values: declared,
      parameters: configured,
      kind: 'ArduCopter'
    })
    expect(result.overwrites).toContain('Frame/Specifications/Frame class')
    expect(result.values['Frame/Specifications/Frame class']).toBe('Quad')
  })

  it('leaves an answer that already agrees alone', () => {
    const result = importFromVehicle({
      fields,
      values: { 'Frame/Specifications/Frame class': 'Quad' },
      parameters: configured,
      kind: 'ArduCopter'
    })
    expect(result.overwrites).not.toContain('Frame/Specifications/Frame class')
    expect(result.values['Frame/Specifications/Frame class']).toBeUndefined()
  })

  it('reports what the parameters could not settle', () => {
    // Two ports set to GPS: the parameters do not say which one has the
    // receiver, and saying so beats picking one silently.
    const result = importFromVehicle({
      fields,
      values: {},
      parameters: { ...configured, SERIAL4_PROTOCOL: 5 },
      kind: 'ArduCopter'
    })
    expect(result.undetermined.some((m) => /SERIAL3 and SERIAL4/.test(m))).toBe(true)
  })

  it('derives nothing from a vehicle that has reported nothing', () => {
    const result = importFromVehicle({ fields, values: {}, parameters: {}, kind: 'ArduCopter' })
    expect(result.values).toEqual({})
    expect(result.overwrites).toEqual([])
  })

  it("prefers the firmware's own MOT_PWM_TYPE labels over the built-in table", () => {
    const result = importFromVehicle({
      fields,
      values: {},
      parameters: configured,
      kind: 'ArduCopter',
      pwmTypeValues: { '6': 'DShot600-from-firmware' }
    })
    expect(result.values['ESC/FC->ESC Connection/Protocol']).toBe('DShot600-from-firmware')
  })
})

describe('opening a directory written for older firmware', () => {
  /** A directory declaring 4.5, holding a parameter 4.7 renamed and rescaled. */
  const oldProject = (version: string) => [
    {
      filename: 'vehicle_components.json',
      text: JSON.stringify({ Components: { 'Flight Controller': { Firmware: { Version: version } } } })
    },
    {
      filename: '13_initial_atc.param',
      // ANGLE_MAX was centidegrees; ATC_ANGLE_MAX is degrees.
      text: 'ANGLE_MAX,3000  # 30 degrees\n'
    }
  ]

  it('renames and rescales what the firmware moved', () => {
    const read = readProject(copter, oldProject('4.5.0'), fields, { vehicleFirmwareVersion: '4.7.0' })

    const step = read.steps.find((s) => s.filename === '13_initial_atc.param')
    expect(step?.entries.get('ATC_ANGLE_MAX')?.value).toBe(30)
    expect(step?.entries.has('ANGLE_MAX')).toBe(false)

    const rename = read.renamedParameters?.find((r) => r.from === 'ANGLE_MAX')
    expect(rename?.to).toBe('ATC_ANGLE_MAX')
    // The rescale is reported, because the number in the file and the number
    // on the vehicle are deliberately not the same.
    expect(rename?.scale).toBe(0.01)
  })

  it('leaves a directory written for this firmware alone', () => {
    const read = readProject(copter, oldProject('4.7.0'), fields, { vehicleFirmwareVersion: '4.7.0' })
    const step = read.steps.find((s) => s.filename === '13_initial_atc.param')
    expect(step?.entries.get('ANGLE_MAX')?.value).toBe(3000)
    expect(read.renamedParameters ?? []).toEqual([])
  })

  it('renames nothing when either version is unknown', () => {
    // Renaming on a guess moves values that should have stayed put.
    const noVehicle = readProject(copter, oldProject('4.5.0'), fields)
    expect(noVehicle.steps.find((s) => s.filename === '13_initial_atc.param')?.entries.has('ANGLE_MAX')).toBe(true)

    const noFile = readProject(copter, oldProject(''), fields, { vehicleFirmwareVersion: '4.7.0' })
    expect(noFile.steps.find((s) => s.filename === '13_initial_atc.param')?.entries.has('ANGLE_MAX')).toBe(true)
  })
})

describe('what the sequence did not decide', () => {
  it('writes a file naming what is on the vehicle that no step set', () => {
    // The directory says what the method decided. Without this it quietly
    // implies that is the whole vehicle.
    const project = buildProject({
      sequence: copter,
      fields,
      values: declare(),
      parameters: { SOME_HAND_SET_THING: 7 }
    })
    const file = project.files.find((f) => f.filename === 'fc_params_not_accounted_for.param')
    expect(file?.text).toMatch(/SOME_HAND_SET_THING/)
    expect(file?.text).toMatch(/Not set by any step/)
  })

  it('leaves the file out when there is nothing to say', () => {
    // An empty file would assert that the sequence accounts for the whole
    // vehicle, which is a stronger claim than its absence makes.
    const project = buildProject({ sequence: copter, fields, values: declare(), parameters: {} })
    expect(project.files.some((f) => f.filename === 'fc_params_not_accounted_for.param')).toBe(false)
  })

  it('does not report a value still at its firmware default', () => {
    const project = buildProject({
      sequence: copter,
      fields,
      values: declare(),
      parameters: { UNTOUCHED: 3 },
      defaults: new Map([['UNTOUCHED', 3]])
    })
    const file = project.files.find((f) => f.filename === 'fc_params_not_accounted_for.param')
    expect(file?.text ?? '').not.toMatch(/UNTOUCHED/)
  })
})

describe('starting from a similar vehicle', () => {
  it('offers AMC\'s own vehicles for this sequence, most complete first', () => {
    const copterTemplates = vehicleTemplates(fields, 'ArduCopter')
    expect(copterTemplates.length).toBeGreaterThan(10)
    // Narrowed to the sequence: a Rover's declaration is not a starting point
    // for a copter.
    expect(copterTemplates.every((t) => t.kind === 'ArduCopter')).toBe(true)
    // A template answering two fields is a worse starting point than one
    // answering twenty, and the order should say so without the operator
    // opening each.
    for (let i = 1; i < copterTemplates.length; i += 1) {
      expect(copterTemplates[i - 1]!.answers).toBeGreaterThanOrEqual(copterTemplates[i]!.answers)
    }
    expect(copterTemplates[0]!.answers).toBeGreaterThan(5)
    // Readable, not the directory name.
    expect(copterTemplates.some((t) => t.label.includes('_'))).toBe(false)
  })

  it('fills the form in from the template the operator chose', () => {
    const [first] = vehicleTemplates(fields, 'ArduCopter')
    const values = templateValues(first!.id, fields)
    expect(Object.keys(values).length).toBe(first!.answers)
    // Only fields this form actually has.
    const known = new Set(fields.map((f) => f.key))
    for (const key of Object.keys(values)) expect(known.has(key)).toBe(true)
  })

  it('and the result runs the sequence rather than just filling boxes', () => {
    // The point of a starting point: the sequence can compute from it.
    const [first] = vehicleTemplates(fields, 'ArduCopter')
    const project = buildProject({
      sequence: copter,
      fields,
      values: templateValues(first!.id, fields),
      parameters: {}
    })
    expect(project.parameterCount).toBeGreaterThan(0)
    // Fewer unevaluable steps than an empty declaration leaves.
    const empty = buildProject({ sequence: copter, fields, values: {}, parameters: {} })
    expect(project.incomplete.length).toBeLessThan(empty.incomplete.length)
  })

  it('an unknown template id changes nothing', () => {
    expect(templateValues('NoSuch/Vehicle', fields)).toEqual({})
  })
})

describe('the directory AMC would have to open', () => {
  /** AMC's own schema, which its project opener validates against. */
  // Aliased the same way the step data is: the fork holds AMC's schema.
  const schema = schemaJson as unknown as {
    required?: string[]
    properties?: { Components?: { required?: string[] } }
  }

  const componentsOf = (project: { files: readonly { filename: string; text: string }[] }) =>
    JSON.parse(project.files.find((f) => f.filename === 'vehicle_components.json')!.text)

  it('carries the Format version the schema requires', () => {
    // Its absence is the difference between a directory AMC opens and one it
    // refuses, and nothing about the parameter files gives it away.
    const doc = componentsOf(buildProject({ sequence: copter, fields, values: declare(), parameters: {} }))
    for (const key of schema.required ?? []) {
      expect(Object.keys(doc)).toContain(key)
    }
    expect(doc['Format version']).toBe(1)
  })

  it('keeps every component when started from one of AMC\'s vehicles', () => {
    // The form only asks about what the SEQUENCE reads, so a directory built
    // from the answers alone is missing whole components the schema requires —
    // Motors, ESC, Frame — along with every manufacturer, URL and note.
    const [template] = vehicleTemplates(fields, 'ArduCopter')
    const base = templateComponents(template!.id)
    const doc = componentsOf(
      buildProject({
        sequence: copter,
        fields,
        values: templateValues(template!.id, fields),
        parameters: {},
        baseComponents: base
      })
    )

    for (const component of schema.properties?.Components?.required ?? []) {
      expect(Object.keys(doc.Components)).toContain(component)
    }
    // And nothing was dropped: every leaf the template carried is present,
    // which is a stronger claim than any single field being populated (the
    // most-complete template still leaves some blank).
    const leaves = (node: unknown, trail: string[] = [], out: string[] = []): string[] => {
      if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
        for (const [key, child] of Object.entries(node)) leaves(child, [...trail, key], out)
        return out
      }
      out.push(trail.join('/'))
      return out
    }
    const missing = leaves(base).filter((path) => !leaves(doc.Components).includes(path))
    expect(missing).toEqual([])
    expect(leaves(base).length).toBeGreaterThan(30)
  })

  it('lets the operator\'s answer win over the vehicle it started from', () => {
    // A template is a starting point, not a claim: what they corrected has to
    // be what gets written.
    const [template] = vehicleTemplates(fields, 'ArduCopter')
    const base = templateComponents(template!.id)
    const values = { ...templateValues(template!.id, fields) }
    const cellsKey = fields.find((f) => /Number of cells/.test(f.key))!.key
    values[cellsKey] = '12'

    const doc = componentsOf(
      buildProject({ sequence: copter, fields, values, parameters: {}, baseComponents: base })
    )
    expect(doc.Components.Battery.Specifications['Number of cells']).toBe(12)
  })
})
