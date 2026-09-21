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

import type { ConfigurationStepFile, ConfigurationSummary } from '@arduconfig/amc-steps'
import {
  type ComponentRequirement,
  type Diagnosis,
  type ParameterDocs,
  type StepOutcome,
  checkStepLogMessages,
  runThreaded,
  autoImportableParameters,
  componentOptionSources,
  milestonePhases,
  orderedPhases,
  summarize,
  describePath,
  diagnose,
  optionsForField,
  missingComponents,
  orderSteps,
  parseStepFile,
  requiredComponents,
  vehicleContext
} from '@arduconfig/amc-steps'

/**
 * Where this app keeps the tools AMC embeds in its steps.
 *
 * Deliberately a map rather than a guess from the name: `battery_monitor` and
 * `ahrs_orientation` are Config categories here, while the motor tools have
 * their own tab, and Power stopped being a tab of its own some time ago.
 */
export type AppToolView = 'config' | 'motors' | 'calibration' | 'flash'

const STEP_TOOLS: Readonly<Record<string, { label: string; view: AppToolView }>> = {
  ahrs_orientation: { label: 'Board orientation', view: 'config' },
  battery_monitor: { label: 'Battery monitor', view: 'config' },
  esc_rpm_scale: { label: 'ESC telemetry', view: 'motors' },
  motor_test: { label: 'Motor test', view: 'motors' }
}

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

/** The steps, and the file they came from -- which is where the phases live. */
export interface LoadedSequence {
  readonly steps: AmcSequence
  readonly file: ConfigurationStepFile
}

const sequences = new Map<AmcVehicleKind, LoadedSequence>()

/**
 * Load one vehicle's sequence.
 *
 * The four step files are ~470 KB together, for a tab most operators never
 * open, so each is a dynamic import and lands in its own chunk -- the same
 * treatment the upstream parameter metadata gets. Cached after the first load.
 */
export async function loadSequence(kind: AmcVehicleKind): Promise<LoadedSequence> {
  const cached = sequences.get(kind)
  if (cached) return cached
  const source: unknown = await (kind === 'ArduCopter'
    ? import('@amc/data/configuration_steps_ArduCopter.json')
    : kind === 'ArduPlane'
      ? import('@amc/data/configuration_steps_ArduPlane.json')
      : kind === 'Rover'
        ? import('@amc/data/configuration_steps_Rover.json')
        : import('@amc/data/configuration_steps_Heli.json'))
  const file = parseStepFile(JSON.stringify((source as { default: unknown }).default))
  const loaded: LoadedSequence = { steps: orderSteps(file), file }
  sequences.set(kind, loaded)
  return loaded
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
  const fields = requiredComponents(steps).map((requirement) =>
    toField(requirement, docs && sources ? optionsForField(requirement.path, sources, docs) : undefined)
  )

  // The one field the sequence does not read but the form still needs.
  //
  // No expression names the chemistry -- the steps read the five cell voltages
  // directly. But the voltages are only judged as sensible against a
  // chemistry: 2.5 V is a flat Li-ion cell and a destroyed LiPo one. Without
  // this the checks fall back on AMC's default of LiPo and would reject a
  // perfectly good Li-ion pack, so it is asked rather than assumed.
  if (fields.some((field) => field.key.startsWith('Battery/Specifications/Volt per cell'))) {
    const chemistry = OBSERVED['Battery/Specifications/Chemistry']
    fields.push({
      key: 'Battery/Specifications/Chemistry',
      path: ['Battery', 'Specifications', 'Chemistry'],
      component: 'Battery',
      group: 'Specifications',
      label: 'Chemistry',
      uses: 0,
      numeric: false,
      ...(chemistry === undefined ? {} : { suggested: chemistry })
    })
  }

  return fields
}

/**
 * Assemble the declared values into a vehicle_components document.
 *
 * Built as *text* rather than an object on purpose: whether a number was
 * written `4` or `4.0` changes what the sequence computes, and going through a
 * JavaScript object would erase that distinction. So each field's raw input is
 * emitted as the operator typed it.
 */
export function buildComponentsJson(
  fields: readonly ComponentField[],
  values: Readonly<Record<string, string>>,
  base?: Readonly<Record<string, unknown>>
): string {
  type Node = { children: Map<string, Node>; literal?: string }
  const root: Node = { children: new Map() }

  // Everything the vehicle already carried that this form never asks about:
  // a motor's manufacturer, a receiver's URL, the operator's notes. The form
  // is built from what the SEQUENCE reads, so without this a directory
  // written here would drop every other field — and the result is not a
  // vehicle project AMC could open, only the parts of one we happened to use.
  //
  // Rendered through JSON.stringify rather than the literal path below: no
  // expression reads these, so the `4` versus `4.0` distinction that matters
  // for declared values cannot matter for them.
  if (base) seed(root, base)

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

  // "Format version" is REQUIRED by AMC's schema, and its absence is the
  // difference between a directory AMC can open and one it refuses.
  return `{"Format version":${COMPONENTS_FORMAT_VERSION},"Components":${render(root)}}`

  function seed(node: Node, value: Readonly<Record<string, unknown>>): void {
    for (const [key, child] of Object.entries(value)) {
      if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
        let next = node.children.get(key)
        if (!next) {
          next = { children: new Map() }
          node.children.set(key, next)
        }
        seed(next, child as Readonly<Record<string, unknown>>)
        continue
      }
      node.children.set(key, { children: new Map(), literal: JSON.stringify(child) })
    }
  }
}

/** The schema version AMC's templates carry, and validate against. */
const COMPONENTS_FORMAT_VERSION = 1

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
  /**
   * Steps whose values this one reads, when any of them set it first.
   *
   * The sequence is run in order and each step sees what the ones before it
   * did, so a value here can disagree with what the vehicle currently reports.
   * That disagreement is correct and needs saying, or it reads as a bug.
   */
  readonly inheritedFrom?: readonly string[]
  /**
   * Parameters this step sets that only take effect after a reboot.
   *
   * This is what makes AMC's method step-by-step rather than a single bulk
   * write: a later step reading one of these would read the OLD value until
   * the vehicle has restarted, so the step has to be written and the vehicle
   * rebooted before the rest of the sequence means anything.
   */
  readonly rebootParameters?: readonly string[]
  /** `05_board_orientation.param` reads as "Board orientation". */
  readonly title: string
  /** Why the step exists. */
  readonly why?: string
  /** Why it is done here rather than earlier or later. */
  readonly whyNow?: string
  /** How much of it is required, in the sequence's own words. */
  readonly mandatory?: string
  /** The component it configures, when it names one. */
  readonly component?: string
  /**
   * Something outside this app has to happen first.
   *
   * A precondition, not a note: "first flight in ALT_HOLD for 30 seconds" or
   * "do this in Mission Planner" means the step cannot be finished here yet.
   */
  readonly autoChangedBy?: string
  /** An instruction to read before starting, with its severity. */
  readonly popup?: { readonly type: string; readonly msg: string }
  /**
   * Further reading the sequence points at.
   *
   * `label` is short enough to read as a link; the sequence's own text is
   * sometimes a title and sometimes a whole sentence, so the long ones become
   * the `title` and the link falls back to naming its kind.
   */
  readonly links: readonly {
    readonly label: string
    readonly title?: string
    readonly url: string
    readonly kind: 'wiki' | 'blog' | 'tool'
  }[]
  /** Steps that may be skipped to from here, and what skipping costs. */
  readonly jumps: readonly { readonly to: string; readonly filename: string; readonly cost: string }[]
  /** Log messages this step's configuration should produce. */
  readonly logMessages: readonly {
    readonly id: string
    readonly name: string
    readonly required: boolean
    /**
     * How many of these the loaded flight log holds; undefined when no log has
     * been loaded, which is a different statement from zero.
     */
    readonly count?: number
  }[]
  /**
   * Whether the loaded log contains every message this step depends on.
   *
   * Undefined when no log is loaded. Only about REQUIRED messages: an optional
   * one missing is a log that could tell you more, not a step that failed.
   */
  readonly logSatisfied?: boolean
  /**
   * A file the step needs on the flight controller.
   *
   * `name` is what it must be called, which is not always the last segment of
   * the URL, and `destination` is where it goes. The fetch and the upload are
   * separate acts here: the applet can be downloaded and read before anything
   * is put on an aircraft.
   */
  readonly file?: { readonly url: string; readonly name: string; readonly destination: string }
  /**
   * A tool the sequence places beside the step, and where this app keeps it.
   *
   * AMC embeds these; here they already exist as their own surfaces, so the
   * step points at the one that does the work rather than reimplementing it.
   */
  readonly tool?: { readonly name: string; readonly label: string; readonly view: AppToolView }
  /**
   * Values already on the vehicle that this step is responsible for.
   *
   * Not something the step sets -- something it takes account of. A completed
   * calibration, or anything another tool changed, belongs in the record of
   * the step that owns those parameters.
   */
  readonly captured: readonly { readonly parameter: string; readonly value: number }[]
  /** The step declares patterns but the vehicle's defaults have not been read. */
  readonly capturePending: boolean
  readonly wikiUrl?: string
  readonly changes: readonly ChangeRow[]
  readonly deletions: readonly string[]
  readonly skipped: StepOutcome['skipped']
  readonly blocked: readonly BlockedRow[]
  /** Changes whose value the vehicle does not already have. */
  readonly pending: number
}

/** A phase of the sequence, with the steps that fall under it. */
export interface PhaseGroup {
  readonly name: string
  readonly description?: string
  /** Declared optional by the sequence: tuning not every vehicle needs. */
  readonly optional: boolean
  readonly rows: readonly StepRow[]
}

export interface SequenceSummary {
  readonly rows: readonly StepRow[]
  /**
   * What this vehicle has that the firmware did not give it.
   *
   * Undefined until the firmware's defaults are known, because every category
   * in it is a statement about differing from a default.
   */
  readonly configuration?: ConfigurationSummary
  /** Values on the vehicle that the sequence's steps claim. */
  readonly totalCaptured: number
  /** Steps that would capture, once the vehicle's defaults have been read. */
  readonly captureBlocked: number
  /** The steps grouped under their phase, in order. */
  readonly groups: readonly PhaseGroup[]
  /**
   * Phases that mark something to do between steps rather than a run of them --
   * assembling the frame, flying it for the first time.
   */
  readonly milestones: readonly { readonly name: string; readonly description?: string }[]
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

/**
 * The sequence leaves fields present but empty rather than omitting them, so
 * "has a value" is the test, not "is defined".
 */
function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** `13_initial_atc.param` -> `Initial ATC`. */
/** `05_board_orientation.param` reads as "Board orientation". */
export function titleOf(filename: string): string {
  const stem = filename.replace(/\.param$/, '').replace(/^\d+_/, '').replace(/_/g, ' ')
  return stem.charAt(0).toUpperCase() + stem.slice(1)
}

/** Parameters are floats, so compare with tolerance rather than for equality. */
/** Two parameter values that a flight controller would not tell apart. */
export function sameValue(left: number, right: number): boolean {
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
  /** The step file the sequence came from, for its phases. */
  readonly file?: ConfigurationStepFile
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
  /**
   * The firmware's own default per parameter, from
   * `@PARAM/param.pck?withdefaults=1`. Without it nothing can be captured,
   * because "differs from default" is the whole test.
   */
  readonly defaults?: ReadonlyMap<string, number>
  readonly docs?: ParameterDocs
  /**
   * Message counts from a flight log, when one has been loaded.
   *
   * Several steps configure something whose only proof is in the log — ESC
   * telemetry either arrives or it does not — and the sequence names the
   * messages each one depends on.
   */
  readonly logCounts?: ReadonlyMap<string, number>
}

/**
 * Evaluate the whole sequence for the declared vehicle.
 *
 * Steps that cannot be computed are kept in the list with their failures
 * attached rather than dropped, because "this step needs something you have
 * not told me" is the most useful thing the screen can say.
 */
export function runSequence(inputs: RunInputs): SequenceSummary {
  const { sequence, file, fields, values, parameters, states, defaults, docs, logCounts } = inputs
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

  // The sequence is run AS a sequence: each step sees the vehicle as the steps
  // before it left it, not as it is now. The distinction is not theoretical --
  // step 13 sets INS_GYRO_FILTER and MOT_THST_HOVER, and the notch-filter and
  // throttle-controller steps read them, so evaluating those against the live
  // vehicle answers a question nobody asked.
  const threaded = runThreaded(sequence, context, parameters, docs ? { docs } : {})
  const inheritedBy = new Map(threaded.steps.map((step) => [step.filename, step.inheritedFrom]))
  const orderDependent = new Set(threaded.orderDependent)

  // Two passes: everything the sequence proposes is judged in one call, so the
  // validation sees the whole set rather than one step at a time.
  const outcomes = threaded.steps.map((step, index) => {
    const entry = sequence[index] as AmcSequence[number]
    for (const change of step.outcome.changes) {
      proposals.push({ parameter: change.parameter, value: change.value })
    }
    return { entry, outcome: step.outcome }
  })
  const disputes = disputesFor(proposals, states ?? [])
  // Which parameters the firmware only reads at boot. Taken from the app's own
  // parameter metadata rather than restated here, so it follows ArduPilot.
  const rebootRequired = new Set(
    (states ?? []).filter((state) => state.definition?.rebootRequired).map((state) => state.id)
  )

  for (const { entry, outcome } of outcomes) {
    const logCheck = logCounts ? checkStepLogMessages(entry.step, logCounts) : undefined
    const rebootParameters = outcome.changes
      .filter((change) => rebootRequired.has(change.parameter))
      .map((change) => change.parameter)
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

    const step = entry.step
    // Everything the sequence says about the step, in one shape the view can
    // render without knowing AMC's field names.
    const link = (
      kind: 'wiki' | 'blog' | 'tool',
      fallback: string,
      text: string | undefined,
      url: string | undefined
    ): StepRow['links'][number][] => {
      if (!nonEmpty(url)) return []
      // A label long enough to be a sentence is a description, not a link.
      const short = nonEmpty(text) && text.length <= 48
      return [
        {
          kind,
          url,
          label: short ? text : fallback,
          ...(nonEmpty(text) && !short ? { title: text } : {})
        }
      ]
    }
    const links: StepRow['links'] = [
      ...link('wiki', 'ArduPilot wiki', step.wiki_text, step.wiki_url),
      ...link('blog', 'Tuning guide', step.blog_text, step.blog_url),
      ...link('tool', 'External tool', step.external_tool_text, step.external_tool_url)
    ]

    const capturedNames = autoImportableParameters(step, parameters, defaults)
    const declaresCapture = (step.autoimport_nondefault_regexp ?? []).length > 0

    rows.push({
      captured: capturedNames.map((parameter) => ({ parameter, value: parameters[parameter] as number })),
      // A step that wants to capture but cannot say so, rather than looking
      // like a step that found nothing.
      capturePending: declaresCapture && (defaults === undefined || defaults.size === 0),
      filename: entry.filename,
      index: entry.index,
      ...(rebootParameters.length > 0 ? { rebootParameters } : {}),
      // Only worth saying when the ordering actually changed this step's
      // answer: a step that reads an earlier value which happens to match the
      // live one has nothing to explain.
      ...(orderDependent.has(entry.filename) && (inheritedBy.get(entry.filename)?.length ?? 0) > 0
        ? { inheritedFrom: inheritedBy.get(entry.filename) }
        : {}),
      title: titleOf(entry.filename),
      changes,
      deletions: outcome.deletions,
      skipped: outcome.skipped,
      blocked,
      pending,
      links,
      jumps: Object.entries(step.jump_possible ?? {}).map(([to, cost]) => ({
        to: titleOf(to),
        filename: to,
        cost
      })),
      // With a log loaded these carry their counts and the step says whether
      // its evidence is complete; without one they are just the list the
      // sequence names, and a count of zero would be a claim we cannot make.
      logMessages: logCheck
        ? logCheck.messages.map((message) => ({
            id: message.id,
            name: message.name,
            required: message.required,
            count: message.count
          }))
        : Object.entries(step.related_bin_messages ?? {}).map(([id, message]) => ({
            id,
            name: message.name,
            required: message.required
          })),
      ...(logCheck ? { logSatisfied: logCheck.satisfied } : {}),
      ...(entry.phase === undefined ? {} : { phase: entry.phase }),
      ...(nonEmpty(step.why) ? { why: step.why } : {}),
      ...(nonEmpty(step.why_now) ? { whyNow: step.why_now } : {}),
      ...(nonEmpty(step.mandatory_text) ? { mandatory: step.mandatory_text } : {}),
      ...(nonEmpty(step.component) ? { component: step.component } : {}),
      ...(nonEmpty(step.auto_changed_by) ? { autoChangedBy: step.auto_changed_by } : {}),
      ...(step.instructions_popup ? { popup: step.instructions_popup } : {}),
      ...(step.plugin && STEP_TOOLS[step.plugin.name]
        ? {
            tool: {
              name: step.plugin.name,
              label: (STEP_TOOLS[step.plugin.name] as { label: string }).label,
              view: (STEP_TOOLS[step.plugin.name] as { view: AppToolView }).view
            }
          }
        : {}),
      ...(step.download_file && step.upload_file
        ? {
            file: {
              url: step.download_file.source_url,
              name: step.upload_file.source_local,
              destination: step.upload_file.dest_on_fc
            }
          }
        : {}),
      ...(step.wiki_url === undefined ? {} : { wikiUrl: step.wiki_url })
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

  // Grouped for rendering. Steps before the first phase -- and any sequence
  // that declares none -- fall into a single unnamed group rather than being
  // dropped, so the list is always the whole sequence.
  const spanning = file ? orderedPhases(file) : []
  const groups: PhaseGroup[] = []
  for (const row of rows) {
    const name = row.phase ?? ''
    const last = groups[groups.length - 1]
    if (last && last.name === name) {
      ;(last.rows as StepRow[]).push(row)
      continue
    }
    const declared = spanning.find((phase) => phase.name === name)
    groups.push({
      name,
      optional: declared?.optional === true,
      rows: [row],
      ...(declared?.description === undefined ? {} : { description: declared.description })
    })
  }

  const totalCaptured = rows.reduce((total, row) => total + row.captured.length, 0)
  const captureBlocked = rows.filter((row) => row.capturePending).length

  const configuration = defaults && defaults.size > 0 ? summarize(parameters, defaults, docs) : undefined

  return {
    rows,
    ...(configuration ? { configuration } : {}),
    totalCaptured,
    captureBlocked,
    groups,
    milestones: file ? milestonePhases(file) : [],
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
