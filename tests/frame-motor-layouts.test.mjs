import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const generated = join(repoRoot, 'packages/param-metadata/src/frame-motor-layouts.generated.ts')
const script = join(repoRoot, 'packages/param-metadata/scripts/generate-frame-motor-layouts.mjs')

// Always-on sanity: the checked-in table is structurally valid and the quad
// frames still match the values the old hand-written preview tables used, so a
// bad regeneration can't quietly ship. (Parses the JSON literal out of the .ts.)
function loadLayouts() {
  const text = readFileSync(generated, 'utf8')
  const eq = text.indexOf('=', text.indexOf('FRAME_MOTOR_LAYOUTS'))
  return JSON.parse(text.slice(text.indexOf('{', eq)))
}

test('the checked-in frame table is well-formed and covers the matrix classes', () => {
  const layouts = loadLayouts()
  // Quad(1) Hexa(2) Octa(3) OctaQuad(4) Y6(5) DodecaHexa(12) Deca(14).
  for (const cls of [1, 2, 3, 4, 5, 12, 14]) {
    assert.ok(layouts[cls], `frame class ${cls} present`)
  }
  for (const byType of Object.values(layouts)) {
    for (const motors of Object.values(byType)) {
      assert.ok(motors.length > 0)
      for (const m of motors) {
        assert.equal(typeof m.motorNumber, 'number')
        assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y), 'finite coords')
        assert.ok(['cw', 'ccw', 'none'].includes(m.spin), `valid spin ${m.spin}`)
      }
    }
  }
})

test('quad X / + / H spins match the tables they replaced', () => {
  const layouts = loadLayouts()
  const spins = (cls, ty) =>
    Object.fromEntries(layouts[cls][ty].map((m) => [m.motorNumber, m.spin]))
  assert.deepEqual(spins(1, 1), { 1: 'ccw', 2: 'ccw', 3: 'cw', 4: 'cw' }, 'quad X')
  assert.deepEqual(spins(1, 0), { 1: 'ccw', 2: 'ccw', 3: 'cw', 4: 'cw' }, 'quad +')
  assert.deepEqual(spins(1, 3), { 1: 'cw', 2: 'cw', 3: 'ccw', 4: 'ccw' }, 'quad H (X reversed)')
})

// Opt-in: regenerate from a real ArduPilot checkout and assert the checked-in
// file is byte-identical. Catches drift when firmware frame tables change.
// Mirrors the true-SITL gating — skipped unless ARDUPILOT_REPO_PATH is set.
test('generated table is in sync with ArduPilot source', { skip: !process.env.ARDUPILOT_REPO_PATH }, () => {
  const scratch = mkdtempSync(join(tmpdir(), 'frame-layouts-'))
  // Regenerate into a temp copy of the target path by running the script with a
  // redirected output is not supported; instead run it and compare in place is
  // destructive. So: capture the current file, run generator, diff, restore.
  const before = readFileSync(generated, 'utf8')
  try {
    execFileSync('node', [script], {
      env: { ...process.env, ARDUPILOT_REPO_PATH: process.env.ARDUPILOT_REPO_PATH },
      cwd: repoRoot
    })
    const after = readFileSync(generated, 'utf8')
    assert.equal(
      after,
      before,
      'frame-motor-layouts.generated.ts is stale — re-run the generator and commit the result'
    )
  } finally {
    // Restore the original (the generator overwrote it during the check).
    execFileSync('node', ['-e', `require('fs').writeFileSync(${JSON.stringify(generated)}, ${JSON.stringify(before)})`])
    void scratch
  }
})
