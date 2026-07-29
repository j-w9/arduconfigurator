// The wiki's ArduPilot parameter reference is GENERATED (see
// wiki/tools/generate_parameter_reference.py) from pinned upstream metadata.
// These tests run the generator and check its output, because the two failure
// modes it has are both silent:
//
//   - a slug collision drops a whole parameter family with no error (upstream
//     ships ARSPD and ARSPD_, PRX1 and PRX1_, ... which slugged identically and
//     lost 77 parameters), and
//   - a search-index entry can point at a page or anchor that does not exist,
//     which just looks like a dead link to whoever clicks it.
//
// Neither shows up as a build failure, so they need asserting directly.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WIKI = path.join(REPO, 'wiki')
const GENERATOR = path.join(WIKI, 'tools', 'generate_parameter_reference.py')
const PARAMS_DIR = path.join(WIKI, 'parameters')
const INDEX_JSON = path.join(WIKI, '_static', 'parameter-index.json')
const PINNED = path.join(WIKI, 'data', 'apm.pdef.Copter-4.7.json')

function generate() {
  execFileSync('python3', [GENERATOR], { cwd: REPO, stdio: 'pipe' })
}

test('the pinned upstream metadata is present (the build is hermetic — no network)', () => {
  assert.ok(existsSync(PINNED), `missing pinned metadata: ${PINNED}`)
})

test('every parameter family gets its own page — no slug collisions', () => {
  generate()
  const pinned = JSON.parse(readFileSync(PINNED, 'utf8'))
  const familyCount = Object.values(pinned).filter(
    (params) => params && typeof params === 'object' && Object.keys(params).length > 0
  ).length
  const pages = readdirSync(PARAMS_DIR).filter((name) => name.startsWith('group-') && name.endsWith('.rst'))
  assert.equal(
    pages.length,
    familyCount,
    'one page per family — a mismatch means slugs collided and a family was overwritten'
  )
})

test('every indexed parameter is reachable: its page exists and declares its anchor', () => {
  generate()
  const index = JSON.parse(readFileSync(INDEX_JSON, 'utf8'))
  assert.ok(index.params.length > 5000, `expected the full table, saw ${index.params.length}`)

  const anchorsByPage = new Map()
  const broken = []
  for (const entry of index.params) {
    const page = path.join(PARAMS_DIR, `group-${entry.g}.rst`)
    if (!anchorsByPage.has(page)) {
      anchorsByPage.set(page, existsSync(page) ? readFileSync(page, 'utf8') : undefined)
    }
    const body = anchorsByPage.get(page)
    if (body === undefined) {
      broken.push(`${entry.n}: no page group-${entry.g}.rst`)
      continue
    }
    // The generator writes `.. _param-<name>:`; docutils lowercases it and
    // rewrites underscores to hyphens when it builds the HTML id, which is what
    // the search page links to.
    if (!body.includes(`.. _param-${entry.n.toLowerCase()}:`)) {
      broken.push(`${entry.n}: no anchor on group-${entry.g}.rst`)
    }
  }
  assert.deepEqual(broken.slice(0, 5), [], `${broken.length} unreachable parameter(s)`)
})

test('generated pages carry no directive that a theme renders as an error block', () => {
  // Furo builds its own "On this page" sidebar and REJECTS a `.. contents::`
  // directive by rendering a red ERROR block into the page body. sphinx-build
  // reports that as neither an error nor a warning, so a clean build log said
  // nothing while all 387 pages shipped the banner. Asserting on the source is
  // the cheap guard; the expensive one (scanning built HTML for
  // docutils system-message nodes) needs a full Sphinx build.
  generate()
  const offenders = readdirSync(PARAMS_DIR)
    .filter((name) => name.startsWith('group-') && name.endsWith('.rst'))
    .filter((name) => readFileSync(path.join(PARAMS_DIR, name), 'utf8').includes('.. contents::'))
  assert.deepEqual(offenders.slice(0, 3), [], `${offenders.length} page(s) still use .. contents::`)
})

test('page titles escape the trailing underscore every ArduPilot family name has', () => {
  // An unescaped trailing underscore is RST hyperlink-reference syntax: it
  // produced ~290 "Unknown target name" build errors and a mangled heading.
  generate()
  const body = readFileSync(path.join(PARAMS_DIR, 'group-adsb.rst'), 'utf8')
  assert.match(body, /ADSB\\_ parameters/)
})
