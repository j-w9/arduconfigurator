import { useEffect, useState } from 'react'

import { buttonStyle } from '@arduconfig/ui-kit'

import {
  activeFaultCount,
  availableGroups,
  formatControlValue,
  healthyWrites,
  switchIsOn,
  switchValue,
  type SimControl
} from '../view-models/sitl-conditions'

export interface SitlConditionsProps {
  /** The connected vehicle's live parameters. */
  parameters: Readonly<Record<string, number>>
  /** Write one simulator parameter and wait for the vehicle to confirm it. */
  onSet: (writes: readonly { parameter: string; value: number }[]) => Promise<void>
  /** Off while the link is down — there is nothing to drive. */
  live: boolean
}

/**
 * The controls a simulator has and a real vehicle does not: time, weather,
 * and a way to break things on purpose.
 *
 * Every one of these is a `SIM_*` parameter on the running vehicle, so this
 * panel is an ordinary parameter editor with a nicer face on it — no second
 * channel, and the same verified write as everywhere else in the app.
 */
export function SitlConditions({ parameters, onSet, live }: SitlConditionsProps) {
  const groups = availableGroups(parameters)
  const faults = activeFaultCount(groups, parameters)
  const toClear = healthyWrites(groups, parameters)
  const [busy, setBusy] = useState(false)

  // While a slider is under the pointer its position is local: writing on
  // every animation frame of a drag would flood the link and fight the
  // read-back for control of the handle. The write happens on release.
  const [dragging, setDragging] = useState<Record<string, number>>({})

  // A value that arrives from the vehicle while nothing is being dragged is
  // the truth; drop any stale local position so the handle follows it.
  useEffect(() => {
    if (!live) setDragging({})
  }, [live])

  if (!live || groups.length === 0) return null

  const write = async (writes: readonly { parameter: string; value: number }[]) => {
    if (writes.length === 0) return
    setBusy(true)
    try {
      await onSet(writes)
    } finally {
      setBusy(false)
    }
  }

  const valueOf = (control: SimControl) =>
    dragging[control.parameter] ?? parameters[control.parameter]

  const renderControl = (control: SimControl) => {
    const value = valueOf(control)
    const id = `sim-${control.parameter}`

    if (control.kind === 'switch') {
      const on = switchIsOn(control, parameters[control.parameter])
      return (
        <div className="sim-control sim-control--switch" key={control.parameter}>
          <input
            id={id}
            type="checkbox"
            checked={on}
            disabled={busy}
            onChange={(event) => {
              void write([
                { parameter: control.parameter, value: switchValue(control, event.target.checked) }
              ])
            }}
          />
          <label htmlFor={id}>
            <span className="sim-control__label">{control.label}</span>
            <span className="sim-control__hint">{control.hint}</span>
          </label>
        </div>
      )
    }

    if (control.kind === 'choice') {
      return (
        <div className="sim-control sim-control--choice" key={control.parameter}>
          <label htmlFor={id} className="sim-control__label">
            {control.label}
          </label>
          <select
            id={id}
            value={value ?? control.choices?.[0]?.value ?? 0}
            disabled={busy}
            onChange={(event) => {
              void write([{ parameter: control.parameter, value: Number(event.target.value) }])
            }}
          >
            {control.choices?.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
          <p className="sim-control__hint">{control.hint}</p>
        </div>
      )
    }

    return (
      <div className="sim-control sim-control--slider" key={control.parameter}>
        <label htmlFor={id} className="sim-control__label">
          {control.label}
        </label>
        <output className="sim-control__value" htmlFor={id}>
          {formatControlValue(control, value)}
        </output>
        <input
          id={id}
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={value ?? control.min ?? 0}
          disabled={busy}
          onChange={(event) =>
            setDragging((current) => ({ ...current, [control.parameter]: Number(event.target.value) }))
          }
          // Commit on release rather than on movement: one write per gesture,
          // not one per frame.
          onPointerUp={() => {
            const next = dragging[control.parameter]
            setDragging((current) => {
              const { [control.parameter]: _done, ...rest } = current
              return rest
            })
            if (next !== undefined && next !== parameters[control.parameter]) {
              void write([{ parameter: control.parameter, value: next }])
            }
          }}
          onKeyUp={() => {
            const next = dragging[control.parameter]
            setDragging((current) => {
              const { [control.parameter]: _done, ...rest } = current
              return rest
            })
            if (next !== undefined && next !== parameters[control.parameter]) {
              void write([{ parameter: control.parameter, value: next }])
            }
          }}
        />
        <p className="sim-control__hint">{control.hint}</p>
      </div>
    )
  }

  return (
    <section className="sim-conditions" aria-label="Simulator conditions">
      {groups.map((group) => (
        <div className="sim-group" key={group.id}>
          <div className="sim-group__head">
            <h3>{group.title}</h3>
            {group.id === 'faults' && faults > 0 ? (
              <span className="sim-group__count">
                {faults} active
              </span>
            ) : null}
            {group.id === 'faults' ? (
              <button
                style={buttonStyle()}
                disabled={busy || toClear.length === 0}
                title={
                  toClear.length === 0
                    ? 'Nothing is broken'
                    : `Put ${toClear.length} setting${toClear.length === 1 ? '' : 's'} back`
                }
                onClick={() => void write(toClear)}
              >
                Clear faults
              </button>
            ) : null}
          </div>
          <p className="sim-group__blurb">{group.blurb}</p>
          <div className="sim-group__controls">{group.controls.map(renderControl)}</div>
        </div>
      ))}
    </section>
  )
}
