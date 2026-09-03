import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { readFileSync, copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const generated = join(repoRoot, 'packages/param-metadata/src/board-rotations.generated.ts')
const script = join(repoRoot, 'packages/param-metadata/scripts/generate-board-rotations.mjs')

function loadRotations() {
  const text = readFileSync(generated, 'utf8')
  const marker = 'BOARD_ROTATIONS: readonly BoardRotation[] ='
  const start = text.indexOf('[', text.indexOf(marker) + marker.length)
  return JSON.parse(text.slice(start).trim())
}

// Always-on: the checked-in table must be a set of genuine rotations. A matrix
// that is not orthonormal with determinant +1 is not a rotation at all, and
// would silently mis-detect a board's mounting — which rotates the compass.
test('every checked-in board rotation is a proper rotation matrix', () => {
  const rotations = loadRotations()
  assert.ok(rotations.length >= 40, `expected the full rotation set, got ${rotations.length}`)

  for (const { name, matrix } of rotations) {
    const det =
      matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
      matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
      matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
    assert.ok(Math.abs(det - 1) < 1e-9, `${name}: determinant ${det}, not +1`)

    for (let i = 0; i < 3; i += 1) {
      const norm = Math.hypot(matrix[i][0], matrix[i][1], matrix[i][2])
      assert.ok(Math.abs(norm - 1) < 1e-9, `${name}: row ${i} is not a unit vector`)
      for (let j = i + 1; j < 3; j += 1) {
        const dot = [0, 1, 2].reduce((sum, k) => sum + matrix[i][k] * matrix[j][k], 0)
        assert.ok(Math.abs(dot) < 1e-9, `${name}: rows ${i}/${j} are not orthogonal`)
      }
    }
  }
})

// Always-on: anchors whose meaning is fixed by the axis convention, so a
// regenerated table that transposed or re-signed itself is caught here rather
// than by an operator whose compass points the wrong way.
test('the anchor rotations mean what their names say', () => {
  const byValue = new Map(loadRotations().map((rotation) => [rotation.value, rotation]))
  const apply = (m, v) => m.map((row) => row.reduce((sum, c, i) => sum + c * v[i], 0))

  assert.deepEqual(byValue.get(0).matrix, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], 'ROTATION_NONE is identity')
  // Forward (+X) becomes right (+Y) under a 90-degree yaw.
  assert.deepEqual(apply(byValue.get(2).matrix, [1, 0, 0]), [0, 1, 0], 'ROTATION_YAW_90')
  // Down (+Z) becomes up under a 180-degree roll.
  assert.deepEqual(apply(byValue.get(8).matrix, [0, 0, 1]), [0, 0, -1], 'ROTATION_ROLL_180')
  // Forward becomes backward under a 180-degree pitch.
  assert.deepEqual(apply(byValue.get(12).matrix, [1, 0, 0]), [-1, 0, 0], 'ROTATION_PITCH_180')
})

// Gated: with an ArduPilot checkout, regenerating must reproduce the file
// byte-for-byte. This is what catches an upstream change to the rotation set.
test('regenerating from ArduPilot reproduces the checked-in table', (t) => {
  const repo = process.env.ARDUPILOT_REPO_PATH
  if (!repo) {
    t.skip('set ARDUPILOT_REPO_PATH to verify against ArduPilot source')
    return
  }
  const before = readFileSync(generated, 'utf8')
  const backup = join(mkdtempSync(join(tmpdir(), 'rot-')), 'board-rotations.generated.ts')
  copyFileSync(generated, backup)
  try {
    execFileSync(process.execPath, [script], { env: { ...process.env, ARDUPILOT_REPO_PATH: repo } })
    assert.equal(readFileSync(generated, 'utf8'), before, 'checked-in table is stale — re-run the generator')
  } finally {
    copyFileSync(backup, generated)
  }
})
