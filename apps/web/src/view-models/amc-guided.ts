// AMC guided mode — the derivation behind the experimental tab.
//
// ArduPilot Methodic Configurator's configuration sequence, evaluated in the
// browser. The sequence itself is AMC's data, vendored in the arduconfig-amc
// fork; @arduconfig/amc-expr evaluates its expressions and @arduconfig/amc-steps
// walks the steps. Nothing here talks to a flight controller: it computes what
// the sequence *would* set, so it can be read before anything is written.
//
// Pure, per the view-model pattern — no React, no runtime, no transport.

import {
  type ComponentRequirement,
  type ParameterDocs,
  type StepOutcome,
  applyStep,
  missingComponents,
  orderSteps,
  parseStepFile,
  requiredComponents,
  vehicleContext
} from '@arduconfig/amc-steps'

/** The four sequences AMC ships. Sub is not among them. */
export type AmcVehicleKind = 'ArduCopter' | 'ArduPlane' | 'Rover' | 'Heli'

export const AMC_VEHICLE_KINDS: readonly AmcVehicleKind[] = ['ArduCopter', 'ArduPlane', 'Rover', 'Heli']

/**
 * The Heli sequence configures a helicopter frame running Copter firmware, so
 * its parameter documentation is Copter's.
 */
export function metadataVehicleFor(kind: AmcVehicleKind): string {
  switch (kind) {
    case 'ArduPlane':
      return 'ArduPlane'
    case 'Rover':
      return 'ArduRover'
    default:
      return 'ArduCopter'
  }
}

/** Map the connected vehicle's firmware name onto a sequence, when there is one. */
export function sequenceForFirmware(vehicle: string | undefined): AmcVehicleKind | undefined {
  switch (vehicle) {
    case 'ArduCopter':
      return 'ArduCopter'
    case 'ArduPlane':
      return 'ArduPlane'
    case 'ArduRover':
      return 'Rover'
    default:
      // ArduSub and anything unrecognised have no AMC sequence.
      return undefined
  }
}

/** A loaded sequence: AMC's steps for one vehicle, in order. */
export type AmcSequence = ReturnType<typeof orderSteps>

const sequences = new Map<AmcVehicleKind, AmcSequence>()

/**
 * Load one vehicle's sequence.
 *
 * The four step files are ~470 KB together, for a tab most operators never
 * open, so each is a dynamic import and lands in its own chunk -- the same
 * treatment the upstream parameter metadata gets. Cached after the first load.
 */
export async function loadSequence(kind: AmcVehicleKind): Promise<AmcSequence> {
  const cached = sequences.get(kind)
  if (cached) return cached
  const source: unknown = await (kind === 'ArduCopter'
    ? import('@amc/data/configuration_steps_ArduCopter.json')
    : kind === 'ArduPlane'
      ? import('@amc/data/configuration_steps_ArduPlane.json')
      : kind === 'Rover'
        ? import('@amc/data/configuration_steps_Rover.json')
        : import('@amc/data/configuration_steps_Heli.json'))
  const ordered = orderSteps(parseStepFile(JSON.stringify((source as { default: unknown }).default)))
  sequences.set(kind, ordered)
  return ordered
}

/** One field the operator has to declare, ready to render as a form row. */
export interface ComponentField {
  /** Stable key for form state: the path, slash-joined. */
  readonly key: string
  readonly path: readonly string[]
  /** The component it belongs to, e.g. `Battery`. */
  readonly component: string
  /** The field's own name, e.g. `Number of cells`. */
  readonly label: string
  /** Which section of the component, e.g. `Specifications`. */
  readonly group: string
  /** How many expressions read it — how much of the sequence it unlocks. */
  readonly uses: number
}

function toField(requirement: ComponentRequirement): ComponentField {
  const path = requirement.path
  return {
    key: path.join('/'),
    path,
    component: path[0] as string,
    group: path.length > 2 ? (path[1] as string) : '',
    label: path[path.length - 1] as string,
    uses: requirement.uses
  }
}

/**
 * The fields this sequence reads, derived from the step files themselves.
 *
 * This is why the form is not a guess: add a step upstream that reads a new
 * component field and it appears here, because the requirement is read off the
 * parsed expressions rather than maintained by hand.
 */
export function fieldsFor(sequence: AmcSequence): ComponentField[] {
  return requiredComponents(sequence.map((entry) => entry.step)).map(toField)
}

/**
 * Assemble the declared values into a vehicle_components document.
 *
 * Built as *text* rather than an object on purpose: whether a number was
 * written `4` or `4.0` changes what the sequence computes, and going through a
 * JavaScript object would erase that distinction. So each field's raw input is
 * emitted as the operator typed it.
 */
export function buildComponentsJson(fields: readonly ComponentField[], values: Readonly<Record<string, string>>): string {
  type Node = { children: Map<string, Node>; literal?: string }
  const root: Node = { children: new Map() }

  for (const field of fields) {
    const raw = values[field.key]?.trim()
    if (raw === undefined || raw === '') continue
    let node = root
    for (const segment of field.path) {
      let next = node.children.get(segment)
      if (!next) {
        next = { children: new Map() }
        node.children.set(segment, next)
      }
      node = next
    }
    // A bare number is emitted unquoted and *exactly as typed*, so `4.0` stays
    // a float; anything else is a JSON string.
    node.literal = NUMERIC.test(raw) ? raw : JSON.stringify(raw)
  }

  const render = (node: Node): string => {
    if (node.literal !== undefined) return node.literal
    const entries = [...node.children].map(([key, child]) => `${JSON.stringify(key)}:${render(child)}`)
    return `{${entries.join(',')}}`
  }

  return `{"Components":${render(root)}}`
}

/** A JSON number literal, which is what keeps `4.0` distinct from `4`. */
const NUMERIC = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/

/** A parameter the sequence would set, next to what the vehicle has now. */
export interface ChangeRow {
  readonly parameter: string
  readonly value: number
  readonly group: StepOutcome['changes'][number]['group']
  readonly reason?: string
  /** The vehicle's current value, when connected and known. */
  readonly current?: number
  /** True when the vehicle's value already matches. */
  readonly satisfied: boolean
}

export interface StepRow {
  readonly filename: string
  readonly index: number
  readonly phase?: string
  /** `05_board_orientation.param` reads as "Board orientation". */
  readonly title: string
  readonly why?: string
  readonly wikiUrl?: string
  readonly changes: readonly ChangeRow[]
  readonly deletions: readonly string[]
  readonly skipped: StepOutcome['skipped']
  readonly failures: StepOutcome['failures']
  /** Changes whose value the vehicle does not already have. */
  readonly pending: number
}

export interface SequenceSummary {
  readonly rows: readonly StepRow[]
  readonly phases: readonly string[]
  /** Fields the operator has not declared yet. */
  readonly missing: readonly ComponentField[]
  readonly totalChanges: number
  readonly totalPending: number
  readonly totalFailures: number
}

/** `13_initial_atc.param` -> `Initial ATC`. */
function titleOf(filename: string): string {
  const stem = filename.replace(/\.param$/, '').replace(/^\d+_/, '').replace(/_/g, ' ')
  return stem.charAt(0).toUpperCase() + stem.slice(1)
}

/** Parameters are floats, so compare with tolerance rather than for equality. */
function sameValue(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(1e-6, Math.abs(right) * 1e-6)
}

export interface RunInputs {
  readonly sequence: AmcSequence
  readonly fields: readonly ComponentField[]
  readonly values: Readonly<Record<string, string>>
  /** The vehicle's current parameters, when connected. */
  readonly parameters: Readonly<Record<string, number>>
  readonly docs?: ParameterDocs
}

/**
 * Evaluate the whole sequence for the declared vehicle.
 *
 * Steps that cannot be computed are kept in the list with their failures
 * attached rather than dropped, because "this step needs something you have
 * not told me" is the most useful thing the screen can say.
 */
export function runSequence(inputs: RunInputs): SequenceSummary {
  const { sequence, fields, values, parameters, docs } = inputs
  const componentsJson = buildComponentsJson(fields, values)
  const context = vehicleContext(componentsJson, parameters)
  const declared: unknown = JSON.parse(componentsJson).Components

  const rows: StepRow[] = []
  const phases: string[] = []
  let totalChanges = 0
  let totalPending = 0
  let totalFailures = 0

  for (const entry of sequence) {
    const outcome = applyStep(entry.step, context, docs ? { docs } : {})
    const changes = outcome.changes.map((change): ChangeRow => {
      const current = parameters[change.parameter]
      const satisfied = current !== undefined && sameValue(current, change.value)
      const base = { parameter: change.parameter, value: change.value, group: change.group, satisfied }
      return current === undefined
        ? change.reason === undefined
          ? base
          : { ...base, reason: change.reason }
        : change.reason === undefined
          ? { ...base, current }
          : { ...base, current, reason: change.reason }
    })
    const pending = changes.filter((change) => !change.satisfied).length
    totalChanges += changes.length
    totalPending += pending
    totalFailures += outcome.failures.length
    if (entry.phase && !phases.includes(entry.phase)) phases.push(entry.phase)

    rows.push({
      filename: entry.filename,
      index: entry.index,
      title: titleOf(entry.filename),
      changes,
      deletions: outcome.deletions,
      skipped: outcome.skipped,
      failures: outcome.failures,
      pending,
      ...(entry.phase === undefined ? {} : { phase: entry.phase }),
      ...(entry.step.why === undefined ? {} : { why: entry.step.why }),
      ...(entry.step.wiki_url === undefined ? {} : { wikiUrl: entry.step.wiki_url })
    })
  }

  const missing = missingComponents(declared, requiredComponents(sequence.map((entry) => entry.step))).map(toField)

  return { rows, phases, missing, totalChanges, totalPending, totalFailures }
}
