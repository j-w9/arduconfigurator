import { useState } from 'react'

import { buttonStyle } from '@arduconfig/ui-kit'

import {
  DEFAULT_TAKEOFF_ALTITUDE_M,
  DESCEND_MODE,
  canTakeOff,
  flightModesFor,
  modeLabel,
  takeOffSequence
} from '../view-models/sitl-flight'

export interface SitlFlightProps {
  /** Which simulated vehicle is running — `copter`, `plane`. */
  vehicleId: string
  /** Off while the link is down; there is nothing to command. */
  live: boolean
  armed: boolean
  /** The vehicle's own mode number, from its heartbeat. */
  customMode?: number
  onSetMode: (customMode: number) => Promise<void>
  onArm: (arm: boolean) => Promise<void>
  onTakeOff: (altitudeMetres: number) => Promise<void>
}

/**
 * Arm, mode and takeoff, for the simulated vehicle only.
 *
 * The runtime refuses all three unless the vehicle is running in this tab, so
 * this panel cannot be the thing that keeps them safe — it is only the thing
 * that makes them reachable.
 */
export function SitlFlight({
  vehicleId,
  live,
  armed,
  customMode,
  onSetMode,
  onArm,
  onTakeOff
}: SitlFlightProps) {
  const modes = flightModesFor(vehicleId)
  const [altitude, setAltitude] = useState(DEFAULT_TAKEOFF_ALTITUDE_M)
  const [busy, setBusy] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  if (!live || modes.length === 0) return null

  const run = async (what: string, work: () => Promise<void>) => {
    setBusy(what)
    setError(undefined)
    try {
      await work()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(undefined)
    }
  }

  const takeOff = () =>
    run('takeoff', async () => {
      // Three commands, in an order Copter will not accept any other way.
      for (const step of takeOffSequence(vehicleId, altitude)) {
        if (step.kind === 'mode') await onSetMode(step.value)
        if (step.kind === 'arm') await onArm(true)
        if (step.kind === 'takeoff') await onTakeOff(step.altitudeMetres)
      }
    })

  const descend = DESCEND_MODE[vehicleId]

  return (
    <section className="sitl-flight" aria-label="Flight">
      <div className="sitl-flight__row">
        <label htmlFor="sitl-mode" className="sitl-flight__label">
          Mode
        </label>
        <select
          id="sitl-mode"
          value={modes.some((mode) => mode.value === customMode) ? customMode : ''}
          disabled={busy !== undefined}
          onChange={(event) => void run('mode', () => onSetMode(Number(event.target.value)))}
        >
          {/* The vehicle can be in a mode this short list does not carry.
              Showing its real name beats showing the first entry as if it
              were selected. */}
          {!modes.some((mode) => mode.value === customMode) ? (
            <option value="">{modeLabel(vehicleId, customMode)}</option>
          ) : null}
          {modes.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>

        <button
          style={buttonStyle()}
          disabled={busy !== undefined}
          onClick={() => void run('arm', () => onArm(!armed))}
          title={armed ? 'Stop the motors' : 'Arm the motors. Pre-arm checks still apply.'}
        >
          {armed ? 'Disarm' : 'Arm'}
        </button>

        {canTakeOff(vehicleId) ? (
          <>
            <button
              style={buttonStyle('primary')}
              disabled={busy !== undefined || armed}
              onClick={() => void takeOff()}
              title={
                armed
                  ? 'Already armed — set Guided and climb from the mode picker'
                  : 'Guided, arm, then climb'
              }
            >
              {busy === 'takeoff' ? 'Taking off…' : 'Take off'}
            </button>
            <label htmlFor="sitl-takeoff-alt" className="sitl-flight__label">
              to
            </label>
            <input
              id="sitl-takeoff-alt"
              type="number"
              min={1}
              max={120}
              value={altitude}
              disabled={busy !== undefined}
              onChange={(event) => setAltitude(Number(event.target.value))}
            />
            <span className="sitl-flight__unit">m</span>
          </>
        ) : null}

        {descend !== undefined ? (
          <button
            style={buttonStyle()}
            disabled={busy !== undefined || !armed}
            onClick={() => void run('descend', () => onSetMode(descend))}
            title="Bring it back down"
          >
            {modeLabel(vehicleId, descend)}
          </button>
        ) : null}

        <span className={`sitl-flight__state${armed ? ' sitl-flight__state--armed' : ''}`}>
          {armed ? 'armed' : 'disarmed'} · {modeLabel(vehicleId, customMode)}
        </span>
      </div>

      {error ? <p className="sitl-flight__error">{error}</p> : null}
    </section>
  )
}
