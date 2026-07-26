// Generate the frame → motor-layout table from ArduPilot source, so the
// Motor Test diagram draws each frame's REAL geometry and prop directions
// instead of a hardcoded quad-X.
//
// Source of truth: libraries/AP_Motors/AP_MotorsMatrix.cpp (setup_*_matrix) and
// AP_Motors_Class.h (the frame_class / frame_type enums). Run against a local
// ArduPilot checkout:
//
//   ARDUPILOT_REPO_PATH=/path/to/ardupilot \
//     node packages/param-metadata/scripts/generate-frame-motor-layouts.mjs
//
// Writes packages/param-metadata/src/frame-motor-layouts.generated.ts. The
// gated test tests/frame-motor-layouts.test.mjs re-runs this and asserts the
// checked-in file matches, so it can't silently drift from firmware.
//
// Geometry, matching AP_MotorsMatrix::add_motor():
//   MotorDef{angle,yaw,order}          -> x =  sin(angle),      y = -cos(angle)
//   MotorDefRaw{roll,pitch,yaw,order}  -> x = -roll_factor,     y = -pitch_factor
//   add_motor(n, rollDeg, pitchDeg, …) -> x =  sin(rollDeg),    y = -cos(pitchDeg)
// spin = sign of yaw_factor (CCW=+1 -> 'ccw', CW=-1 -> 'cw'); motorNumber is the
// 1-based position in the add order (= the MOTn output), matching the existing
// quad tables byte-for-byte.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = process.env.ARDUPILOT_REPO_PATH
if (!repo) {
  console.error('ARDUPILOT_REPO_PATH is required (path to an ArduPilot checkout).')
  process.exit(2)
}

const here = dirname(fileURLToPath(import.meta.url))
const outFile = join(here, '..', 'src', 'frame-motor-layouts.generated.ts')
const classHeader = join(repo, 'libraries/AP_Motors/AP_Motors_Class.h')
const matrixSrc = join(repo, 'libraries/AP_Motors/AP_MotorsMatrix.cpp')

const YAW_CW = -1
const YAW_CCW = 1

function parseEnum(text, enumName) {
  const body = text.slice(text.indexOf(`enum ${enumName}`))
  const inner = body.slice(body.indexOf('{') + 1, body.indexOf('}'))
  const out = {}
  let last = -1
  for (const rawLine of inner.split('\n')) {
    const line = rawLine.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').trim()
    const m = line.match(/^([A-Z0-9_]+)\s*(?:=\s*(-?\d+))?\s*,?$/)
    if (!m) continue
    const value = m[2] !== undefined ? Number(m[2]) : last + 1
    out[m[1]] = value
    last = value
  }
  return out
}

const header = readFileSync(classHeader, 'utf8')
const frameClass = parseEnum(header, 'motor_frame_class')
const frameType = parseEnum(header, 'motor_frame_type')

// setup_<fn>_matrix -> frame_class enum member
const CLASS_FN = {
  quad: 'MOTOR_FRAME_QUAD',
  hexa: 'MOTOR_FRAME_HEXA',
  octa: 'MOTOR_FRAME_OCTA',
  octaquad: 'MOTOR_FRAME_OCTAQUAD',
  dodecahexa: 'MOTOR_FRAME_DODECAHEXA',
  y6: 'MOTOR_FRAME_Y6',
  deca: 'MOTOR_FRAME_DECA'
}

const src = readFileSync(matrixSrc, 'utf8')

function evalYaw(token) {
  if (token.includes('YAW_FACTOR_CW')) return YAW_CW
  if (token.includes('YAW_FACTOR_CCW')) return YAW_CCW
  const n = Number(token.replace(/f$/, '')) // strip C++ float suffix
  if (Number.isNaN(n)) throw new Error(`unrecognised yaw factor: ${token}`)
  // Non-±1 yaw factors (V frame, VTAIL) still carry a spin SIGN.
  return n
}

const num = (t) => Number(String(t).replace(/f$/, ''))
const round = (n) => Math.round(n * 1000) / 1000
const spinOf = (yaw) => (yaw < 0 ? 'cw' : yaw > 0 ? 'ccw' : 'none')

// Extract the body of one setup_<fn>_matrix function.
function functionBody(fnName) {
  const sig = `AP_MotorsMatrix::${fnName}(`
  const start = src.indexOf(sig)
  if (start < 0) return undefined
  let depth = 0
  let i = src.indexOf('{', start)
  const open = i
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return undefined
}

// Motors from a `static const … motors[] { {…}, {…} }; add_motors(…)` block.
// `raw` is detected per-BLOCK (a single frame class mixes angle-based cases with
// raw ones — e.g. quad's Y4 is raw while quad's X is angle-based).
function motorsFromArray(block) {
  const raw = /add_motors_raw/.test(block)
  const arrMatch = block.match(/motors\[\]\s*\{([\s\S]*?)\}\s*;/)
  if (!arrMatch) return undefined
  const rows = arrMatch[1].match(/\{[^{}]*\}/g) ?? []
  return rows.map((row, index) => {
    const parts = row.replace(/[{}]/g, '').split(',').map((p) => p.trim()).filter(Boolean)
    if (raw) {
      const [roll, pitch, yaw] = parts
      const yawFactor = evalYaw(yaw)
      return { x: round(-num(roll)), y: round(-num(pitch)), spin: spinOf(yawFactor), motorNumber: index + 1 }
    }
    const [angle, yaw] = parts
    const a = (num(angle) * Math.PI) / 180
    const yawFactor = evalYaw(yaw)
    return { x: round(Math.sin(a)), y: round(-Math.cos(a)), spin: spinOf(yawFactor), motorNumber: index + 1 }
  })
}

// Motors from a run of direct `add_motor(MOT_n, roll, pitch, yaw, order)` /
// `add_motor(MOT_n, angle, yaw, order)` calls (VTAIL/ATAIL/Y4).
function motorsFromCalls(block) {
  const calls = [...block.matchAll(/add_motor\(\s*AP_MOTORS_MOT_(\d+)\s*,([^;]*?)\)\s*;/g)]
  if (calls.length === 0) return undefined
  return calls.map((call) => {
    const motorNumber = Number(call[1])
    const args = call[2].split(',').map((p) => p.trim())
    let x
    let y
    let yaw
    if (args.length === 4) {
      // roll_deg, pitch_deg, yaw, order
      x = round(Math.sin((num(args[0]) * Math.PI) / 180))
      y = round(-Math.cos((num(args[1]) * Math.PI) / 180))
      yaw = evalYaw(args[2])
    } else {
      // angle, yaw, order
      const a = (num(args[0]) * Math.PI) / 180
      x = round(Math.sin(a))
      y = round(-Math.cos(a))
      yaw = evalYaw(args[1])
    }
    return { x, y, spin: spinOf(yaw), motorNumber }
  }).sort((l, r) => l.motorNumber - r.motorNumber)
}

// Split a function body into `case …:` blocks, each mapped to the frame_type
// value(s) it serves (deca shares one block across X and CW_X).
function parseCases(body) {
  const out = []
  const caseRe = /case\s+(MOTOR_FRAME_TYPE_[A-Z0-9_]+)\s*:/g
  const markers = [...body.matchAll(caseRe)]
  for (let i = 0; i < markers.length; i += 1) {
    const typeName = markers[i][1]
    // Accumulate consecutive `case X: case Y: { … }` labels sharing a body.
    const bodyStart = markers[i].index + markers[i][0].length
    const nextCase = i + 1 < markers.length ? markers[i + 1].index : body.length
    const between = body.slice(bodyStart, nextCase)
    // A block is present only once the labels stop stacking (an add_motor call).
    if (!/add_motor/.test(between)) {
      out.push({ typeName, shareForward: true })
      continue
    }
    out.push({ typeName, block: between })
  }
  // Resolve shared labels: a shareForward case takes the next real block.
  const resolved = []
  for (let i = 0; i < out.length; i += 1) {
    if (out[i].shareForward) {
      let j = i
      while (j < out.length && out[j].shareForward) j += 1
      if (j < out.length) resolved.push({ typeName: out[i].typeName, block: out[j].block })
      continue
    }
    resolved.push(out[i])
  }
  return resolved
}

// Coaxial stacks: motors sharing a position are top/bottom on one arm.
function markStacks(motors) {
  const byPos = new Map()
  for (const m of motors) {
    const key = `${m.x}:${m.y}`
    if (!byPos.has(key)) byPos.set(key, [])
    byPos.get(key).push(m)
  }
  const anyStacked = [...byPos.values()].some((group) => group.length > 1)
  if (!anyStacked) return motors
  for (const group of byPos.values()) {
    if (group.length <= 1) continue
    group.sort((l, r) => l.motorNumber - r.motorNumber)
    group.forEach((m, idx) => {
      m.stack = idx === 0 ? 'top' : 'bottom'
    })
  }
  return motors
}

// Normalise planar (non-coaxial) motors onto a display ring, preserving angle.
// Coaxial frames keep their raw radii so a stack's two rings stay concentric.
function normalise(motors) {
  const stacked = motors.some((m) => m.stack)
  if (stacked) {
    // Scale so the outermost motor sits near the ring edge.
    const maxR = Math.max(...motors.map((m) => Math.hypot(m.x, m.y))) || 1
    const target = 0.78
    return motors.map((m) => ({ ...m, x: round((m.x / maxR) * target), y: round((m.y / maxR) * target) }))
  }
  const radius = motors.length >= 8 ? 0.8 : 0.74
  return motors.map((m) => {
    const r = Math.hypot(m.x, m.y) || 1
    return { ...m, x: round((m.x / r) * radius), y: round((m.y / r) * radius) }
  })
}

const layouts = {}
for (const [fn, classMember] of Object.entries(CLASS_FN)) {
  const classValue = frameClass[classMember]
  if (classValue === undefined) throw new Error(`missing frame class ${classMember}`)
  const body = functionBody(`setup_${fn}_matrix`)
  if (!body) {
    console.warn(`no setup_${fn}_matrix — skipping`)
    continue
  }
  for (const c of parseCases(body)) {
    const typeValue = frameType[c.typeName]
    if (typeValue === undefined) {
      console.warn(`unknown frame type ${c.typeName} — skipping`)
      continue
    }
    let motors = motorsFromArray(c.block) ?? motorsFromCalls(c.block)
    if (!motors || motors.length === 0) {
      console.warn(`no motors parsed for ${fn}/${c.typeName} — skipping`)
      continue
    }
    motors = normalise(markStacks(motors))
    layouts[classValue] = layouts[classValue] ?? {}
    layouts[classValue][typeValue] = motors.map((m) => ({
      motorNumber: m.motorNumber,
      x: m.x,
      y: m.y,
      spin: m.spin,
      ...(m.stack ? { stack: m.stack } : {})
    }))
  }
}

const banner = `// GENERATED by packages/param-metadata/scripts/generate-frame-motor-layouts.mjs
// from ArduPilot AP_MotorsMatrix.cpp — do NOT edit by hand.
// Regenerate: ARDUPILOT_REPO_PATH=/path/to/ardupilot node packages/param-metadata/scripts/generate-frame-motor-layouts.mjs
`

const body = `${banner}
/** One motor in a frame's top-down layout. x is right, y is down, unit-ish. */
export interface FrameMotorNode {
  /** 1-based position in ArduPilot's add order (= the MOTn output). */
  motorNumber: number
  x: number
  y: number
  /** Prop rotation seen from above; 'none' for yaw-neutral (NYT) motors. */
  spin: 'cw' | 'ccw' | 'none'
  /** Present on coaxial frames (Y6, X8): which motor of the shared arm. */
  stack?: 'top' | 'bottom'
}

/** FRAME_CLASS value -> FRAME_TYPE value -> motor layout. */
export const FRAME_MOTOR_LAYOUTS: Record<number, Record<number, readonly FrameMotorNode[]>> =
${JSON.stringify(layouts, null, 2)}
`

writeFileSync(outFile, body)
const classCount = Object.keys(layouts).length
const comboCount = Object.values(layouts).reduce((sum, byType) => sum + Object.keys(byType).length, 0)
console.log(`Wrote ${outFile}: ${classCount} frame classes, ${comboCount} class/type combos.`)
