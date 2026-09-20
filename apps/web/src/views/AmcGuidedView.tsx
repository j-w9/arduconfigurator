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
  runSequence
} from '../view-models/amc-guided'
import type { ParameterDocs } from '@arduconfig/amc-steps'
import type { ParameterState } from '@arduconfig/ardupilot-core'

import { buildProject, projectArchive, projectFilename, readProject } from '../view-models/amc-project'
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
function FieldControl({
  field,
  value,
  onChange
}: {
  field: ComponentField
  value: string
  onChange: (next: string) => void
}) {
  const choices = field.documented ?? field.suggested
  // Once "Other" is chosen, or a stored value is off-list, the field stays a
  // text box rather than silently snapping to something it does not mean.
  const offList = value !== '' && choices !== undefined && !choices.includes(value)
  const [freeform, setFreeform] = useState(offList)

  if (!choices || (freeform && field.suggested)) {
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
          {option}
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
  defaultsRead?: 'idle' | 'asking' | 'nothing'
  onOpenTool?: ((view: AppToolView) => void) | undefined
  onJump?: ((filename: string) => void) | undefined
}) {
  const [open, setOpen] = useState(false)
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
              {stagedHere.length > 0 ? (
                <StatusBadge tone="success">{stagedHere.length} staged</StatusBadge>
              ) : null}
              <span className="amc-step__stage-note">
                Reviewed and written from the draft bar.
              </span>
            </div>
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
                {row.logMessages.filter((m) => m.required).length} log message
                {row.logMessages.filter((m) => m.required).length === 1 ? '' : 's'} this step should produce
              </summary>
              <ul>
                {row.logMessages.map((message) => (
                  <li key={message.id}>
                    <code>{message.id}</code> {message.name}
                    {message.required ? <span className="amc-step__tag">required</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {row.file ? (
            <p className="amc-step__file">
              {/* Two separate acts on purpose. Fetching the applet is harmless
                  and the operator can read it; putting a file on an aircraft is
                  not, and goes over the MAVFTP transfer that is currently known
                  to hang — so this stops at the download and says where the
                  file has to end up. */}
              This step needs <code>{row.file.name}</code> at <code>{row.file.destination}</code> on the
              flight controller.{' '}
              <a href={row.file.url} download={row.file.name} target="_blank" rel="noreferrer">
                Download it
              </a>{' '}
              and copy it across with the Files tab; this tab does not put files on the vehicle.
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
            ...(docs ? { docs } : {})
          })
        : undefined,
    [steps, loaded, fields, values, parameters, states, defaults, docs]
  )

  const declaredCount = fields.length - (summary?.missing.length ?? fields.length)

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
      overrides
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
  }, [steps, fields, values, parameters, defaults, docs, overrides, kind, versionKey])

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

      const project = readProject(steps, files, fields)
      if (project.steps.length === 0 && project.componentValues === undefined) {
        setProjectNotice({
          tone: 'warning',
          text: 'Nothing in that selection belongs to this sequence. Pick the vehicle directory itself, or switch the sequence to the one it was written for.'
        })
        return
      }

      if (project.componentValues) setValues(project.componentValues)
      setOverrides(project.overrides)

      const parts = [`Read ${project.steps.length} step files`]
      if (project.overrides.size > 0) {
        parts.push(`${project.overrides.size} decision${project.overrides.size === 1 ? '' : 's'} you had recorded`)
      }
      // Old names are worth naming: the directory looked like it matched
      // nothing until these were claimed, and the operator should know their
      // project predates the current sequence.
      if (project.renamed.length > 0) {
        parts.push(`${project.renamed.length} under names the sequence has since changed`)
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

      <Panel
        title="The vehicle's configuration directory"
        subtitle="One file per step, each value carrying the reason it was set — the artefact this method exists to produce."
      >
        <p className="amc-guided__project-blurb">
          A configuration you cannot reopen later is one you have to redo from memory. The
          directory holds what you declared alongside what the sequence derived from it, so both
          the values and the reasoning survive.
        </p>
        <div className="button-row">
          <button style={buttonStyle('primary')} onClick={exportProject} disabled={declaredCount === 0}>
            Download the directory
          </button>
          {/* The sequence is what gives a directory's files meaning, and it is
              dynamic-imported — so until it is here there is nothing to read
              against. Disabled rather than silently doing nothing, which is
              what it did: a directory picked in the first moment after the tab
              opened was dropped without a word. */}
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
