import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import { sha256 } from '../packages/protocol-mavlink/dist/sha256.js'

const encoder = new TextEncoder()

function hex(bytes) {
  return Buffer.from(bytes).toString('hex')
}

// Published NIST SHA-256 test vectors (FIPS 180-4 examples).
test('sha256 matches the published digest of the empty string', () => {
  assert.equal(
    hex(sha256(new Uint8Array(0))),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  )
})

test('sha256 matches the published digest of "abc"', () => {
  assert.equal(
    hex(sha256(encoder.encode('abc'))),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  )
})

test('sha256 matches the published 56-char two-block NIST vector', () => {
  // The 448-bit message that forces a second padding block.
  const message = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'
  assert.equal(
    hex(sha256(encoder.encode(message))),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
  )
})

test('sha256 agrees with node crypto across random-length inputs (incl. block boundaries)', () => {
  // Cross-check the vendored implementation against node's trusted SHA-256
  // over a range of lengths that exercise the 0x80 marker landing in every
  // position relative to the 64-byte block + the 2-block length carry.
  for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000]) {
    const input = new Uint8Array(length)
    for (let i = 0; i < length; i += 1) {
      input[i] = (i * 31 + 7) & 0xff
    }
    const expected = crypto.createHash('sha256').update(Buffer.from(input)).digest('hex')
    assert.equal(hex(sha256(input)), expected, `length ${length}`)
  }
})

test('sha256 does not mutate its input', () => {
  const input = encoder.encode('abc')
  const copy = Uint8Array.from(input)
  sha256(input)
  assert.deepEqual(Array.from(input), Array.from(copy))
})
