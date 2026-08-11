import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseDfuSeMemoryLayout,
  findProtectedSectors,
  describeProtectedSectors
} from '../packages/firmware-flash/dist/index.js'

// A real STM32H7 layout. `g` = readable+erasable+writeable.
const OPEN = '@Internal Flash  /0x08000000/04*016Kg,01*016Kg,01*064Kg,07*128Kg'
// The same board with write protection on the first two sectors: `c` is
// readable+erasable but NOT writeable — what a WRP-locked sector reports.
const LOCKED = '@Internal Flash  /0x08000000/02*016Kc,02*016Kg,01*016Kg,01*064Kg,07*128Kg'

const segment = (address, length) => ({ address, data: new Uint8Array(length) })

test('an unprotected layout parses every sector as writable', () => {
  const sectors = parseDfuSeMemoryLayout(OPEN)
  assert.ok(sectors.length > 0)
  assert.ok(sectors.every((s) => s.writable && s.erasable && s.readable))
  assert.deepEqual(findProtectedSectors(sectors, [segment(0x08000000, 0x8000)]), [])
})

test('a WRP-locked sector the image touches is reported', () => {
  // The reported failure: a vendor ships nWRP1/nWRP2 set, blocking the
  // bootloader write. Catching it here is the difference between a refusal and
  // a board that fails partway through its erase.
  const sectors = parseDfuSeMemoryLayout(LOCKED)
  const blocked = findProtectedSectors(sectors, [segment(0x08000000, 0x8000)])
  assert.equal(blocked.length, 2)
  assert.equal(blocked[0].start, 0x08000000)
  assert.equal(blocked[0].writable, false)
  assert.equal(blocked[0].erasable, true)
})

test('a protected sector the image does NOT touch is not reported', () => {
  // Only the sectors this firmware actually needs matter; warning about the
  // rest would train operators to click through the warning.
  const sectors = parseDfuSeMemoryLayout(LOCKED)
  assert.deepEqual(findProtectedSectors(sectors, [segment(0x08040000, 0x1000)]), [])
})

test('a layout with no type letter is treated as permitted, not as protected', () => {
  // Inventing a protection the device never claimed would fire on every flash.
  const sectors = parseDfuSeMemoryLayout('@Internal Flash  /0x08000000/04*016K')
  assert.ok(sectors.every((s) => s.writable && s.erasable))
})

test('the explanation names the sectors and the real cause', () => {
  const sectors = parseDfuSeMemoryLayout(LOCKED)
  const text = describeProtectedSectors(findProtectedSectors(sectors, [segment(0x08000000, 0x8000)]))
  assert.match(text, /0x8000000/)
  assert.match(text, /nWRP/)
  assert.match(text, /bootloader/i)
})
