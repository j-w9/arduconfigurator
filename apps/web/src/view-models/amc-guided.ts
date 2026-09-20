// AMC guided mode — the derivation behind the experimental tab.
//
// ArduPilot Methodic Configurator's configuration sequence, evaluated in the
// browser. The sequence itself is AMC's data, vendored in the arduconfig-amc
// fork; @arduconfig/amc-expr evaluates its expressions and @arduconfig/amc-steps
// walks the steps. Nothing here talks to a flight controller: it computes what
// the sequence *would* set, so it can be read before anything is written.
//
// Pure, per the view-model pattern — no React, no runtime, no transport.

import { deriveParameterDraftEntries } from '@arduconfig/ardupilot-core'
import type { ParameterState } from '@arduconfig/ardupilot-core'

import observedComponentValues from '@amc/data/component-values.json'

import {
  type ComponentRequirement,
  type Diagnosis,
  type ParameterDocs,
  type StepOutcome,
  applyStep,
  componentOptionSources,
  describePath,
  diagnose,
  optionsForField,
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

/** Every value AMC's own vehicle templates use for a field, by path. */
const OBSERVED: Readonly<Record<string, readonly string[]>> = observedComponentValues

/** A field whose every observed value is a number is a number field. */
function looksNumeric(values: readonly string[] | undefined): boolean {
  return values !== undefined && values.length > 0 && values.every((value) => value.trim() !== '' && !Number.isNaN(Number(value)))
}

/**
 * A field whose observed values are version numbers is not an enumeration.
 *
 * The firmware version is the clearest case: the templates happen to contain
 * fifteen of them ('4.6.0 dev', '4.7.1 beta'), but the next release is not in
 * that list and the sequence compares versions with `Version(x) > Version(y)`,
 * so any version has to be typeable. Offering a list of the versions other
 * people's vehicles ran would put most operators on the "Other" escape.
 */
function looksVersioned(values: readonly string[] | undefined): boolean {
  if (values === undefined || values.length === 0) return false
  const versions = values.filter((value) => /^\s*v?\d+\.\d+/.test(value)).length
  return versions > values.length / 2
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
  /**
   * The values this field accepts, when it is an enumeration.
   *
   * Both render as a dropdown. They differ in authority, which the UI says out
   * loud: `documented` comes from ArduPilot's parameter documentation and is
   * the whole set, so nothing outside it is valid. `suggested` is every value
   * AMC's own vehicle templates use, for the fields whose lists AMC keeps in
   * code rather than in the documentation -- evidence of real values, but not
   * proof of the whole set, so those keep an escape to type something else.
   */
  readonly documented?: readonly string[]
  readonly suggested?: readonly string[]
  /** Every value ever seen for it is a number. */
  readonly numeric: boolean
}

function toField(requirement: ComponentRequirement, documented?: readonly string[]): ComponentField {
  const path = requirement.path
  const key = path.join('/')
  const observed = OBSERVED[key]
  // A measurement is not an enumeration, whatever values happen to have been
  // observed: a propeller diameter or a cell voltage is a number the operator
  // reads off their hardware, and a list of the sizes other people's vehicles
  // used would be a worse way to enter it.
  const numeric = documented === undefined && looksNumeric(observed)
  const freeform = numeric || looksVersioned(observed)
  return {
    key,
    path,
    component: path[0] as string,
    group: path.length > 2 ? (path[1] as string) : '',
    label: path[path.length - 1] as string,
    uses: requirement.uses,
    numeric,
    ...(documented === undefined ? {} : { documented }),
    ...(documented !== undefined || freeform || observed === undefined ? {} : { suggested: observed })
  }
}

/**
 * The fields this sequence reads, derived from the step files themselves.
 *
 * This is why the form is not a guess: add a step upstream that reads a new
 * component field and it appears here, because the requirement is read off the
 * parsed expressions rather than maintained by hand.
 */
export function fieldsFor(sequence: AmcSequence, docs?: ParameterDocs): ComponentField[] {
  const steps = sequence.map((entry) => entry.step)
  // Which parameter each field supplies is stated by the step files, so the
  // dropdowns follow upstream rather than a list kept here.
  const sources = docs ? componentOptionSources(steps) : undefined
  return requiredComponents(steps).map((requirement) =>
    toField(requirement, docs && sources ? optionsForField(requirement.path, sources, docs) : undefined)
  )
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

/**
 * Why the draft bar would refuse a value.
 *
 * Several of the sequence's values sit outside what ArduPilot's *documented*
 * range allows while being exactly what the firmware expects -- most often a
 * 0 that means "disabled" on a parameter whose range starts at 5. Left to the
 * draft bar alone that arrives as an unexplained "N invalid" after staging, so
 * the same rules are run here and the reason is shown next to the value that
 * causes it, before anything is staged.
 */
export interface Disputed {
  readonly reason: string
  /** Whether the app's "Override and write anyway" can carry it through. */
  readonly overridable: boolean
}

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
  /** Set when the draft validation would reject this value, with its reason. */
  readonly disputed?: Disputed
}

/**
 * A directive that could not be computed, said in the operator's terms.
 *
 * The evaluator's own message is kept for the detail line, but what the step
 * leads with is the thing to go and do about it.
 */
export interface BlockedRow {
  /**
   * Every parameter blocked by this one cause.
   *
   * Grouped because a single undeclared field commonly blocks a whole run of
   * parameters -- one missing ESC protocol blocks SERIAL1 through SERIAL9 --
   * and nine identical lines say no more than one line and a list does.
   */
  readonly parameters: readonly string[]
  readonly summary: string
  readonly kind: Diagnosis['kind']
  /** Form fields to fill in, as keys into the declaration form. */
  readonly declare: readonly { readonly key: string; readonly label: string }[]
  /** The evaluator's own words, for when the summary is not enough. */
  readonly detail: string
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
  readonly blocked: readonly BlockedRow[]
  /** Changes whose value the vehicle does not already have. */
  readonly pending: number
}

export interface SequenceSummary {
  readonly rows: readonly StepRow[]
  readonly phases: readonly string[]
  /** Distinct parameters whose value differs from the vehicle's. */
  readonly missing: readonly ComponentField[]
  /** Fields that would unblock the most directives, most first. */
  readonly nextFields: readonly { readonly field: ComponentField; readonly unblocks: number }[]
  readonly totalChanges: number
  readonly totalPending: number
  readonly totalFailures: number
  /**
   * Distinct parameters the draft bar would refuse.
   *
   * Distinct, like `totalPending`, because staging produces one draft per
   * parameter however many steps set it.
   */
  readonly totalDisputed: number
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

/**
 * Ask the app's own draft validation what it makes of the sequence's values.
 *
 * Deliberately the real `deriveParameterDraftEntries` rather than a
 * reimplementation of min/max/enum/bitmask here: this screen's whole job is to
 * predict what the draft bar will say, and a second copy of the rules would
 * eventually disagree with the first.
 */
function disputesFor(
  proposals: readonly { parameter: string; value: number }[],
  states: readonly ParameterState[]
): Map<string, Disputed> {
  const disputes = new Map<string, Disputed>()
  // Nothing is known about the vehicle, so there is nothing to predict; the
  // tab is showing the sequence rather than a plan for a particular aircraft.
  if (states.length === 0) return disputes

  const drafts: Record<string, string> = {}
  for (const proposal of proposals) drafts[proposal.parameter] = String(proposal.value)

  // The vehicle's own parameter list, with the app's own definitions. Passing
  // these rather than a reconstruction is what makes the prediction exact:
  // the draft bar is about to run this same function over this same input.
  for (const entry of deriveParameterDraftEntries([...states], drafts)) {
    if (entry.status !== 'invalid') continue
    disputes.set(entry.id, {
      reason: entry.reason ?? 'The draft bar would refuse this value.',
      overridable: entry.overridable === true
    })
  }
  return disputes
}

export interface RunInputs {
  readonly sequence: AmcSequence
  readonly fields: readonly ComponentField[]
  readonly values: Readonly<Record<string, string>>
  /** The vehicle's current parameters, when connected. */
  readonly parameters: Readonly<Record<string, number>>
  /**
   * The vehicle's parameters as the app holds them, definitions included.
   *
   * Used to predict exactly what the draft bar will accept, by running the
   * app's own validation over the app's own data rather than a reconstruction
   * of either.
   */
  readonly states?: readonly ParameterState[]
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
  const { sequence, fields, values, parameters, states, docs } = inputs
  const componentsJson = buildComponentsJson(fields, values)
  const context = vehicleContext(componentsJson, parameters)

  const declared: unknown = JSON.parse(componentsJson).Components
  const rows: StepRow[] = []
  const proposals: { parameter: string; value: number }[] = []
  const phases: string[] = []
  const unblockCounts = new Map<string, number>()
  let totalChanges = 0
  let totalFailures = 0
  // Counted as distinct parameters, not as rows. One parameter is commonly set
  // by several steps, and what gets staged -- and what the draft bar then
  // reports -- is one draft per parameter, so counting rows here would promise
  // a number the draft bar never shows.
  const pendingParameters = new Set<string>()
  const disputedParameters = new Set<string>()

  // Two passes: everything the sequence proposes is judged in one call, so the
  // validation sees the whole set rather than one step at a time.
  const outcomes = sequence.map((entry) => {
    const outcome = applyStep(entry.step, context, docs ? { docs } : {})
    for (const change of outcome.changes) proposals.push({ parameter: change.parameter, value: change.value })
    return { entry, outcome }
  })
  const disputes = disputesFor(proposals, states ?? [])

  for (const { entry, outcome } of outcomes) {
    const changes = outcome.changes.map((change): ChangeRow => {
      const current = parameters[change.parameter]
      const satisfied = current !== undefined && sameValue(current, change.value)
      const disputed = satisfied ? undefined : disputes.get(change.parameter)
      return {
        parameter: change.parameter,
        value: change.value,
        group: change.group,
        satisfied,
        ...(current === undefined ? {} : { current }),
        ...(change.reason === undefined ? {} : { reason: change.reason }),
        ...(disputed === undefined ? {} : { disputed })
      }
    })
    const causes = new Map<string, { diagnosis: Diagnosis; declare: BlockedRow['declare']; parameters: string[]; detail: string }>()
    for (const failure of outcome.failures) {
      const diagnosis = diagnose(failure, declared)
      const declare = diagnosis.declare.map((path) => ({ key: path.join('/'), label: describePath(path) }))
      for (const entry of declare) {
        unblockCounts.set(entry.key, (unblockCounts.get(entry.key) ?? 0) + 1)
      }
      // Same kind, same fields to fill in, same parameters absent: one cause.
      const key = [diagnosis.kind, declare.map((entry) => entry.key).join('+'), diagnosis.parameters.join('+')].join('|')
      const existing = causes.get(key)
      if (!existing) {
        causes.set(key, { diagnosis, declare, parameters: [failure.parameter], detail: failure.error })
      } else if (!existing.parameters.includes(failure.parameter)) {
        // The same parameter can be blocked twice in one step -- named in two
        // directive groups -- and is still one thing to fix.
        existing.parameters.push(failure.parameter)
      }
    }

    const blocked = [...causes.values()].map(({ diagnosis, declare, parameters: blockedParams, detail }): BlockedRow => ({
      parameters: blockedParams,
      kind: diagnosis.kind,
      declare,
      detail,
      // A single parameter keeps the diagnosis's own sentence, which names it;
      // a group says the cause once and lets the list carry the parameters.
      summary:
        blockedParams.length === 1
          ? diagnosis.summary
          : declare.length > 0
            ? `Declare ${declare.map((entry) => entry.label).join(' and ')} to set ${blockedParams.length} parameters.`
            : diagnosis.summary.replace(`${blockedParams[0] as string} `, `${blockedParams.length} parameters `)
    }))
    for (const change of changes) {
      if (change.satisfied) continue
      pendingParameters.add(change.parameter)
      if (change.disputed) disputedParameters.add(change.parameter)
    }
    const pending = changes.filter((change) => !change.satisfied).length
    totalChanges += changes.length
    // Counted in parameters, not causes, so it pairs with "Parameters set" in
    // the summary; the per-step list still groups causes.
    totalFailures += blocked.reduce((total, entry) => total + entry.parameters.length, 0)
    if (entry.phase && !phases.includes(entry.phase)) phases.push(entry.phase)

    rows.push({
      filename: entry.filename,
      index: entry.index,
      title: titleOf(entry.filename),
      changes,
      deletions: outcome.deletions,
      skipped: outcome.skipped,
      blocked,
      pending,
      ...(entry.phase === undefined ? {} : { phase: entry.phase }),
      ...(entry.step.why === undefined ? {} : { why: entry.step.why }),
      ...(entry.step.wiki_url === undefined ? {} : { wikiUrl: entry.step.wiki_url })
    })
  }

  const missing = missingComponents(declared, requiredComponents(sequence.map((entry) => entry.step))).map((requirement) =>
    toField(requirement)
  )

  // What to fill in next: the field standing between this vehicle and the most
  // blocked directives.
  const byKey = new Map(missing.map((field) => [field.key, field]))
  const nextFields = [...unblockCounts]
    .map(([key, unblocks]) => ({ field: byKey.get(key), unblocks }))
    .filter((entry): entry is { field: ComponentField; unblocks: number } => entry.field !== undefined)
    .sort((left, right) => right.unblocks - left.unblocks)

  return {
    rows,
    phases,
    missing,
    nextFields,
    totalChanges,
    totalPending: pendingParameters.size,
    totalFailures,
    totalDisputed: disputedParameters.size
  }
}

/**
 * Turn the sequence's proposals into parameter drafts.
 *
 * The app's draft model is `parameter id -> the string an operator would have
 * typed`, so the sequence's numbers are rendered the same way. Deduplicated on
 * the way in: one parameter can be proposed by more than one step, and the last
 * step in the sequence is the one that decides, as it would be if the steps
 * were walked in order.
 */
export function draftsFrom(changes: readonly { parameter: string; value: number }[]): Record<string, string> {
  const drafts: Record<string, string> = {}
  for (const change of changes) drafts[change.parameter] = String(change.value)
  return drafts
}
