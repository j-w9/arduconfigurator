import { describe, expect, it } from 'vitest'

import { fieldsFor, loadSequence } from './amc-guided'
import { buildProject, importFromVehicle, projectArchive, projectFilename, readProject } from './amc-project'

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
