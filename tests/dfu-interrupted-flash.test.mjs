// A DFU flash cut off at any point must never be reported as good, and must
// leave the board in a state it can recover from on its own: the old firmware
// untouched, the new one complete, or ArduPilot's bootloader in place with the
// app's first words blank (bl_protocol.cpp will not start such an app, so the
// board waits in its bootloader for a normal .apj flash).
//
// The fake board below behaves like STM32 flash: an erase sets a sector to
// 0xFF, a write over bytes that are not blank fails (flash cannot be rewritten
// without an erase), and a fault can cut the USB link at any transfer -- or
// halfway through a block, as a power loss would.

import assert from 'node:assert/strict'
import test from 'node:test'

import { DfuSeDevice, findAppStart, parseDfuSeMemoryLayout } from '../packages/firmware-flash/dist/index.js'

const LAYOUT = '@Internal Flash  /0x08000000/8*016Kg'
const BASE = 0x08000000
const SECTOR = 0x4000
const XFER = 1024

/** A _with_bl-shaped image: a bootloader in sector 0, the app from sector 1. */
function image(seed, { bootloaderSeed = 1 } = {}) {
  const appStart = BASE + SECTOR
  const data = new Uint8Array(SECTOR + 6000).fill(0xff)
  const vectors = (offset, base) => {
    const view = new DataView(data.buffer)
    view.setUint32(offset, 0x20020000, true) // initial stack, in SRAM
    view.setUint32(offset + 4, (base + 0x201) | 1, true) // Thumb reset handler, inside the image
  }
  for (let i = 8; i < 3000; i += 1) data[i] = (i * 13 + bootloaderSeed) & 0xff
  vectors(0, BASE)
  for (let i = SECTOR + 8; i < data.length; i += 1) data[i] = (i * 7 + seed) & 0xff
  vectors(SECTOR, appStart)
  return [{ address: BASE, data }]
}

function fakeBoard(installed, faults = {}) {
  const flash = new Uint8Array(8 * SECTOR).fill(0xff)
  for (const segment of installed) flash.set(segment.data, segment.address - BASE)
  let state = 2
  let status = 0
  let pointer = BASE
  let transfers = 0
  let gone = false
  const stallsLeft = new Set(faults.stallAt ?? [])
  // Chrome on macOS/Linux reports a stall as status 'stall'; on Windows it throws a NetworkError.
  const stallError = () =>
    faults.windows
      ? Object.assign(new Error("Failed to execute 'controlTransferOut' on 'USBDevice': A transfer error has occurred."), { name: 'NetworkError' })
      : new Error('DFU control transfer failed (stall)')
  const step = (kind) => {
    transfers += 1
    if (gone) throw Object.assign(new Error('The device was disconnected.'), { name: 'NotFoundError' })
    if (transfers === faults.cutAt) {
      gone = true
      if (kind === 'block' && faults.halfBlock) return 'half'
      throw Object.assign(new Error('The device was disconnected.'), { name: 'NotFoundError' })
    }
    if (stallsLeft.has(transfers)) {
      stallsLeft.delete(transfers)
      throw stallError()
    }
    return 'ok'
  }
  const write = (address, bytes) => {
    const offset = address - BASE
    for (let i = 0; i < bytes.length; i += 1) {
      if (flash[offset + i] !== 0xff) return false
    }
    flash.set(bytes, offset)
    return true
  }
  const iface = {
    async controlOut(request, value, data) {
      const kind = request === 1 && value >= 2 ? 'block' : 'command'
      const outcome = step(kind)
      if (request === 4) {
        state = 2
        status = 0
      } else if (request === 6) {
        state = 2
      } else if (request === 1) {
        if (value === 0 && data.length === 0) {
          state = 2
        } else if (value === 0 && data[0] === 0x21) {
          pointer = (data[1] | (data[2] << 8) | (data[3] << 16) | (data[4] << 24)) >>> 0
          state = 5
        } else if (value === 0 && data[0] === 0x41) {
          const address = (data[1] | (data[2] << 8) | (data[3] << 16) | (data[4] << 24)) >>> 0
          flash.fill(0xff, address - BASE, address - BASE + SECTOR)
          state = 5
        } else if (value >= 2) {
          const address = pointer + (value - 2) * XFER
          const bytes = outcome === 'half' ? data.subarray(0, data.length >> 1) : data
          if (!write(address, bytes)) {
            state = 10
            status = 0x06 // errPROG
          } else {
            state = 5
          }
          if (outcome === 'half') throw Object.assign(new Error('The device was disconnected.'), { name: 'NotFoundError' })
        }
      }
    },
    async controlIn(request, value, length) {
      step('command')
      if (request === 3) return new Uint8Array([status, 0, 0, 0, state, 0])
      if (request === 2) {
        const offset = pointer - BASE + (value - 2) * XFER
        state = 9
        return flash.slice(offset, offset + length)
      }
      return new Uint8Array(6)
    }
  }
  return { iface, flash, transfers: () => transfers }
}

const holds = (flash, segments) =>
  segments.every((segment) => segment.data.every((byte, i) => flash[segment.address - BASE + i] === byte))
// ArduPilot's bootloader will not start an app if any of its first eight words is blank.
const blankAt = (flash, address) => {
  const view = new DataView(flash.buffer, address - BASE, 32)
  return [0, 1, 2, 3, 4, 5, 6, 7].some((word) => view.getUint32(word * 4, true) === 0xffffffff)
}

async function flashOnce(board, incoming, options) {
  const device = new DfuSeDevice(board.iface, parseDfuSeMemoryLayout(LAYOUT), XFER, async () => {})
  try {
    await device.flash(incoming, undefined, options)
    return true
  } catch {
    return false
  }
}

const memory = parseDfuSeMemoryLayout(LAYOUT)
const oldFirmware = image(3)
const newFirmware = image(9)
const appStart = findAppStart(newFirmware, memory)

test('the app start is found past the bootloader', () => {
  assert.equal(appStart, BASE + SECTOR)
})

for (const fullErase of [false, true]) {
  for (const bootloaderChanges of [false, true]) {
    const incoming = bootloaderChanges ? image(9, { bootloaderSeed: 5 }) : newFirmware
    const label = `${fullErase ? 'full erase' : 'sector erase'}, ${bootloaderChanges ? 'new bootloader' : 'same bootloader'}`

    test(`cut off at every transfer (${label}): never reported good, never left unbootable`, async () => {
      const clean = fakeBoard(oldFirmware)
      assert.equal(await flashOnce(clean, incoming, { fullErase }), true)
      assert.ok(holds(clean.flash, incoming))
      const total = clean.transfers()

      for (const halfBlock of [false, true]) {
        for (let cutAt = 1; cutAt <= total; cutAt += 1) {
          const board = fakeBoard(oldFirmware, { cutAt, halfBlock })
          const ok = await flashOnce(board, incoming, { fullErase })
          const where = `cut at transfer ${cutAt}/${total}${halfBlock ? ' mid-block' : ''}`
          if (ok) {
            // Only a cut during the leave (after the full read-back) may still report success.
            assert.ok(holds(board.flash, incoming), `${where}: reported good but the image is not on the board`)
            continue
          }
          const untouched = holds(board.flash, oldFirmware)
          const complete = holds(board.flash, incoming)
          const bootloaderIntact = incoming[0].data.subarray(0, SECTOR).every((byte, i) => board.flash[i] === byte) ||
            oldFirmware[0].data.subarray(0, SECTOR).every((byte, i) => board.flash[i] === byte)
          const parked = bootloaderIntact && blankAt(board.flash, appStart)
          if (bootloaderChanges && !bootloaderIntact) {
            // Replacing the bootloader itself has a window no write order can
            // close: the ST ROM's DFU (BOOT0) is the way back from it.
            continue
          }
          assert.ok(untouched || complete || parked, `${where}: left a board that would jump into a half-written app`)
        }
      }
    })
  }
}

test('an unchanged bootloader is never erased or rewritten', async () => {
  const board = fakeBoard(oldFirmware)
  const erased = []
  const controlOut = board.iface.controlOut
  board.iface.controlOut = async (request, value, data) => {
    if (request === 1 && value === 0 && data[0] === 0x41) erased.push((data[1] | (data[2] << 8) | (data[3] << 16) | (data[4] << 24)) >>> 0)
    return controlOut(request, value, data)
  }
  assert.equal(await flashOnce(board, newFirmware, { fullErase: true }), true)
  assert.ok(!erased.includes(BASE), 'sector 0 was erased although it already held this bootloader')
  assert.ok(erased.includes(BASE + SECTOR))
  assert.ok(holds(board.flash, newFirmware))
})

for (const windows of [false, true]) test(`a stall anywhere is ridden out and the flash still lands${windows ? ' (Windows: a transfer error)' : ''}`, async () => {
  const clean = fakeBoard(oldFirmware)
  await flashOnce(clean, newFirmware, { fullErase: false })
  const total = clean.transfers()
  for (let stallAt = 1; stallAt <= total; stallAt += 1) {
    const board = fakeBoard(oldFirmware, { stallAt: [stallAt], windows })
    const ok = await flashOnce(board, newFirmware, { fullErase: false })
    if (ok) {
      assert.ok(holds(board.flash, newFirmware), `stall at ${stallAt}: reported good but the image is not on the board`)
    } else {
      // Whatever a stall still stops must stop safe.
      assert.ok(holds(board.flash, oldFirmware) || holds(board.flash, newFirmware) || blankAt(board.flash, appStart), `stall at ${stallAt}: failed unsafe`)
    }
  }
})

test('an H743 rev V that stays busy after an erase is cleared and the flash lands', async () => {
  const board = fakeBoard(oldFirmware)
  // After each erase the board answers dfuDNBUSY until it gets two CLRSTATUS
  // requests: the first leaves it in dfuERROR, the second in dfuIDLE.
  let wedged = 0
  let clears = 0
  const { controlOut, controlIn } = board.iface
  board.iface.controlOut = async (request, value, data) => {
    if (request === 1 && value === 0 && data[0] === 0x41) wedged = 1
    if (request === 4 && wedged) {
      clears += 1
      if (wedged === 1) {
        wedged = 2
        return
      }
      wedged = 0
    }
    return controlOut(request, value, data)
  }
  board.iface.controlIn = async (request, value, length) => {
    if (request === 3 && wedged === 1) return new Uint8Array([0, 10, 0, 0, 4, 0]) // dfuDNBUSY, 10 ms
    if (request === 3 && wedged === 2) return new Uint8Array([0x0e, 0, 0, 0, 10, 0]) // errUNKNOWN, dfuERROR
    return controlIn(request, value, length)
  }
  assert.equal(await flashOnce(board, newFirmware, { fullErase: false }), true)
  assert.ok(clears >= 2)
  assert.ok(holds(board.flash, newFirmware))
})

test('an erase that runs past the wait the board asked for is waited out, never cleared', async () => {
  // A real H743 erases a 128 KiB sector for seconds but asks for a shorter
  // wait, and stalls a CLRSTATUS sent meanwhile (on Windows: a transfer error).
  for (const fullErase of [false, true]) {
    const board = fakeBoard(oldFirmware)
    let busyPolls = 0
    let clears = 0
    const { controlOut, controlIn } = board.iface
    board.iface.controlOut = async (request, value, data) => {
      if (request === 1 && value === 0 && data[0] === 0x41) busyPolls = 25
      if (request === 4 && busyPolls > 0) {
        clears += 1
        throw Object.assign(new Error('A transfer error has occurred.'), { name: 'NetworkError' })
      }
      return controlOut(request, value, data)
    }
    board.iface.controlIn = async (request, value, length) => {
      if (request === 3 && busyPolls > 0) {
        busyPolls -= 1
        return new Uint8Array([0, 100, 0, 0, 4, 0]) // dfuDNBUSY, asks for 100 ms
      }
      return controlIn(request, value, length)
    }
    assert.equal(await flashOnce(board, newFirmware, { fullErase }), true)
    assert.equal(clears, 0)
    assert.ok(holds(board.flash, newFirmware))
  }
})
