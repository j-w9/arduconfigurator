// Functions available to graph expressions: Python's `math` module plus the
// helpers MAVExplorer graphs call from pymavlink's mavextra.py.
//
// Provenance: the mavextra functions are ported from pymavlink 2.4.49
// (https://github.com/ArduPilot/pymavlink, pymavlink/mavextra.py and the
// Matrix3 maths in rotmat.py), Copyright Andrew Tridgell, released under the
// GNU GPL v3 or later — compatible with this repository's GPL-3.0-only licence.
//
// Differences by design: stateful helpers (lowpass, diff, delta, ...) keep
// their state per term in `env.state` rather than in module globals, and
// vehicle parameters come from `env.param` rather than mavutil's global file.

import {
  DECLINATION_TABLE,
  INCLINATION_TABLE,
  INTENSITY_TABLE,
  SAMPLING_MAX_LAT,
  SAMPLING_MAX_LON,
  SAMPLING_MIN_LAT,
  SAMPLING_MIN_LON,
  SAMPLING_RES
} from './generated/mag-field-tables.js'
import type { EvalEnv, MessageRecord, Value, Vec3 } from './types.js'

export type ExpressionFunction = (args: readonly Value[], env: EvalEnv) => Value

const DEG = 180 / Math.PI
const RAD = Math.PI / 180

const degrees = (x: number) => x * DEG
const radians = (x: number) => x * RAD

/** One-argument numeric functions, compiled inline by the evaluator. */
export const MATH1: ReadonlyMap<string, (x: number) => number> = new Map<string, (x: number) => number>([
  ['degrees', degrees],
  ['radians', radians],
  ['sqrt', Math.sqrt],
  ['sin', Math.sin],
  ['cos', Math.cos],
  ['tan', Math.tan],
  ['asin', Math.asin],
  ['acos', Math.acos],
  ['atan', Math.atan],
  ['sinh', Math.sinh],
  ['cosh', Math.cosh],
  ['tanh', Math.tanh],
  ['exp', Math.exp],
  ['log10', Math.log10],
  ['log2', Math.log2],
  ['floor', Math.floor],
  ['ceil', Math.ceil],
  ['trunc', Math.trunc],
  ['fabs', Math.abs],
  ['abs', Math.abs],
  ['int', Math.trunc],
  ['float', (x) => x],
  ['isnan', (x) => (Number.isNaN(x) ? 1 : 0)],
  ['isinf', (x) => (x === Infinity || x === -Infinity ? 1 : 0)],
  ['kmh', (x) => x * 3.6],
  ['feet', (x) => x * 3.2808],
  ['knots', (x) => x * 1.94384449],
  ['wrap_180', wrap180],
  ['wrap_360', wrap360]
])

function wrap180(angle: number): number {
  if (angle > 180) angle -= 360
  if (angle < -180) angle += 360
  return angle
}

function wrap360(angle: number): number {
  if (angle > 360) angle -= 360
  if (angle < 0) angle += 360
  return angle
}

// --- helpers -----------------------------------------------------------------

function num(value: Value): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function nums(args: readonly Value[], count: number): number[] | undefined {
  if (args.length < count) return undefined
  const out: number[] = new Array(count)
  for (let i = 0; i < count; i += 1) {
    const v = args[i]
    if (typeof v !== 'number') return undefined
    out[i] = v
  }
  return out
}

function record(value: Value): MessageRecord | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as MessageRecord) : undefined
}

/** Python hasattr() on a message record. */
function has(msg: MessageRecord, field: string): boolean {
  return msg[field] !== undefined
}

/** A numeric field, or throw — callers run inside the evaluator's try/catch. */
function f(msg: MessageRecord, field: string): number {
  const v = msg[field]
  if (typeof v !== 'number') throw new Error(`no numeric ${field}`)
  return v
}

function stateOf(env: EvalEnv): Map<string, unknown> {
  if (!env.state) env.state = new Map()
  return env.state
}

function stateKey(fn: string, key: Value): string {
  return `${fn}:${typeof key === 'number' || typeof key === 'string' ? key : JSON.stringify(key)}`
}

const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

/** Row-major 3x3 from Euler angles (rotmat.Matrix3.from_euler). */
function fromEuler(roll: number, pitch: number, yaw: number): number[] {
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const sr = Math.sin(roll)
  const cr = Math.cos(roll)
  const sy = Math.sin(yaw)
  const cy = Math.cos(yaw)
  return [
    cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy,
    cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy,
    -sp, sr * cp, cr * cp
  ]
}

function mul(m: number[], v: Vec3): Vec3 {
  return vec(m[0] * v.x + m[1] * v.y + m[2] * v.z, m[3] * v.x + m[4] * v.y + m[5] * v.z, m[6] * v.x + m[7] * v.y + m[8] * v.z)
}

function mulTransposed(m: number[], v: Vec3): Vec3 {
  return vec(m[0] * v.x + m[3] * v.y + m[6] * v.z, m[1] * v.x + m[4] * v.y + m[7] * v.z, m[2] * v.x + m[5] * v.y + m[8] * v.z)
}

/** DCM of an ATTITUDE (radians) or ATT (degrees) message (mavextra.rotation). */
function rotation(att: MessageRecord): number[] {
  if (has(att, 'roll')) return fromEuler(f(att, 'roll'), f(att, 'pitch'), f(att, 'yaw'))
  return fromEuler(radians(f(att, 'Roll')), radians(f(att, 'Pitch')), radians(f(att, 'Yaw')))
}

/** Tilt-compensated heading from a body-frame field and a DCM (APM's calculation). */
function headingFromDcm(mx: number, my: number, mz: number, dcm: number[], declinationDeg: number): number {
  const cx = dcm[6]
  const cy = dcm[7]
  const cz = dcm[8]
  const cosPitchSq = 1 - cx * cx
  const headY = my * cz - mz * cy
  const headX = mx * cosPitchSq - cx * (my * cy + mz * cz)
  let heading = degrees(Math.atan2(-headY, headX)) + declinationDeg
  if (heading < 0) heading += 360
  return heading
}

// --- earth magnetic field (WMM tables) ----------------------------------------

function interpolateTable(table: readonly (readonly number[])[], latDeg: number, lonDeg: number): number {
  const minLat = Math.trunc(Math.floor(latDeg / SAMPLING_RES) * SAMPLING_RES)
  const minLon = Math.trunc(Math.floor(lonDeg / SAMPLING_RES) * SAMPLING_RES)
  const latIndex = Math.trunc(Math.floor(-SAMPLING_MIN_LAT + minLat) / SAMPLING_RES)
  const lonIndex = Math.trunc(Math.floor(-SAMPLING_MIN_LON + minLon) / SAMPLING_RES)
  const sw = table[latIndex][lonIndex]
  const se = table[latIndex][lonIndex + 1]
  const ne = table[latIndex + 1][lonIndex + 1]
  const nw = table[latIndex + 1][lonIndex]
  const dataMin = ((lonDeg - minLon) / SAMPLING_RES) * (se - sw) + sw
  const dataMax = ((lonDeg - minLon) / SAMPLING_RES) * (ne - nw) + nw
  return ((latDeg - minLat) / SAMPLING_RES) * (dataMax - dataMin) + dataMin
}

/** [declination_deg, inclination_deg, intensity_gauss], or undefined off the table. */
function magFieldEf(latDeg: number, lonDeg: number): [number, number, number] | undefined {
  if (latDeg < SAMPLING_MIN_LAT || latDeg >= SAMPLING_MAX_LAT) return undefined
  if (lonDeg < SAMPLING_MIN_LON || lonDeg >= SAMPLING_MAX_LON) return undefined
  return [
    interpolateTable(DECLINATION_TABLE, latDeg, lonDeg),
    interpolateTable(INCLINATION_TABLE, latDeg, lonDeg),
    interpolateTable(INTENSITY_TABLE, latDeg, lonDeg)
  ]
}

function latLonStatus(gps: MessageRecord): [number, number, number] {
  if (has(gps, 'fix_type')) return [f(gps, 'lat') * 1e-7, f(gps, 'lon') * 1e-7, f(gps, 'fix_type')]
  return [f(gps, 'Lat'), f(gps, 'Lng'), f(gps, 'Status')]
}

function expectedEarthFieldLatLon(lat: number, lon: number): Vec3 | undefined {
  const field = magFieldEf(lat, lon)
  if (!field) return undefined
  return mul(fromEuler(0, -radians(field[1]), radians(field[0])), vec(field[2] * 1000, 0, 0))
}

function expectedEarthField(gps: MessageRecord): Vec3 | undefined {
  const [lat, lon, status] = latLonStatus(gps)
  if (status < 3) return vec(0, 0, 0)
  return expectedEarthFieldLatLon(lat, lon)
}

function magYaw(gps: MessageRecord, att: MessageRecord, mag: MessageRecord): number | undefined {
  const [lat, lon] = latLonStatus(gps)
  const field = magFieldEf(lat, lon)
  if (!field) return undefined
  const dcm = fromEuler(radians(f(att, 'Roll')), radians(f(att, 'Pitch')), radians(f(att, 'Yaw')))
  return headingFromDcm(f(mag, 'MagX'), f(mag, 'MagY'), f(mag, 'MagZ'), dcm, field[0])
}

// --- positions ---------------------------------------------------------------

/** (lat rad, lon rad, alt m) from a position message (mavextra.get_lat_lon_alt). */
function latLonAlt(msg: MessageRecord): [number, number, number] | undefined {
  if (has(msg, 'Lat') && has(msg, 'Lng')) return [radians(f(msg, 'Lat')), radians(f(msg, 'Lng')), f(msg, 'Alt')]
  if (has(msg, 'Lat') && has(msg, 'Lon')) return [radians(f(msg, 'Lat')), radians(f(msg, 'Lon')), f(msg, 'Alt')]
  if (has(msg, 'cog')) return [radians(f(msg, 'lat')) * 1e-7, radians(f(msg, 'lon')) * 1e-7, f(msg, 'alt') * 0.001]
  if (has(msg, 'lat') && has(msg, 'lon')) return [radians(f(msg, 'lat')), radians(f(msg, 'lon')), f(msg, 'alt') * 0.001]
  if (has(msg, 'lat') && has(msg, 'lng')) return [radians(f(msg, 'lat')), radians(f(msg, 'lng')), f(msg, 'alt') * 0.001]
  // EKF origin-relative positions (PN/PE) need the log's origin; not ported.
  return undefined
}

/** Great-circle (haversine) distance in metres, earth radius 6371 km. */
function distanceTwo(a: MessageRecord, b: MessageRecord): number | undefined {
  const p1 = latLonAlt(a)
  const p2 = latLonAlt(b)
  if (!p1 || !p2) return undefined
  const dLat = p2[0] - p1[0]
  const dLon = p2[1] - p1[1]
  const h = Math.sin(0.5 * dLat) ** 2 + Math.sin(0.5 * dLon) ** 2 * Math.cos(p1[0]) * Math.cos(p2[0])
  return 6371 * 1000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

// --- stateful ----------------------------------------------------------------

function deltaImpl(env: EvalEnv, key: string, v: number, tusec: number | undefined): number | undefined {
  if (Number.isNaN(v)) return undefined
  const tnow = tusec !== undefined ? tusec * 1e-6 : env.time
  if (tnow === undefined) return undefined
  const state = stateOf(env)
  const stored = state.get(key) as [number, number, number] | undefined
  let ret = 0
  if (stored) {
    const [lastV, lastT, lastRet] = stored
    if (lastT === tnow) return lastRet
    ret = (v - lastV) / (tnow - lastT)
  }
  state.set(key, [v, tnow, ret])
  return ret
}

// --- the table ---------------------------------------------------------------

const FUNCTIONS = new Map<string, ExpressionFunction>()

for (const [name, fn] of MATH1) {
  FUNCTIONS.set(name, (args) => {
    const x = num(args[0])
    return x === undefined ? undefined : fn(x)
  })
}

const define = (name: string, fn: ExpressionFunction) => FUNCTIONS.set(name, fn)

// Python math / builtins with more than one argument.
define('atan2', (args) => {
  const a = nums(args, 2)
  return a && Math.atan2(a[0], a[1])
})
define('pow', (args) => {
  const a = nums(args, 2)
  return a && a[0] ** a[1]
})
define('hypot', (args) => {
  const a = nums(args, args.length)
  return a && Math.hypot(...a)
})
define('fmod', (args) => {
  const a = nums(args, 2)
  return a && a[1] !== 0 ? a[0] % a[1] : undefined
})
define('copysign', (args) => {
  const a = nums(args, 2)
  return a && Math.abs(a[0]) * (a[1] < 0 || Object.is(a[1], -0) ? -1 : 1)
})
define('log', (args) => {
  const x = num(args[0])
  if (x === undefined) return undefined
  if (args.length < 2) return Math.log(x)
  const base = num(args[1])
  return base === undefined ? undefined : Math.log(x) / Math.log(base)
})
define('round', (args) => {
  const x = num(args[0])
  if (x === undefined) return undefined
  const digits = num(args[1]) ?? 0
  const scale = 10 ** digits
  // Python rounds half to even.
  const scaled = x * scale
  const r = Math.round(scaled)
  return (Math.abs(scaled % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r) / scale
})
define('min', (args) => {
  const a = nums(args, args.length)
  return a && a.length > 0 ? Math.min(...a) : undefined
})
define('max', (args) => {
  const a = nums(args, args.length)
  return a && a.length > 0 ? Math.max(...a) : undefined
})
define('constrain', (args) => {
  const a = nums(args, 3)
  return a && Math.min(Math.max(a[0], a[1]), a[2])
})
define('angle_diff', (args) => {
  const a = nums(args, 2)
  return a && wrap180(a[0] - a[1])
})

// Barometric altitude from SCALED_PRESSURE and the ground-pressure parameter.
// Newer firmware renamed GND_ABS_PRESS to BARO1_GND_PRESS; both are tried.
function groundPressure(env: EvalEnv, explicit: Value): number | undefined {
  return num(explicit) ?? env.param?.('GND_ABS_PRESS') ?? env.param?.('BARO1_GND_PRESS')
}
define('altitude', (args, env) => {
  const msg = record(args[0])
  if (!msg) return undefined
  const ground = groundPressure(env, args[1])
  if (ground === undefined) return 0
  const temp = (num(args[2]) ?? env.param?.('GND_TEMP') ?? 0) + 273.15
  return Math.log(ground / (f(msg, 'press_abs') * 100)) * temp * 29271.267 * 0.001
})
define('altitude2', (args, env) => {
  const msg = record(args[0])
  if (!msg) return undefined
  const ground = groundPressure(env, args[1])
  if (ground === undefined) return 0
  const temp = (num(args[2]) ?? env.param?.('GND_TEMP') ?? 0) + 273.15
  return 153.8462 * temp * (1 - Math.exp(0.190259 * Math.log((f(msg, 'press_abs') * 100) / ground)))
})

// Magnetometer.
define('mag_field', (args) => {
  const msg = record(args[0])
  return msg && Math.sqrt(f(msg, 'xmag') ** 2 + f(msg, 'ymag') ** 2 + f(msg, 'zmag') ** 2)
})
define('mag_field_df', (args) => {
  const msg = record(args[0])
  return msg && Math.sqrt(f(msg, 'MagX') ** 2 + f(msg, 'MagY') ** 2 + f(msg, 'MagZ') ** 2)
})
define('mag_heading', (args, env) => {
  const imu = record(args[0])
  const att = record(args[1])
  if (!imu || !att) return undefined
  const declination = num(args[2]) ?? degrees(env.param?.('COMPASS_DEC') ?? 0)
  return headingFromDcm(f(imu, 'xmag'), f(imu, 'ymag'), f(imu, 'zmag'), rotation(att), declination)
})
define('mag_heading_df', (args, env) => {
  const mag = record(args[0])
  const att = record(args[1])
  if (!mag || !att) return undefined
  const declination = num(args[2]) ?? degrees(env.param?.('COMPASS_DEC') ?? 0)
  const dcm = fromEuler(radians(f(att, 'Roll')), radians(f(att, 'Pitch')), radians(f(att, 'Yaw')))
  return headingFromDcm(f(mag, 'MagX'), f(mag, 'MagY'), f(mag, 'MagZ'), dcm, declination)
})
define('expected_earth_field', (args) => {
  const gps = record(args[0])
  return gps && expectedEarthField(gps)
})
define('expected_mag', (args) => {
  const gps = record(args[0])
  const att = record(args[1])
  if (!gps || !att) return undefined
  const earth = expectedEarthField(gps)
  if (!earth) return undefined
  const [ra, pa, ya] = [num(args[2]) ?? 0, num(args[3]) ?? 0, num(args[4]) ?? 0]
  const [roll, pitch, yaw] = has(att, 'roll')
    ? [degrees(f(att, 'roll')) + ra, degrees(f(att, 'pitch')) + pa, degrees(f(att, 'yaw')) + ya]
    : [f(att, 'Roll') + ra, f(att, 'Pitch') + pa, f(att, 'Yaw') + ya]
  return mulTransposed(fromEuler(radians(roll), radians(pitch), radians(yaw)), earth)
})
define('mag_yaw', (args) => {
  const [gps, att, mag] = [record(args[0]), record(args[1]), record(args[2])]
  return gps && att && mag ? magYaw(gps, att, mag) : undefined
})
define('expected_mag_yaw', (args) => {
  const [gps, att, mag] = [record(args[0]), record(args[1]), record(args[2])]
  if (!gps || !att || !mag) return undefined
  const earth = expectedEarthField(gps)
  const yaw = magYaw(gps, att, mag)
  if (!earth || yaw === undefined) return undefined
  const roll = f(att, 'Roll') + (num(args[3]) ?? 0)
  const pitch = f(att, 'Pitch') + (num(args[4]) ?? 0)
  return mulTransposed(fromEuler(radians(roll), radians(pitch), radians(yaw)), earth)
})
define('earth_field_error', (args) => {
  const gps = record(args[0])
  const nkf = record(args[1])
  if (!gps || !nkf) return undefined
  const earth = expectedEarthField(gps)
  if (!earth) return undefined
  return vec(f(nkf, 'MN') - earth.x, f(nkf, 'ME') - earth.y, f(nkf, 'MD') - earth.z)
})

// Accelerometer magnitude (RAW_IMU in mg, or a DataFlash IMU in m/s/s).
define('gravity', (args) => {
  const imu = record(args[0])
  if (!imu) return undefined
  if (has(imu, 'xacc')) {
    const k = 9.81 / 1000
    return Math.sqrt((f(imu, 'xacc') * k) ** 2 + (f(imu, 'yacc') * k) ** 2 + (f(imu, 'zacc') * k) ** 2)
  }
  return Math.sqrt(f(imu, 'AccX') ** 2 + f(imu, 'AccY') ** 2 + f(imu, 'AccZ') ** 2)
})

// Positions.
define('distance_two', (args) => {
  const a = record(args[0])
  const b = record(args[1])
  return a && b ? distanceTwo(a, b) : undefined
})
define('distance_home', (args, env) => {
  const gps = record(args[0])
  if (!gps) return undefined
  if ((has(gps, 'fix_type') && f(gps, 'fix_type') < 2) || (has(gps, 'Status') && f(gps, 'Status') < 2)) return 0
  const state = stateOf(env)
  const first = state.get('distance_home:first') as MessageRecord | undefined
  if (!first) {
    // Copy: live callers may reuse the record object for the next message.
    state.set('distance_home:first', { ...gps })
    return 0
  }
  return distanceTwo(gps, first)
})

// Stateful filters, keyed by their `key` argument within the term.
define('lowpass', (args, env) => {
  const v = num(args[0])
  if (v === undefined || Number.isNaN(v)) return undefined
  const factor = num(args[2])
  if (factor === undefined) return undefined
  const state = stateOf(env)
  const key = stateKey('lowpass', args[1])
  const prev = state.get(key) as number | undefined
  const next = prev === undefined ? v : factor * prev + (1 - factor) * v
  state.set(key, next)
  return next
})
function lpalpha(sampleRateHz: number, cutoffHz: number): number {
  const rc = 1 / (2 * Math.PI * cutoffHz)
  const dt = 1 / sampleRateHz
  return 1 - dt / (dt + rc)
}
define('lpalpha', (args) => {
  const a = nums(args, 2)
  return a && lpalpha(a[0], a[1])
})
define('lowpassHz', (args, env) => {
  const v = num(args[0])
  const a = nums(args.slice(2), 2)
  if (v === undefined || !a) return undefined
  const alpha = lpalpha(a[0], a[1])
  const state = stateOf(env)
  const key = stateKey('lowpassHz', args[1])
  const prev = state.get(key) as number | undefined
  const next = prev === undefined ? v : alpha * prev + (1 - alpha) * v
  state.set(key, next)
  return next
})
define('diff', (args, env) => {
  const v = num(args[0])
  if (v === undefined) return undefined
  const state = stateOf(env)
  const key = stateKey('diff', args[1])
  const prev = state.get(key) as number | undefined
  state.set(key, v)
  return prev === undefined ? 0 : v - prev
})
define('delta', (args, env) => {
  const v = num(args[0])
  return v === undefined ? undefined : deltaImpl(env, stateKey('delta', args[1]), v, num(args[2]))
})
define('delta_angle', (args, env) => {
  const v = num(args[0])
  if (v === undefined) return undefined
  const tnow = args[2] !== undefined ? (num(args[2]) ?? NaN) * 1e-6 : env.time
  if (tnow === undefined || Number.isNaN(tnow)) return undefined
  // Shares delta()'s state table, as in mavextra.
  const state = stateOf(env)
  const key = stateKey('delta', args[1])
  const stored = state.get(key) as [number, number, number] | undefined
  let ret = 0
  if (stored) {
    const [lastV, lastT, lastRet] = stored
    if (lastT === tnow) return lastRet
    ret = wrap180(v - lastV) / (tnow - lastT)
  }
  state.set(key, [v, tnow, ret])
  return ret
})
define('integral', (args, env) => {
  const a = nums([args[0], args[2]], 2)
  if (!a) return undefined
  const [v, timeus] = a
  const state = stateOf(env)
  const key = stateKey('integral', args[1])
  const [lastSum, lastT] = (state.get(key) as [number, number] | undefined) ?? [0, timeus]
  const next = lastSum + v * (timeus - lastT) * 1e-6
  state.set(key, [next, timeus])
  return next
})
define('average', (args, env) => {
  const v = num(args[0])
  const n = num(args[2])
  if (v === undefined || n === undefined || n < 1) return undefined
  const state = stateOf(env)
  const key = stateKey('average', args[1])
  const window = state.get(key) as number[] | undefined
  if (!window) {
    state.set(key, new Array<number>(Math.trunc(n)).fill(v))
    return v
  }
  window.shift()
  window.push(v)
  return window.reduce((s, x) => s + x, 0) / n
})
define('sim_body_rates', (args, env) => {
  const sim = record(args[0])
  if (!sim) return undefined
  const tus = f(sim, 'TimeUS')
  const rollRate = deltaImpl(env, stateKey('delta', 'sbr'), f(sim, 'Roll'), tus)
  const pitchRate = deltaImpl(env, stateKey('delta', 'sbp'), f(sim, 'Pitch'), tus)
  const yawRate = deltaImpl(env, stateKey('delta', 'sby'), f(sim, 'Yaw'), tus)
  if (rollRate === undefined || pitchRate === undefined || yawRate === undefined) return undefined
  const phi = radians(f(sim, 'Roll'))
  const theta = radians(f(sim, 'Pitch'))
  const phiDot = radians(rollRate)
  const thetaDot = radians(pitchRate)
  const psiDot = radians(yawRate)
  return vec(
    phiDot - psiDot * Math.sin(theta),
    Math.cos(phi) * thetaDot + Math.sin(phi) * psiDot * Math.cos(theta),
    Math.cos(phi) * psiDot * Math.cos(theta) - Math.sin(phi) * thetaDot
  )
})

/** Every function name an expression may call. */
export const SUPPORTED_FUNCTIONS: ReadonlySet<string> = new Set(FUNCTIONS.keys())

export function lookupFunction(name: string): ExpressionFunction | undefined {
  return FUNCTIONS.get(name)
}
