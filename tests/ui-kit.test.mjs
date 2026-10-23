import assert from 'node:assert/strict'
import test from 'node:test'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { DraftBar, InfoDot, appendLogLines, buttonStyle } from '../packages/ui-kit/dist/index.js'

// The components themselves are presentational and are covered by the app's
// own suites; what is worth pinning here is the log's line handling, which is
// pure and is the part that is easy to get wrong.

test('a multi-line block becomes one timestamped line each, not one line with newlines in it', () => {
  const lines = appendLogLines([], 'Connecting...\nChip is ESP32\n', 5000, '12:00:00.000')
  assert.deepEqual(lines, ['12:00:00.000  Connecting...', '12:00:00.000  Chip is ESP32'])
})

test('blank lines are dropped rather than timestamped into noise', () => {
  assert.deepEqual(appendLogLines([], '\n\n', 5000, '12:00:00.000'), [])
  // Nothing to append must return the same array, so a re-render is not
  // triggered by a library logging an empty string.
  const previous = ['kept']
  assert.equal(appendLogLines(previous, '', 5000, '12:00:00.000'), previous)
})

test('the cap drops from the FRONT — the end of a flash is the part worth keeping', () => {
  let lines = []
  for (let i = 0; i < 12; i += 1) {
    lines = appendLogLines(lines, `line ${i}`, 5, '12:00:00.000')
  }
  assert.equal(lines.length, 5)
  assert.equal(lines[0], '12:00:00.000  line 7')
  assert.equal(lines[4], '12:00:00.000  line 11')
})

test('a single logged block longer than the cap still ends on its last line', () => {
  const block = ['a', 'b', 'c', 'd'].join('\n')
  const lines = appendLogLines([], block, 2, '12:00:00.000')
  assert.deepEqual(lines, ['12:00:00.000  c', '12:00:00.000  d'])
})

test('buttonStyle still answers for each kind (the promoted components build on it)', () => {
  for (const kind of ['primary', 'secondary', 'hero']) {
    assert.equal(typeof buttonStyle(kind).cursor, 'string', `${kind} is a style object`)
  }
})

// DraftBar and InfoDot were drawn inside apps/web, which still renders them
// through thin adapters; what is pinned here is the behaviour a second consumer
// relies on without apps/web's e2e suite to catch it.

const render = (component, props, ...children) => renderToStaticMarkup(createElement(component, props, ...children))
const noop = () => {}
const button = (html, testId) => html.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? ''
const isDisabled = (html, testId) => / disabled=""/.test(button(html, testId))
const bar = (overrides = {}) =>
  render(DraftBar, { stagedCount: 2, busy: false, onWrite: noop, onDiscard: noop, ...overrides })

test('DraftBar will not write an invalid value, an empty set, while busy, or when the caller says no', () => {
  assert.equal(isDisabled(bar(), 'draft-write'), false)
  assert.equal(isDisabled(bar({ invalidCount: 1 }), 'draft-write'), true)
  assert.equal(isDisabled(bar({ stagedCount: 0 }), 'draft-write'), true)
  assert.equal(isDisabled(bar({ busy: true }), 'draft-write'), true)
  assert.equal(isDisabled(bar({ canWrite: false }), 'draft-write'), true)
})

test('DraftBar: Discard with nothing to discard is disabled, not a button that does nothing', () => {
  assert.equal(isDisabled(bar({ stagedCount: 0 }), 'draft-discard'), true)
  assert.equal(isDisabled(bar({ stagedCount: 0, invalidCount: 1 }), 'draft-discard'), false)
  assert.equal(isDisabled(bar(), 'draft-discard'), false)
})

test('DraftBar: the reboot prompt replaces the write controls only once nothing is staged', () => {
  const reboot = { pending: true, message: 'restart it', buttonLabel: 'Reboot', onRequest: noop }
  const prompt = bar({ stagedCount: 0, reboot })
  assert.match(prompt, /data-testid="draft-reboot"/)
  assert.doesNotMatch(prompt, /data-testid="draft-write"/)
  // A staged change outranks a pending reboot: rebooting would not write it.
  const staged = bar({ stagedCount: 1, reboot })
  assert.match(staged, /data-testid="draft-write"/)
  assert.doesNotMatch(staged, /data-testid="draft-reboot"/)
})

test('DraftBar: every test id takes the prefix, so apps/web keeps its global-draft-* ids', () => {
  const html = bar({ testIdPrefix: 'global-', onShowChanges: noop })
  const ids = [...html.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(ids.sort(), ['global-draft-bar', 'global-draft-count', 'global-draft-discard', 'global-draft-show', 'global-draft-write'])
})

test('DraftBar floats by default and goes in flow only when asked; Show changes only with somewhere to show', () => {
  assert.doesNotMatch(bar(), /parameter-draft-bar--inline/)
  assert.match(bar({ placement: 'inline' }), /class="parameter-draft-bar parameter-draft-bar--inline"/)
  assert.doesNotMatch(bar(), /draft-show/)
})

test('InfoDot: a tip only takes pointer events when it has a link to click', () => {
  const plain = render(InfoDot, { label: 'About it' }, 'text')
  assert.doesNotMatch(plain, /receiver-info-tip--linked/)
  assert.doesNotMatch(plain, /<a /)
  const linked = render(InfoDot, { label: 'About it', links: [{ href: 'https://example.invalid/x', label: 'More', testId: 'more' }] }, 'text')
  assert.match(linked, /receiver-info-tip--linked/)
  assert.match(linked, /<a class="receiver-info-wiki" href="https:\/\/example.invalid\/x" target="_blank" rel="noopener noreferrer" data-testid="more">More<\/a>/)
})
