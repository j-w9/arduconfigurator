/**
 * Launching ArduPilot SITL in the browser.
 *
 * The vehicle firmware is a WebAssembly module served from this origin, so
 * "starting a simulation" is loading a 3.4 MB file and handing it a command
 * line. Everything here is that command line and the choices behind it; the
 * transport (WasmSitlTransport) does the running.
 *
 * The frames and locations are extracted from the same ArduPilot checkout that
 * produced the binaries (scripts/build-sitl-wasm.sh), not typed out here — a
 * hand-written list is one that silently stops matching upstream.
 */

export interface SimLocation {
  readonly lat: number
  readonly lon: number
  readonly alt: number
  readonly heading: number
}

export interface SimOptions {
  /** Frames each built vehicle offers, keyed `copter`, `plane`, … */
  readonly frames: Readonly<Record<string, readonly string[]>>
  readonly locations: Readonly<Record<string, SimLocation>>
}

export interface SimVehicle {
  /** `copter`, as the binary is named `arducopter.wasm`. */
  readonly id: string
  readonly label: string
  /** The frame SITL uses when the operator has not chosen one. */
  readonly defaultFrame: string
}

/**
 * The vehicles this tab can run, in the order worth offering them.
 *
 * Only those with a built binary appear — `availableVehicles` filters against
 * what the options file actually describes, so a vehicle nobody compiled is
 * not a dead entry in the picker.
 */
export const SIM_VEHICLES: readonly SimVehicle[] = [
  { id: 'copter', label: 'Copter', defaultFrame: 'X' },
  { id: 'plane', label: 'Plane', defaultFrame: 'plane' },
  { id: 'rover', label: 'Rover', defaultFrame: 'rover' },
  { id: 'heli', label: 'Heli', defaultFrame: 'heli' }
]

/** AMC's own default home, and SITL's: Canberra Model Aircraft Club. */
export const DEFAULT_LOCATION = 'CMAC'

export function availableVehicles(options: SimOptions | undefined): readonly SimVehicle[] {
  if (!options) return []
  return SIM_VEHICLES.filter((vehicle) => (options.frames[vehicle.id]?.length ?? 0) > 0)
}

/**
 * The frames for a vehicle, with the sensible default first.
 *
 * SITL lists them alphabetically, which puts `+` and `airsim-copter` ahead of
 * `X` — the frame almost everyone wants. The default is lifted to the front
 * rather than the list being reordered wholesale, so the rest stays in the
 * order upstream gives.
 */
export function framesFor(options: SimOptions | undefined, vehicleId: string): readonly string[] {
  const frames = options?.frames[vehicleId] ?? []
  const vehicle = SIM_VEHICLES.find((entry) => entry.id === vehicleId)
  const preferred = vehicle?.defaultFrame
  if (!preferred || !frames.includes(preferred)) return frames
  return [preferred, ...frames.filter((frame) => frame !== preferred)]
}

/** Location names, with the default first and the rest alphabetical. */
export function locationNames(options: SimOptions | undefined): readonly string[] {
  const names = Object.keys(options?.locations ?? {}).sort()
  if (!names.includes(DEFAULT_LOCATION)) return names
  return [DEFAULT_LOCATION, ...names.filter((name) => name !== DEFAULT_LOCATION)]
}

export interface SimLaunch {
  readonly vehicle: string
  readonly frame: string
  /** A name from `locations`, or undefined to let SITL pick its own home. */
  readonly location?: string
  /** How much faster than real time. SITL's own default is 1. */
  readonly speedup?: number
  /** Start from the firmware's defaults rather than any stored parameters. */
  readonly wipe?: boolean
}

/**
 * The command line for a launch.
 *
 * `--serial0 wasm` is deliberately absent: the transport prepends it, because
 * a caller who forgets it gets a vehicle that boots into silence, and there is
 * no reason for every call site to have to remember.
 *
 * SERIAL1 and SERIAL2 are turned off explicitly. SITL would otherwise try to
 * open them as sockets, which in a browser is a handful of failures on the way
 * up for ports nothing here reads.
 */
export function launchArguments(launch: SimLaunch, options?: SimOptions): readonly string[] {
  const args = ['--model', launch.frame, '--serial1', 'none', '--serial2', 'none']

  const home = launch.location ? options?.locations[launch.location] : undefined
  if (home) {
    // SITL takes home as lat,lon,alt,heading -- the same four fields
    // locations.txt holds, in that order.
    args.push('--home', `${home.lat},${home.lon},${home.alt},${home.heading}`)
  }

  // Only when asked for: passing --speedup 1 is not the same as passing
  // nothing, and the round trip through the UI should not change the vehicle.
  if (launch.speedup !== undefined && launch.speedup !== 1) {
    args.push('--speedup', String(launch.speedup))
  }
  if (launch.wipe) args.push('--wipe')

  return args
}

/** Where the built module for a vehicle is served from. */
export function moduleUrlFor(vehicleId: string, base = '/sitl'): string {
  return `${base}/ardu${vehicleId}.js`
}

/**
 * Emscripten's own progress chatter, which is not about the vehicle.
 *
 * While the worker pool starts, the runtime prints its dependency list every
 * few hundred milliseconds -- "still waiting on run dependencies", the
 * dependency itself, "(end of list)" -- so a console that shows everything
 * fills with a repeating three-line stanza and reads as a hang. It is progress
 * information, and belongs in a status line rather than a log.
 */
const RUNTIME_CHATTER = /^(still waiting on run dependencies|dependency:|\(end of list\))/

/**
 * Whether a line of SITL's console output is worth showing.
 *
 * SITL is chatty on the way up and most of it is noise for someone who only
 * wants to know whether the vehicle is alive. The lines kept are the ones that
 * say what it is doing or what went wrong.
 */
export function isInterestingOutput(line: string): boolean {
  const text = line.trim()
  if (text.length === 0) return false
  if (/^Skipping port/.test(text)) return false
  if (RUNTIME_CHATTER.test(text)) return false
  return true
}

/**
 * What the simulator is doing, for someone watching it start.
 *
 * Derived from the output rather than tracked as state, because the module is
 * the only thing that knows where it has got to -- and the chatter that makes
 * the console unreadable is exactly what says which stage it is in.
 *
 * `undefined` once there is nothing left to report, which is the caller's cue
 * to stop showing a status and start showing the vehicle.
 */
export function loadingStatus(output: readonly string[], heartbeat: boolean): string | undefined {
  if (heartbeat) return undefined

  // Newest first: the last thing said is the stage it reached.
  for (let i = output.length - 1; i >= 0; i -= 1) {
    const text = (output[i] ?? '').trim()
    if (/dependency: loading-workers/.test(text)) return 'Starting worker threads'
    if (/^dependency:/.test(text)) return 'Preparing the runtime'
    if (/Loaded defaults from/.test(text)) return 'Booting the vehicle'
    if (/^Waiting for internal clock/.test(text)) return 'Waiting for the simulated clock'
  }

  // Output arrives only once the module is instantiating, so silence this
  // early means the 3.4 MB is still on its way down.
  return output.length === 0 ? 'Fetching ArduPilot' : 'Starting the vehicle'
}
