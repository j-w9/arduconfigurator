// ArduPilot SITL, running in this tab.
//
// The vehicle firmware is a WebAssembly module served from this origin: no
// process, no socket, no bridge, nothing installed. Choosing a vehicle and
// pressing Fly loads compiled ArduPilot, hands it a command line, and connects
// the app to it exactly as it would to a board on USB.
//
// Laid out as a flight progress strip — the compact row air traffic control
// keeps per aircraft, carrying identity, route and status. It is a form while
// nothing is flying and a readout once something is, because that change is
// the whole point of the feature: the aircraft is HERE, not on a bench.
//
// Presentational: the launch options are computed in view-models/sitl-sim.ts
// and the running is done by WasmSitlTransport.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { buttonStyle } from '@arduconfig/ui-kit'

import { MapLocationPicker } from './MapLocationPicker'
import { SitlConditions } from './SitlConditions'
import {
  CUSTOM_LOCATION,
  DEFAULT_LOCATION,
  type SimOptions,
  availableVehicles,
  framesFor,
  isInterestingOutput,
  launchArguments,
  loadingStatus,
  locationNames,
  moduleUrlFor
} from '../view-models/sitl-sim'

export type SitlPhase = 'idle' | 'loading' | 'running' | 'error'

export interface SitlSimViewProps {
  /**
   * The connected vehicle's live parameters, which for a simulator include
   * the several hundred `SIM_*` ones the conditions panel drives.
   */
  parameters?: Readonly<Record<string, number>>
  /** Write simulator parameters and wait for the vehicle to confirm them. */
  onSetConditions?: (writes: readonly { parameter: string; value: number }[]) => Promise<void>
  onStart: (vehicle: string, args: readonly string[], moduleUrl: string) => Promise<void>
  onStop: () => Promise<void>
  phase: SitlPhase
  output: readonly string[]
  /** Set once MAVLink has arrived — the vehicle is alive, not merely loaded. */
  heartbeat: boolean
  error?: string
  base?: string
}

/** How much of SITL's console to keep. It is chatty and this is a diagnostic. */
const OUTPUT_LIMIT = 200

export function SitlSimView(props: SitlSimViewProps) {
  const { onStart, onStop, phase, output, heartbeat, error, base, parameters, onSetConditions } = props

  const [options, setOptions] = useState<SimOptions | undefined>(undefined)
  const [optionsError, setOptionsError] = useState<string | undefined>(undefined)
  const [vehicle, setVehicle] = useState('copter')
  const [frame, setFrame] = useState<string | undefined>(undefined)
  const [location, setLocation] = useState(DEFAULT_LOCATION)
  const [speedup, setSpeedup] = useState(1)
  const [wipe, setWipe] = useState(false)
  const [customHome, setCustomHome] = useState<{ lat: number; lon: number } | undefined>(undefined)

  const [buildPath, setBuildPath] = useState<string | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    fetch(`${base ?? '/sitl'}/build.json`)
      .then((response) => (response.ok ? (response.json() as Promise<{ build: string }>) : undefined))
      .then((info) => {
        if (cancelled) return
        setBuildPath(info?.build ? `${base ?? '/sitl'}/${info.build}` : (base ?? '/sitl'))
      })
      .catch(() => {
        if (!cancelled) setBuildPath(base ?? '/sitl')
      })
    return () => {
      cancelled = true
    }
  }, [base])

  useEffect(() => {
    if (!buildPath) return
    let cancelled = false
    fetch(`${buildPath}/sim-options.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status}`)
        return response.json() as Promise<SimOptions>
      })
      .then((loaded) => {
        if (!cancelled) setOptions(loaded)
      })
      .catch(() => {
        if (!cancelled) setOptionsError('No simulator was built into this site.')
      })
    return () => {
      cancelled = true
    }
  }, [buildPath])

  const vehicles = useMemo(() => availableVehicles(options), [options])
  const frames = useMemo(() => framesFor(options, vehicle), [options, vehicle])
  const locations = useMemo(() => locationNames(options), [options])

  useEffect(() => {
    setFrame(undefined)
  }, [vehicle])
  const chosenFrame = frame ?? frames[0]

  useEffect(() => {
    if (vehicles.length > 0 && !vehicles.some((entry) => entry.id === vehicle)) {
      setVehicle(vehicles[0]?.id ?? 'copter')
    }
  }, [vehicles, vehicle])

  const running = phase === 'running'
  const busy = phase === 'loading'
  const live = running && heartbeat
  const status = running || busy ? loadingStatus(output, heartbeat) : undefined

  // How long it has been flying. The one number worth watching once it is up,
  // and the thing that makes a simulated vehicle feel like a running one.
  const [airborneMs, setAirborneMs] = useState(0)
  useEffect(() => {
    if (!live) {
      setAirborneMs(0)
      return
    }
    const started = Date.now()
    const timer = setInterval(() => setAirborneMs(Date.now() - started), 200)
    return () => clearInterval(timer)
  }, [live])

  const home = useMemo(() => {
    if (location === CUSTOM_LOCATION) {
      return customHome ? { lat: customHome.lat, lon: customHome.lon, alt: 0, heading: 0 } : undefined
    }
    return options?.locations[location]
  }, [location, customHome, options])

  const start = useCallback(async () => {
    if (!chosenFrame) return
    await onStart(
      vehicle,
      launchArguments(
        {
          vehicle,
          frame: chosenFrame,
          location,
          speedup,
          wipe,
          ...(location === CUSTOM_LOCATION && customHome ? { customHome } : {})
        },
        options
      ),
      moduleUrlFor(vehicle, buildPath)
    )
  }, [onStart, vehicle, chosenFrame, location, speedup, wipe, customHome, options, buildPath])

  const visible = output.filter(isInterestingOutput).slice(-OUTPUT_LIMIT)
  const consoleRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const element = consoleRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [visible.length])

  const vehicleLabel = vehicles.find((entry) => entry.id === vehicle)?.label ?? vehicle
  const canFly = !busy && vehicles.length > 0 && !!chosenFrame && !(location === CUSTOM_LOCATION && !customHome)

  if (optionsError) {
    return (
      <div className="sitl">
        <p className="sitl__absent">
          {optionsError} Run <code>npm run sitl:build</code> to compile ArduPilot for the browser,
          then rebuild the site.
        </p>
      </div>
    )
  }

  return (
    <div className="sitl">
      <header className="sitl__intro">
        <h2>Fly a vehicle here</h2>
        <p>
          ArduPilot compiled to WebAssembly, running in this tab. Nothing to install, and nothing
          leaves the browser. Configure it like any other vehicle.
        </p>
      </header>

      {/* The strip. A form while nothing is flying, a readout once something
          is — same shape either way, so the transition reads as one object
          changing state rather than two screens. */}
      <div className={`strip${live ? ' strip--live' : ''}${busy ? ' strip--busy' : ''}`}>
        <div className="strip__craft">
          {live ? (
            <>
              <span className="strip__mark" aria-hidden="true" />
              <span className="strip__ident">
                {vehicleLabel} {chosenFrame}
              </span>
              <span className="strip__sub">
                airborne <time>{(airborneMs / 1000).toFixed(1)}s</time>
              </span>
            </>
          ) : (
            <>
              <div className="strip__picks">
                <select
                  id="sitl-vehicle"
                  name="sitl-vehicle"
                  aria-label="Vehicle"
                  value={vehicle}
                  disabled={busy}
                  onChange={(event) => setVehicle(event.target.value)}
                >
                  {vehicles.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
                <select
                  id="sitl-frame"
                  name="sitl-frame"
                  aria-label="Frame"
                  value={chosenFrame ?? ''}
                  disabled={busy}
                  onChange={(event) => setFrame(event.target.value)}
                >
                  {frames.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </div>
              <span className="strip__sub">airframe</span>
            </>
          )}
        </div>

        <div className="strip__home">
          {live ? (
            <span className="strip__ident">{location === CUSTOM_LOCATION ? 'Picked' : location}</span>
          ) : (
            <select
              id="sitl-home"
              name="sitl-home"
              aria-label="Home location"
              value={location}
              disabled={busy}
              onChange={(event) => setLocation(event.target.value)}
            >
              <option value={CUSTOM_LOCATION}>{CUSTOM_LOCATION}</option>
              {locations.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          )}
          {home ? (
            <span className="strip__coords">
              {home.lat.toFixed(6)}, {home.lon.toFixed(6)}
            </span>
          ) : (
            <span className="strip__sub">choose a point on the map</span>
          )}
        </div>

        <div className="strip__rate">
          {live ? (
            <span className="strip__ident">{speedup}×</span>
          ) : (
            <select
              id="sitl-speed"
              name="sitl-speed"
              aria-label="Simulation speed"
              value={speedup}
              disabled={busy}
              onChange={(event) => setSpeedup(Number(event.target.value))}
            >
              {[1, 2, 5, 10].map((entry) => (
                <option key={entry} value={entry}>
                  {entry}×
                </option>
              ))}
            </select>
          )}
          <span className="strip__sub">{live ? 'real time' : 'speed'}</span>
        </div>

        <div className="strip__act">
          {running || busy ? (
            <button style={buttonStyle()} onClick={() => void onStop()} disabled={busy && !running}>
              Land
            </button>
          ) : (
            <button style={buttonStyle('primary')} disabled={!canFly} onClick={() => void start()}>
              Fly
            </button>
          )}
        </div>
      </div>

      {status ? (
        <p className="sitl__status" role="status">
          <span className="sitl__spinner" aria-hidden="true" />
          {status}…
        </p>
      ) : null}

      {error ? <p className="sitl__error">{error}</p> : null}

      {location === CUSTOM_LOCATION && !live ? (
        <div className="sitl__map">
          <MapLocationPicker
            latitude={customHome?.lat ?? options?.locations[DEFAULT_LOCATION]?.lat}
            longitude={customHome?.lon ?? options?.locations[DEFAULT_LOCATION]?.lon}
            onPick={(lat, lon) => setCustomHome({ lat, lon })}
            heightPx={260}
          />
        </div>
      ) : null}

      {!live ? (
        <label className="sitl__wipe">
          <input
            type="checkbox"
            checked={wipe}
            disabled={busy}
            onChange={(event) => setWipe(event.target.checked)}
          />
          <span>
            {/* A simulated vehicle keeps its parameters between runs, which is
                usually wanted and occasionally exactly what is confusing you. */}
            Start from the firmware&apos;s own defaults, discarding anything set before
          </span>
        </label>
      ) : null}

      {parameters && onSetConditions ? (
        <SitlConditions parameters={parameters} onSet={onSetConditions} live={heartbeat} />
      ) : null}

      {visible.length > 0 ? (
        <details className="sitl__log">
          <summary>Everything ArduPilot printed on the way up</summary>
          <pre ref={consoleRef}>{visible.join('\n')}</pre>
        </details>
      ) : null}
    </div>
  )
}
