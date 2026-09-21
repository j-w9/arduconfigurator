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
    const stepFiles = project.files.filter((f) => /^\d+_/.test(f.filename))
    expect(stepFiles.length).toBe(copter.length)
    // Named rather than counted, so adding a file to the directory does not
    // read as a regression in the step files.
    expect(project.files.some((f) => f.filename === 'complete.param')).toBe(true)
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
    // Two derived fields have no box on this form, and that is correct: the
    // field list is built from what the SEQUENCE reads, and no ArduCopter
    // expression reads the telemetry protocol or the ESC's connection type.
    // Reported rather than dropped, so a derived value never disappears
    // silently.
    //
    // The battery chemistry used to be a third. It is now asked for -- no
    // expression reads it either, but the cell-voltage checks are meaningless
    // without it -- so the value this derives from the pack voltage lands in
    // the form instead of being reported as homeless.
    expect(result.values['Battery/Specifications/Chemistry']).toBeTruthy()
    expect([...result.unmapped].sort()).toEqual([
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
    // AMC's name, which spells out the range of steps it covers: "not
    // accounted for" is only meaningful against a stated set of files.
    const file = project.files.find((f) =>
      f.filename.startsWith('fc_params_missing_or_different_in_the_amc_param_files_')
    )
    expect(file?.filename).toMatch(/_to_\d+_\w+\.param$/)
    expect(file?.text).toMatch(/SOME_HAND_SET_THING/)
    expect(file?.text).toMatch(/Not set by any step/)
  })

  it('leaves the file out when there is nothing to say', () => {
    // An empty file would assert that the sequence accounts for the whole
    // vehicle, which is a stronger claim than its absence makes.
    const project = buildProject({ sequence: copter, fields, values: declare(), parameters: {} })
    expect(project.files.some((f) => f.filename.startsWith('fc_params_missing_or_different'))).toBe(false)
  })

  it('does not report a value still at its firmware default', () => {
    const project = buildProject({
      sequence: copter,
      fields,
      values: declare(),
      parameters: { UNTOUCHED: 3 },
      defaults: new Map([['UNTOUCHED', 3]])
    })
    const file = project.files.find((f) => f.filename.startsWith('fc_params_missing_or_different'))
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

describe('a directory you can come back to', () => {
  const componentsOf = (project: { files: readonly { filename: string; text: string }[] }, name: string) =>
    project.files.find((f) => f.filename === name)

  it('records where the operator got to, and resumes after it', () => {
    // AMC's method runs over days. Reopening at step one is a surprising
    // answer to a sequence someone had nearly finished.
    const stopped = copter[4]!.filename
    const project = buildProject({
      sequence: copter,
      fields,
      values: declare(),
      parameters: {},
      lastWritten: stopped
    })
    expect(componentsOf(project, 'last_uploaded_filename.txt')?.text).toBe(`${stopped}\n`)

    const read = readProject(copter, project.files, fields)
    expect(read.resume?.reason).toBe('after-last-written')
    expect(read.resume?.lastWritten).toBe(stopped)
    expect(read.resume?.filename).toBe(copter[5]!.filename)
  })

  it('does not report its own bookkeeping as unread work', () => {
    // complete.param and the rest are the directory describing itself. Listed
    // as unread they would look like the operator's work being dropped.
    const project = buildProject({
      sequence: copter,
      fields,
      values: declare(),
      parameters: { SOMETHING: 1 },
      lastWritten: copter[2]!.filename
    })
    expect(readProject(copter, project.files, fields).unmatched).toEqual([])
  })

  it('compounds every decision into complete.param', () => {
    const project = buildProject({ sequence: copter, fields, values: declare(), parameters: {} })
    const complete = componentsOf(project, 'complete.param')!
    // Each value says which step settled it, which a compounded file
    // otherwise loses.
    expect(complete.text).toMatch(/#\s+\d+_\w+\.param/)
  })

  it('writes the documentation into the files only when asked', () => {
    const plain = buildProject({ sequence: copter, fields, values: declare(), parameters: {} })
    const annotated = buildProject({
      sequence: copter,
      fields,
      values: declare(),
      parameters: {},
      annotate: (name) => (name === 'INS_TCAL1_ENABLE' ? { label: 'Temperature calibration enable' } : undefined)
    })

    const plainStep = plain.files.find((f) => f.filename.includes('imu_temperature_calibration_setup'))!
    const richStep = annotated.files.find((f) => f.filename.includes('imu_temperature_calibration_setup'))!
    expect(plainStep.text).not.toMatch(/Temperature calibration enable/)
    expect(richStep.text).toMatch(/# Temperature calibration enable/)

    // And an annotated directory still reads back: annotation is comments, so
    // it must not change what the files mean.
    const read = readProject(copter, annotated.files, fields)
    expect(read.unmatched).toEqual([])
    expect(read.steps.length).toBe(copter.length)
  })
})

describe('the summary files beside the sequence', () => {
  const summary = {
    readOnly: [{ parameter: 'STAT_RUNTIME', value: 4200, defaultValue: 0, category: 'readOnly' as const }],
    calibration: [{ parameter: 'INS_ACCOFFS_X', value: 0.12, defaultValue: 0, category: 'calibration' as const }],
    identity: [{ parameter: 'SYSID_THISMAV', value: 7, defaultValue: 1, category: 'identity' as const }],
    chosen: [{ parameter: 'ATC_RAT_RLL_P', value: 0.135, defaultValue: 0.135, category: 'chosen' as const }],
    changed: [],
    compared: 4,
    categoriesAvailable: true
  }

  it('writes what the vehicle holds, split by who decided it', () => {
    // complete.param says what the METHOD decided. These say what is on the
    // aircraft, and the split is what lets a configuration be reused without
    // carrying another airframe's calibration or identity along with it.
    const project = buildProject({
      sequence: copter,
      fields,
      values: declare(),
      parameters: {},
      summary
    })
    const names = project.files.map((f) => f.filename)
    expect(names).toContain('non-default_read-only.param')
    expect(names).toContain('non-default_writable_calibrations.param')
    expect(names).toContain('non-default_writable_ids.param')
    expect(names).toContain('reusable.param')

    const reusable = project.files.find((f) => f.filename === 'reusable.param')!
    expect(reusable.text).toMatch(/ATC_RAT_RLL_P/)
    expect(reusable.text).not.toMatch(/INS_ACCOFFS_X/)
    expect(reusable.text).not.toMatch(/SYSID_THISMAV/)
  })

  it('writes none of them when there is no summary to write', () => {
    const project = buildProject({ sequence: copter, fields, values: declare(), parameters: {} })
    expect(project.files.some((f) => f.filename.startsWith('non-default_'))).toBe(false)
  })

  it('does not report them as unread when the directory is reopened', () => {
    const project = buildProject({
      sequence: copter,
      fields,
      values: declare(),
      parameters: {},
      summary
    })
    expect(readProject(copter, project.files, fields).unmatched).toEqual([])
  })
})

describe('the snapshot of what the vehicle had first', () => {
  // AMC takes this once and never again, so it records the aircraft before the
  // method ran — the thing you want back when a configuration turns out wrong
  // and the tuning that actually flew is two weeks of edits ago.

  const live = { ATC_RAT_RLL_P: 0.135, LOG_BITMASK: 176126 }

  it('is written into the directory beside the step files', () => {
    const project = buildProject({ sequence: copter, fields, values: declare(), parameters: live })
    const names = project.files.map((file) => file.filename)
    expect(names).toContain('autobackup_00_before_ardupilot_methodic_configurator.param')
    expect(names).toContain('autobackup_01.param')
  })

  it('is not taken again once the sequence has been written to the vehicle', () => {
    // By then the aircraft has already been changed, so a snapshot of it is no
    // longer a snapshot of what was there before.
    const project = buildProject({
      sequence: copter,
      fields,
      values: declare(),
      parameters: live,
      lastWritten: '05_board_orientation.param'
    })
    const names = project.files.map((file) => file.filename)
    expect(names).not.toContain('autobackup_00_before_ardupilot_methodic_configurator.param')
    expect(names).toContain('autobackup_01.param')
  })

  it('is absent when the vehicle has reported nothing', () => {
    // An empty backup would assert that the aircraft was blank.
    const project = buildProject({ sequence: copter, fields, values: declare(), parameters: {} })
    expect(project.files.some((file) => file.filename.startsWith('autobackup_'))).toBe(false)
  })

  it('survives the round trip without being called unread work', () => {
    const project = buildProject({ sequence: copter, fields, values: declare(), parameters: live })
    expect(readProject(copter, project.files, fields).unmatched).toEqual([])
  })
})

describe('a parameter the operator added to a step', () => {
  // Written with the @manual_override marker, because on the way back in there
  // is otherwise no way to tell an addition from a value the sequence used to
  // compute and no longer does — and an unmarked one would be dropped on the
  // next rewrite.

  const additions = new Map([
    ['08_telemetry.param', new Map([['SERIAL1_BAUD', { value: 115, reason: 'my ESP32 link' }]])]
  ])

  it('is written into the step it belongs to, and nowhere else', () => {
    const project = buildProject({
      sequence: copter,
      fields,
      values: declare(),
      parameters: {},
      additions
    })
    const telemetry = project.files.find((file) => file.filename === '08_telemetry.param')
    expect(telemetry?.text).toMatch(/SERIAL1_BAUD,115/)
    expect(telemetry?.text).toMatch(/my ESP32 link/)

    // No OTHER step holds it. complete.param and the summaries legitimately
    // do — aggregating every step is what they are for.
    const otherSteps = project.files.filter(
      (file) =>
        /^\d+_/.test(file.filename) &&
        file.filename !== '08_telemetry.param' &&
        /SERIAL1_BAUD/.test(file.text)
    )
    expect(otherSteps.map((file) => file.filename)).toEqual([])
    expect(project.files.find((file) => file.filename === 'complete.param')?.text).toMatch(
      /SERIAL1_BAUD/
    )
  })

  it('comes back when the directory is read, against the same step', () => {
    const project = buildProject({
      sequence: copter,
      fields,
      values: declare(),
      parameters: {},
      additions
    })
    const read = readProject(copter, project.files, fields)

    const telemetry = read.steps.find((step) => step.filename === '08_telemetry.param')
    const entry = telemetry?.entries.get('SERIAL1_BAUD')
    expect(entry?.value).toBe(115)
    expect(entry?.comment).toBe('my ESP32 link')
    // Marked, which is what makes it recoverable at all.
    expect(entry?.manualOverride).toBe(true)
  })

  it('is not reported as a file or value the directory could not place', () => {
    const project = buildProject({
      sequence: copter,
      fields,
      values: declare(),
      parameters: {},
      additions
    })
    expect(readProject(copter, project.files, fields).unmatched).toEqual([])
  })
})
