import { describe, expect, it } from 'vitest'

import { fieldsFor, loadSequence } from './amc-guided'
import { buildProject, projectArchive, projectFilename, readProject } from './amc-project'

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
