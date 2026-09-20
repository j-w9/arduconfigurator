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
  type ProjectFile,
  type VehicleProject,
  buildZip,
  defaultsFile,
  readVehicleProject,
  vehicleContext,
  vehicleFiles
} from '@arduconfig/amc-steps'
import type { ParameterDocs } from '@arduconfig/amc-steps'

import type { AmcSequence, ComponentField } from './amc-guided'
import { buildComponentsJson } from './amc-guided'

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
