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

test('the index IS the search page, and generated pages stay out of the nav tree', () => {
  // Two things this pins:
  //   - the search box lives on the index; a separate page that only links to a
  //     search box is a pointless hop when finding a parameter is the whole job.
  //   - group/letter pages are :orphan:. A :hidden: toctree was not enough —
  //     it hides the tree from the page body but Furo still renders every entry
  //     into the sidebar of EVERY page in the section, which put 45-53 KB of
  //     nav on each one (a group page was 76 KB, mostly sidebar).
  generate()
  const index = readFileSync(path.join(PARAMS_DIR, 'index.rst'), 'utf8')
  assert.match(index, /param-search-input/, 'the index must carry the search box itself')

  const group = readFileSync(path.join(PARAMS_DIR, 'group-arming.rst'), 'utf8')
  assert.match(group, /^:orphan:/, 'group pages must stay out of the nav tree')
  const letter = readFileSync(path.join(PARAMS_DIR, 'letter-a.rst'), 'utf8')
  assert.match(letter, /^:orphan:/, 'letter pages must stay out of the nav tree')
})

test("the app's per-parameter link resolves against this reference", () => {
  // The "i" bubble in the app links parameters by NAME
  // (parameters/index.html?param=ATC_INPUT_TC) and this reference's search
  // script resolves the name to a family page. That contract spans two
  // packages, so neither side's own tests can catch it drifting: the app can't
  // see the generated pages, and the generator doesn't know the app exists.
  generate()
  const docs = readFileSync(path.join(REPO, 'apps', 'web', 'src', 'view-models', 'param-docs.ts'), 'utf8')

  // 1. The page the app links to is a page this generator emits.
  const target = /WIKI_PARAMETER_REFERENCE_URL = '([^']+)'/.exec(docs)?.[1]
  assert.ok(target?.endsWith('/wiki/parameters/index.html'), `unexpected link target: ${target}`)
  assert.ok(existsSync(path.join(PARAMS_DIR, 'index.rst')), 'the app links a page the generator does not emit')

  // 2. The query key the app writes is the one the search script reads.
  const key = /WIKI_PARAMETER_QUERY_KEY = '([^']+)'/.exec(docs)?.[1]
  const search = readFileSync(path.join(WIKI, '_static', 'parameter-search.js'), 'utf8')
  assert.ok(key, 'the app must declare the query key it uses')
  assert.match(search, new RegExp(`\\.get\\('${key}'\\)`), 'the search script does not read that query key')

  // 3. A named parameter resolves to a page and an anchor that both exist —
  //    including the two shapes whose page is NOT derivable from the name
  //    (top-level Copter params, and the underscore-collision suffix), which is
  //    the whole reason the link is name-addressed.
  const byName = new Map(
    JSON.parse(readFileSync(INDEX_JSON, 'utf8')).params.map((entry) => [entry.n, entry])
  )
  for (const [name, expectedPage] of [
    ['ATC_INPUT_TC', 'group-atc.rst'],
    ['BATT_MONITOR', 'group-batt.rst'],
    ['SERVO1_FUNCTION', 'group-servo1.rst'],
    ['ACRO_RP_EXPO', 'group-copter.rst'],
    ['ARSPD_TYPE', 'group-arspd-2.rst'],
  ]) {
    const entry = byName.get(name)
    assert.ok(entry, `${name} is not in the index the search resolves against`)
    const page = path.join(PARAMS_DIR, `group-${entry.g}.rst`)
    assert.equal(path.basename(page), expectedPage, `${name} moved family page`)
    assert.match(
      readFileSync(page, 'utf8'),
      new RegExp(`^\\.\\. _param-${name.toLowerCase()}:$`, 'm'),
      `${name}: no anchor to land on`
    )
  }

  // 4. The firmware the app puts in the link label is the one this reference
  //    documents — a regenerate for a new release must not leave it lying.
  const labelled = /WIKI_PARAMETER_FIRMWARE = '([^']+)'/.exec(docs)?.[1]
  const { vehicle, firmware } = JSON.parse(readFileSync(INDEX_JSON, 'utf8'))
  assert.equal(labelled, `${vehicle} ${firmware}`, 'the app advertises a firmware the reference is not for')
})

test('page titles escape the trailing underscore every ArduPilot family name has', () => {
  // An unescaped trailing underscore is RST hyperlink-reference syntax: it
  // produced ~290 "Unknown target name" build errors and a mangled heading.
  generate()
  const body = readFileSync(path.join(PARAMS_DIR, 'group-adsb.rst'), 'utf8')
  assert.match(body, /ADSB\\_ parameters/)
})
