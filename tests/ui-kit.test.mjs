import assert from 'node:assert/strict'
import test from 'node:test'

import { appendLogLines, buttonStyle } from '../packages/ui-kit/dist/index.js'

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
