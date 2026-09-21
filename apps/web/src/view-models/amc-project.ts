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
  type Migration,
  type MigrationTables,
  type ProjectFile,
  type VehicleProject,
  annotateParamFile,
  backupFiles,
  buildZip,
  migrateProject,
  completeFile,
  defaultsFile,
  lastWrittenFile,
  summaryFiles,
  hasTuningHistory,
  tuningReport,
  fitTemperatureCalibration,
  importComponentsFromParameters,
  imuSamplesFromLog,
  plotTemperatureFit,
  readVehicleProject,
  unaccountedParameters,
  vehicleContext,
  vehicleFiles
} from '@arduconfig/amc-steps'
import type { AnnotationDocs, ConfigurationSummary, ParameterRename, UpgradeTables } from '@arduconfig/amc-steps'
import {
  mavlinkProtocolNumbers,
  streamRateRenames,
  upgradeParameters,
  upgradeStreamRates,
  upgradesBetween
} from '@arduconfig/amc-steps'
import connectionTablesJson from '@amc/data/connection-tables.json'
import vehicleTemplatesJson from '@amc/data/vehicle-templates.json'

// Extracted from AMC's own source by scripts/extract-connection-tables.py, so
// the mapping from parameter values to hardware follows upstream rather than
// being restated here.
const connectionTables = connectionTablesJson as unknown as ConnectionTables
// The same file carries ArduPilot's parameter renames between versions.
const upgradeTables = connectionTablesJson as unknown as UpgradeTables
// The 25 vehicles AMC ships a declaration for, as starting points.
const templateDocuments = vehicleTemplatesJson as unknown as Readonly<Record<string, unknown>>
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

export interface VehicleTemplate {
  /** `ArduCopter/Holybro_X500` */
  readonly id: string
  /** The sequence it belongs to, so the list can be narrowed to one vehicle. */
  readonly kind: string
  /** `Holybro X500` */
  readonly label: string
  /** How many of THIS form's fields it answers. */
  readonly answers: number
}

/**
 * The vehicles AMC already describes, as starting points.
 *
 * A quadcopter much like a Holybro X500 is most of the declaration form
 * already answered, by someone who owned that aircraft. The operator still
 * corrects it — a template is a starting point, not a claim about their
 * vehicle — but starting from "nearly right" beats starting from empty.
 */
export function vehicleTemplates(
  fields: readonly ComponentField[],
  kind?: string
): readonly VehicleTemplate[] {
  const known = new Set(fields.map((field) => field.key))
  const templates: VehicleTemplate[] = []

  for (const [id, components] of Object.entries(templateDocuments)) {
    const [templateKind = '', name = ''] = id.split('/')
    if (kind !== undefined && templateKind !== kind) continue
    const values = valuesFromComponents({ Components: components }, fields)
    templates.push({
      id,
      kind: templateKind,
      // `Holybro_X500_V2` reads as `Holybro X500 V2`.
      label: name.replace(/_/g, ' '),
      answers: Object.keys(values).filter((key) => known.has(key)).length
    })
  }

  // Most complete first: a template that answers two fields is a worse
  // starting point than one that answers twenty, and the list should say so
  // by its order rather than making the operator open each one.
  return templates.sort((a, b) => b.answers - a.answers || a.label.localeCompare(b.label))
}

/** A template's declaration, in the form's own keys. */
export function templateValues(
  id: string,
  fields: readonly ComponentField[]
): Readonly<Record<string, string>> {
  const components = templateDocuments[id]
  if (!components) return {}
  return valuesFromComponents({ Components: components }, fields)
}

/**
 * A template's whole declaration, including everything the form never asks
 * about — so a directory written from it is a complete vehicle project.
 */
export function templateComponents(id: string): Readonly<Record<string, unknown>> | undefined {
  return templateDocuments[id] as Readonly<Record<string, unknown>> | undefined
}

export interface TempcalOutcome {
  /** The parameters to stage, across every IMU that could be fitted. */
  readonly parameters: Readonly<Record<string, number>>
  readonly fitted: readonly { readonly imu: number; readonly span: number; readonly samples: number }[]
  readonly rejected: readonly { readonly imu: number; readonly reason: string }[]
  /**
   * The fit, drawn.
   *
   * A cubic through a narrow or noisy sweep produces confident-looking
   * coefficients, and the cheap way to tell a good calibration from a bad one
   * is to look at it. AMC writes PNGs beside the results for the same reason.
   */
  readonly plots: readonly { readonly label: string; readonly filename: string; readonly svg: string }[]
}

/**
 * Fit the IMU temperature calibration from a log the operator has loaded.
 *
 * Three of the sequence's steps are about this, and the middle one produced
 * nothing usable here until now: cool the controller, fly it warm, then write
 * the coefficients ArduPilot applies at runtime.
 */
export function fitTempcalFromLog(
  messagesByType: ReadonlyMap<string, readonly ({ readonly name: string } & Record<string, unknown>)[]>
): TempcalOutcome {
  const { calibrations, rejected } = fitTemperatureCalibration(
    imuSamplesFromLog(messagesByType as never)
  )
  const parameters: Record<string, number> = {}
  for (const calibration of calibrations) Object.assign(parameters, calibration.parameters)

  // One plot per IMU, gyro X: enough to see whether the sweep was wide enough
  // and the curve follows its samples, without eighteen charts for a
  // three-IMU vehicle.
  const samples = imuSamplesFromLog(messagesByType as never)
  const plots = calibrations.flatMap((calibration) => {
    const imu = samples.find((entry) => entry.imu === calibration.imu)
    if (!imu) return []
    const n = calibration.imu + 1
    // Back out of the stored scaling, and into highest-order-first, which is
    // the order the plot evaluates.
    const coefficients = [3, 2, 1].map(
      (order) => (calibration.parameters[`INS_TCAL${n}_GYR${order}_X`] ?? 0) / 1e6
    )
    const svg = plotTemperatureFit(imu.gyro, 'x', [...coefficients, 0], {
      label: `IMU ${n} gyro X drift over ${calibration.temperatureSpan.toFixed(0)} °C`
    })
    // Named the way AMC names its own, numbered per IMU so three sensors do
    // not overwrite each other.
    return svg ? [{ label: `IMU ${n}`, filename: `tempcal_gyro_imu${n}.svg`, svg }] : []
  })

  return {
    parameters,
    fitted: calibrations.map((c) => ({ imu: c.imu, span: c.temperatureSpan, samples: c.samples })),
    rejected,
    plots
  }
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
  /**
   * The declaration the operator started from — a template, or a directory
   * they opened.
   *
   * Carried through so the written directory keeps the fields this form never
   * asks about: a motor's manufacturer, the operator's notes. Without it the
   * result holds only what the sequence reads, which is not a vehicle project
   * AMC could open.
   */
  readonly baseComponents?: Readonly<Record<string, unknown>>
  /** The step the operator last wrote, so the directory records the place. */
  readonly lastWritten?: string
  /**
   * What the vehicle holds, categorised — the summary the tab already shows.
   *
   * Passed in rather than recomputed: the categories need the parameter
   * documentation and the firmware defaults, which the caller already has.
   */
  readonly summary?: ConfigurationSummary
  /** The temperature fit drawn, when a log produced one. */
  readonly tempcalPlots?: readonly { readonly filename: string; readonly svg: string }[]
  /**
   * Parameter documentation to write above each value.
   *
   * Off unless asked for: it roughly triples the size of every file, which is
   * worth it for a directory someone will read and not for one they will
   * only feed back in.
   */
  readonly annotate?: AnnotationDocs
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
  const {
    sequence,
    fields,
    values,
    parameters,
    defaults,
    docs,
    overrides,
    baseComponents,
    lastWritten,
    annotate,
    summary,
    tempcalPlots
  } = inputs
  const componentsJson = buildComponentsJson(fields, values, baseComponents)
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

  // Every value the sequence decided, in one file. It answers what the
  // per-step files cannot: what does the method say this vehicle should be,
  // all told?
  const complete = completeFile(steps)
  if (complete.count > 0) files.push({ filename: complete.filename, text: complete.text })

  // Where the operator got to, so the next session resumes rather than
  // starting over. AMC reads the same file.
  if (lastWritten) {
    const marker = lastWrittenFile(lastWritten)
    files.push({ filename: marker.filename, text: marker.text })
  }

  // What the VEHICLE now holds, split by who decided it. complete.param says
  // what the method decided; these say what is actually on the aircraft, and
  // the split is what lets someone reuse a configuration without carrying
  // another airframe's calibration or identity with it.
  if (summary) {
    for (const file of summaryFiles(summary)) {
      files.push({ filename: file.filename, text: file.text })
    }
  }

  // How the tuning moved across the session. Only when there is a history to
  // report: a grid of 26 blank rows says nothing, and a file that says
  // nothing is worse than one that is absent.
  if (hasTuningHistory(steps, defaults)) {
    const report = tuningReport(steps, defaults)
    files.push({ filename: report.filename, text: report.text })
  }

  // The temperature fit, drawn. AMC writes PNGs; these are SVG for the same
  // reason the tab renders them — a few kilobytes, sharp at any size, and
  // readable without anything else installed.
  for (const plot of tempcalPlots ?? []) {
    files.push({ filename: plot.filename, text: plot.svg })
  }

  // What is on the aircraft that the sequence did NOT decide. An operator
  // finishing the sequence is left asking "is that everything?", and without
  // this the directory quietly implies that it is.
  if (Object.keys(parameters).length > 0) {
    const unaccounted = unaccountedParameters(steps, parameters, {
      ...(defaults ? { defaults } : {})
    })
    // Only when there is something to say: an empty file would assert that
    // the sequence accounts for the whole vehicle, which is a stronger claim
    // than its absence makes.
    if (unaccounted.count > 0) {
      files.push({ filename: unaccounted.filename, text: unaccounted.text })
    }
  }

  // What the aircraft held before any of this touched it.
  //
  // Not a step and never read back. It exists for the moment a configuration
  // turns out wrong and the tuning that actually flew is two weeks of edits
  // ago — which is exactly when it can no longer be regenerated. AMC takes
  // the first one only into a directory the method has not been run in, so
  // reopening a project cannot overwrite the original vehicle with a record
  // of what this tool has already made of it.
  for (const backup of backupFiles(parameters, {
    existing: files.map((file) => file.filename),
    ...(lastWritten === undefined ? {} : { alreadyStarted: true })
  })) {
    files.push({ filename: backup.filename, text: backup.text })
  }

  // Written so the directory explains itself: a file opened months later, by
  // someone who did not configure the vehicle, should not need ArduPilot's
  // wiki in another window. Annotation is a comment block, so the result
  // still parses as an ordinary .param file and still reads back.
  const written = annotate
    ? files.map((file) =>
        file.filename.endsWith('.param')
          ? { ...file, text: annotateParamFile(file.text, annotate) }
          : file
      )
    : files

  return {
    files: written,
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
  /**
   * Parameters renamed because the vehicle's firmware is newer than the
   * directory's. Empty unless a version boundary was actually crossed.
   */
  readonly renamedParameters?: readonly ParameterRename[]
  /**
   * Where to pick the sequence up.
   *
   * AMC's method runs over days — cool the controller overnight, fly it, come
   * back for the notch filters — so a directory records the step last
   * written, and reopening starts after it rather than at the beginning.
   */
  /**
   * What had to change before the directory could be read at all.
   *
   * Set only when the directory declared an older format version. Reported
   * rather than done quietly: the operator opened a directory and it changed
   * shape, and they are owed an account of which of their values moved where.
   */
  readonly migration?: Migration
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
  fields: readonly ComponentField[],
  options: { readonly vehicleFirmwareVersion?: string; readonly migrations?: MigrationTables } = {}
): ProjectImport {
  // A directory an older AMC wrote is brought up to the current layout first,
  // because everything below reads it against the CURRENT sequence: a
  // parameter still sitting in its v0 file would be attributed to whichever
  // step owns that name now, and a file the sequence has retired would be
  // reported to the operator as work left unread.
  const migration = options.migrations ? migrateProject(files, options.migrations) : undefined
  const project = readVehicleProject(sequence, migration ? migration.files : files)
  const withMigration = <T extends VehicleProject>(result: T): T =>
    migration ? { ...result, migration } : result
  if (project.components === undefined) return withMigration(project)

  let parsed: unknown
  try {
    parsed = JSON.parse(project.components)
  } catch {
    // A components file we cannot parse is reported by its absence from the
    // result rather than by throwing: the parameter files still read, and a
    // directory that is partly readable is more useful than an error.
    return withMigration(project)
  }

  const componentValues = valuesFromComponents(parsed, fields)
  // readVehicleProject works this out now, resolved through the renames so a
  // directory written by an older AMC resumes where it left off.
  const { resume } = project

  // A directory written against an older firmware names parameters the
  // vehicle no longer has: ANGLE_MAX became ATC_ANGLE_MAX, and in degrees
  // rather than centidegrees. Left alone, reading it back drops those values
  // silently — the file says one thing, the vehicle has another, and nothing
  // reports the gap. The directory's own declared firmware version is what
  // says where it started.
  const fileVersion = componentValues[FIRMWARE_VERSION_KEY] ?? ''
  const crossed = upgradesBetween(fileVersion, options.vehicleFirmwareVersion ?? '')
  if (crossed.length === 0) return withMigration({ ...project, componentValues, resume })

  // Stream rates are renamed by POSITION — SR2_ becomes MAV1_ when serial 2
  // is the first MAVLink port — so the mapping needs the whole directory's
  // serial configuration, not the file in hand.
  const serialConfig: Record<string, number> = {}
  for (const step of project.steps) {
    for (const [name, entry] of step.entries) {
      if (/^SERIAL\d+_PROTOCOL$/.test(name)) serialConfig[name] = entry.value
    }
  }
  const streamRates = crossed.includes(4.6)
    ? streamRateRenames(serialConfig, mavlinkProtocolNumbers(connectionTables.SERIAL_PROTOCOLS_DICT))
    : new Map<string, string>()

  const renames: ParameterRename[] = []
  const steps = project.steps.map((step) => {
    const upgraded = upgradeParameters(
      step.entries,
      upgradeTables,
      crossed,
      (entry) => entry.value,
      (entry, value) => ({ ...entry, value })
    )
    renames.push(...upgraded.renamed)
    const streamed = upgradeStreamRates(upgraded.parameters, streamRates)
    renames.push(...streamed.renamed)
    return { ...step, entries: streamed.parameters }
  })

  return withMigration({ ...project, componentValues, resume, steps, renamedParameters: renames })
}

/** Where the operator declares the firmware a directory was written for. */
const FIRMWARE_VERSION_KEY = 'Flight Controller/Firmware/Version'

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
