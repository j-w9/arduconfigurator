import assert from 'node:assert/strict'
import test from 'node:test'

import {
  parseBoardNameFromBanner,
  parseFirmwareStringFromBanner
} from '../packages/ardupilot-core/dist/index.js'

// Captured verbatim from a real board (ArduCopter 4.7.0-beta7-SFD on a
// BrotherHobby H743) so the parsers are pinned against what ArduPilot actually
// prints, not against a shape invented here.
const REAL_BANNER = [
  'ArduCopter V4.7.0-beta7-SFD (e89b80bb)',
  'ChibiOS: 4f34e217',
  'BROTHERHOBBYH743 00210044 3433510B 34303639',
  'RCOut: DS300:1-4 PWM:5-6 NeoP:7-10 PWM:11-13',
  'IMU0: fast sampling 4.0kHz/4.0kHz',
  'IMU1: normal sampling 1.0kHz/1.0kHz',
  'Frame: QUAD/X'
]

test('the board name is taken from the one banner line that carries it', () => {
  const names = REAL_BANNER.map(parseBoardNameFromBanner).filter((name) => name !== undefined)
  assert.deepEqual(names, ['BROTHERHOBBYH743'], 'exactly one line should match')
})

test('the firmware string keeps the fork suffix the decoded version drops', () => {
  // "4.7.0 (beta)" is what the decode gives; the suffix is the part that says
  // WHICH 4.7.0 build this is.
  const strings = REAL_BANNER.map(parseFirmwareStringFromBanner).filter((value) => value !== undefined)
  assert.deepEqual(strings, ['ArduCopter V4.7.0-beta7-SFD'])
})

test('no other banner line is mistaken for an identity line', () => {
  // The lines that follow are the realistic false positives: they are also
  // "word colon values", and IMU/Frame lines carry uppercase tokens.
  for (const line of REAL_BANNER.slice(1)) {
    if (line.startsWith('BROTHERHOBBY')) continue
    assert.equal(parseFirmwareStringFromBanner(line), undefined, line)
  }
  assert.equal(parseBoardNameFromBanner('ChibiOS: 4f34e217'), undefined)
  assert.equal(parseBoardNameFromBanner('Frame: QUAD/X'), undefined)
  assert.equal(parseBoardNameFromBanner('IMU0: fast sampling 4.0kHz/4.0kHz'), undefined)
})

test('a board this app has never catalogued still reports its own name', () => {
  // The whole point: boardType is looked up in our table, this is not.
  assert.equal(
    parseBoardNameFromBanner('SOMEBRANDNEWFC_H7 00210044 3433510B 34303639'),
    'SOMEBRANDNEWFC_H7'
  )
})

test('other vehicle firmwares are recognised too', () => {
  assert.equal(parseFirmwareStringFromBanner('ArduPlane V4.6.0 (abc123)'), 'ArduPlane V4.6.0')
  assert.equal(parseFirmwareStringFromBanner('ArduRover V4.5.7-dev'), 'ArduRover V4.5.7-dev')
})
