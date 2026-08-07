// The app's concept-level "i" bubbles (InfoDot) can deep-link a topic page in
// our own wiki. Those destinations live in one map — WIKI_TOPIC_PATHS in
// apps/web/src/view-models/param-docs.ts — and this test is why.
//
// A concept link is `page.html#anchor`, and BOTH halves rot silently:
//
//   - renaming or moving a wiki page leaves the app pointing at a 404, and
//   - editing a heading ("Filters" -> "Filtering") changes the docutils slug the
//     anchor is built from, so the link still loads the page but lands at the
//     top of it with no indication anything is wrong.
//
// Neither is a build failure on either side. A dead "i" link is worse than no
// link — it teaches an operator the affordance is unreliable — so the map is
// asserted against the wiki sources here.
//
// Asserting against the .rst sources rather than built HTML keeps this test
// hermetic: `npm run test` has no Sphinx. The anchors were additionally checked
// against a real `sphinx-build -b html wiki` run when they were introduced; the
// slug rule below is docutils' own and is what produced those ids.

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WIKI = path.join(REPO, 'wiki')
const PARAM_DOCS = path.join(REPO, 'apps', 'web', 'src', 'view-models', 'param-docs.ts')

/** The topic map, read out of the app source it is declared in. */
function readTopicPaths() {
  const source = readFileSync(PARAM_DOCS, 'utf8')
  const block = /export const WIKI_TOPIC_PATHS = \{([\s\S]*?)\n\} as const/.exec(source)
  assert.ok(block, 'WIKI_TOPIC_PATHS not found in param-docs.ts')
  const entries = [...block[1].matchAll(/^\s*(\w+):\s*'([^']+)'/gm)].map(([, key, value]) => [key, value])
  assert.ok(entries.length > 0, 'WIKI_TOPIC_PATHS parsed as empty')
  return entries
}

/**
 * docutils' id rule for a section title: lowercase, every run of non-alphanumeric
 * characters becomes a single '-', and leading/trailing '-' are dropped. This is
 * what turns "Rate controllers (PID gains)" into "rate-controllers-pid-gains".
 */
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Every heading anchor an .rst page declares (title line + underline line). */
function anchorsInPage(rstPath) {
  const lines = readFileSync(rstPath, 'utf8').split('\n')
  const anchors = new Set()
  for (let index = 1; index < lines.length; index += 1) {
    const underline = lines[index]
    const title = lines[index - 1].trim()
    if (title === '' || !/^[=\-~^"'`#*+_:.]{3,}$/.test(underline.trim())) continue
    if (underline.trim().length < title.length) continue
    anchors.add(slugify(title))
  }
  return anchors
}

test('every wiki topic an "i" bubble links resolves to a real page and heading', () => {
  const broken = []
  for (const [key, value] of readTopicPaths()) {
    const [page, anchor] = value.split('#')
    assert.match(page, /\.html$/, `${key}: topic paths are page.html#anchor, saw "${value}"`)
    const rst = path.join(WIKI, `${page.replace(/\.html$/, '')}.rst`)
    if (!existsSync(rst)) {
      broken.push(`${key} -> ${value}: no such wiki page (${path.relative(REPO, rst)})`)
      continue
    }
    if (anchor && !anchorsInPage(rst).has(anchor)) {
      broken.push(`${key} -> ${value}: page has no heading slugging to "#${anchor}"`)
    }
  }
  assert.deepEqual(broken, [], `dead wiki topic links:\n${broken.join('\n')}`)
})

test('a topic page reached by a bubble is reachable from the wiki nav too', () => {
  // A page that no toctree lists still builds, but Sphinx warns and the page is
  // orphaned — an operator who follows the link has no way back into the wiki.
  // Toctrees nest (wiki/index.rst lists first-time-setup/index, which lists the
  // pages under it), so a doc counts as reachable if ANY toctree names it —
  // either by full path from the wiki root or relative to its own directory.
  const toctrees = readdirSync(WIKI, { recursive: true })
    .filter((entry) => typeof entry === 'string' && entry.endsWith('.rst') && !entry.startsWith('parameters/'))
    .map((entry) => ({ dir: path.dirname(entry), text: readFileSync(path.join(WIKI, entry), 'utf8') }))
  const missing = []
  for (const [key, value] of readTopicPaths()) {
    const doc = value.split('#')[0].replace(/\.html$/, '')
    const listed = toctrees.some(({ dir, text }) => {
      const relative = dir === '.' ? doc : path.relative(dir, doc)
      return new RegExp(`^\\s+(${doc}|${relative})\\s*$`, 'm').test(text)
    })
    if (!listed) {
      missing.push(`${key} -> ${doc} is in no wiki toctree`)
    }
  }
  assert.deepEqual(missing, [], missing.join('\n'))
})
