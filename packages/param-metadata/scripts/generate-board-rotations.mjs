#!/usr/bin/env node
// Emit the AHRS_ORIENTATION rotation table from ArduPilot source.
//
// AHRS_ORIENTATION is an enum of fixed 45/90-degree rotations, and detecting a
// board's mounting means asking "which of these takes the gravity vectors I
// measured onto the ones I expected". That needs each rotation as a matrix, and
// transcribing 45 of them by hand is exactly the kind of table that is wrong in
// one sign and silently rotates somebody's compass.
//
// So we do not transcribe: we take ArduPilot's own Vector3<T>::rotate() switch,
// transpile each case body to JavaScript, and run it on the three basis vectors
// to recover the matrix. The arithmetic is ArduPilot's, not ours.
//
// Custom rotations (100/101/102) are deliberately excluded — they are whatever
// the operator put in CUST_ROT*_ROLL/PIT/YAW, not fixed values we can match.
//
// Regenerate:
//   ARDUPILOT_REPO_PATH=/path/to/ardupilot \
//     node packages/param-metadata/scripts/generate-board-rotations.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = process.env.ARDUPILOT_REPO_PATH
if (!repo) {
  console.error('Set ARDUPILOT_REPO_PATH to an ArduPilot checkout.')
  process.exit(2)
}

const here = dirname(fileURLToPath(import.meta.url))
const outFile = join(here, '../src/board-rotations.generated.ts')

const rotationsH = readFileSync(join(repo, 'libraries/AP_Math/rotations.h'), 'utf8')
const vector3 = readFileSync(join(repo, 'libraries/AP_Math/vector3.cpp'), 'utf8')

// 1. enum name -> numeric value
const values = new Map()
for (const line of rotationsH.split('\n')) {
  const m = line.match(/^\s*(ROTATION_[A-Z0-9_]+)\s*=\s*(\d+)\s*,/)
  if (m) values.set(m[1], Number(m[2]))
}
// The header only numbers the first entry of each run; the rest increment.
let running
for (const line of rotationsH.split('\n')) {
  const named = line.match(/^\s*(ROTATION_[A-Z0-9_]+)\s*=\s*(\d+)\s*,/)
  const bare = line.match(/^\s*(ROTATION_[A-Z0-9_]+)\s*,/)
  if (named) {
    running = Number(named[2])
  } else if (bare && running !== undefined) {
    running += 1
    if (!values.has(bare[1])) values.set(bare[1], running)
  }
}

// 2. the rotate() switch body
const fnStart = vector3.indexOf('void Vector3<T>::rotate(enum Rotation rotation)')
if (fnStart < 0) throw new Error('Vector3<T>::rotate not found — ArduPilot layout changed')
const switchStart = vector3.indexOf('switch (rotation)', fnStart)
const switchEnd = vector3.indexOf('\n}', switchStart)
const body = vector3.slice(switchStart, switchEnd)

// 3. split into label-groups -> statements
const EXCLUDED = new Set([
  'ROTATION_CUSTOM_OLD', 'ROTATION_CUSTOM_1', 'ROTATION_CUSTOM_2',
  'ROTATION_CUSTOM_END', 'ROTATION_MAX'
])

const caseRe = /case\s+(ROTATION_[A-Z0-9_]+)\s*:/g
const marks = []
let m
while ((m = caseRe.exec(body)) !== null) marks.push({ name: m[1], at: m.index, end: caseRe.lastIndex })

const table = []
// Labels with no body of their own fall through to the next one that has code,
// so carry them forward rather than dropping them. Getting this wrong silently
// omits rotations -- it omitted ROTATION_NONE, the identity, on the first pass.
let pendingNames = []
for (let i = 0; i < marks.length; i += 1) {
  const { name, end } = marks[i]
  const next = marks[i + 1]?.at ?? body.length
  const raw = body.slice(end, next)

  // A bare label (nothing but whitespace/comments before the next case) shares
  // the following body. A body containing only `return;` is the identity.
  const hasCode = /[^\s]/.test(raw.replace(/\/\/[^\n]*/g, '').replace(/[{}]/g, ''))
  if (!hasCode) {
    if (!EXCLUDED.has(name)) pendingNames.push(name)
    continue
  }

  const names = [...pendingNames, name].filter((each) => !EXCLUDED.has(each))
  pendingNames = []
  if (names.length === 0) continue

  const js = raw
    .replace(/\{|\}/g, '')
    .replace(/\(ftype\)/g, '')
    .replace(/\bHALF_SQRT_2\b/g, 'Math.SQRT1_2')
    .replace(/\breturn\s*;/g, '')
    .replace(/\/\/[^\n]*/g, '')
    // C++ locals -> JS. `tmp` is provided by the prologue; the trig-heavy
    // rotations declare their own tmpx/tmpy/tmpz.
    .replace(/\bT\s+tmp\s*;/g, '')
    .replace(/\bconst\s+T\s+(\w+)/g, 'const $1')
    .replace(/\bT\s+(\w+)/g, 'let $1')
    .trim()

  // Run ArduPilot's own arithmetic on each basis vector -> matrix columns.
  // An empty body is a no-op, i.e. the identity, which is exactly right.
  const column = (bx, by, bz) => {
    const fn = new Function('x', 'y', 'z', `let tmp;\n${js}\nreturn [x, y, z]`)
    return fn(bx, by, bz)
  }
  let cols
  try {
    cols = [column(1, 0, 0), column(0, 1, 0), column(0, 0, 1)]
  } catch (error) {
    throw new Error(`could not evaluate ${names.join('/')}: ${error.message}\n${js}`)
  }
  const round = (v) => (Object.is(v, -0) ? 0 : Number(v.toFixed(12)))
  // matrix[row][col]; rotate() maps a vector, so column j is the image of basis j.
  const matrix = [0, 1, 2].map((row) => [0, 1, 2].map((col) => round(cols[col][row])))

  for (const each of names) {
    const value = values.get(each)
    if (value === undefined) throw new Error(`no numeric value for ${each}`)
    table.push({ value, name: each, matrix })
  }
}

table.sort((a, b) => a.value - b.value)

// 3b. Coverage. Consecutive `case` labels share one body, so a naive walk drops
// the leading label of every fall-through group -- silently, and a missing
// rotation is a rotation we would never propose. Assert that every fixed value
// the enum defines came out with a matrix.
const expected = [...values.entries()]
  .filter(([name, value]) => value < 100 && !EXCLUDED.has(name))
  .sort((a, b) => a[1] - b[1])
const produced = new Set(table.map((entry) => entry.name))
const missing = expected.filter(([name]) => !produced.has(name))
if (missing.length > 0) {
  throw new Error(
    `no matrix produced for ${missing.length} rotation(s): ${missing.map(([n, v]) => `${n}=${v}`).join(', ')}`
  )
}

// 4. sanity: every matrix must be a proper rotation (orthonormal, det +1)
for (const { name, matrix } of table) {
  const det =
    matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
    matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
    matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
  if (Math.abs(det - 1) > 1e-9) throw new Error(`${name} is not a proper rotation (det ${det})`)
}

const lines = [
  '// GENERATED by packages/param-metadata/scripts/generate-board-rotations.mjs',
  '// from ArduPilot AP_Math/vector3.cpp + rotations.h — do NOT edit by hand.',
  '// Regenerate: ARDUPILOT_REPO_PATH=/path/to/ardupilot node packages/param-metadata/scripts/generate-board-rotations.mjs',
  '',
  '/** One AHRS_ORIENTATION value and the rotation it applies. */',
  'export interface BoardRotation {',
  '  /** The AHRS_ORIENTATION parameter value. */',
  '  value: number',
  "  /** ArduPilot's own enum name, e.g. ROTATION_YAW_270. */",
  '  name: string',
  '  /** Row-major 3x3. Column j is the image of basis vector j, matching',
  "   *  Vector3::rotate() — so rotated = matrix * original. */",
  '  matrix: readonly (readonly number[])[]',
  '}',
  '',
  '/** Every fixed rotation AHRS_ORIENTATION accepts. Custom (100/101/102) are',
  " *  excluded: they are whatever the operator put in CUST_ROT*, not a fixed",
  ' *  value anything can be matched against. */',
  'export const BOARD_ROTATIONS: readonly BoardRotation[] = ' + JSON.stringify(table, null, 2),
  ''
].join('\n')

writeFileSync(outFile, lines)
console.log(`wrote ${table.length} rotations to ${outFile}`)
