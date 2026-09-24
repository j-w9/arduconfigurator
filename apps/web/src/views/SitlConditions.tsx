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
  // Only the bulk "clear faults" action takes a busy state. The individual
  // controls deliberately do NOT: a verified write takes about a second, and
  // disabling them for it meant every keypress in that second was dropped --
  // so a slider could not be stepped with the arrow keys at all, and a flag
  // set by one control froze all the others.
  const [busy, setBusy] = useState(false)

  // A slider's position is local from the first movement until the vehicle
  // confirms it. Two reasons: writing on every frame of a drag would flood
  // the link, and a handle that springs back to the old value for the second
  // it takes the write to land cannot be stepped with the arrow keys at all
  // -- each press would start again from the value the vehicle still holds.
  const [local, setLocal] = useState<Record<string, number>>({})

  // Let go of a local position once the vehicle agrees with it, and of all of
  // them when the link drops. From then on the vehicle is the truth again.
  useEffect(() => {
    setLocal((current) => {
      if (!live) return Object.keys(current).length === 0 ? current : {}
      const next = Object.fromEntries(
        Object.entries(current).filter(([parameter, value]) => parameters[parameter] !== value)
      )
      return Object.keys(next).length === Object.keys(current).length ? current : next
    })
  }, [live, parameters])

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

  const commit = (control: SimControl) => {
    const next = local[control.parameter]
    if (next === undefined || next === parameters[control.parameter]) return
    void write([{ parameter: control.parameter, value: next }])
  }

  const valueOf = (control: SimControl) =>
    local[control.parameter] ?? parameters[control.parameter]

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
          onChange={(event) =>
            setLocal((current) => ({ ...current, [control.parameter]: Number(event.target.value) }))
          }
          // Commit when the gesture ends, not while it is happening: one
          // write per drag or per keypress, never one per frame. The local
          // position stays put until the vehicle confirms it.
          onPointerUp={() => commit(control)}
          onKeyUp={() => commit(control)}
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
