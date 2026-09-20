/**
 * The two ends of a vehicle configuration project: writing one out, reading
 * one back.
 *
 * This is what makes the method worth following rather than a nicer way to
 * click through a checklist. AMC's output is a directory an operator keeps —
 * one file per step, each value carrying the reason it was set — and a
 * configuration that cannot be reopened a year later is one that has to be
 * redone from memory.
 *
 * Kept out of the component for the usual reason: everything here is a pure
 * function of the sequence and the declared vehicle, and the only part that
 * needs a browser is the two lines that hand bytes to the user.
 */

import {
  type ConnectionTables,
  type FirmwareKind,
  type ProjectFile,
  type VehicleProject,
  buildZip,
  defaultsFile,
  importComponentsFromParameters,
  readVehicleProject,
  vehicleContext,
  vehicleFiles
} from '@arduconfig/amc-steps'
import connectionTablesJson from '@amc/data/connection-tables.json'

// Extracted from AMC's own source by scripts/extract-connection-tables.py, so
// the mapping from parameter values to hardware follows upstream rather than
// being restated here.
const connectionTables = connectionTablesJson as unknown as ConnectionTables
import type { ParameterDocs } from '@arduconfig/amc-steps'

import type { AmcSequence, ComponentField } from './amc-guided'
import { buildComponentsJson } from './amc-guided'

export interface ImportFromVehicleInputs {
  readonly fields: readonly ComponentField[]
  /** What the operator has already declared, by field key. */
  readonly values: Readonly<Record<string, string>>
  readonly parameters: Readonly<Record<string, number>>
  readonly kind: FirmwareKind
  /** `MOT_PWM_TYPE`'s documented values, preferred over the built-in table. */
  readonly pwmTypeValues?: Readonly<Record<string, string>>
}

export interface ImportFromVehicle {
  /** Fields to fill in, by field key — only ones the form actually has. */
  readonly values: Readonly<Record<string, string>>
  /** Which of those would change an answer the operator already gave. */
  readonly overwrites: readonly string[]
  /** What the vehicle's parameters could not settle, in the operator's words. */
  readonly undetermined: readonly string[]
  /** Derived fields the form has no home for, so nothing is silently dropped. */
  readonly unmapped: readonly string[]
}

/**
 * Read the declaration off the vehicle instead of asking for it.
 *
 * A configured flight controller has already answered most of the form:
 * SERIAL3_PROTOCOL says a GPS is on serial 3, BATT_MONITOR says how the
 * battery is measured, MOT_BAT_VOLT_MAX over a per-cell voltage gives the cell
 * count. On AMC's own templates this fills in around 21 of the 24 fields.
 *
 * Returned rather than applied, and separated into what is new and what would
 * overwrite: a parameter says how a vehicle is CONFIGURED, which is not the
 * same as how it is wired, and the operator is the one who can see the
 * difference.
 */
export function importFromVehicle(inputs: ImportFromVehicleInputs): ImportFromVehicle {
  const { fields, values, parameters, kind, pwmTypeValues } = inputs
  // The form is keyed by slash-joined path, and so is the import's idea of
  // "what is already declared".
  const current: Record<string, string> = {}
  for (const field of fields) {
    const value = values[field.key]?.trim()
    if (value) current[field.key] = value
  }

  const { derived, undetermined } = importComponentsFromParameters(parameters, connectionTables, kind, {
    current,
    ...(pwmTypeValues ? { pwmTypeValues } : {})
  })

  const known = new Set(fields.map((field) => field.key))
  const next: Record<string, string> = {}
  const overwrites: string[] = []
  const unmapped: string[] = []

  for (const entry of derived) {
    const key = entry.path.join('/')
    // A field this sequence never reads has nowhere to go. Reported rather
    // than dropped: it usually means the sequence and the import disagree
    // about what a component is called.
    if (!known.has(key)) {
      unmapped.push(key)
      continue
    }
    const existing = current[key]
    if (existing === entry.value) continue
    if (existing !== undefined) overwrites.push(key)
    next[key] = entry.value
  }

  return { values: next, overwrites, undetermined, unmapped }
}

export interface ProjectExportInputs {
  readonly sequence: AmcSequence
  readonly fields: readonly ComponentField[]
  readonly values: Readonly<Record<string, string>>
  readonly parameters: Readonly<Record<string, number>>
  readonly defaults?: ReadonlyMap<string, number>
  readonly docs?: ParameterDocs
  /** Decisions read back from a previous project, so a rewrite keeps them. */
  readonly overrides?: ReadonlyMap<string, { value: number; reason?: string }>
}

export interface ProjectExport {
  readonly files: readonly ProjectFile[]
  /** Steps whose directives could not all be evaluated. */
  readonly incomplete: readonly string[]
  readonly parameterCount: number
}

/**
 * Assemble the directory.
 *
 * `vehicle_components.json` is written alongside the parameter files because
 * it is the input the whole directory was derived from — without it the files
 * are a list of values with no account of why any of them are what they are,
 * and re-deriving them is impossible.
 */
export function buildProject(inputs: ProjectExportInputs): ProjectExport {
  const { sequence, fields, values, parameters, defaults, docs, overrides } = inputs
  const componentsJson = buildComponentsJson(fields, values)
  const context = vehicleContext(componentsJson, parameters)

  const steps = vehicleFiles(sequence, context, {
    ...(docs ? { docs } : {}),
    ...(defaults ? { defaults } : {}),
    parameters,
    ...(overrides ? { overrides } : {})
  })

  const files: ProjectFile[] = [{ filename: 'vehicle_components.json', text: componentsJson }]
  // Only when we actually have them: an empty 00_default.param would assert
  // that the firmware's defaults are known to be nothing, which is worse than
  // the file being absent.
  if (defaults && defaults.size > 0) {
    const file = defaultsFile(defaults)
    files.push({ filename: file.filename, text: file.text })
  }
  for (const step of steps) {
    files.push({ filename: step.filename, text: step.text })
  }

  return {
    files,
    incomplete: steps.filter((s) => s.incomplete > 0).map((s) => s.filename),
    parameterCount: steps.reduce((total, s) => total + s.count, 0)
  }
}

/** The directory as a single archive, named after the vehicle. */
export function projectArchive(project: ProjectExport): Uint8Array {
  return buildZip(project.files.map(({ filename, text }) => ({ filename, text })))
}

/**
 * A filename for the download.
 *
 * Anything the operator typed can appear here, so it is reduced to characters
 * that are safe on every platform rather than trusted.
 */
export function projectFilename(vehicleName: string | undefined): string {
  const cleaned = (vehicleName ?? '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  return `${cleaned.length > 0 ? cleaned : 'vehicle'}.zip`
}

export interface ProjectImport extends VehicleProject {
  /** Declared components, when the directory carried them. */
  readonly componentValues?: Readonly<Record<string, string>>
}

/**
 * Read a directory the operator picked.
 *
 * Returns what was understood AND what was not: a file no step claims means
 * the operator's work is sitting there unread, which the screen has to be able
 * to say rather than quietly dropping it.
 */
export function readProject(
  sequence: AmcSequence,
  files: readonly ProjectFile[],
  fields: readonly ComponentField[]
): ProjectImport {
  const project = readVehicleProject(sequence, files)
  if (project.components === undefined) return project

  let parsed: unknown
  try {
    parsed = JSON.parse(project.components)
  } catch {
    // A components file we cannot parse is reported by its absence from the
    // result rather than by throwing: the parameter files still read, and a
    // directory that is partly readable is more useful than an error.
    return project
  }

  return { ...project, componentValues: valuesFromComponents(parsed, fields) }
}

/**
 * Flatten the declared components back into the form the field list uses.
 *
 * Driven by the FIELDS rather than by walking the JSON: the form only has
 * somewhere to put a value the sequence actually reads, so anything else in
 * the file is carried by `components` and left alone.
 */
function valuesFromComponents(
  parsed: unknown,
  fields: readonly ComponentField[]
): Record<string, string> {
  const components = (parsed as { Components?: unknown } | null)?.Components
  const values: Record<string, string> = {}
  if (typeof components !== 'object' || components === null) return values

  for (const field of fields) {
    let node: unknown = components
    for (const key of field.path) {
      if (typeof node !== 'object' || node === null) {
        node = undefined
        break
      }
      node = (node as Record<string, unknown>)[key]
    }
    if (node === undefined || node === null || typeof node === 'object') continue
    values[field.key] = String(node)
  }
  return values
}
