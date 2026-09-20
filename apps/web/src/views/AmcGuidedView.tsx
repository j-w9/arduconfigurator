import { useCallback, useEffect, useMemo, useState } from 'react'
import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import {
  AMC_VEHICLE_KINDS,
  type AmcSequence,
  type AmcVehicleKind,
  type ComponentField,
  type StepRow,
  fieldsFor,
  loadSequence,
  runSequence
} from '../view-models/amc-guided'
import type { ParameterDocs } from '@arduconfig/amc-steps'

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
// Nothing on this screen writes to the flight controller. There is deliberately
// no apply affordance yet: the sequence is being read against a real vehicle to
// see whether it agrees with the native flow, which is the whole experiment.

export interface AmcGuidedViewProps {
  connected: boolean
  /** The connected vehicle's firmware, used to pick a sequence. */
  firmwareVehicle?: string
  /** Live parameter values, keyed by name. Empty when not connected. */
  parameters: Readonly<Record<string, number>>
  /** Suggested sequence for the connected firmware, when there is one. */
  suggestedKind?: AmcVehicleKind
  /** ArduPilot parameter documentation, loaded lazily by App. */
  docs?: ParameterDocs
  docsVehicle?: string
  onDocsVehicleChange: (vehicle: string) => void
}

/** A stable DOM id per declaration field, so a blocked step can focus one. */
function fieldInputId(key: string): string {
  return `amc-field-${key.replace(/[^a-zA-Z0-9]+/g, '-')}`
}

function groupFields(fields: readonly ComponentField[]): [string, ComponentField[]][] {
  const byComponent = new Map<string, ComponentField[]>()
  for (const field of fields) {
    const list = byComponent.get(field.component)
    if (list) list.push(field)
    else byComponent.set(field.component, [field])
  }
  return [...byComponent]
}

function StepCard({
  row,
  connected,
  onDeclareField
}: {
  row: StepRow
  connected: boolean
  onDeclareField: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const blocked = row.blocked.length > 0

  return (
    <article className={`amc-step${blocked ? ' amc-step--blocked' : ''}`}>
      <button className="amc-step__head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="amc-step__index">{row.index + 1}</span>
        <span className="amc-step__title">{row.title}</span>
        {blocked ? (
          <StatusBadge tone="danger">{row.blocked.length} blocked</StatusBadge>
        ) : row.changes.length === 0 ? (
          <StatusBadge tone="neutral">nothing to set</StatusBadge>
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
          {row.why ? <p className="amc-step__why">{row.why}</p> : null}

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
                  <tr key={change.parameter} className={change.satisfied ? 'is-satisfied' : undefined}>
                    <td>
                      <code>{change.parameter}</code>
                      {change.group === 'forced_parameters' ? (
                        <span className="amc-step__tag" title="Not adjustable — the sequence requires this value">
                          forced
                        </span>
                      ) : null}
                    </td>
                    {connected ? <td>{change.current === undefined ? '—' : change.current}</td> : null}
                    <td>{change.value}</td>
                    <td className="amc-step__reason">{change.reason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}

          {row.deletions.length > 0 ? (
            <p className="amc-step__deletions">
              Removes from the vehicle&apos;s file: {row.deletions.map((name) => <code key={name}>{name}</code>)}
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

          {row.wikiUrl ? (
            <p className="amc-step__link">
              <a href={row.wikiUrl} target="_blank" rel="noreferrer">
                ArduPilot wiki for this step
              </a>
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

export function AmcGuidedView(props: AmcGuidedViewProps) {
  const { connected, parameters, suggestedKind, docs, docsVehicle, onDocsVehicleChange } = props

  const [kind, setKind] = useState<AmcVehicleKind>(suggestedKind ?? 'ArduCopter')
  const [values, setValues] = useState<Record<string, string>>({})

  // Follow the connected vehicle, but never override a sequence the operator
  // picked by hand for a vehicle that is not connected.
  useEffect(() => {
    if (suggestedKind) setKind(suggestedKind)
  }, [suggestedKind])

  // The step files are dynamic-imported, so the sequence arrives after the tab
  // does. A stale load for a sequence the operator has since switched away from
  // is discarded rather than rendered.
  const [sequence, setSequence] = useState<{ kind: AmcVehicleKind; steps: AmcSequence } | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    setLoadError(undefined)
    loadSequence(kind)
      .then((steps) => {
        if (!cancelled) setSequence({ kind, steps })
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [kind])

  const steps = sequence?.kind === kind ? sequence.steps : undefined
  const fields = useMemo(() => (steps ? fieldsFor(steps) : []), [steps])

  // The documentation is ~1.7 MB per vehicle and lazily loaded by App; ask for
  // the one this sequence needs whenever the sequence changes.
  useEffect(() => {
    onDocsVehicleChange(kind === 'ArduPlane' ? 'ArduPlane' : kind === 'Rover' ? 'ArduRover' : 'ArduCopter')
  }, [kind, onDocsVehicleChange])

  const summary = useMemo(
    () => (steps ? runSequence({ sequence: steps, fields, values, parameters, ...(docs ? { docs } : {}) }) : undefined),
    [steps, fields, values, parameters, docs]
  )

  const declaredCount = fields.length - (summary?.missing.length ?? fields.length)

  // A blocked step names the field that would unblock it; clicking it should
  // put the cursor there rather than leaving the operator to find it.
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
        subtitle="ArduPilot Methodic Configurator's configuration sequence, evaluated here. Read-only — nothing on this screen writes to the vehicle."
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
            <dt>Blocked</dt>
            <dd>{summary.totalFailures}</dd>
          </div>
        </dl>
        )}
      </Panel>

      <Panel
        title="Declare the vehicle"
        subtitle={`${declaredCount} of ${fields.length} fields. This list is derived from the sequence itself, so it is exactly what these steps read — nothing more.`}
      >
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
          {groupFields(fields).map(([component, group]) => (
            <fieldset key={component} className="amc-guided__component">
              <legend>{component}</legend>
              {group.map((field) => (
                <label key={field.key} className="amc-guided__field">
                  <span title={`${field.uses} expression${field.uses === 1 ? '' : 's'} read this`}>{field.label}</span>
                  <input
                    id={fieldInputId(field.key)}
                    value={values[field.key] ?? ''}
                    placeholder={field.group}
                    onChange={(event) =>
                      setValues((previous) => ({ ...previous, [field.key]: event.target.value }))
                    }
                  />
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <div className="button-row">
          <button style={buttonStyle()} onClick={() => setValues({})}>
            Clear
          </button>
        </div>
      </Panel>

      <Panel title="The sequence" subtitle="Each step, and the parameters it would set for this vehicle.">
        <div className="amc-guided__steps">
          {(summary?.rows ?? []).map((row) => (
            <StepCard key={row.filename} row={row} connected={connected} onDeclareField={focusField} />
          ))}
        </div>
      </Panel>
    </div>
  )
}
