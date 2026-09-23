// ArduPilot SITL, running in this tab.
//
// The vehicle firmware is a WebAssembly module served from this origin: no
// process, no socket, no bridge, nothing installed. Choosing a vehicle and
// pressing Start loads 3.4 MB of compiled ArduPilot, hands it a command line,
// and connects the app to it exactly as it would to a board on USB.
//
// Presentational: the launch options are computed in view-models/sitl-sim.ts
// and the running is done by WasmSitlTransport, so what is here is the picker,
// the console, and the decision about when a vehicle counts as alive.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Panel, StatusBadge, buttonStyle } from '@arduconfig/ui-kit'

import { MapLocationPicker } from './MapLocationPicker'
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
  /** Start a simulation. Resolves once the module is loaded and polling. */
  onStart: (vehicle: string, args: readonly string[], moduleUrl: string) => Promise<void>
  onStop: () => Promise<void>
  phase: SitlPhase
  /** Console output from SITL itself, oldest first. */
  output: readonly string[]
  /** Set once MAVLink has actually arrived — the vehicle is alive, not just loaded. */
  heartbeat: boolean
  error?: string
  /** Where the built modules are served from; '/sitl' unless the site moved. */
  base?: string
}

/** How much of SITL's console to keep. It is chatty and this is a diagnostic. */
const OUTPUT_LIMIT = 200

export function SitlSimView(props: SitlSimViewProps) {
  const { onStart, onStop, phase, output, heartbeat, error, base } = props

  const [options, setOptions] = useState<SimOptions | undefined>(undefined)
  const [optionsError, setOptionsError] = useState<string | undefined>(undefined)
  const [vehicle, setVehicle] = useState('copter')
  const [frame, setFrame] = useState<string | undefined>(undefined)
  const [location, setLocation] = useState(DEFAULT_LOCATION)
  const [speedup, setSpeedup] = useState(1)
  const [wipe, setWipe] = useState(false)
  const [customHome, setCustomHome] = useState<{ lat: number; lon: number } | undefined>(undefined)

  // The options file ships beside the binaries and is tiny, but it is fetched
  // rather than bundled: a site built without ever running the SITL build has
  // no sitl/ directory at all, and the tab should say so rather than fail.
  useEffect(() => {
    let cancelled = false
    fetch(`${base ?? '/sitl'}/sim-options.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`${response.status}`)
        return response.json() as Promise<SimOptions>
      })
      .then((loaded) => {
        if (!cancelled) setOptions(loaded)
      })
      .catch(() => {
        if (!cancelled) {
          setOptionsError('No simulator was built into this site.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [base])

  const vehicles = useMemo(() => availableVehicles(options), [options])
  const frames = useMemo(() => framesFor(options, vehicle), [options, vehicle])
  const locations = useMemo(() => locationNames(options), [options])

  // The frame follows the vehicle: a Copter frame means nothing to Plane, and
  // keeping a stale one would hand SITL a model it cannot build.
  useEffect(() => {
    setFrame(undefined)
  }, [vehicle])
  const chosenFrame = frame ?? frames[0]

  // Pick the first vehicle that was actually built, once the options arrive.
  useEffect(() => {
    if (vehicles.length > 0 && !vehicles.some((entry) => entry.id === vehicle)) {
      setVehicle(vehicles[0]?.id ?? 'copter')
    }
  }, [vehicles, vehicle])

  const consoleRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    // Follow the tail: the interesting line is almost always the newest.
    const element = consoleRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [output])

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
      moduleUrlFor(vehicle, base)
    )
  }, [onStart, vehicle, chosenFrame, location, speedup, wipe, customHome, options, base])

  const running = phase === 'running'
  const busy = phase === 'loading'
  const visible = output.filter(isInterestingOutput).slice(-OUTPUT_LIMIT)
  // Only while it is coming up: once there is a heartbeat the badge says so,
  // and once it is stopped there is nothing to report.
  const status = running || busy ? loadingStatus(output, heartbeat) : undefined

  return (
    <div className="sitl-sim">
      <Panel
        title="Simulated vehicle"
        subtitle="ArduPilot compiled to WebAssembly, running in this tab. Nothing to install, and nothing leaves the browser."
      >
        {optionsError ? (
          <p className="sitl-sim__missing">
            {optionsError} Run <code>npm run sitl:build</code> to compile ArduPilot for the browser,
            then rebuild the site.
          </p>
        ) : (
          <>
            <div className="sitl-sim__controls">
              <label htmlFor="sitl-vehicle">
                <span>Vehicle</span>
                <select
                  id="sitl-vehicle"
                  name="sitl-vehicle"
                  value={vehicle}
                  disabled={running || busy}
                  onChange={(event) => setVehicle(event.target.value)}
                >
                  {vehicles.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>

              <label htmlFor="sitl-frame">
                <span>Frame</span>
                <select
                  id="sitl-frame"
                  name="sitl-frame"
                  value={chosenFrame ?? ''}
                  disabled={running || busy}
                  onChange={(event) => setFrame(event.target.value)}
                >
                  {frames.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>

              <label htmlFor="sitl-home">
                <span>Home</span>
                <select
                  id="sitl-home"
                  name="sitl-home"
                  value={location}
                  disabled={running || busy}
                  onChange={(event) => setLocation(event.target.value)}
                >
                  {/* SITL's own 117 named places, plus anywhere at all. */}
                  <option value={CUSTOM_LOCATION}>{CUSTOM_LOCATION}</option>
                  {locations.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </select>
              </label>

              <label htmlFor="sitl-speed">
                <span>Speed</span>
                <select
                  id="sitl-speed"
                  name="sitl-speed"
                  value={speedup}
                  disabled={running || busy}
                  onChange={(event) => setSpeedup(Number(event.target.value))}
                >
                  {[1, 2, 5, 10].map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}×
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {location === CUSTOM_LOCATION ? (
              <div className="sitl-sim__map">
                <MapLocationPicker
                  latitude={customHome?.lat ?? options?.locations[DEFAULT_LOCATION]?.lat}
                  longitude={customHome?.lon ?? options?.locations[DEFAULT_LOCATION]?.lon}
                  onPick={(lat, lon) => setCustomHome({ lat, lon })}
                  heightPx={260}
                />
                <p className="sitl-sim__map-note">
                  {customHome
                    ? `Home at ${customHome.lat.toFixed(6)}, ${customHome.lon.toFixed(6)} — sea level, facing north.`
                    : 'Click anywhere to put the vehicle there.'}
                </p>
              </div>
            ) : null}

            <label className="sitl-sim__wipe">
              <input
                type="checkbox"
                checked={wipe}
                disabled={running || busy}
                onChange={(event) => setWipe(event.target.checked)}
              />
              <span>
                {/* Worth an explicit choice: a simulated vehicle keeps its
                    parameters between runs, which is usually what you want
                    and occasionally exactly what is confusing you. */}
                Start from the firmware&apos;s own defaults, discarding anything set before
              </span>
            </label>

            <div className="sitl-sim__actions">
              {running ? (
                <button style={buttonStyle()} onClick={() => void onStop()}>
                  Stop the simulator
                </button>
              ) : (
                <button
                  style={buttonStyle('primary')}
                  disabled={
                    busy ||
                    vehicles.length === 0 ||
                    !chosenFrame ||
                    // Nothing to start at: the map is chosen but unclicked.
                    (location === CUSTOM_LOCATION && !customHome)
                  }
                  onClick={() => void start()}
                >
                  {busy ? 'Loading ArduPilot…' : 'Start the simulator'}
                </button>
              )}

              {running && heartbeat ? (
                <StatusBadge tone="success">Vehicle is alive</StatusBadge>
              ) : status ? (
                // Loaded is not alive. Until a heartbeat arrives the module is
                // running but has said nothing, and saying "connected" then
                // would be a claim about a vehicle nobody has heard from.
                //
                // The stage comes from the module's own chatter, which is the
                // only thing that knows where it has got to. Without it the
                // start is a frozen button for ten seconds.
                <span className="sitl-sim__status" role="status">
                  <span className="sitl-sim__spinner" aria-hidden="true" />
                  {status}…
                </span>
              ) : null}

            </div>

            {error ? <p className="sitl-sim__error">{error}</p> : null}
          </>
        )}
      </Panel>

      {visible.length > 0 ? (
        <Panel
          title="What the vehicle is saying"
          subtitle="Everything ArduPilot printed on the way up."
        >
          <pre className="sitl-sim__console" ref={consoleRef}>
            {visible.join('\n')}
          </pre>
        </Panel>
      ) : null}
    </div>
  )
}
