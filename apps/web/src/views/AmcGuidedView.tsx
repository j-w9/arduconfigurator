import { useCallback, useEffect, useMemo, useState } from 'react'
import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import {
  AMC_VEHICLE_KINDS,
  type AppToolView,
  type AmcVehicleKind,
  type LoadedSequence,
  type ComponentField,
  type StepRow,
  fieldsFor,
  loadSequence,
  runSequence,
  sameValue,
  titleOf
} from '../view-models/amc-guided'
import {
  changesBootDelay,
  connectionGroupOf,
  escTelemetryMirror,
  nextRequiredStep,
  orderByPairing,
  protocolsForConnection,
  rebootWaitSeconds
} from '@arduconfig/amc-steps'
import type { ConnectionPairings, ConnectionTables, ParameterDocs } from '@arduconfig/amc-steps'
import connectionPairingsJson from '@amc/data/component-pairings.json'
import connectionTablesJson from '@amc/data/connection-tables.json'

// Observed from AMC's vehicle templates by scripts/sync-from-vendor.mjs. Small
// (a few hundred bytes) so it rides along rather than being fetched.
const connectionPairings = connectionPairingsJson as ConnectionPairings
// ArduPilot's own type-to-protocol rules, extracted from AMC's source.
const connectionTables = connectionTablesJson as unknown as ConnectionTables
import type { ParameterState } from '@arduconfig/ardupilot-core'

import {
  buildProject,
  fitTempcalFromLog,
  importFromVehicle,
  projectArchive,
  projectFilename,
  readProject,
  templateComponents,
  templateValues,
  vehicleTemplates
} from '../view-models/amc-project'
import type { TempcalOutcome } from '../view-models/amc-project'
import {
  UNATTACHED_KEY,
  clearAmcProgress,
  loadAmcProgress,
  saveAmcProgress
} from '../amc-progress-storage'

// AMC guided mode — the experimental tab.
//
// ArduPilot Methodic Configurator's configuration sequence, evaluated here and
// shown before anything is written. It sits beside the native Guided Setup tab
// rather than replacing it, so the two can be compared on the same vehicle.
//
// Presentational, per the "Adding a View" pattern: no runtime, transport or
// MAVLink imports. The declared-components form is local UI state, like the AI
// Assistant's composer draft — it describes the vehicle, not the app.
//
// Nothing here writes to the flight controller directly. Changes are *staged*
// into the app's existing parameter-draft model, so the sequence's proposals
// land in the same review-then-write flow as every other change in the app --
// the draft bar, the Show changes list, the min/max/enum validation, Write all
// and Discard. A step cannot push parameters on its own, and staging a step is
// undoable the same way any other staged edit is.

export interface AmcGuidedViewProps {
  connected: boolean
  /**
   * Stage changes into the app's parameter drafts. The existing draft bar
   * reviews and writes them; this view never writes.
   */
  onStage: (changes: readonly { parameter: string; value: number }[]) => void
  /** The currently staged drafts, so a step can show what it has contributed. */
  staged: Readonly<Record<string, string>>
  /** The connected vehicle's firmware, used to pick a sequence. */
  firmwareVehicle?: string
  /** Live parameter values, keyed by name. Empty when not connected. */
  parameters: Readonly<Record<string, number>>
  /** The same parameters as the app holds them, used to predict the draft bar. */
  states?: readonly ParameterState[]
  /** The firmware's own defaults, needed before a step can capture anything. */
  defaults?: ReadonlyMap<string, number>
  /**
   * Read the defaults from the vehicle.
   *
   * Resolves when the attempt is over, whether or not it produced anything --
   * the app's own fetch reports failures through the Parameters view's notice,
   * which is not this screen, so this tab judges the outcome by whether
   * defaults actually arrived.
   */
  onReadDefaults?: () => void | Promise<void>
  /**
   * Restart the vehicle. The sequence needs this between steps, not only at
   * the end: a step that sets a boot-time parameter has not taken effect until
   * the vehicle has restarted, and the steps after it read the old value.
   */
  onRequestReboot?: () => void
  /**
   * Reboot, wait out the boot delay, and reconnect — as one action.
   *
   * A step that sets a boot-time parameter is finished when the vehicle has
   * restarted and read it, not when the write is acknowledged. Leaving the
   * operator to do the waiting and the reconnecting turns the sequence into a
   * series of manual recoveries.
   */
  onRebootAndReconnect?: (waitSeconds: number) => Promise<void>
  /**
   * Fetch the newest dataflash log off the vehicle.
   *
   * The vehicle has the log. Sending the operator to another tab to download
   * it, then back here to load it, is three steps for something the sequence
   * already needs.
   */
  onDownloadLatestLog?: () => Promise<{ name: string; bytes: Uint8Array } | undefined>
  /**
   * Fetch a step's script and write it to the flight controller.
   *
   * Two steps need a Lua applet on the vehicle before they mean anything.
   * Both sources send `Access-Control-Allow-Origin: *`, so the browser can
   * fetch them directly and the operator does not have to round-trip through
   * a download and the Files tab.
   */
  onInstallFile?: (file: { url: string; name: string; destination: string }) => Promise<void>
  /**
   * Write one step's parameters to the vehicle now.
   *
   * The method is step-by-step, not one bulk write at the end: a step that
   * sets a boot-time parameter has not taken effect until the vehicle
   * restarts, and the steps after it read the old value. Goes through the
   * app's own verified write and read-back, so a step is only "done" once the
   * vehicle has confirmed it.
   */
  onWriteStep?: (changes: readonly { parameter: string; value: number }[], label: string) => void
  /** Open one of the app's own tools, for the steps that are done with one. */
  onOpenTool?: (view: AppToolView) => void
  /**
   * Where this vehicle's declaration is kept, from the board's identity.
   *
   * Passed in rather than derived here so the view keeps no opinion about what
   * counts as the same aircraft.
   */
  progressKey: string
  /** Suggested sequence for the connected firmware, when there is one. */
  suggestedKind?: AmcVehicleKind
  /**
   * The firmware version the vehicle reports, e.g. "4.5.3 (official)".
   *
   * The sequence asks for this, and the vehicle already knows it, so it is
   * filled in from the link rather than typed or picked off a list of the
   * versions other people's aircraft happened to run.
   */
  vehicleFirmwareVersion?: string
  /** ArduPilot parameter documentation, loaded lazily by App. */
  docs?: ParameterDocs
  docsVehicle?: string
  onDocsVehicleChange: (vehicle: string) => void
}

/** A stable DOM id per step, so a jump can bring its destination into view. */
function stepDomId(filename: string): string {
  return `amc-step-${filename.replace(/[^a-zA-Z0-9]+/g, '-')}`
}

/** A stable DOM id per declaration field, so a blocked step can focus one. */
function fieldInputId(key: string): string {
  return `amc-field-${key.replace(/[^a-zA-Z0-9]+/g, '-')}`
}

/**
 * The step whose whole job is to hold the calibration the flight produced.
 *
 * The sequence has three IMU temperature steps — set it up, fly the profile,
 * write the results — and this is the third.
 */
const TEMPCAL_RESULT_STEP = '03_imu_temperature_calibration_results.param'

/** The escape in a suggestions dropdown, for a value the templates never used. */
const OTHER = '\u0000other'

/**
 * One field: a dropdown where the field is an enumeration, an input where it is
 * a measurement.
 *
 * A suggested list is not known to be complete, so it keeps an "Other" escape
 * that turns the field back into a text box; a documented list is complete, so
 * it does not.
 */
/**
 * The value an ESC telemetry field is fixed to, when its control connection
 * carries the telemetry itself.
 *
 * Returns undefined for every other field, and for DShot — which CAN answer
 * back on the same wire but can equally use a dedicated serial port or
 * nothing, so there the question is real.
 */
function mirroredTelemetry(
  field: ComponentField,
  values: Readonly<Record<string, string>>,
  kind: AmcVehicleKind
): string | undefined {
  if (field.path[0] !== 'ESC' || field.path[1] !== 'ESC->FC Telemetry') return undefined
  const leaf = field.path[2]
  if (leaf !== 'Type' && leaf !== 'Protocol') return undefined

  const controlProtocol = values['ESC/FC->ESC Connection/Protocol']
  if (!controlProtocol) return undefined
  const mirror = escTelemetryMirror(connectionTables, kind, controlProtocol)
  if (leaf === 'Type' && !mirror.type) return undefined
  if (leaf === 'Protocol' && !mirror.protocol) return undefined
  return values[`ESC/FC->ESC Connection/${leaf}`]
}

function FieldControl({
  field,
  value,
  pairedType,
  mirroredFrom,
  onChange
}: {
  field: ComponentField
  value: string
  /** The Type declared on this field's connection, when it has one. */
  pairedType?: string
  /** Fixed to the control connection's value; see mirroredTelemetry. */
  mirroredFrom?: string
  onChange: (next: string) => void
}) {
  const documented = field.documented ?? field.suggested

  // The control connection carries this, so there is nothing to choose. Shown
  // rather than hidden: an operator should be able to see what their ESC
  // protocol implied, not wonder where the field went.
  if (mirroredFrom !== undefined && mirroredFrom !== '') {
    return (
      <span className="amc-guided__field-control amc-guided__field-mirrored">
        <input id={fieldInputId(field.key)} value={mirroredFrom} readOnly />
        <em>same as the control connection</em>
      </span>
    )
  }
  // A connection's Type and Protocol are not independent: a CAN link carries
  // DroneCAN, a serial one a serial protocol. The pairings are observed from
  // AMC's templates, so they are evidence rather than a specification — they
  // reorder the list and never shorten it, because twenty-nine vehicles cannot
  // prove that a protocol nobody used is invalid.
  const { ordered: choices, likely } = useMemo(() => {
    const ordered = orderByPairing(
      documented ?? [],
      connectionPairings,
      connectionGroupOf(field.path),
      pairedType
    )
    // Where ArduPilot's own tables settle it, the type does not merely reorder
    // the protocols — it decides them. A GNSS on CAN1 speaks DroneCAN and a
    // GNSS on SERIAL3 does not, and offering the whole list under every type
    // invites a declaration the sequence cannot resolve.
    const allowed =
      field.path.length === 3 && field.path[2] === 'Protocol' && pairedType
        ? protocolsForConnection(connectionTables, field.path[0] as string, pairedType)
        : undefined
    if (!allowed) return ordered
    return {
      ...ordered,
      // The operator's own answer is never made unselectable, even when the
      // rule disagrees with it: they can see the wiring and this cannot, and
      // a value that vanishes from the list is a value they cannot argue with.
      ordered: ordered.ordered.filter((option) => allowed.has(option) || option === value)
    }
  }, [documented, field.path, pairedType, value])
  // Once "Other" is chosen, or a stored value is off-list, the field stays a
  // text box rather than silently snapping to something it does not mean.
  const offList = value !== '' && documented !== undefined && !choices.includes(value)
  const [freeform, setFreeform] = useState(offList)

  if (!documented || (freeform && field.suggested)) {
    return (
      <span className="amc-guided__field-control">
        <input
          id={fieldInputId(field.key)}
          value={value}
          type={field.numeric ? 'number' : 'text'}
          inputMode={field.numeric ? 'decimal' : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {field.suggested ? (
          <button
            type="button"
            className="amc-guided__field-back"
            onClick={() => {
              setFreeform(false)
              onChange('')
            }}
          >
            Choose from list
          </button>
        ) : null}
      </span>
    )
  }

  return (
    <select
      id={fieldInputId(field.key)}
      value={offList ? OTHER : value}
      onChange={(event) => {
        if (event.target.value === OTHER) {
          setFreeform(true)
          onChange('')
          return
        }
        onChange(event.target.value)
      }}
    >
      <option value="">Not declared</option>
      {choices.map((option) => (
        <option key={option} value={option}>
          {/* Marked rather than hidden: the operator can see their own wiring
              and we cannot, so this is a hint about what is usual, not a rule
              about what is possible. */}
          {option}
          {likely.size > 0 && likely.has(option) ? ' — seen with this connection' : ''}
        </option>
      ))}
      {field.suggested ? <option value={OTHER}>Other…</option> : null}
    </select>
  )
}

interface FieldGroup {
  readonly component: string
  readonly fields: readonly ComponentField[]
  /**
   * Whether to show each field's group alongside its name.
   *
   * It is only worth the space when the component has more than one: the ESC
   * has a Protocol under both its telemetry and its control connection, so
   * there the group is the whole difference. Where every field sits under
   * "Specifications" it is the same word on every row and says nothing.
   */
  readonly showGroups: boolean
}

function groupFields(fields: readonly ComponentField[]): FieldGroup[] {
  const byComponent = new Map<string, ComponentField[]>()
  for (const field of fields) {
    const list = byComponent.get(field.component)
    if (list) list.push(field)
    else byComponent.set(field.component, [field])
  }
  return [...byComponent].map(([component, group]) => ({
    component,
    fields: group,
    showGroups: new Set(group.map((field) => field.group)).size > 1
  }))
}

function StepCard({
  row,
  connected,
  staged,
  reviewed,
  onDeclareField,
  onStage,
  onReviewed,
  onReadDefaults,
  onRequestReboot,
  onInstallFile,
  onRebootAndReconnect,
  bootDelay,
  onWriteStep,
  onStepWritten,
  tempcal,
  defaultsRead,
  onOpenTool,
  onJump
}: {
  row: StepRow
  connected: boolean
  staged: Readonly<Record<string, string>>
  reviewed: boolean
  onDeclareField: (key: string) => void
  onStage: (changes: readonly { parameter: string; value: number }[]) => void
  onReviewed: (next: boolean) => void
  onReadDefaults?: (() => void) | undefined
  onRequestReboot?: (() => void) | undefined
  onInstallFile?: ((file: { url: string; name: string; destination: string }) => Promise<void>) | undefined
  onRebootAndReconnect?: ((waitSeconds: number) => Promise<void>) | undefined
  bootDelay?: number | undefined
  onWriteStep?: ((changes: readonly { parameter: string; value: number }[], label: string) => void) | undefined
  onStepWritten?: ((filename: string) => void) | undefined
  tempcal?: TempcalOutcome | undefined
  defaultsRead?: 'idle' | 'asking' | 'nothing'
  onOpenTool?: ((view: AppToolView) => void) | undefined
  onJump?: ((filename: string) => void) | undefined
}) {
  const [open, setOpen] = useState(false)
  // Which destination is being written, and how the last write went. Kept per
  // step rather than globally: two steps each install a script, and a notice
  // from one has nothing to say about the other.
  const [installing, setInstalling] = useState<string | undefined>(undefined)
  const [installNotice, setInstallNotice] = useState<
    { destination: string; tone: 'ok' | 'warning'; text: string } | undefined
  >(undefined)
  const [rebooting, setRebooting] = useState(false)
  const [rebootCountdown, setRebootCountdown] = useState(0)

  const rebootAndWait = useCallback(
    async (changes: readonly { parameter: string; value: number }[]) => {
      if (!onRebootAndReconnect) return
      // The wait is the larger of what the vehicle has and what this step is
      // about to set: the step may be the very thing that lengthens it.
      const seconds = rebootWaitSeconds({
        ...(bootDelay !== undefined ? { current: bootDelay } : {}),
        ...(changesBootDelay(changes) !== undefined ? { staged: changesBootDelay(changes) } : {})
      })
      setRebooting(true)
      setRebootCountdown(seconds)
      // Counted down out loud, because a silent wait of several seconds looks
      // like nothing happening.
      const timer = window.setInterval(() => setRebootCountdown((left) => Math.max(0, left - 1)), 1000)
      try {
        await onRebootAndReconnect(seconds)
      } finally {
        window.clearInterval(timer)
        setRebooting(false)
      }
    },
    [onRebootAndReconnect, bootDelay]
  )

  // What the vehicle already holds for the parameters this step covers.
  // Only where the value actually differs from the sequence's — otherwise
  // "take from the vehicle" would offer to change nothing.
  const fromVehicle = useMemo(
    () =>
      row.changes
        .filter((change) => change.current !== undefined && !sameValue(change.current, change.value))
        .map((change) => ({ parameter: change.parameter, value: change.current as number })),
    [row.changes]
  )

  const installFile = useCallback(
    async (file: { url: string; name: string; destination: string }) => {
      if (!onInstallFile) return
      setInstalling(file.destination)
      setInstallNotice(undefined)
      try {
        await onInstallFile(file)
        setInstallNotice({
          destination: file.destination,
          tone: 'ok',
          // Scripts run from boot, so an upload nobody restarts does nothing.
          text: `Installed. Reboot the vehicle to start it.`
        })
      } catch (error) {
        setInstallNotice({
          destination: file.destination,
          tone: 'warning',
          text: error instanceof Error ? error.message : String(error)
        })
      } finally {
        setInstalling(undefined)
      }
    },
    [onInstallFile]
  )
  const blocked = row.blocked.length > 0
  // Staging a satisfied parameter would add a no-op draft to the review list,
  // so a step offers only what actually differs from the vehicle.
  const stageable = row.changes.filter((change) => !change.satisfied)
  const stagedHere = row.changes.filter((change) => staged[change.parameter] !== undefined)

  return (
    <article id={stepDomId(row.filename)} className={`amc-step${blocked ? ' amc-step--blocked' : ''}`}>
      <button className="amc-step__head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="amc-step__index">{row.index + 1}</span>
        <span className="amc-step__title">{row.title}</span>
        {row.autoChangedBy ? (
          <span className="amc-step__tag" title={row.autoChangedBy}>
            needs something done elsewhere
          </span>
        ) : null}
        {row.capturePending ? (
          <span className="amc-step__tag" title="Needs the vehicle's defaults before it can take account of your existing settings">
            needs defaults
          </span>
        ) : null}
        {row.tool ? (
          <span className="amc-step__tag" title={`This step is done with the ${row.tool.label} tool`}>
            {row.tool.label}
          </span>
        ) : null}
        {blocked ? (
          <StatusBadge tone="danger">{row.blocked.length} blocked</StatusBadge>
        ) : row.changes.length === 0 ? (
          reviewed ? (
            <StatusBadge tone="success">reviewed</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">nothing to set</StatusBadge>
          )
        ) : connected && row.pending === 0 ? (
          <StatusBadge tone="success">already set</StatusBadge>
        ) : (
          <StatusBadge tone={connected ? 'warning' : 'neutral'}>
            {connected ? `${row.pending} to change` : `${row.changes.length} parameters`}
          </StatusBadge>
        )}
      </button>

      {open ? (
        <div className="amc-step__body">
          {/* An instruction to read before starting, which is why it leads. */}
          {row.popup ? (
            <p className={`amc-step__popup amc-step__popup--${row.popup.type}`}>
              <strong>{row.popup.type === 'warning' ? 'Before you start' : 'Note'}</strong>
              {row.popup.msg}
            </p>
          ) : null}

          {/* A precondition outside this app: the step cannot finish until it
              has happened, so it reads as a blocker rather than a footnote. */}
          {row.autoChangedBy ? (
            <p className="amc-step__precondition">
              <strong>Done elsewhere:</strong> {row.autoChangedBy}
            </p>
          ) : null}

          {row.why ? <p className="amc-step__why">{row.why}</p> : null}
          {row.whyNow ? (
            <p className="amc-step__why-now">
              <strong>Why now:</strong> {row.whyNow}
            </p>
          ) : null}

          {row.mandatory || row.component ? (
            <p className="amc-step__facts">
              {row.mandatory ? <span>{row.mandatory}</span> : null}
              {row.component ? <span>configures {row.component}</span> : null}
            </p>
          ) : null}

          {row.blocked.length > 0 ? (
            <div className="amc-step__failures">
              <strong>Cannot be computed yet</strong>
              <ul>
                {row.blocked.map((entry) => (
                  <li key={entry.parameters.join(',')}>
                    {entry.summary}
                    {entry.declare.length > 0 ? (
                      <span className="amc-step__jump">
                        {entry.declare.map((target) => (
                          <button key={target.key} onClick={() => onDeclareField(target.key)}>
                            {target.label}
                          </button>
                        ))}
                      </span>
                    ) : null}
                    {entry.parameters.length > 1 ? (
                      <span className="amc-step__params">
                        {entry.parameters.map((name) => (
                          <code key={name}>{name}</code>
                        ))}
                      </span>
                    ) : null}
                    {/* The evaluator's own words, for when the summary is not enough. */}
                    <details>
                      <summary>details</summary>
                      <code>{entry.detail}</code>
                    </details>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {row.changes.length > 0 ? (
            <table className="amc-step__table">
              <thead>
                <tr>
                  <th>Parameter</th>
                  {connected ? <th>Now</th> : null}
                  <th>Sequence</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {row.changes.map((change) => (
                  <tr
                    key={change.parameter}
                    className={
                      change.satisfied ? 'is-satisfied' : staged[change.parameter] !== undefined ? 'is-staged' : undefined
                    }
                  >
                    <td>
                      <code>{change.parameter}</code>
                      {change.group === 'forced_parameters' ? (
                        <span className="amc-step__tag" title="Not adjustable — the sequence requires this value">
                          forced
                        </span>
                      ) : null}
                    </td>
                    {connected ? <td>{change.current === undefined ? '—' : change.current}</td> : null}
                    <td>
                      {change.value}
                      {staged[change.parameter] !== undefined ? <span className="amc-step__tag">staged</span> : null}
                      {change.disputed ? (
                        <span className="amc-step__disputed" title={change.disputed.reason}>
                          {change.disputed.overridable ? 'needs override' : 'refused'}
                        </span>
                      ) : null}
                    </td>
                    <td className="amc-step__reason">
                      {change.reason ?? ''}
                      {change.disputed ? (
                        <span className="amc-step__disputed-why">{change.disputed.reason}</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {stageable.length > 0 ? (
            <div className="amc-step__stage">
              <button
                style={buttonStyle()}
                disabled={!connected}
                title={
                  connected
                    ? 'Stage these into the parameter drafts for review'
                    : 'Connect a vehicle first — a draft for a parameter the vehicle has not reported cannot be written'
                }
                onClick={() => onStage(stageable.map((change) => ({ parameter: change.parameter, value: change.value })))}
              >
                Stage {stageable.length} change{stageable.length === 1 ? '' : 's'}
              </button>
              {onWriteStep ? (
                <button
                  style={buttonStyle('primary')}
                  disabled={!connected}
                  title={
                    connected
                      ? "Write just this step's parameters and let the vehicle confirm them"
                      : 'Connect a vehicle first'
                  }
                  onClick={() => {
                    onWriteStep(
                      stageable.map((change) => ({ parameter: change.parameter, value: change.value })),
                      row.title
                    )
                    // Recorded so the directory knows where the operator got
                    // to: AMC's method runs over days, and reopening at step
                    // one is a surprising answer.
                    onStepWritten?.(row.filename)
                  }}
                >
                  {/* The method is step-by-step: write this one, let the
                      vehicle confirm it, reboot if it needs to, then move on.
                      Goes through the app's own verified write, so the result
                      and any reboot prompt appear in the usual place. */}
                  Write this step
                </button>
              ) : null}
              {fromVehicle.length > 0 ? (
                <button
                  style={buttonStyle()}
                  disabled={!connected}
                  title="Record what the vehicle already has for this step, instead of what the sequence would set"
                  onClick={() => onStage(fromVehicle)}
                >
                  {/* Distinct from the automatic capture above it: that only
                      covers the parameters the step declares importable and
                      which differ from their default. This takes everything
                      the step touches, for an operator whose vehicle is
                      already configured and who wants the directory to record
                      what it HAS rather than what the sequence would impose. */}
                  Take {fromVehicle.length} from the vehicle
                </button>
              ) : null}
              {stagedHere.length > 0 ? (
                <StatusBadge tone="success">{stagedHere.length} staged</StatusBadge>
              ) : null}
              <span className="amc-step__stage-note">
                Reviewed and written from the draft bar.
              </span>
            </div>
          ) : null}

          {tempcal && row.filename === TEMPCAL_RESULT_STEP ? (
            <div className="amc-step__tempcal">
              {/* This step's whole job is to hold the calibration the flight
                  produced. Without a log it has nothing to say, and AMC runs
                  the same fit over the same .bin. */}
              {tempcal.fitted.length > 0 ? (
                <>
                  <p>
                    Fitted from your log: {tempcal.fitted.length} IMU
                    {tempcal.fitted.length === 1 ? '' : 's'} over{' '}
                    {tempcal.fitted.map((fit) => `${fit.span.toFixed(1)} °C`).join(', ')}.
                    {onStage ? (
                      <button
                        style={buttonStyle('primary')}
                        disabled={!connected}
                        onClick={() =>
                          onStage(
                            Object.entries(tempcal.parameters).map(([parameter, value]) => ({
                              parameter,
                              value
                            }))
                          )
                        }
                      >
                        Stage {Object.keys(tempcal.parameters).length} calibration values
                      </button>
                    ) : null}
                  </p>
                </>
              ) : null}
              {tempcal.plots.length > 0 ? (
                <div className="amc-step__tempcal-plots">
                  {/* Drawn because the numbers alone cannot say whether the
                      fit is any good: a curve that follows its samples is
                      trustworthy, one that swings away from them at the ends
                      is a polynomial doing what polynomials do. */}
                  {tempcal.plots.map((plot) => (
                    <figure key={plot.label} dangerouslySetInnerHTML={{ __html: plot.svg }} />
                  ))}
                </div>
              ) : null}
              {tempcal.rejected.length > 0 ? (
                <ul className="amc-step__tempcal-rejected">
                  {tempcal.rejected.map((rejection) => (
                    <li key={rejection.imu}>
                      {/* A confident calibration from a narrow temperature
                          range is worse than none: ArduPilot would apply a
                          curve fitted to noise at every temperature. */}
                      IMU {rejection.imu + 1} was not calibrated — {rejection.reason}.
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {row.rebootParameters && row.rebootParameters.length > 0 ? (
            <p className="amc-step__reboot">
              {/* This is what makes the method step-by-step rather than one
                  bulk write at the end: the firmware reads these at boot, so a
                  later step that reads one would read the OLD value until the
                  vehicle has restarted. */}
              <strong>Write and reboot before continuing.</strong> The firmware only reads{' '}
              <span className="amc-step__params">
                {row.rebootParameters.map((name) => (
                  <code key={name}>{name}</code>
                ))}
              </span>{' '}
              at startup, so later steps see the previous value until the vehicle has restarted.
              {onRebootAndReconnect ? (
                <button
                  onClick={() => void rebootAndWait(row.changes)}
                  disabled={!connected || rebooting}
                >
                  {/* Reboot, wait, reconnect — one action, because the step is
                      not finished until the vehicle has restarted and read the
                      value. Leaving the operator to do the waiting and the
                      reconnecting themselves turns the sequence into a series
                      of manual recoveries. */}
                  {rebooting ? `Rebooting… ${rebootCountdown}s` : 'Reboot and reconnect'}
                </button>
              ) : onRequestReboot ? (
                <button onClick={onRequestReboot} disabled={!connected}>
                  Reboot the vehicle
                </button>
              ) : null}
            </p>
          ) : null}

          {row.deletions.length > 0 ? (
            <p className="amc-step__deletions">
              <span>Removes from the vehicle&apos;s file:</span>
              {/* A wrapping list, not run-together inline code: adjacent <code>
                  elements with no whitespace between them give the line no
                  break opportunities at all, so it grows instead of wrapping. */}
              <span className="amc-step__params">
                {row.deletions.map((name) => (
                  <code key={name}>{name}</code>
                ))}
              </span>
            </p>
          ) : null}

          {row.skipped.length > 0 ? (
            <details className="amc-step__skipped">
              <summary>{row.skipped.length} not applicable to this vehicle</summary>
              <ul>
                {row.skipped.map((skip) => (
                  <li key={`${skip.parameter}-${skip.guard}`}>
                    <code>{skip.parameter}</code> — <span>{skip.guard}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {/* A step that sets nothing leaves no trace in the parameters, so the
              operator's own mark is the only record that it was done. Steps
              that do set something are judged by the vehicle instead. */}
          {row.changes.length === 0 && row.blocked.length === 0 ? (
            <label className="amc-step__reviewed">
              <input type="checkbox" checked={reviewed} onChange={(event) => onReviewed(event.target.checked)} />
              <span>I have done this</span>
            </label>
          ) : null}

          {row.captured.length > 0 ? (
            <details className="amc-step__captured">
              <summary>
                {row.captured.length} value{row.captured.length === 1 ? '' : 's'} on this vehicle belong to this step
              </summary>
              <table className="amc-step__table">
                <tbody>
                  {row.captured.map((entry) => (
                    <tr key={entry.parameter}>
                      <td>
                        <code>{entry.parameter}</code>
                      </td>
                      <td>{entry.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}

          {row.inheritedFrom && row.inheritedFrom.length > 0 ? (
            <p className="amc-step__inherited">
              This step reads values an earlier step sets, so what it computes here can differ from
              what the vehicle reports now — the sequence runs in order, and{' '}
              {row.inheritedFrom.map((from, index) => (
                <span key={from}>
                  {index > 0 ? ' and ' : ''}
                  <button onClick={() => onJump?.(from)}>{titleOf(from)}</button>
                </span>
              ))}{' '}
              {row.inheritedFrom.length === 1 ? 'comes' : 'come'} first.
            </p>
          ) : null}

          {row.capturePending ? (
            <p className="amc-step__capture-pending">
              This step also takes account of settings you have already changed, which needs the
              vehicle&apos;s own defaults.
              {onReadDefaults ? (
                <button onClick={onReadDefaults} disabled={defaultsRead === 'asking'}>
                  {defaultsRead === 'asking' ? 'Reading…' : 'Read them from the vehicle'}
                </button>
              ) : null}
              {defaultsRead === 'nothing' ? (
                <span className="amc-step__disputed-why">
                  The vehicle sent no defaults. That needs MAVFTP on ArduPilot 4.5 or later; the
                  Parameters view reports the reason.
                </span>
              ) : null}
            </p>
          ) : null}

          {row.logMessages.length > 0 ? (
            <details className="amc-step__logs">
              <summary>
                {/* With a log loaded this is a verdict rather than a list:
                    several steps configure something whose only proof is in
                    the log, and ESC telemetry either arrived or it did not. */}
                {row.logSatisfied === undefined
                  ? `${row.logMessages.filter((m) => m.required).length} log message${
                      row.logMessages.filter((m) => m.required).length === 1 ? '' : 's'
                    } this step should produce`
                  : row.logSatisfied
                    ? 'The flight log has everything this step should produce'
                    : `The flight log is missing ${
                        row.logMessages.filter((m) => m.required && !m.count).length
                      } message${
                        row.logMessages.filter((m) => m.required && !m.count).length === 1 ? '' : 's'
                      } this step should produce`}
              </summary>
              <ul>
                {row.logMessages.map((message) => (
                  <li key={message.id}>
                    <code>{message.id}</code> {message.name}
                    {message.required ? <span className="amc-step__tag">required</span> : null}
                    {message.count !== undefined ? (
                      <span
                        className={`amc-step__log-count amc-step__log-count--${
                          message.count > 0 ? 'present' : message.required ? 'missing' : 'absent'
                        }`}
                      >
                        {message.count > 0 ? `${message.count.toLocaleString()} in the log` : 'not in the log'}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {row.file ? (
            <p className="amc-step__file">
              This step needs <code>{row.file.name}</code> at <code>{row.file.destination}</code> on the
              flight controller.{' '}
              {/* The download stays, and not only as a fallback: putting a
                  script on an aircraft is worth being able to read first. */}
              <a href={row.file.url} download={row.file.name} target="_blank" rel="noreferrer">
                Download it
              </a>
              {onInstallFile ? (
                <>
                  {' or '}
                  <button
                    onClick={() => void installFile(row.file!)}
                    disabled={!connected || installing === row.file.destination}
                    title={
                      connected
                        ? 'Fetch it and write it to the flight controller'
                        : 'Connect a vehicle first'
                    }
                  >
                    {installing === row.file.destination ? 'Installing…' : 'put it on the vehicle'}
                  </button>
                </>
              ) : null}
              {installNotice?.destination === row.file.destination ? (
                <span
                  className={`amc-step__file-notice amc-step__file-notice--${installNotice.tone}`}
                >
                  {installNotice.text}
                </span>
              ) : null}
            </p>
          ) : null}

          {row.tool && onOpenTool ? (
            <p className="amc-step__tool">
              {/* AMC embeds this tool in the step; here it already exists as
                  its own surface, so the step sends you to it rather than
                  carrying a second copy. */}
              This step is done with the {row.tool.label} tool.
              <button onClick={() => onOpenTool(row.tool!.view)}>Open it</button>
            </p>
          ) : null}

          {row.jumps.length > 0 ? (
            <details className="amc-step__jumps">
              <summary>You may skip ahead from here</summary>
              <ul>
                {row.jumps.map((jump) => (
                  <li key={jump.filename}>
                    <button className="amc-step__jump-to" onClick={() => onJump?.(jump.filename)}>
                      {jump.to}
                    </button>{' '}
                    — {jump.cost}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {row.links.length > 0 ? (
            <p className="amc-step__link">
              {row.links.map((link) => (
                <a key={link.url} href={link.url} target="_blank" rel="noreferrer" title={link.title ?? link.label}>
                  {link.label}
                </a>
              ))}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

export function AmcGuidedView(props: AmcGuidedViewProps) {
  const {
    connected,
    parameters,
    states,
    defaults,
    onReadDefaults,
    onRequestReboot,
    onRebootAndReconnect,
    onDownloadLatestLog,
    onInstallFile,
    onWriteStep,
    onOpenTool,
    suggestedKind,
    vehicleFirmwareVersion,
    progressKey,
    docs,
    docsVehicle,
    onDocsVehicleChange,
    onStage,
    staged
  } = props

  const [kind, setKind] = useState<AmcVehicleKind>(suggestedKind ?? 'ArduCopter')
  const [values, setValues] = useState<Record<string, string>>({})
  const [reviewed, setReviewed] = useState<ReadonlySet<string>>(new Set())
  // A declaration made before connecting, offered rather than applied when a
  // vehicle turns up with nothing of its own stored.
  const [carryOver, setCarryOver] = useState<Record<string, string> | undefined>(undefined)
  // Asking the vehicle for its defaults is a MAVFTP transfer that can quietly
  // do nothing on a firmware that cannot serve it. A control on this screen
  // reports its own outcome rather than leaving the operator to infer it.
  const [defaultsRead, setDefaultsRead] = useState<'idle' | 'asking' | 'nothing'>('idle')
  // What the last export or import did. Both are one-shot actions with no
  // other visible effect -- a download that silently produced nothing, or an
  // import that matched no files, would look identical to success.
  const [projectNotice, setProjectNotice] = useState<{ tone: 'ok' | 'warning'; text: string } | undefined>(undefined)
  // Decisions read back from a directory, so rewriting it keeps them. Held
  // here rather than merged into `values`: an @manual_override is a parameter
  // the operator overruled, not a component they declared.
  const [overrides, setOverrides] = useState<ReadonlyMap<string, { value: number; reason?: string }>>(new Map())
  // What the last read off the vehicle found, including what it could not
  // settle — a control that silently filled in some boxes would leave the
  // operator unsure whether it had run.
  const [importNotice, setImportNotice] = useState<
    { tone: 'ok' | 'warning'; text: string; undetermined: readonly string[] } | undefined
  >(undefined)
  // Message counts from a flight log the operator picked. Counts only: the
  // decoded messages are tens of megabytes and nothing here needs them.
  const [logCounts, setLogCounts] = useState<ReadonlyMap<string, number> | undefined>(undefined)
  const [logState, setLogState] = useState<'idle' | 'reading' | 'downloading'>('idle')
  // The IMU temperature calibration fitted from that log, when it held one.
  const [tempcal, setTempcal] = useState<TempcalOutcome | undefined>(undefined)
  // The declaration the operator started from, whole. The form only asks
  // about what the sequence reads, so without this a written directory drops
  // every other field and stops being a vehicle project AMC could open.
  const [baseComponents, setBaseComponents] = useState<Readonly<Record<string, unknown>> | undefined>(
    undefined
  )
  // The step the operator last wrote, so the directory records where they got
  // to and reopening resumes rather than starting over.
  const [lastWritten, setLastWritten] = useState<string | undefined>(undefined)
  // Written documentation is off by default: it roughly triples every file,
  // which is worth it for a directory someone will read and not for one they
  // will only feed back in.
  const [annotate, setAnnotate] = useState(false)
  // Where "next" counts from. Kept separate from the step an operator has
  // merely expanded: pressing next twice should advance twice.
  const [lastVisited, setLastVisited] = useState<string | undefined>(undefined)
  const [logNotice, setLogNotice] = useState<string | undefined>(undefined)

  const fetchLatestLog = useCallback(async () => {
    if (!onDownloadLatestLog) return
    setLogState('downloading')
    setLogNotice(undefined)
    try {
      const latest = await onDownloadLatestLog()
      if (!latest) {
        setLogNotice('The vehicle has no logs on it.')
        return
      }
      // Straight into the same path a picked file takes, so there is one
      // place where a log becomes an answer.
      await readLogBytes(latest.name, latest.bytes)
    } catch (error) {
      setLogNotice(
        `Could not fetch the log: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      setLogState('idle')
    }
    // readLogBytes is declared below and stable; see the note there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDownloadLatestLog])

  /**
   * Turn a log's bytes into the answer each step needs.
   *
   * One implementation for both ways in — a file the operator picked and a
   * log pulled off the vehicle — so there is a single place where a log
   * becomes a verdict.
   */
  const readLogBytes = useCallback(async (name: string, bytes: ArrayBuffer | Uint8Array) => {
    setLogState('reading')
    setLogNotice(undefined)
    try {
      // Dynamic-imported: the parser is large and most sessions never open a
      // log, so it should not be in the tab's first paint.
      const { parseDataflashLog } = await import('@arduconfig/log-analysis')
      const parsed = parseDataflashLog(bytes)
      if (parsed.counts.size === 0) {
        setLogNotice(`${name} holds no recognisable messages — is it a DataFlash .bin log?`)
        return
      }
      setLogCounts(parsed.counts)

      // Three of the sequence's steps are the IMU temperature calibration,
      // and the log is where its answer comes from. Fitted on load so the
      // steps can offer it rather than asking for the same file twice.
      const tempcalResult = fitTempcalFromLog(parsed.messagesByType)
      setTempcal(
        Object.keys(tempcalResult.parameters).length > 0 || tempcalResult.rejected.length > 0
          ? tempcalResult
          : undefined
      )

      const parts = [`${name}: ${parsed.counts.size} message types`]
      if (tempcalResult.fitted.length > 0) {
        parts.push(
          `IMU temperature calibration fitted for ${tempcalResult.fitted.length} IMU${
            tempcalResult.fitted.length === 1 ? '' : 's'
          }`
        )
      }
      setLogNotice(`${parts.join('. ')}.`)
    } catch (error) {
      setLogNotice(`Could not read ${name}: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLogState('idle')
    }
  }, [])

  const readLog = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      await readLogBytes(file.name, await file.arrayBuffer())
    },
    [readLogBytes]
  )

  const readDefaults = useCallback(async () => {
    if (!onReadDefaults) return
    setDefaultsRead('asking')
    try {
      await onReadDefaults()
    } finally {
      // Judged on the next render by whether defaults arrived; see below.
      setDefaultsRead((current) => (current === 'asking' ? 'nothing' : current))
    }
  }, [onReadDefaults])

  // Anything that arrives clears the failure state, including a fetch the app
  // made for its own reasons.
  useEffect(() => {
    if (defaults && defaults.size > 0) setDefaultsRead('idle')
  }, [defaults])

  // Which vehicle the values in state belong to.
  //
  // Saving is held until this matches, because the key changes the moment a
  // vehicle connects and the values in hand at that instant still belong to
  // whatever came before. Without the guard, connecting saves the previous
  // (usually empty) declaration over the one stored for this aircraft, and the
  // work is gone -- which is exactly what it did.
  const [loadedKey, setLoadedKey] = useState<string | undefined>(undefined)

  // Restore whatever belongs to this vehicle. Runs again when the key changes,
  // which is what makes connecting to a different aircraft show its own work
  // rather than the last one's.
  useEffect(() => {
    const stored = loadAmcProgress(progressKey)
    setValues(stored?.declaration ?? {})
    setReviewed(new Set(stored?.reviewed ?? []))
    setLoadedKey(progressKey)
    if (stored || progressKey === UNATTACHED_KEY) {
      setCarryOver(undefined)
      return
    }
    // Nothing stored for this aircraft: if there is unattached work, offer it.
    const unattached = loadAmcProgress(UNATTACHED_KEY)
    setCarryOver(
      unattached && Object.keys(unattached.declaration).length > 0 ? unattached.declaration : undefined
    )
  }, [progressKey])

  useEffect(() => {
    if (loadedKey !== progressKey) return
    saveAmcProgress(progressKey, { vehicleKind: kind, declaration: values, reviewed: [...reviewed] })
  }, [loadedKey, progressKey, kind, values, reviewed])

  // Follow the connected vehicle, but never override a sequence the operator
  // picked by hand for a vehicle that is not connected.
  useEffect(() => {
    if (suggestedKind) setKind(suggestedKind)
  }, [suggestedKind])

  // The step files are dynamic-imported, so the sequence arrives after the tab
  // does. A stale load for a sequence the operator has since switched away from
  // is discarded rather than rendered.
  const [sequence, setSequence] = useState<{ kind: AmcVehicleKind; loaded: LoadedSequence } | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    setLoadError(undefined)
    loadSequence(kind)
      .then((loaded) => {
        if (!cancelled) setSequence({ kind, loaded })
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [kind])

  const loaded = sequence?.kind === kind ? sequence.loaded : undefined
  const steps = loaded?.steps

  // The documentation decides which fields are dropdowns, so the form is
  // rebuilt once it has loaded.
  const fields = useMemo(() => (steps ? fieldsFor(steps, docs) : []), [steps, docs])

  const templates = useMemo(() => vehicleTemplates(fields, kind), [fields, kind])

  const applyTemplate = useCallback(
    (id: string) => {
      const values = templateValues(id, fields)
      const filled = Object.keys(values).length
      if (filled === 0) return
      // Replaces rather than merges: a template describes one coherent
      // aircraft, and half of one vehicle mixed with half of another is a
      // vehicle that does not exist.
      setValues(values)
      setBaseComponents(templateComponents(id))
      setImportNotice({
        tone: 'ok',
        text: `Started from ${id.split('/')[1]?.replace(/_/g, ' ')}: ${filled} field${
          filled === 1 ? '' : 's'
        } filled in. Correct anything that differs from your vehicle.`,
        undetermined: []
      })
    },
    [fields]
  )

  // The firmware version unblocks more of the sequence than any other field,
  // and the vehicle reports it -- so it is read off the link rather than typed
  // or picked from a list of the versions other aircraft happened to run.
  // Filled in only when the operator has not answered it themselves.
  const versionKey = useMemo(
    () => fields.find((field) => field.component === 'Flight Controller' && field.label === 'Version')?.key,
    [fields]
  )
  useEffect(() => {
    if (!vehicleFirmwareVersion || !versionKey) return
    setValues((previous) => (previous[versionKey] ? previous : { ...previous, [versionKey]: vehicleFirmwareVersion }))
  }, [vehicleFirmwareVersion, versionKey])

  // The documentation is ~1.7 MB per vehicle and lazily loaded by App; ask for
  // the one this sequence needs whenever the sequence changes.
  useEffect(() => {
    onDocsVehicleChange(kind === 'ArduPlane' ? 'ArduPlane' : kind === 'Rover' ? 'ArduRover' : 'ArduCopter')
  }, [kind, onDocsVehicleChange])

  const summary = useMemo(
    () =>
      steps
        ? runSequence({
            sequence: steps,
            ...(loaded ? { file: loaded.file } : {}),
            fields,
            values,
            parameters,
            ...(states ? { states } : {}),
            ...(defaults ? { defaults } : {}),
            ...(docs ? { docs } : {}),
            ...(logCounts ? { logCounts } : {})
          })
        : undefined,
    [steps, loaded, fields, values, parameters, states, defaults, docs, logCounts]
  )

  const declaredCount = fields.length - (summary?.missing.length ?? fields.length)

  // Reading the declaration off the vehicle. Pure apart from setting state:
  // the deriving is in the view-model, tested against AMC's 29 templates.
  const pwmTypeValues = useMemo(() => {
    const options = docs?.('MOT_PWM_TYPE')?.options
    if (!options || options.length === 0) return undefined
    return Object.fromEntries(options.map((option) => [String(option.value), option.label]))
  }, [docs])

  const readFromVehicle = useCallback(() => {
    if (!steps) return
    const result = importFromVehicle({
      fields,
      values,
      parameters,
      kind,
      // The firmware's own documentation for MOT_PWM_TYPE beats the built-in
      // table, which is only there for a build whose metadata we lack. The
      // docs carry options as a list; the import wants them keyed by value.
      ...(pwmTypeValues ? { pwmTypeValues } : {})
    })

    const filled = Object.keys(result.values).length
    if (filled === 0) {
      setImportNotice({
        tone: 'warning',
        text:
          result.undetermined.length > 0
            ? 'Its parameters did not settle anything the form still needs.'
            : 'Everything its parameters can settle is already declared.',
        undetermined: result.undetermined
      })
      return
    }

    setValues((previous) => ({ ...previous, ...result.values }))
    const parts = [`Filled in ${filled} field${filled === 1 ? '' : 's'} from the vehicle`]
    // Overwriting an answer the operator gave is the one thing worth calling
    // out: it means the vehicle disagrees with them.
    if (result.overwrites.length > 0) {
      parts.push(`${result.overwrites.length} replaced what you had answered`)
    }
    setImportNotice({
      tone: result.overwrites.length > 0 ? 'warning' : 'ok',
      text: `${parts.join(', ')}.`,
      undetermined: result.undetermined
    })
  }, [steps, fields, values, parameters, kind, pwmTypeValues])

  // Writing the directory out. The whole assembly is pure; the only part that
  // needs a browser is handing the bytes over, which is these few lines.
  const exportProject = useCallback(() => {
    if (!steps) return
    const project = buildProject({
      sequence: steps,
      fields,
      values,
      parameters,
      ...(defaults ? { defaults } : {}),
      ...(docs ? { docs } : {}),
      overrides,
      ...(baseComponents ? { baseComponents } : {}),
      ...(lastWritten ? { lastWritten } : {}),
      ...(summary?.configuration ? { summary: summary.configuration } : {}),
      ...(tempcal?.plots.length ? { tempcalPlots: tempcal.plots } : {}),
      ...(annotate && docs ? { annotate: docs } : {})
    })
    const blob = new Blob([projectArchive(project) as unknown as BlobPart], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    // The firmware version, when it is declared, distinguishes two exports of
    // the same airframe taken months apart.
    const version = versionKey ? values[versionKey] : undefined
    link.download = projectFilename(version ? `${kind}_${version}` : kind)
    link.click()
    URL.revokeObjectURL(url)

    // A step whose directives could not all be evaluated still gets a file --
    // it just does not hold everything it should, and saying so beats the
    // operator finding out when they read the directory back.
    setProjectNotice(
      project.incomplete.length > 0
        ? {
            tone: 'warning',
            text: `Written, but ${project.incomplete.length} step${
              project.incomplete.length === 1 ? '' : 's'
            } could not be fully evaluated \u2014 declare the fields they need and download again.`
          }
        : {
            tone: 'ok',
            text: `Written: ${project.files.length} files, ${project.parameterCount} parameters.`
          }
    )
  }, [steps, fields, values, parameters, defaults, docs, overrides, baseComponents, lastWritten, annotate, summary, tempcal, kind, versionKey])

  // Reading one back. The picker hands over whatever the operator selected, so
  // this has to be honest about what it could and could not place.
  const importProject = useCallback(
    async (picked: FileList | null) => {
      if (!steps || !picked || picked.length === 0) return
      const files = await Promise.all(
        [...picked].map(async (file) => ({
          // webkitRelativePath is set when a whole directory was chosen and is
          // the only place the directory structure survives.
          filename: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
          text: await file.text()
        }))
      )

      const project = readProject(steps, files, fields, {
        ...(vehicleFirmwareVersion ? { vehicleFirmwareVersion } : {})
      })
      if (project.steps.length === 0 && project.componentValues === undefined) {
        setProjectNotice({
          tone: 'warning',
          text: 'Nothing in that selection belongs to this sequence. Pick the vehicle directory itself, or switch the sequence to the one it was written for.'
        })
        return
      }

      if (project.componentValues) setValues(project.componentValues)
      // Everything the opened directory held that this form never asks about
      // travels with it, so rewriting does not quietly strip the vehicle down
      // to the fields the sequence happens to read.
      if (project.components) {
        try {
          const parsed = JSON.parse(project.components) as { Components?: Record<string, unknown> }
          if (parsed.Components) setBaseComponents(parsed.Components)
        } catch {
          // Already reported by readProject leaving componentValues unset.
        }
      }
      setOverrides(project.overrides)

      // Where the operator got to. Resuming at step one would be a surprising
      // answer to reopening a sequence they had nearly finished.
      if (project.resume?.lastWritten) setLastWritten(project.resume.lastWritten)
      const resumeAt = project.resume?.filename
      if (resumeAt) {
        // Brought into view rather than jumped to silently.
        window.setTimeout(() => jumpToStep(resumeAt), 0)
      }

      const parts = [`Read ${project.steps.length} step files`]
      if (project.resume?.reason === 'after-last-written' && resumeAt) {
        parts.push(`resuming at ${titleOf(resumeAt)}`)
      } else if (project.resume?.reason === 'finished') {
        parts.push('the sequence was finished')
      } else if (project.resume?.reason === 'unrecognised') {
        parts.push('its last step is not one this sequence has, so it starts from the beginning')
      }
      if (project.overrides.size > 0) {
        parts.push(`${project.overrides.size} decision${project.overrides.size === 1 ? '' : 's'} you had recorded`)
      }
      // Old names are worth naming: the directory looked like it matched
      // nothing until these were claimed, and the operator should know their
      // project predates the current sequence.
      if (project.renamed.length > 0) {
        parts.push(`${project.renamed.length} under names the sequence has since changed`)
      }
      // A rename that also changed units is worth its own mention: the number
      // in the file and the number now on the vehicle are deliberately not
      // the same, and an operator comparing them would otherwise be puzzled.
      const upgraded = project.renamedParameters ?? []
      if (upgraded.length > 0) {
        const rescaled = upgraded.filter((rename) => rename.scale !== undefined).length
        parts.push(
          `${upgraded.length} parameter${upgraded.length === 1 ? '' : 's'} renamed for this firmware` +
            (rescaled > 0 ? ` (${rescaled} rescaled with it)` : '')
        )
      }
      setProjectNotice({
        tone: project.unmatched.length > 0 ? 'warning' : 'ok',
        text:
          project.unmatched.length > 0
            ? `${parts.join(', ')}. ${project.unmatched.length} file${
                project.unmatched.length === 1 ? '' : 's'
              } left unread: ${project.unmatched.slice(0, 3).join(', ')}.`
            : `${parts.join(', ')}.`
      })
    },
    [steps, fields]
  )

  // A blocked step names the field that would unblock it; clicking it should
  // put the cursor there rather than leaving the operator to find it.
  // A jump names another step; bringing it into view is the least this can do
  // without pretending the sequence has been reordered.
  const jumpToStep = useCallback((filename: string) => {
    const target = document.getElementById(stepDomId(filename))
    if (!target) return
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
    target.querySelector<HTMLButtonElement>('.amc-step__head')?.focus()
  }, [])

  const focusField = useCallback((key: string) => {
    const input = document.getElementById(fieldInputId(key))
    if (!(input instanceof HTMLInputElement)) return
    input.scrollIntoView({ block: 'center', behavior: 'smooth' })
    input.focus()
  }, [])

  return (
    <div className="amc-guided">
      <Panel
        title="AMC guided mode"
        subtitle="AMC's setup sequence, run against your vehicle. Changes are staged, not written."
      >
        {/* The sequence, the reasoning and the tuning guides are AMC's work.
            This tab evaluates their data; it does not replace their docs, and
            an operator following a step should be able to reach the guide that
            explains it. */}
        <p className="amc-guided__credit">
          The sequence below is ArduPilot Methodic Configurator&apos;s work. This tab runs it against
          your vehicle; their docs are where the reasoning lives.
        </p>
        <p className="amc-guided__links">
          {[
            ['Project', 'https://github.com/ArduPilot/MethodicConfigurator'],
            ['Introduction', 'https://discuss.ardupilot.org/t/new-ardupilot-methodic-configurator-gui/115038'],
            ['Documentation', 'https://ardupilot.github.io/MethodicConfigurator/'],
            // AMC publishes exactly four tuning guides, named for the four
            // sequence kinds, so this always resolves to a real page.
            [`${kind} tuning guide`, `https://ardupilot.github.io/MethodicConfigurator/TUNING_GUIDE_${kind}`]
          ].map(([label, href]) => (
            <a key={href} href={href} target="_blank" rel="noreferrer noopener">
              {label}
            </a>
          ))}
        </p>
        <div className="amc-guided__controls">
          <label>
            Sequence
            <select value={kind} onChange={(event) => setKind(event.target.value as AmcVehicleKind)}>
              {AMC_VEHICLE_KINDS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          {suggestedKind ? (
            <StatusBadge tone="success">matched to the connected vehicle</StatusBadge>
          ) : connected ? (
            <StatusBadge tone="warning">no AMC sequence for this firmware</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">not connected — showing the sequence only</StatusBadge>
          )}
          {docs === undefined && docsVehicle !== undefined ? (
            <StatusBadge tone="neutral">loading parameter documentation…</StatusBadge>
          ) : null}
          {loadError ? <StatusBadge tone="danger">could not load the sequence: {loadError}</StatusBadge> : null}
        </div>

        {summary === undefined ? (
          <p className="amc-guided__loading">Loading the {kind} sequence…</p>
        ) : (
        <dl className="amc-guided__summary">
          <div>
            <dt>Steps</dt>
            <dd>{summary.rows.length}</dd>
          </div>
          <div>
            <dt>Parameters set</dt>
            <dd>{summary.totalChanges}</dd>
          </div>
          {connected ? (
            <div>
              <dt>Differ from the vehicle</dt>
              <dd>{summary.totalPending}</dd>
            </div>
          ) : null}
          <div>
            <dt>Done</dt>
            <dd>
              {
                summary.rows.filter(
                  (row) =>
                    reviewed.has(row.filename) ||
                    (row.blocked.length === 0 && row.changes.length > 0 && row.pending === 0)
                ).length
              }{' '}
              / {summary.rows.length}
            </dd>
          </div>
          <div>
            <dt>Blocked</dt>
            <dd>{summary.totalFailures}</dd>
          </div>
          {summary.totalCaptured > 0 ? (
            <div title="Settings already on this vehicle that the sequence's steps claim — a calibration you have run, or anything another tool changed.">
              <dt>Already yours</dt>
              <dd>{summary.totalCaptured}</dd>
            </div>
          ) : null}
          {summary.totalDisputed > 0 ? (
            <div title="Values the sequence intends that ArduPilot's documented range disputes — most often a 0 that means 'disabled' on a parameter whose range starts higher.">
              <dt>Outside documented range</dt>
              <dd>{summary.totalDisputed}</dd>
            </div>
          ) : null}
        </dl>
        )}
      </Panel>

      <Panel
        title="The vehicle's configuration directory"
        subtitle="One file per step, each value carrying the reason it was set — the artefact this method exists to produce."
      >
        <p className="amc-guided__project-blurb">
          A configuration you cannot reopen later is one you have to redo from memory. Start from
          something — a directory, a similar aircraft, the vehicle itself — and write the result
          back out when you are done.
        </p>

        {/* Everything that fills the declaration in. They belong together:
            each one answers "where does this vehicle's description come
            from?", and having them scattered down the page made the tab read
            as one long form rather than a place you arrive with something.
            Laid out as a grid so the controls share an edge and the
            descriptions share another — as three loose rows they read as a
            ragged list rather than three ways to do one thing. */}
        <div className="amc-guided__sources">
          <h4>Fill it in from</h4>
        <p className="amc-guided__from-vehicle-row">
          {/* A vehicle much like one AMC already describes is most of this
              form answered by someone who owned that aircraft. Still a
              starting point, not a claim about their vehicle. */}
          <label>
            Start from a similar vehicle
            <select
              data-testid="amc-template-select"
              value=""
              onChange={(event) => {
                if (event.target.value) applyTemplate(event.target.value)
                event.target.value = ''
              }}
            >
              <option value="">Choose one…</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label} — answers {template.answers}
                </option>
              ))}
            </select>
          </label>
          <span>Fills the form in from AMC&apos;s own vehicles. Correct anything that differs.</span>
        </p>
        {connected ? (
          <p className="amc-guided__from-vehicle-row">
            {/* The form asks two dozen questions a configured vehicle has
                already answered. Offered rather than applied: a parameter says
                how the vehicle is CONFIGURED, which is not the same as how it
                is wired, and only the operator can see the difference. */}
            <button style={buttonStyle()} onClick={readFromVehicle} disabled={!steps}>
              Read what the vehicle already knows
            </button>
            <span>Fills in what its parameters can settle. Nothing is written to the vehicle.</span>
          </p>
        ) : null}
        <p className="amc-guided__from-vehicle-row">
          {/* Several steps configure something whose only proof is in a flight
              log. The sequence names the messages each one depends on; this is
              what turns that list into an answer. Parsed here in the browser —
              nothing is uploaded anywhere. */}
          <label className="amc-guided__import" style={buttonStyle()}>
            {logState === 'reading' ? 'Reading the log…' : 'Check a flight log'}
            <input
              type="file"
              accept=".bin,.BIN"
              data-testid="amc-open-log"
              disabled={logState === 'reading'}
              onChange={(event) => {
                void readLog(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </label>
          <span>
            {logNotice ?? 'Marks the messages each step should have produced. Read in your browser.'}
            {onDownloadLatestLog && connected ? (
              <>
                {' '}
                {/* The vehicle has the log. Sending the operator to another
                    tab to fetch it, then back here to load it, is three steps
                    for something the sequence already needs. */}
                <button
                  className="amc-guided__inline-action"
                  onClick={() => void fetchLatestLog()}
                  disabled={logState !== 'idle'}
                >
                  {logState === 'downloading' ? 'Downloading…' : 'or take the latest off the vehicle'}
                </button>
              </>
            ) : null}
          </span>
        </p>
        {importNotice ? (
          <div className={`amc-guided__import-notice amc-guided__import-notice--${importNotice.tone}`}>
            <p>{importNotice.text}</p>
            {importNotice.undetermined.length > 0 ? (
              <details>
                <summary>
                  {importNotice.undetermined.length} thing
                  {importNotice.undetermined.length === 1 ? '' : 's'} its parameters could not settle
                </summary>
                <ul>
                  {importNotice.undetermined.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}

        <p className="amc-guided__from-vehicle-row">
          {/* Opening a directory is a SOURCE like the three above it: it is
              where a vehicle's description comes from when the operator
              already has one. Only the download belongs on the other side.

              The sequence is what gives a directory's files meaning, and it
              is dynamic-imported — so until it is here there is nothing to
              read against. Disabled rather than silently doing nothing, which
              is what it did: a directory picked in the first moment after the
              tab opened was dropped without a word. */}
          <label
            className={`amc-guided__import${steps ? '' : ' amc-guided__import--waiting'}`}
            style={buttonStyle()}
            aria-disabled={steps ? undefined : true}
          >
            {steps ? 'Open a directory' : 'Loading the sequence…'}
            <input
              type="file"
              multiple
              disabled={!steps}
              data-testid="amc-open-project"
              accept=".param,.json"
              onChange={(event) => {
                void importProject(event.target.files)
                // Cleared so picking the same directory twice fires again.
                event.target.value = ''
              }}
            />
          </label>
          <span>Picks up a directory you wrote before, at the step you stopped on.</span>
        </p>
        </div>

        <div className="amc-guided__sources amc-guided__sources--out">
          <h4>When you are done</h4>
          <p className="amc-guided__from-vehicle-row">
            <button style={buttonStyle('primary')} onClick={exportProject} disabled={declaredCount === 0}>
              Download the directory
            </button>
            <span>
              One file per step, plus what you declared and everything the sequence decided.
            </span>
          </p>
          <label className="amc-guided__annotate">
            <input
              type="checkbox"
              data-testid="amc-annotate-toggle"
              checked={annotate}
              disabled={!docs}
              onChange={(event) => setAnnotate(event.target.checked)}
            />
            <span>
              {/* Worth an explicit choice: the files roughly triple in size,
                  which suits a directory someone will read and not one that
                  only gets fed back in. */}
              Write ArduPilot&apos;s documentation into the files
            </span>
          </label>
        </div>

        {projectNotice ? (
          <p className={`amc-guided__project-notice amc-guided__project-notice--${projectNotice.tone}`}>
            {projectNotice.text}
          </p>
        ) : null}
        {declaredCount === 0 ? (
          <p className="amc-guided__project-empty">
            Nothing is declared yet, so there is nothing to derive — an empty directory records no
            decisions at all.
          </p>
        ) : null}
      </Panel>

      <Panel
        title="Declare the vehicle"
        subtitle={`${declaredCount} of ${fields.length} fields — exactly what the sequence reads, nothing more.`}
      >
        {carryOver ? (
          <p className="amc-guided__carry-over">
            You declared a vehicle before connecting. Use it for this one?
            <button
              onClick={() => {
                setValues(carryOver)
                setCarryOver(undefined)
              }}
            >
              Use it
            </button>
            <button
              onClick={() => {
                setCarryOver(undefined)
              }}
            >
              Start fresh
            </button>
          </p>
        ) : null}
        {summary && summary.nextFields.length > 0 ? (
          <p className="amc-guided__next">
            Most blocking:{' '}
            {summary.nextFields.slice(0, 3).map((entry) => (
              <button key={entry.field.key} onClick={() => focusField(entry.field.key)}>
                {entry.field.component} › {entry.field.label}
                <span> unblocks {entry.unblocks}</span>
              </button>
            ))}
          </p>
        ) : null}
        {/* Open while there is still something to answer, folded away once
            there is not: this is 24 fields you fill in once, and leaving it
            expanded puts the sequence itself below the fold for the rest of
            the session. */}
        <details className="amc-guided__components-fold" open={declaredCount < fields.length}>
          <summary>
            {declaredCount >= fields.length
              ? 'The vehicle is described — open to change an answer'
              : `${fields.length - declaredCount} still to answer`}
          </summary>
        <div className="amc-guided__components">
          {groupFields(fields).map(({ component, fields: group, showGroups }) => (
            <fieldset key={component} className="amc-guided__component">
              <legend>{component}</legend>
              {group.map((field) => (
                <label key={field.key} className="amc-guided__field">
                  <span className="amc-guided__field-name">
                    <span title={`${field.uses} expression${field.uses === 1 ? '' : 's'} read this`}>{field.label}</span>
                    {/* Two fields in one component can share a name -- the ESC
                        has a Protocol under both its telemetry and its control
                        connection -- so the group is part of the label, not a
                        placeholder that the input's width cuts off. */}
                    {showGroups && field.group ? <em>{field.group}</em> : null}
                  </span>
                  <FieldControl
                    field={field}
                    value={values[field.key] ?? ''}
                    // A Protocol is constrained by the Type on the SAME
                    // connection, which is the sibling field one level up.
                    pairedType={
                      field.path.length === 3 && field.path[2] === 'Protocol'
                        ? values[[...field.path.slice(0, 2), 'Type'].join('/')]
                        : undefined
                    }
                    // Some ESC protocols carry telemetry back over the wire
                    // that drives the motors — FETtecOneWire, DroneCAN and
                    // friends — so the telemetry connection is not a separate
                    // question, and asking it invites a different answer the
                    // sequence would then compute from.
                    mirroredFrom={mirroredTelemetry(field, values, kind)}
                    onChange={(next) => setValues((previous) => ({ ...previous, [field.key]: next }))}
                  />
                  {field.key === versionKey && vehicleFirmwareVersion && values[field.key] === vehicleFirmwareVersion ? (
                    <em className="amc-guided__from-vehicle">read from the vehicle</em>
                  ) : null}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        </details>
        <div className="button-row">
          <button
            style={buttonStyle()}
            onClick={() => {
              setValues({})
              setReviewed(new Set())
              clearAmcProgress(progressKey)
            }}
          >
            Clear
          </button>
        </div>
      </Panel>

      {summary?.configuration ? (
        <Panel
          title="What this vehicle has"
          subtitle="Everything that differs from the firmware's own defaults, sorted by who decided it."
        >
          <dl className="amc-guided__summary">
            <div>
              <dt>Changed</dt>
              <dd>
                {summary.configuration.changed.length}
                <span> of {summary.configuration.compared}</span>
              </dd>
            </div>
            {summary.configuration.categoriesAvailable ? (
              <>
                <div title="Produced by a calibration rather than chosen by anyone.">
                  <dt>From calibration</dt>
                  <dd>{summary.configuration.calibration.length}</dd>
                </div>
                <div title="Written by the firmware about itself; not an operator's decision.">
                  <dt>Written by the vehicle</dt>
                  <dd>{summary.configuration.readOnly.length}</dd>
                </div>
              </>
            ) : null}
            <div title="SYSID_THISMAV and friends — which aircraft this is, which matters when a configuration is shared.">
              <dt>Identity</dt>
              <dd>{summary.configuration.identity.length}</dd>
            </div>
            <div title="What is left once calibration, firmware-written and identity values are set aside.">
              <dt>Decisions</dt>
              <dd>{summary.configuration.chosen.length}</dd>
            </div>
          </dl>

          {/* Without ArduPilot's @ReadOnly and @Calibration annotations every
              changed value looks like a decision, which overstates how much was
              actually decided. Better to say so than to show a confident
              number that is wrong. */}
          {!summary.configuration.categoriesAvailable ? (
            <p className="amc-guided__summary-note">
              Calibration results and firmware-written values cannot be separated out: the parameter
              documentation in this build does not carry those flags, so they are counted as decisions.
            </p>
          ) : null}

          <details className="amc-guided__summary-list">
            <summary>The {summary.configuration.chosen.length} decisions</summary>
            <table className="amc-step__table">
              <thead>
                <tr>
                  <th>Parameter</th>
                  <th>Default</th>
                  <th>This vehicle</th>
                </tr>
              </thead>
              <tbody>
                {summary.configuration.chosen.map((entry) => (
                  <tr key={entry.parameter}>
                    <td>
                      <code>{entry.parameter}</code>
                    </td>
                    <td>{entry.defaultValue}</td>
                    <td>{entry.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </Panel>
      ) : null}

      <Panel
        title="The sequence"
        subtitle="Each step, and what it would set on this vehicle."
      >
        {summary && connected && summary.totalPending > 0 ? (
          <div className="amc-guided__stage-all">
            <button
              style={buttonStyle()}
              onClick={() =>
                onStage(
                  summary.rows.flatMap((row) =>
                    row.changes
                      .filter((change) => !change.satisfied)
                      .map((change) => ({ parameter: change.parameter, value: change.value }))
                  )
                )
              }
            >
              Stage all {summary.totalPending} pending
            </button>
            <span>
              Review and write them from the draft bar.
              {summary.totalDisputed > 0
                ? ` ${summary.totalDisputed} sit outside ArduPilot's documented range and the draft bar will hold them until you override.`
                : ''}
            </span>
          </div>
        ) : null}
        {/* The sequence is 63 steps in a dozen phases, and without this the
            tab is one uninterrupted scroll — you cannot see the shape of the
            work or get back to the phase you were in. */}
        {(summary?.groups ?? []).filter((group) => group.name).length > 1 ? (
          <nav className="amc-guided__phase-nav" aria-label="Jump to a phase">
            {(summary?.groups ?? [])
              .filter((group) => group.name)
              .map((group) => {
                const done = group.rows.filter(
                  (row) =>
                    reviewed.has(row.filename) ||
                    (row.blocked.length === 0 && row.changes.length > 0 && row.pending === 0)
                ).length
                return (
                  <button
                    key={group.name}
                    className={`amc-guided__phase-jump${
                      done === group.rows.length ? ' amc-guided__phase-jump--done' : ''
                    }`}
                    onClick={() => {
                      const first = group.rows[0]?.filename
                      if (first) jumpToStep(first)
                    }}
                  >
                    {group.name}
                    <span>
                      {done}/{group.rows.length}
                    </span>
                  </button>
                )
              })}
            {/* Not every step is for every vehicle: the sequence says how
                mandatory each one is, and a dozen of the 63 may be about a
                feature this aircraft does not have. This steps past those. */}
            <button
              className="amc-guided__phase-jump amc-guided__phase-jump--next"
              onClick={() => {
                const next = nextRequiredStep(steps ?? [], lastVisited)
                if (next) {
                  setLastVisited(next)
                  jumpToStep(next)
                }
              }}
              title="Skip the steps most vehicles do not need"
            >
              Next step that matters →
            </button>
          </nav>
        ) : null}
        <div className="amc-guided__steps">
          {(summary?.groups ?? []).map((group) => (
            <section key={group.name || 'unphased'} className="amc-guided__phase">
              {group.name ? (
                <header className="amc-guided__phase-head">
                  <h4>{group.name}</h4>
                  {group.optional ? (
                    <StatusBadge tone="neutral">optional</StatusBadge>
                  ) : (
                    <StatusBadge tone="warning">required</StatusBadge>
                  )}
                  <span className="amc-guided__phase-count">
                    {
                      group.rows.filter(
                        (row) =>
                          reviewed.has(row.filename) ||
                          (row.blocked.length === 0 && row.changes.length > 0 && row.pending === 0)
                      ).length
                    }{' '}
                    / {group.rows.length} done
                  </span>
                  {group.description ? <p>{group.description}</p> : null}
                </header>
              ) : null}
              {group.rows.map((row) => (
                <StepCard
                  key={row.filename}
                  row={row}
                  connected={connected}
                  staged={staged}
                  reviewed={reviewed.has(row.filename)}
                  onDeclareField={focusField}
                  onStage={onStage}
                  onReadDefaults={onReadDefaults ? readDefaults : undefined}
                  onRequestReboot={onRequestReboot}
                  onInstallFile={onInstallFile}
                  onRebootAndReconnect={onRebootAndReconnect}
                  bootDelay={parameters.BRD_BOOT_DELAY}
                  onWriteStep={onWriteStep}
                  onStepWritten={setLastWritten}
                  tempcal={tempcal}
                  defaultsRead={defaultsRead}
                  onOpenTool={onOpenTool}
                  onJump={jumpToStep}
                  onReviewed={(next) =>
                    setReviewed((previous) => {
                      const updated = new Set(previous)
                      if (next) updated.add(row.filename)
                      else updated.delete(row.filename)
                      return updated
                    })
                  }
                />
              ))}
            </section>
          ))}
        </div>
        {summary && summary.milestones.length > 0 ? (
          <p className="amc-guided__milestones">
            {/* Phases that set no parameters at all: things done to the
                aircraft between steps, which the sequence names but cannot
                check. Listed so they are not simply missing from the plan. */}
            Between these steps the sequence also expects:{' '}
            {summary.milestones.map((m) => m.name).join('; ')}.
          </p>
        ) : null}
      </Panel>
    </div>
  )
}
