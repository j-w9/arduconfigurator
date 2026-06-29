import assert from 'node:assert/strict'
import test from 'node:test'
import { deflateSync, inflateSync } from 'node:zlib'

import {
  arduPilotCrc32,
  firmwareCrc,
  parseApj,
  decodeApjImage,
  decodeApjExtfImage,
  padTo4,
  MAX_FIRMWARE_IMAGE_BYTES,
  checkBoardMatch,
  checkImageFitsFlash,
  BootloaderClient,
  chipEraseTimeoutMs,
  parseManifest,
  fetchManifest,
  firmwaresForBoard,
  availableReleaseTypes,
  selectFirmware,
  firmwaresForDronecanNode,
  dronecanNodeReleaseTypes,
  dronecanNodeBoardId
} from '../packages/firmware-flash/dist/index.js'

const INSYNC = 0x12
const OK = 0x10
const FAILED = 0x11
const INVALID = 0x13

// Scripted serial: read() pops from a pre-seeded inbound queue; every
// write() is recorded for framing assertions.
class ScriptedSerial {
  constructor(inbound = []) {
    this.inbound = Uint8Array.from(inbound)
    this.cursor = 0
    this.writes = []
    this.flushed = 0
  }
  push(bytes) {
    const next = new Uint8Array(this.inbound.length + bytes.length)
    next.set(this.inbound)
    next.set(Uint8Array.from(bytes), this.inbound.length)
    this.inbound = next
  }
  async write(data) {
    this.writes.push(Array.from(data))
  }
  async read(n) {
    if (this.cursor + n > this.inbound.length) {
      throw new Error('scripted serial: read past end (simulated timeout)')
    }
    const slice = this.inbound.slice(this.cursor, this.cursor + n)
    this.cursor += n
    return slice
  }
  flushInput() {
    this.flushed += 1
  }
}

const le32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]

test('ArduPilot CRC-32 uses the STANDARD reflected table (0xEDB88320) with init 0 and no inversion', () => {
  assert.equal(arduPilotCrc32(new Uint8Array()), 0, 'empty = init state 0')
  // INDEPENDENT ground truth, not self-generated: a single byte n with
  // state 0 returns crctab[n] directly, so these lock our generated
  // table against the canonical published zlib/uploader.py crctab.
  // (The previous "locked" vectors were generated from a table built
  // with a typo'd polynomial 0xEDB88420 — they passed forever while
  // every GET_CRC verify against real hardware failed. Conformance
  // audit caught it; never lock CRC vectors produced by the code
  // under test.)
  assert.equal(arduPilotCrc32(new Uint8Array([0x01])), 0x77073096, 'crctab[1] — canonical zlib table')
  assert.equal(arduPilotCrc32(new Uint8Array([0xff])), 0x2d02ef8d, 'crctab[255] — canonical zlib table')
  // Full-string vector computed with the canonical table, init 0, no
  // pre/post inversion. Deliberately NOT 0xcbf43926 (the zlib crc32()
  // of "123456789", which wraps the same table in init/final
  // 0xFFFFFFFF) — proves the no-inversion call convention.
  assert.equal(arduPilotCrc32(new TextEncoder().encode('123456789')), 0x2dfd2d88)
  assert.notEqual(arduPilotCrc32(new TextEncoder().encode('123456789')), 0xcbf43926)
})

test('firmwareCrc: 4-align required; padding to flash size is deterministic', () => {
  const img = padTo4(new Uint8Array([1, 2, 3, 4, 5, 6, 7]))
  assert.equal(img.length, 8)
  // No padding iterations when flash == image length → equals raw CRC.
  assert.equal(firmwareCrc(img, img.length), arduPilotCrc32(img, 0))
  assert.equal(firmwareCrc(img, 64), 0xdfae288c) // re-locked post polynomial fix
  assert.throws(() => firmwareCrc(new Uint8Array([1, 2, 3]), 64), /4-byte aligned/)
})

test('parseApj validates and decodeApjImage round-trips + 4-aligns', async () => {
  const raw = new Uint8Array([10, 20, 30, 40, 50])
  const apj = JSON.stringify({
    board_id: 9,
    board_revision: 0,
    image_size: 5,
    image: Buffer.from(deflateSync(Buffer.from(raw))).toString('base64')
  })
  const parsed = parseApj(apj)
  assert.equal(parsed.boardId, 9)
  assert.equal(parsed.imageSize, 5)
  const decoded = await decodeApjImage(parsed, (z) => new Uint8Array(inflateSync(Buffer.from(z))))
  assert.equal(decoded.length, 8, 'padded to 4-byte multiple')
  assert.deepEqual(Array.from(decoded.slice(0, 5)), [10, 20, 30, 40, 50])
  assert.deepEqual(Array.from(decoded.slice(5)), [0xff, 0xff, 0xff])

  assert.throws(() => parseApj('not json'), /not valid JSON/)
  assert.throws(() => parseApj('{"board_id":1}'), /missing "image"/)
  assert.throws(() => parseApj(JSON.stringify({ image: 'AA==' })), /board_id/)
  // inflated length mismatch is rejected (corruption guard).
  const bad = parseApj(
    JSON.stringify({ board_id: 1, image_size: 999, image: Buffer.from(deflateSync(Buffer.from(raw))).toString('base64') })
  )
  await assert.rejects(
    () => decodeApjImage(bad, (z) => new Uint8Array(inflateSync(Buffer.from(z)))),
    /image_size declares/
  )
})

test('parseApj accepts an .apj that omits image_size (uploader.py-faithful); inflated length is authoritative', async () => {
  // User-reported: a real ArduPilot .apj was rejected with
  // "missing/invalid image_size". ArduPilot's own uploader.py never
  // requires image_size — it derives the size from the decompressed
  // image — so a missing/garbled value must NOT block flashing; it just
  // means "no declared size" and the cross-check is skipped.
  const raw = new Uint8Array([1, 2, 3, 4, 5, 6, 7])
  const b64 = Buffer.from(deflateSync(Buffer.from(raw))).toString('base64')

  const noSize = parseApj(JSON.stringify({ board_id: 9, image: b64 }))
  assert.equal(noSize.boardId, 9)
  assert.equal(noSize.imageSize, undefined, 'absent image_size -> undefined, not a hard failure')
  const decoded = await decodeApjImage(noSize, (z) => new Uint8Array(inflateSync(Buffer.from(z))))
  assert.equal(decoded.length, 8, 'inflated length authoritative, padded to a 4-byte multiple')
  assert.deepEqual(Array.from(decoded.slice(0, 7)), [1, 2, 3, 4, 5, 6, 7])

  // A non-numeric / non-positive image_size is likewise treated as
  // absent (advisory), not a hard rejection.
  for (const bad of ['n/a', null, 0, -5]) {
    const garbled = parseApj(JSON.stringify({ board_id: 9, image_size: bad, image: b64 }))
    assert.equal(garbled.imageSize, undefined, `image_size ${JSON.stringify(bad)} -> undefined`)
  }
})

test('decodeApjImage enforces the OOM cap on the inflated length even when image_size is absent', async () => {
  // Relaxing the parse-time image_size requirement must NOT reopen the
  // decompression-bomb hole: the cap is also enforced post-inflate (the
  // node path has no streaming cap), so an absent/lying size cannot
  // bypass it.
  const parsed = parseApj(JSON.stringify({ board_id: 9, image: 'AA==' }))
  assert.equal(parsed.imageSize, undefined)
  await assert.rejects(
    () => decodeApjImage(parsed, () => new Uint8Array(MAX_FIRMWARE_IMAGE_BYTES + 1)),
    /exceeding the .* safety cap/
  )
})

test('checkBoardMatch is the point-of-no-return brick guard', () => {
  // Same board id -> ok, no message.
  const ok = checkBoardMatch(1069, 1069)
  assert.equal(ok.ok, true)
  assert.equal(ok.reason, undefined)
  // Mismatch -> refused, with an operator message naming both ids (the
  // classic wrong-image brick this guard exists to prevent).
  const bad = checkBoardMatch(140, 1069)
  assert.equal(bad.ok, false)
  assert.match(bad.reason ?? '', /Refusing to flash/)
  assert.match(bad.reason ?? '', /140/)
  assert.match(bad.reason ?? '', /1069/)
})

test('checkBoardMatch mismatch message includes friendly board names from the ArduPilot board_types.txt lookup', () => {
  // 59 = ARK_FPV and 1013 = MATEKH743 in ArduPilot Tools/AP_Bootloader/
  // board_types.txt. The error message should surface those so the
  // operator can recognise their hardware without cross-referencing
  // the bootloader source.
  const bad = checkBoardMatch(59, 1013)
  assert.equal(bad.ok, false)
  assert.match(bad.reason ?? '', /Refusing to flash/)
  assert.match(bad.reason ?? '', /59 \(ARK_FPV\)/, 'firmware board id surfaces its name')
  assert.match(bad.reason ?? '', /1013 \(MATEKH743\)/, 'connected board id surfaces its name')
})

test('checkImageFitsFlash is the second point-of-no-return brick guard', () => {
  // Fits (and the exact-fit boundary) -> ok, no message.
  assert.deepEqual(checkImageFitsFlash(2048, 2080768), { ok: true })
  assert.deepEqual(checkImageFitsFlash(2080768, 2080768), { ok: true })
  // Too large -> refused, message names both sizes and points at the
  // wrong-build cause (board-id-collision-across-flash-variants / a
  // corrupt or proxy-served .apj) this guard exists to catch pre-erase.
  const bad = checkImageFitsFlash(2080772, 2080768)
  assert.equal(bad.ok, false)
  assert.match(bad.reason ?? '', /Refusing to flash/)
  assert.match(bad.reason ?? '', /2080772/)
  assert.match(bad.reason ?? '', /2080768/)
})

test('flash(): an image too large for the board is refused BEFORE CHIP_ERASE', async () => {
  // The brick-prevention guarantee: an oversized image must throw with
  // the old firmware still intact — NOT after erase() has wiped it (the
  // pre-fix behavior, where program() only FAILs post-erase). Assert no
  // bytes were ever written, so CHIP_ERASE was never sent.
  const tooBig = padTo4(new Uint8Array(64))
  const io = new ScriptedSerial() // empty: any protocol I/O would throw differently
  await assert.rejects(
    () => new BootloaderClient(io).flash(tooBig, 16),
    (err) => /Refusing to flash/.test(err.message) && /No erase was performed/.test(err.message)
  )
  assert.equal(io.writes.length, 0, 'nothing written → CHIP_ERASE never sent → board still bootable')
})

test('parseApj rejects an oversized image_size (decompression-bomb / OOM guard)', () => {
  // A malicious/corrupt (proxy-served) .apj declaring a huge image_size
  // must be refused up front, before any allocate/inflate.
  assert.ok(MAX_FIRMWARE_IMAGE_BYTES > 4 * 1024 * 1024, 'cap must be generous vs real images')
  assert.throws(
    () =>
      parseApj(
        JSON.stringify({ board_id: 9, image_size: MAX_FIRMWARE_IMAGE_BYTES + 1, image: 'AA==' })
      ),
    /exceeds the .* safety cap/
  )
  // A normal-sized image still parses.
  const ok = parseApj(JSON.stringify({ board_id: 9, image_size: 1024, image: 'AA==' }))
  assert.equal(ok.imageSize, 1024)
})

test('parseManifest drops entries whose url is not https (no javascript:/data:/http:)', () => {
  const manifest = JSON.stringify({
    'format-version': '1.0.0',
    firmware: [
      {
        vehicletype: 'Copter', board_id: 7, format: 'apj',
        'mav-firmware-version-type': 'OFFICIAL',
        url: 'https://firmware.ardupilot.org/Copter/stable/X/arducopter.apj'
      },
      {
        vehicletype: 'Copter', board_id: 7, format: 'apj',
        'mav-firmware-version-type': 'OFFICIAL', url: 'http://evil.example/x.apj'
      },
      {
        vehicletype: 'Copter', board_id: 7, format: 'apj',
        'mav-firmware-version-type': 'OFFICIAL', url: 'javascript:alert(1)'
      }
    ]
  })
  const parsed = parseManifest(manifest)
  assert.equal(parsed.entries.length, 1, 'only the https entry survives')
  assert.ok(parsed.entries[0].url.startsWith('https://'))
})

test('identify(): handshake, BL-rev gate, board id / flash size', async () => {
  const io = new ScriptedSerial([
    INSYNC, OK, // sync()
    ...le32(5), INSYNC, OK, // BL_REV = 5
    ...le32(50), INSYNC, OK, // BOARD_ID
    ...le32(0), INSYNC, OK, // BOARD_REV
    ...le32(2080768), INSYNC, OK // FLASH_SIZE (~2MB)
  ])
  const id = await new BootloaderClient(io).identify()
  assert.deepEqual(id, {
    bootloaderRevision: 5,
    boardId: 50,
    boardRevision: 0,
    flashSize: 2080768
  })
  // First write is GET_SYNC + EOC; the four queries are GET_DEVICE,param,EOC.
  assert.deepEqual(io.writes[0], [0x21, 0x20])
  assert.deepEqual(io.writes[1], [0x22, 0x01, 0x20]) // GET_DEVICE INFO_BL_REV EOC
  assert.deepEqual(io.writes[4], [0x22, 0x04, 0x20]) // INFO_FLASH_SIZE

  const stale = new ScriptedSerial([INSYNC, OK, ...le32(99), INSYNC, OK])
  await assert.rejects(() => new BootloaderClient(stale).identify(), /unsupported protocol revision 99/)
})

test('identify(): BL rev floor is 2 (audit-24 accepts rev 2 via byte-compare verify)', async () => {
  // Pre-audit-24 the floor was 3 (rev 2 had no GET_CRC). With the
  // CHIP_VERIFY + READ_MULTI byte-compare verify path added, rev 2 is
  // now supported — unblocks legacy AUAV-X2 / early PX4FMUv1/v2 / clone
  // boards. Rev 1 (and anything > rev 5) is still rejected.
  const rev1 = new ScriptedSerial([INSYNC, OK, ...le32(1), INSYNC, OK])
  await assert.rejects(
    () => new BootloaderClient(rev1).identify(),
    /unsupported protocol revision 1 \(supported 2-5\)/
  )
  const rev2 = new ScriptedSerial([
    INSYNC, OK, ...le32(2), INSYNC, OK, ...le32(9), INSYNC, OK, ...le32(0), INSYNC, OK, ...le32(1024), INSYNC, OK
  ])
  const id2 = await new BootloaderClient(rev2).identify()
  assert.equal(id2.bootloaderRevision, 2, 'rev 2 accepted post-audit-24')
  assert.equal(id2.boardId, 9, 'identify still parses the rest of the descriptor cleanly')
})

test('identify({syncTimeoutMs}) bounds only the initial GET_SYNC wait (pre-scan fast-fail)', async () => {
  // The web flasher's pre-scan probes already-authorized ports that are
  // usually NOT bootloaders (firmware/MAVLink ports never answer
  // GET_SYNC) — a short initial budget is what makes scanning N ports
  // tolerable. After the sync answers, the GET_DEVICE reads must revert
  // to the standard 3s timeout.
  const silentTimeouts = []
  const silent = {
    async write() {},
    async read(n, timeoutMs) {
      silentTimeouts.push(timeoutMs)
      throw new Error(`serial read timed out waiting for ${n} bytes`)
    },
    flushInput() {}
  }
  await assert.rejects(() => new BootloaderClient(silent).identify({ syncTimeoutMs: 800 }), /timed out/)
  assert.deepEqual(silentTimeouts, [800], 'initial GET_SYNC wait used the caller budget')

  const afterSyncTimeouts = []
  let reads = 0
  const answersSyncOnly = {
    async write() {},
    async read(n, timeoutMs) {
      afterSyncTimeouts.push(timeoutMs)
      reads += 1
      if (reads === 1) return Uint8Array.from([INSYNC])
      if (reads === 2) return Uint8Array.from([OK])
      throw new Error(`serial read timed out waiting for ${n} bytes`)
    },
    flushInput() {}
  }
  await assert.rejects(() => new BootloaderClient(answersSyncOnly).identify({ syncTimeoutMs: 800 }), /timed out/)
  assert.deepEqual(afterSyncTimeouts.slice(0, 2), [800, 800], 'both GET_SYNC reply bytes use the short budget')
  assert.equal(afterSyncTimeouts[2], 3000, 'GET_DEVICE read reverts to the standard timeout')

  // No options at all → unchanged default everywhere.
  const defaultTimeouts = []
  const silentDefault = {
    async write() {},
    async read(n, timeoutMs) {
      defaultTimeouts.push(timeoutMs)
      throw new Error(`serial read timed out waiting for ${n} bytes`)
    },
    flushInput() {}
  }
  await assert.rejects(() => new BootloaderClient(silentDefault).identify(), /timed out/)
  assert.deepEqual(defaultTimeouts, [3000], 'no-option identify keeps the 3s default')
})

test('getSync error replies map to clear errors', async () => {
  await assert.rejects(
    () => new BootloaderClient(new ScriptedSerial([INSYNC, FAILED])).identify(),
    /OPERATION FAILED/
  )
  await assert.rejects(
    () => new BootloaderClient(new ScriptedSerial([INSYNC, INVALID])).identify(),
    /INVALID OPERATION/
  )
  await assert.rejects(
    () => new BootloaderClient(new ScriptedSerial([0x99, OK])).identify(),
    /expected INSYNC/
  )
})

test('program(): 128-byte PROG_MULTI chunking + per-chunk uploader.py framing', async () => {
  // 600-byte image @ 128/chunk -> five chunks: 128, 128, 128, 128, 88.
  // Each chunk is sent as FOUR separate writes (cmd / len / payload / EOC)
  // to mirror uploader.py — bundling them into one writer.write() handed
  // the OS a burst large enough to overflow the bootloader's RX buffer
  // and silently corrupt payload (caught only at the final GET_CRC).
  // flushInput() before each chunk drops any stray byte so the next
  // chunk can't be shifted by a late ACK tail / boot banner.
  const image = padTo4(new Uint8Array(600).map((_, i) => i & 0xff))
  const io = new ScriptedSerial([INSYNC, OK, INSYNC, OK, INSYNC, OK, INSYNC, OK, INSYNC, OK])
  let lastRatio = 0
  await new BootloaderClient(io).program(image, (phase, r) => {
    assert.equal(phase, 'program')
    lastRatio = r
  })
  // 5 chunks * 4 writes per chunk = 20 writes (no bundled-frame fallback).
  assert.equal(io.writes.length, 20)
  // First chunk framing: PROG_MULTI alone / length alone / 128-byte payload / EOC alone.
  assert.deepEqual(io.writes[0], [0x27])
  assert.deepEqual(io.writes[1], [128])
  assert.equal(io.writes[2].length, 128)
  assert.deepEqual(io.writes[3], [0x20])
  // Final chunk (writes 16-19): same shape, payload length 88.
  assert.deepEqual(io.writes[16], [0x27])
  assert.deepEqual(io.writes[17], [88])
  assert.equal(io.writes[18].length, 88)
  assert.deepEqual(io.writes[19], [0x20])
  // flushInput() called once per chunk so a stray byte can't shift the next chunk.
  assert.equal(io.flushed, 5)
  assert.equal(lastRatio, 1)
  await assert.rejects(
    () => new BootloaderClient(new ScriptedSerial()).program(new Uint8Array([1, 2, 3])),
    /4-byte aligned/
  )
})

test('verify(): CRC match passes, mismatch throws with both values', async () => {
  const image = padTo4(new Uint8Array([9, 8, 7, 6, 5]))
  const flash = 4096
  const good = firmwareCrc(image, flash)
  const okIo = new ScriptedSerial([...le32(good), INSYNC, OK])
  await new BootloaderClient(okIo).verify(image, flash)
  assert.deepEqual(okIo.writes[0], [0x29, 0x20]) // GET_CRC EOC

  const badIo = new ScriptedSerial([...le32((good ^ 0xdead) >>> 0), INSYNC, OK])
  await assert.rejects(() => new BootloaderClient(badIo).verify(image, flash), /CRC verify failed/)
})

test('erase() polls trySync until the chip acks', async () => {
  // First poll: no data (timeout→false); second: INSYNC OK.
  const io = new ScriptedSerial([INSYNC, OK])
  let sawErase = false
  await new BootloaderClient(io).erase((phase, r) => {
    if (phase === 'erase' && r === 1) sawErase = true
  })
  assert.deepEqual(io.writes[0], [0x23, 0x20]) // CHIP_ERASE EOC
  assert.ok(sawErase)
})

test('erase(): a real chip-erase failure surfaces honestly, not as a generic timeout', async () => {
  // Previously trySync swallowed FAILED/INVALID → false, so a genuine
  // erase failure looped to the (then 20s) deadline and reported
  // "timed out", inviting a pointless retry. It must throw promptly.
  await assert.rejects(
    () => new BootloaderClient(new ScriptedSerial([INSYNC, FAILED])).erase(),
    /chip erase FAILED/
  )
  await assert.rejects(
    () => new BootloaderClient(new ScriptedSerial([INSYNC, INVALID])).erase(),
    /INVALID OPERATION during chip erase/
  )
})

test('erase(): a stray INSYNC with no status byte during erase keeps polling, does NOT abort the flash', async () => {
  // Regression: a noise/stray 0x12 during the multi-second silent
  // CHIP_ERASE used to make trySync's unwrapped status read throw out of
  // erase() — bricking a board that was actually fine. It must be
  // treated as a sync miss and keep polling until the real INSYNC/OK.
  let step = 0
  const io = {
    writes: [],
    async write(d) {
      this.writes.push(Array.from(d))
    },
    async read() {
      step += 1
      if (step === 1) return Uint8Array.from([INSYNC]) // stray INSYNC (head)
      if (step === 2) throw new Error('timeout') // no status byte follows
      if (step === 3) return Uint8Array.from([INSYNC]) // next poll: real INSYNC
      if (step === 4) return Uint8Array.from([OK]) // ...followed by OK
      throw new Error('unexpected read')
    },
    flushInput() {}
  }
  let erased = false
  await new BootloaderClient(io).erase((phase, r) => {
    if (phase === 'erase' && r === 1) erased = true
  })
  assert.ok(erased, 'erase completed after a stray-INSYNC sync miss')
  assert.deepEqual(io.writes[0], [0x23, 0x20]) // CHIP_ERASE EOC
})

test('flash(): a verified flash still succeeds when the reboot write fails (port drops)', async () => {
  // The board commonly drops the port the instant it reboots, so a
  // reboot-write rejection after a passing verify must NOT be reported
  // as a failed flash.
  const image = padTo4(new Uint8Array([1, 2, 3, 4]))
  const flash = 256
  const good = firmwareCrc(image, flash)
  class RebootFailsSerial extends ScriptedSerial {
    async write(data) {
      super.write(data)
      if (data[0] === 0x30) throw new Error('port lost on reboot') // REBOOT
    }
  }
  // erase ack, program ack, GET_CRC reply + sync.
  const io = new RebootFailsSerial([INSYNC, OK, INSYNC, OK, ...le32(good), INSYNC, OK])
  await new BootloaderClient(io).flash(image, flash) // must resolve, not reject
})

test('flash(): one-shot retry recovers from a transient CRC verify miss', async () => {
  // A mid-burst USB-serial drop can corrupt one PROG_MULTI chunk
  // silently — the bootloader ACKs (length byte was right) and only
  // GET_CRC catches it at the end. The bootloader itself is still
  // alive, so flash() now auto-retries erase+program+verify once
  // before surfacing the brick-class error. Persistent CRC failures
  // (cable / hub / silicon) still throw on the second miss.
  const image = padTo4(new Uint8Array([10, 20, 30, 40]))
  const flash = 256
  const good = firmwareCrc(image, flash)
  const bad = (good ^ 0xdead) >>> 0
  // FIRST attempt: erase ack, program ack, GET_CRC returns BAD + sync.
  // SECOND attempt (auto-retry): erase ack, program ack, GET_CRC returns
  // GOOD + sync. Then REBOOT (no read needed).
  const io = new ScriptedSerial([
    INSYNC, OK,             // erase 1
    INSYNC, OK,             // program 1
    ...le32(bad), INSYNC, OK, // verify 1 -> mismatch -> retry
    INSYNC, OK,             // erase 2
    INSYNC, OK,             // program 2
    ...le32(good), INSYNC, OK // verify 2 -> pass
  ])
  await new BootloaderClient(io).flash(image, flash) // resolves on retry pass
})

test('flash(): two consecutive CRC misses surface the brick-class error', async () => {
  const image = padTo4(new Uint8Array([5, 6, 7, 8]))
  const flash = 256
  const good = firmwareCrc(image, flash)
  const bad = (good ^ 0xdead) >>> 0
  // Both attempts return BAD; flash() should give up after the retry.
  const io = new ScriptedSerial([
    INSYNC, OK,             // erase 1
    INSYNC, OK,             // program 1
    ...le32(bad), INSYNC, OK, // verify 1 -> mismatch -> retry
    INSYNC, OK,             // erase 2
    INSYNC, OK,             // program 2
    ...le32(bad), INSYNC, OK // verify 2 -> still mismatch
  ])
  await assert.rejects(
    () => new BootloaderClient(io).flash(image, flash),
    /CRC verify failed/
  )
})

// ---- Slice 2: ArduPilot firmware-index (manifest) client ----

const MANIFEST_FIXTURE = JSON.stringify({
  'format-version': '1.0.0',
  firmware: [
    {
      'mav-autopilot': 'ARDUPILOTMEGA', vehicletype: 'Copter', platform: 'Pixhawk6X',
      'git-sha': 'aaa', url: 'https://firmware.ardupilot.org/Copter/stable/Pixhawk6X/arducopter.apj',
      'mav-type': 'MAV_TYPE_QUADROTOR', 'mav-firmware-version-type': 'OFFICIAL',
      'mav-firmware-version-str': '4.5.7', latest: 0, format: 'apj', board_id: 53,
      brand_name: 'Pixhawk6X', manufacturer: 'Holybro', image_size: 2031616
    },
    {
      'mav-autopilot': 'ARDUPILOTMEGA', vehicletype: 'Copter', platform: 'Pixhawk6X',
      'git-sha': 'bbb', url: 'https://firmware.ardupilot.org/Copter/latest/Pixhawk6X/arducopter.apj',
      'mav-type': 'MAV_TYPE_QUADROTOR', 'mav-firmware-version-type': 'OFFICIAL',
      'mav-firmware-version-str': '4.6.0', latest: 1, format: 'apj', board_id: 53
    },
    {
      'mav-autopilot': 'ARDUPILOTMEGA', vehicletype: 'Copter', platform: 'Pixhawk6X',
      'git-sha': 'ccc', url: 'https://firmware.ardupilot.org/Copter/beta/Pixhawk6X/arducopter.apj',
      'mav-firmware-version-type': 'BETA', 'mav-firmware-version-str': '4.7.0-beta1',
      latest: 1, format: 'apj', board_id: 53
    },
    {
      // The manifest only ever carries post-mapped values (generate_manifest.py
      // maps stable->OFFICIAL server-side); the client consumes OFFICIAL.
      'mav-autopilot': 'ARDUPILOTMEGA', vehicletype: 'Plane', platform: 'Pixhawk6X',
      'git-sha': 'ddd', url: 'https://firmware.ardupilot.org/Plane/stable/Pixhawk6X/arduplane.apj',
      'mav-firmware-version-type': 'OFFICIAL', 'mav-firmware-version-str': '4.5.7',
      latest: 1, format: 'apj', board_id: 53
    },
    {
      'mav-autopilot': 'ARDUPILOTMEGA', vehicletype: 'Copter', platform: 'CubeOrange',
      url: 'https://firmware.ardupilot.org/Copter/stable/CubeOrange/arducopter.apj',
      'mav-firmware-version-type': 'OFFICIAL', latest: 1, format: 'apj', board_id: 140
    },
    // foreign / malformed entries that must be skipped, not throw:
    { vehicletype: 'Copter', url: 'x', 'mav-firmware-version-type': 'OFFICIAL', format: 'apj' }, // no board_id
    // not apj — parseManifest keeps it, firmwaresForBoard filters by format.
    // (Real manifest urls are always https; the parser now drops non-https.)
    { vehicletype: 'Copter', board_id: 53, url: 'https://firmware.ardupilot.org/Copter/stable/CubeOrange/arducopter.abin', 'mav-firmware-version-type': 'OFFICIAL', format: 'abin' },
    { vehicletype: 'Spaceship', board_id: 53, url: 'x', 'mav-firmware-version-type': 'OFFICIAL', format: 'apj' }, // unknown vehicle
    'garbage-string'
  ]
})

test('parseManifest: schema parse, release-type map, skips foreign entries', () => {
  const m = parseManifest(MANIFEST_FIXTURE)
  assert.equal(m.formatVersion, '1.0.0')
  // 4 board_id:53 + 1 board_id:140 + 1 abin(board 53) entry survive parse
  // (the no-board / unknown-vehicle / garbage ones are dropped).
  assert.ok(m.entries.length === 6, `expected 6 parsed, got ${m.entries.length}`)
  // Manifest carries already-mapped release types (OFFICIAL etc.); the
  // client accepts those and skips anything unrecognised.
  const plane = m.entries.find((e) => e.vehicletype === 'Plane')
  assert.equal(plane.releaseType, 'OFFICIAL')
  assert.equal(m.entries.find((e) => e.brandName)?.manufacturer, 'Holybro')

  assert.throws(() => parseManifest('nope'), /not valid JSON/)
  assert.throws(() => parseManifest('{"format-version":"1.0.0"}'), /missing "firmware" array/)
})

test('firmwaresForBoard / availableReleaseTypes / selectFirmware', () => {
  const m = parseManifest(MANIFEST_FIXTURE)

  // Only apj + matching board id; the abin entry is excluded.
  const b53 = firmwaresForBoard(m, 53)
  assert.equal(b53.length, 4)
  assert.ok(b53.every((e) => e.format === 'apj' && e.boardId === 53))
  assert.equal(firmwaresForBoard(m, 53, 'Plane').length, 1)
  assert.equal(firmwaresForBoard(m, 99).length, 0)

  assert.deepEqual(availableReleaseTypes(m, 53), ['OFFICIAL', 'BETA'])
  assert.deepEqual(availableReleaseTypes(m, 53, 'Plane'), ['OFFICIAL'])

  // Default OFFICIAL + prefers latest:1 → the 4.6.0 Copter build.
  const def = selectFirmware(m, { boardId: 53, vehicletype: 'Copter' })
  assert.equal(def.versionStr, '4.6.0')
  assert.ok(def.latest)
  // Explicit BETA channel.
  assert.equal(selectFirmware(m, { boardId: 53, vehicletype: 'Copter', releaseType: 'BETA' }).versionStr, '4.7.0-beta1')
  // Vehicle filter.
  assert.equal(selectFirmware(m, { boardId: 53, vehicletype: 'Plane' }).vehicletype, 'Plane')
  // No match → undefined (unknown board, and DEV not present for 53).
  assert.equal(selectFirmware(m, { boardId: 99 }), undefined)
  assert.equal(selectFirmware(m, { boardId: 53, vehicletype: 'Copter', releaseType: 'DEV' }), undefined)
})

// AP_Periph DroneCAN node firmware matching. board_id 1137 (AP_HW_FlywooF405Pro
// in Tools/AP_Bootloader/board_types.txt) splits as major=1137>>8=4,
// minor=1137&0xff=113 in the node's GetNodeInfo hardware_version
// (Tools/AP_Periph/can.cpp). board_id 1059 is a second peripheral board.
const PERIPH_MANIFEST_FIXTURE = JSON.stringify({
  'format-version': '1.0.0',
  firmware: [
    {
      vehicletype: 'AP_Periph', platform: 'FlywooF405Pro', board_id: 1137, format: 'apj',
      url: 'https://firmware.ardupilot.org/AP_Periph/stable/FlywooF405Pro/AP_Periph.apj',
      'mav-firmware-version-type': 'OFFICIAL', 'mav-firmware-version-str': '1.7.0', latest: 1
    },
    {
      vehicletype: 'AP_Periph', platform: 'FlywooF405Pro', board_id: 1137, format: 'apj',
      url: 'https://firmware.ardupilot.org/AP_Periph/beta/FlywooF405Pro/AP_Periph.apj',
      'mav-firmware-version-type': 'BETA', 'mav-firmware-version-str': '1.8.0-beta1', latest: 1
    },
    {
      // Same board also ships a raw .bin in the manifest; firmwaresForBoard
      // (and thus the node matcher) filters to apj only.
      vehicletype: 'AP_Periph', platform: 'FlywooF405Pro', board_id: 1137, format: 'bin',
      url: 'https://firmware.ardupilot.org/AP_Periph/stable/FlywooF405Pro/AP_Periph.bin',
      'mav-firmware-version-type': 'OFFICIAL', 'mav-firmware-version-str': '1.7.0', latest: 1
    },
    {
      vehicletype: 'AP_Periph', platform: 'CubeOrange-periph', board_id: 1059, format: 'apj',
      url: 'https://firmware.ardupilot.org/AP_Periph/stable/CubeOrange-periph/AP_Periph.apj',
      'mav-firmware-version-type': 'OFFICIAL', 'mav-firmware-version-str': '1.7.0', latest: 1
    },
    {
      // A Copter build for the same board id must NOT match the periph node.
      vehicletype: 'Copter', platform: 'CubeOrange', board_id: 1137, format: 'apj',
      url: 'https://firmware.ardupilot.org/Copter/stable/CubeOrange/arducopter.apj',
      'mav-firmware-version-type': 'OFFICIAL', 'mav-firmware-version-str': '4.6.0', latest: 1
    }
  ]
})

test('dronecanNodeBoardId reconstructs APJ_BOARD_ID from hardware_version major/minor', () => {
  // 1137 = (4 << 8) | 113.
  assert.equal(dronecanNodeBoardId({ major: 4, minor: 113 }), 1137)
  // 1059 = (4 << 8) | 35.
  assert.equal(dronecanNodeBoardId({ major: 4, minor: 35 }), 1059)
  // Bytes are masked so a stray high bit can't widen the id.
  assert.equal(dronecanNodeBoardId({ major: 0x102, minor: 0x101 }), (2 << 8) | 1)
  assert.equal(dronecanNodeBoardId(undefined), undefined)
  assert.equal(dronecanNodeBoardId({ major: Number.NaN, minor: 1 }), undefined)
})

test('firmwaresForDronecanNode matches AP_Periph apj by board id', () => {
  const m = parseManifest(PERIPH_MANIFEST_FIXTURE)
  const boardId = dronecanNodeBoardId({ major: 4, minor: 113 }) // 1137

  // Only AP_Periph apj entries for this board id — the .bin and the Copter
  // entry (same board id) are excluded.
  const candidates = firmwaresForDronecanNode(m, { boardId, name: 'org.ardupilot.FlywooF405Pro' })
  assert.equal(candidates.length, 2)
  assert.ok(candidates.every((e) => e.vehicletype === 'AP_Periph' && e.format === 'apj' && e.boardId === 1137))
  assert.deepEqual(candidates.map((e) => e.releaseType).sort(), ['BETA', 'OFFICIAL'])

  // Release-channel filter.
  const stable = firmwaresForDronecanNode(m, { boardId, releaseType: 'OFFICIAL' })
  assert.equal(stable.length, 1)
  assert.equal(stable[0].versionStr, '1.7.0')

  // Unknown board id (no GetNodeInfo yet) → no candidates, no throw.
  assert.deepEqual(firmwaresForDronecanNode(m, { boardId: undefined }), [])
  assert.deepEqual(firmwaresForDronecanNode(m, { boardId: 9999 }), [])

  // Release types for the node's board.
  assert.deepEqual(dronecanNodeReleaseTypes(m, boardId), ['OFFICIAL', 'BETA'])
  assert.deepEqual(dronecanNodeReleaseTypes(m, undefined), [])
})

test('parseManifest keeps STABLE-x.y.z archived releases (80% of the live manifest) and availableReleaseTypes sorts them newest-first', () => {
  // Conformance fix, verified against the live manifest (84,624 entries,
  // 2026-06-10): archived stable releases are typed "STABLE-x.y.z" (81
  // distinct versions, 80.2% of all entries) and the /latest/ folder's
  // dev builds are typed "DEV" — "LATEST" never occurs. The old closed
  // enum dropped every STABLE-x.y.z at parse time.
  const manifest = JSON.stringify({
    'format-version': '1.0.0',
    firmware: [
      {
        vehicletype: 'Copter', platform: 'Pixhawk6X', board_id: 53, format: 'apj',
        url: 'https://firmware.ardupilot.org/Copter/stable-4.6.3/Pixhawk6X/arducopter.apj',
        'mav-firmware-version-type': 'STABLE-4.6.3', 'mav-firmware-version-str': '4.6.3', latest: 0
      },
      {
        vehicletype: 'Copter', platform: 'Pixhawk6X', board_id: 53, format: 'apj',
        url: 'https://firmware.ardupilot.org/Copter/stable-4.5.7/Pixhawk6X/arducopter.apj',
        'mav-firmware-version-type': 'STABLE-4.5.7', 'mav-firmware-version-str': '4.5.7', latest: 0
      },
      {
        vehicletype: 'Copter', platform: 'Pixhawk6X', board_id: 53, format: 'apj',
        url: 'https://firmware.ardupilot.org/Copter/stable/Pixhawk6X/arducopter.apj',
        'mav-firmware-version-type': 'OFFICIAL', 'mav-firmware-version-str': '4.6.4', latest: 1
      },
      {
        vehicletype: 'Copter', platform: 'Pixhawk6X', board_id: 53, format: 'apj',
        url: 'https://firmware.ardupilot.org/Copter/latest/Pixhawk6X/arducopter.apj',
        'mav-firmware-version-type': 'DEV', 'mav-firmware-version-str': '4.7.0-dev', latest: 1
      },
      {
        // Unrecognised release strings still get skipped, not crash.
        vehicletype: 'Copter', platform: 'Pixhawk6X', board_id: 53, format: 'apj',
        url: 'https://firmware.ardupilot.org/Copter/x/Pixhawk6X/arducopter.apj',
        'mav-firmware-version-type': 'STABLE-NOT-A-VERSION', latest: 0
      }
    ]
  })
  const m = parseManifest(manifest)
  assert.equal(m.entries.length, 4, 'STABLE-x.y.z entries parse; the malformed release string is skipped')
  assert.ok(m.entries.some((e) => e.releaseType === 'STABLE-4.6.3'))

  // Fixed channels first, then archived stables newest-first.
  assert.deepEqual(availableReleaseTypes(m, 53), ['OFFICIAL', 'DEV', 'STABLE-4.6.3', 'STABLE-4.5.7'])

  // An archived stable is now directly selectable.
  assert.equal(selectFirmware(m, { boardId: 53, releaseType: 'STABLE-4.5.7' }).versionStr, '4.5.7')
})

test('fetchManifest uses the injected fetcher', async () => {
  const m = await fetchManifest(async () => MANIFEST_FIXTURE)
  assert.equal(m.entries.length, 6)
})

// ---------------------------------------------------------------------------
// audit-28: CHIP_ERASE timeout scales with flash size (QGC behavior).
// 20s baseline + 4s per MB above 2 MB. uploader.py + MP use flat 20s;
// our pre-audit-28 value was a flat 40s. The scaling keeps small-flash
// boards fast and gives 8 MB+ H7 boards real headroom.
// ---------------------------------------------------------------------------

test('chipEraseTimeoutMs: 20s baseline up to 2 MB, +4s per MB above (QGC Bootloader.cc:166-171)', () => {
  // Sub-2 MB / exactly 2 MB -> baseline 20s (no scaling).
  assert.equal(chipEraseTimeoutMs(512 * 1024), 20_000) // 512 KiB F4
  assert.equal(chipEraseTimeoutMs(1024 * 1024), 20_000) // 1 MiB F4/F7
  assert.equal(chipEraseTimeoutMs(2 * 1024 * 1024), 20_000) // 2 MiB H7
  // Strictly above 2 MB -> +4s per (ceil-MB - 2).
  assert.equal(chipEraseTimeoutMs(3 * 1024 * 1024), 24_000) // 3 MiB
  assert.equal(chipEraseTimeoutMs(4 * 1024 * 1024), 28_000) // 4 MiB
  assert.equal(chipEraseTimeoutMs(8 * 1024 * 1024), 44_000) // 8 MiB QSPI-class
  // Unknown / zero / negative / NaN -> 40s fallback (our pre-audit-28
  // generous default) so callers without an identify() result yet still
  // get more than the upstream 20s baseline.
  assert.equal(chipEraseTimeoutMs(undefined), 40_000)
  assert.equal(chipEraseTimeoutMs(0), 40_000)
  assert.equal(chipEraseTimeoutMs(-1), 40_000)
  assert.equal(chipEraseTimeoutMs(Number.NaN), 40_000)
})

// ---------------------------------------------------------------------------
// audit-25: board-ID compat table + signed_firmware parse.
// uploader.py and QGroundControl recognise exactly two cross-id
// equivalences: AUAVX2.1(33) ↔ PX4FMUv2(9) and PX4FMUv3(255) ↔ PX4FMUv2(9)
// when bootloader rev >= 5 and flash > 1032192. Strict elsewhere.
// ---------------------------------------------------------------------------

test('checkBoardMatch(): AUAVX2.1(33) ↔ PX4FMUv2(9) compat is bidirectional with INFO note', () => {
  // Firmware FMUv2, board AUAVX2.1.
  const a = checkBoardMatch(9, 33)
  assert.equal(a.ok, true)
  assert.ok(a.note, 'compat-table hits attach an INFO note, not a silent pass')
  assert.match(a.note, /AUAV-X2\.1.*PX4FMUv2|PX4FMUv2.*AUAV-X2\.1/)
  // Reverse direction equally accepted.
  const b = checkBoardMatch(33, 9)
  assert.equal(b.ok, true)
  assert.ok(b.note)
})

test('checkBoardMatch(): FMUv3(255) firmware on FMUv2(9) board ONLY when rev>=5 + flash>1032192 (QGC compat)', () => {
  // FMUv2 board with corrected bootloader (rev 5) and full 2MB flash
  // is actually an FMUv3 reporting as v2 — QGC's compat path.
  const ok = checkBoardMatch(255, 9, 5, 2 * 1024 * 1024)
  assert.equal(ok.ok, true)
  assert.match(ok.note ?? '', /PX4FMUv3.*PX4FMUv2/)
  // Same IDs but bootloader too old -> refused.
  const oldBl = checkBoardMatch(255, 9, 4, 2 * 1024 * 1024)
  assert.equal(oldBl.ok, false)
  // Same IDs + recent BL but small flash (= threshold, strict >) -> refused.
  const atThreshold = checkBoardMatch(255, 9, 5, 1032192)
  assert.equal(atThreshold.ok, false, 'exactly the threshold is not enough — QGC uses strict >')
  const below = checkBoardMatch(255, 9, 5, 1032191)
  assert.equal(below.ok, false)
  // Reverse direction (FMUv2 firmware -> FMUv3 board reporting 255) is
  // NOT in the upstream compat path and stays refused — QGC explicitly
  // filters fmuv2 entries when on real v3 hardware.
  const reverse = checkBoardMatch(9, 255, 5, 2 * 1024 * 1024)
  assert.equal(reverse.ok, false)
})

test('checkBoardMatch(): unrelated mismatches stay refused (strict)', () => {
  // Pixhawk 6C (53) firmware on AUAV-X2.1 (33) is NOT in any compat
  // table and must hard-fail with both ids named.
  const r = checkBoardMatch(53, 33, 5, 2 * 1024 * 1024)
  assert.equal(r.ok, false)
  assert.match(r.reason ?? '', /Refusing to flash/)
  assert.match(r.reason ?? '', /53/)
  assert.match(r.reason ?? '', /33/)
})

test('parseApj surfaces signed_firmware (defaults to false when absent)', () => {
  const b64 = Buffer.from(deflateSync(Buffer.from([1, 2, 3, 4]))).toString('base64')
  // Absent -> false (the vast majority of builds).
  const unsigned = parseApj(JSON.stringify({ board_id: 9, image: b64 }))
  assert.equal(unsigned.signedFirmware, false)
  // Present and true -> true (Tools/ardupilotwaf/chibios.py sign_firmware).
  const signed = parseApj(JSON.stringify({ board_id: 9, image: b64, signed_firmware: true }))
  assert.equal(signed.signedFirmware, true)
  // Any other value -> false (non-strict-true is treated as not signed,
  // matching uploader.py / MP / QGC which all ignore this field).
  const lying = parseApj(JSON.stringify({ board_id: 9, image: b64, signed_firmware: 'yes' }))
  assert.equal(lying.signedFirmware, false)
})

// ---------------------------------------------------------------------------
// audit-27: currentMatches() — non-destructive GET_CRC probe so the UI
// can surface MP's "board already has this firmware — flash anyway?"
// prompt and skip a full erase+program cycle on accidental re-flashes.
// ---------------------------------------------------------------------------

test('currentMatches(): returns true on CRC match, false on mismatch', async () => {
  const image = padTo4(new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17]))
  const flash = 4096
  const expected = firmwareCrc(image, flash)

  // Matching CRC -> true (skip-if-same-firmware can short-circuit).
  const matchIo = new ScriptedSerial([...le32(expected), INSYNC, OK])
  assert.equal(await new BootloaderClient(matchIo).currentMatches(image, flash), true)
  // Framing: just GET_CRC + EOC (no payload; the bootloader CRCs its
  // OWN current flash, we just compare against our locally-computed
  // expected value).
  assert.deepEqual(matchIo.writes[0], [0x29, 0x20])

  // Non-matching CRC -> false (UI proceeds with the flash).
  const missIo = new ScriptedSerial([...le32((expected ^ 0xdead) >>> 0), INSYNC, OK])
  assert.equal(await new BootloaderClient(missIo).currentMatches(image, flash), false)
})

test('currentMatches(): refuses a non-4-aligned image (uploader.py pads first)', async () => {
  await assert.rejects(
    () => new BootloaderClient(new ScriptedSerial()).currentMatches(new Uint8Array([1, 2, 3]), 256),
    /4-byte aligned/
  )
})

// ---------------------------------------------------------------------------
// audit-23: extflash (dual-image board) support — CubeOrange+, Pixhawk6X,
// Pixhawk6C, Holybro Durandal H7, Hex Here4. Without these, the package
// would silently underflash boards whose runtime code lives in external
// QSPI flash.
// ---------------------------------------------------------------------------

const nodeInflate = (z) => new Uint8Array(inflateSync(Buffer.from(z)))

test('parseApj reads optional extf_image and extf_image_size (advisory)', async () => {
  const internal = new Uint8Array([1, 2, 3, 4])
  const extf = new Uint8Array([9, 8, 7, 6, 5])
  const apjWith = JSON.stringify({
    board_id: 140, // CubeOrange+
    image_size: 4,
    image: Buffer.from(deflateSync(Buffer.from(internal))).toString('base64'),
    extf_image_size: 5,
    extf_image: Buffer.from(deflateSync(Buffer.from(extf))).toString('base64')
  })
  const parsed = parseApj(apjWith)
  assert.equal(parsed.boardId, 140)
  assert.equal(parsed.extfImageSize, 5)
  assert.ok(parsed.compressedExtfImage instanceof Uint8Array)
  assert.ok(parsed.compressedExtfImage.length > 0)

  // Absent extf_image -> both extf fields undefined (single-image board).
  const apjWithout = JSON.stringify({
    board_id: 9,
    image_size: 4,
    image: Buffer.from(deflateSync(Buffer.from(internal))).toString('base64')
  })
  const parsedNone = parseApj(apjWithout)
  assert.equal(parsedNone.compressedExtfImage, undefined)
  assert.equal(parsedNone.extfImageSize, undefined)
})

test('parseApj treats extf_image_size as advisory (uploader.py-faithful)', () => {
  // Like image_size: a missing / garbled value must not throw — the
  // inflated extf length becomes authoritative in decodeApjExtfImage.
  const b64 = Buffer.from(deflateSync(Buffer.from([1, 2, 3, 4]))).toString('base64')
  for (const bad of ['n/a', null, 0, -5]) {
    const p = parseApj(
      JSON.stringify({ board_id: 140, image: b64, extf_image: b64, extf_image_size: bad })
    )
    assert.equal(p.extfImageSize, undefined, `extf_image_size ${JSON.stringify(bad)} -> undefined`)
    assert.ok(p.compressedExtfImage, 'extf_image still parsed when its declared size is bad')
  }
})

test('parseApj rejects an oversized extf_image_size (decompression-bomb guard)', () => {
  const b64 = Buffer.from(deflateSync(Buffer.from([1, 2, 3, 4]))).toString('base64')
  assert.throws(
    () =>
      parseApj(
        JSON.stringify({
          board_id: 140,
          image: b64,
          extf_image: b64,
          extf_image_size: MAX_FIRMWARE_IMAGE_BYTES + 1
        })
      ),
    /extf_image_size .* exceeds the .* safety cap/
  )
})

test('decodeApjExtfImage round-trips + 4-aligns + cross-checks declared size', async () => {
  const extf = new Uint8Array([9, 8, 7, 6, 5]) // length 5 -> pads to 8
  const apj = JSON.stringify({
    board_id: 140,
    image_size: 4,
    image: Buffer.from(deflateSync(Buffer.from([1, 2, 3, 4]))).toString('base64'),
    extf_image_size: 5,
    extf_image: Buffer.from(deflateSync(Buffer.from(extf))).toString('base64')
  })
  const parsed = parseApj(apj)
  const decoded = await decodeApjExtfImage(parsed, nodeInflate)
  assert.equal(decoded.length, 8, 'inflated extf padded to 4-byte multiple')
  assert.deepEqual(Array.from(decoded.slice(0, 5)), [9, 8, 7, 6, 5])
  assert.deepEqual(Array.from(decoded.slice(5)), [0xff, 0xff, 0xff])

  // Cross-check fails when declared extf_image_size mismatches inflated length.
  const bad = parseApj(
    JSON.stringify({
      board_id: 140,
      image: Buffer.from(deflateSync(Buffer.from([1, 2, 3, 4]))).toString('base64'),
      extf_image: Buffer.from(deflateSync(Buffer.from(extf))).toString('base64'),
      extf_image_size: 999
    })
  )
  await assert.rejects(
    () => decodeApjExtfImage(bad, nodeInflate),
    /extf_image_size declares/
  )
})

test('decodeApjExtfImage returns undefined when the .apj has no extf_image', async () => {
  // Single-image boards (the majority — F4 / F7 / older H7 without QSPI).
  const parsed = parseApj(
    JSON.stringify({
      board_id: 9,
      image: Buffer.from(deflateSync(Buffer.from([1, 2, 3, 4]))).toString('base64')
    })
  )
  const decoded = await decodeApjExtfImage(parsed, nodeInflate)
  assert.equal(decoded, undefined, 'no extf -> undefined, NOT an empty buffer that would erase QSPI')
})

test('decodeApjExtfImage returns undefined for an extf_image that inflates to ZERO bytes (standard single-image .apj shape)', async () => {
  // Conformance-audit regression: real firmware.ardupilot.org .apj files
  // for single-image boards still CARRY an `extf_image` key — a non-empty
  // base64 string that is just zlib(b"") — alongside extf_image_size: 0.
  // Pre-fix, decode returned a truthy Uint8Array(0), flash() took the
  // extflash path (EXTF_ERASE size 0 → NAK), and every flash of a
  // standard .apj aborted. uploader.py gates on extf_image_size > 0;
  // we mirror it by treating a zero-byte inflated image as absent.
  const emptyDeflated = Buffer.from(deflateSync(Buffer.alloc(0))).toString('base64')
  assert.ok(emptyDeflated.length > 0, 'zlib of empty input is a NON-empty base64 string — that is the trap')
  const parsed = parseApj(
    JSON.stringify({
      board_id: 1013, // MatekH743 — single-image, no QSPI
      image: Buffer.from(deflateSync(Buffer.from([1, 2, 3, 4]))).toString('base64'),
      extf_image: emptyDeflated,
      extf_image_size: 0
    })
  )
  assert.ok(parsed.compressedExtfImage, 'the empty-but-present extf_image IS parsed (non-empty base64)')
  const decoded = await decodeApjExtfImage(parsed, nodeInflate)
  assert.equal(decoded, undefined, 'zero-byte extf image must be treated as "no extf image"')
})

test('decodeApjExtfImage enforces the OOM cap on inflated extf even when size is absent', async () => {
  // Same decompression-bomb defense as the internal image path.
  const parsed = parseApj(
    JSON.stringify({ board_id: 140, image: 'AA==', extf_image: 'AA==' })
  )
  assert.equal(parsed.extfImageSize, undefined)
  await assert.rejects(
    () => decodeApjExtfImage(parsed, () => new Uint8Array(MAX_FIRMWARE_IMAGE_BYTES + 1)),
    /exceeding the .* safety cap/
  )
})

test('eraseExtflash(): framing + percentage-stream + final trySync (uploader.py erase_extflash)', async () => {
  // After the initial INSYNC/OK the bootloader streams uint8 pct updates;
  // once we see pct >= 90 we switch to trySync polling for the final OK.
  const io = new ScriptedSerial([
    INSYNC, OK,            // initial getSync
    50, 80, 90,            // progress bytes -> last switches to trySync
    INSYNC, OK             // trySync OK
  ])
  const progress = []
  await new BootloaderClient(io).eraseExtflash(8, (phase, ratio) => {
    if (phase === 'extf-erase') progress.push(ratio)
  })
  // Three framing writes (cmd / size_le32 / EOC) — same per-byte split
  // discipline as PROG_MULTI so the USB CDC stack paces them.
  assert.equal(io.writes.length, 3)
  assert.deepEqual(io.writes[0], [0x34]) // EXTF_ERASE
  assert.deepEqual(io.writes[1], le32(8)) // size little-endian
  assert.deepEqual(io.writes[2], [0x20]) // EOC
  assert.equal(io.flushed, 1, 'flushInput once before the framing burst')
  // Progress reports each distinct pct change + the final 1.0 on success.
  assert.deepEqual(progress, [0.5, 0.8, 0.9, 1])
})

test('eraseExtflash(): refuses a non-positive or non-aligned size pre-write', async () => {
  const io = new ScriptedSerial()
  await assert.rejects(() => new BootloaderClient(io).eraseExtflash(0), /4-byte multiple/)
  await assert.rejects(() => new BootloaderClient(io).eraseExtflash(-4), /4-byte multiple/)
  await assert.rejects(() => new BootloaderClient(io).eraseExtflash(7), /4-byte multiple/)
  assert.equal(io.writes.length, 0, 'no protocol bytes were sent for an invalid size')
})

test('programExtflash(): per-chunk four-write framing matching uploader.py', async () => {
  // 260-byte extf @ 128/chunk -> three chunks (128, 128, 4). Same
  // write-split + flushInput per chunk as internal program() (audit-22).
  const extf = padTo4(new Uint8Array(260).map((_, i) => (i * 3) & 0xff))
  const io = new ScriptedSerial([INSYNC, OK, INSYNC, OK, INSYNC, OK])
  await new BootloaderClient(io).programExtflash(extf)
  assert.equal(io.writes.length, 12, '3 chunks * 4 writes each')
  assert.deepEqual(io.writes[0], [0x35]) // EXTF_PROG_MULTI
  assert.deepEqual(io.writes[1], [128])
  assert.equal(io.writes[2].length, 128)
  assert.deepEqual(io.writes[3], [0x20]) // EOC
  // Last chunk: cmd / 4 / 4-byte payload / EOC.
  assert.deepEqual(io.writes[8], [0x35])
  assert.deepEqual(io.writes[9], [4])
  assert.equal(io.writes[10].length, 4)
  assert.deepEqual(io.writes[11], [0x20])
  assert.equal(io.flushed, 3, 'flushInput once per chunk')
})

test('verifyExtflash(): CRC computed over image bytes alone (NO flash-size padding)', async () => {
  // Critical difference from internal verify: extflash CRC is just
  // crc32(extf_image[:size], 0) with no 0xFF padding to flash_max_size
  // (uploader.py extf_crc()). firmwareCrc(img, img.length) gives the
  // same result because its padding loop is a no-op when size == length.
  const extf = padTo4(new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17]))
  const expected = arduPilotCrc32(extf, 0)
  // Equivalence check: same answer either way.
  assert.equal(firmwareCrc(extf, extf.length), expected, 'no-padding equivalence')

  const okIo = new ScriptedSerial([...le32(expected), INSYNC, OK])
  await new BootloaderClient(okIo).verifyExtflash(extf)
  assert.deepEqual(okIo.writes[0], [0x37]) // EXTF_GET_CRC
  assert.deepEqual(okIo.writes[1], le32(extf.length))
  assert.deepEqual(okIo.writes[2], [0x20]) // EOC
  assert.equal(okIo.flushed, 1)

  // Mismatch surfaces with both values + an extflash-specific message
  // (separate from internal "CRC verify failed" so the retry path in
  // flash() doesn't latch onto it).
  const badIo = new ScriptedSerial([...le32((expected ^ 0xdead) >>> 0), INSYNC, OK])
  await assert.rejects(
    () => new BootloaderClient(badIo).verifyExtflash(extf),
    /extflash CRC verify failed/
  )
})

test('flash(): extflash-first ordering when extfImage is supplied (uploader.py:1049-1059)', async () => {
  const image = padTo4(new Uint8Array([1, 2, 3, 4]))
  const extf = padTo4(new Uint8Array([9, 8, 7, 6]))
  const flash = 256
  const internalCrc = firmwareCrc(image, flash)
  const extfCrc = arduPilotCrc32(extf, 0)
  const io = new ScriptedSerial([
    // extflash erase: initial getSync, pct >= 90, trySync.
    INSYNC, OK, 90, INSYNC, OK,
    // extflash program (1 chunk): getSync.
    INSYNC, OK,
    // extflash verify: CRC + getSync.
    ...le32(extfCrc), INSYNC, OK,
    // internal erase: trySync.
    INSYNC, OK,
    // internal program (1 chunk): getSync.
    INSYNC, OK,
    // internal verify: CRC + getSync.
    ...le32(internalCrc), INSYNC, OK
    // reboot: no read needed.
  ])
  const phases = []
  await new BootloaderClient(io).flash(image, flash, (p) => phases.push(p), extf)
  // The extflash trio must run BEFORE the internal trio.
  const firstExtfIdx = phases.indexOf('extf-erase')
  const lastExtfIdx = phases.lastIndexOf('extf-verify')
  const firstInternalIdx = phases.indexOf('erase')
  assert.ok(firstExtfIdx >= 0, 'extf-erase fired')
  assert.ok(phases.includes('extf-program'), 'extf-program fired')
  assert.ok(lastExtfIdx >= 0, 'extf-verify fired')
  assert.ok(firstInternalIdx > lastExtfIdx, 'internal erase only after extflash verify completed')
})

test('flash(): back-compat — without extfImage, no extf phases are emitted', async () => {
  // Regression guard: existing single-image-board callers must see
  // exactly the same sequence as before audit-23.
  const image = padTo4(new Uint8Array([1, 2, 3, 4]))
  const flashSize = 256
  const internalCrc = firmwareCrc(image, flashSize)
  const io = new ScriptedSerial([
    INSYNC, OK,            // internal erase
    INSYNC, OK,            // internal program
    ...le32(internalCrc), INSYNC, OK // internal verify
  ])
  const phases = []
  await new BootloaderClient(io).flash(image, flashSize, (p) => phases.push(p))
  for (const p of phases) {
    assert.ok(!p.startsWith('extf-'), `no extflash phase should fire: saw ${p}`)
  }
})

// ---------------------------------------------------------------------------
// audit-24: BL rev-2 fallback verify (CHIP_VERIFY + READ_MULTI).
// Legacy AUAV-X2 / early PX4FMUv1/v2 / some clone boards have no GET_CRC
// (added in rev 3). The byte-compare path lets those boards flash again.
// ---------------------------------------------------------------------------

test('verifyByReadback(): CHIP_VERIFY + READ_MULTI per-chunk byte-compare framing', async () => {
  // Image of 200 bytes @ READ_MULTI_MAX=128 -> two chunks (128, 72).
  // Per-chunk framing matches uploader.py __verify_multi: READ_MULTI /
  // length / EOC, then `length` payload bytes back (NO INSYNC prefix on
  // the data), then INSYNC+OK from getSync().
  const image = padTo4(new Uint8Array(200).map((_, i) => (i * 7 + 3) & 0xff))
  const chunkA = Array.from(image.subarray(0, 128))
  const chunkB = Array.from(image.subarray(128, 200))
  const io = new ScriptedSerial([
    INSYNC, OK,           // CHIP_VERIFY ack
    ...chunkA, INSYNC, OK, // chunk A: 128 data bytes + sync
    ...chunkB, INSYNC, OK  // chunk B: 72 data bytes + sync
  ])
  const ratios = []
  await new BootloaderClient(io).verifyByReadback(image, (phase, r) => {
    if (phase === 'verify') ratios.push(r)
  })
  // First write group: CHIP_VERIFY / EOC (two writes, no payload).
  assert.deepEqual(io.writes[0], [0x24]) // CHIP_VERIFY
  assert.deepEqual(io.writes[1], [0x20]) // EOC
  // Per-chunk writes: READ_MULTI / length / EOC. Two chunks * 3 writes.
  assert.deepEqual(io.writes[2], [0x28]) // READ_MULTI
  assert.deepEqual(io.writes[3], [128])
  assert.deepEqual(io.writes[4], [0x20])
  assert.deepEqual(io.writes[5], [0x28])
  assert.deepEqual(io.writes[6], [72])
  assert.deepEqual(io.writes[7], [0x20])
  assert.equal(io.writes.length, 8, '2 (CHIP_VERIFY) + 2 * 3 (READ_MULTI chunks)')
  // flushInput before CHIP_VERIFY + once per READ_MULTI chunk = 3 total.
  assert.equal(io.flushed, 3)
  // Final progress reaches 1.0.
  assert.equal(ratios.at(-1), 1)
})

test('verifyByReadback(): a single byte mismatch surfaces with offset + both values', async () => {
  const image = padTo4(new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]))
  const got = Array.from(image)
  got[5] = 0x99 // corrupt one byte mid-chunk
  const io = new ScriptedSerial([INSYNC, OK, ...got, INSYNC, OK])
  await assert.rejects(
    () => new BootloaderClient(io).verifyByReadback(image),
    (err) =>
      /verify failed at offset 0x5/i.test(err.message) &&
      /expected 0x3c/i.test(err.message) && // 60 = 0x3c
      /got 0x99/i.test(err.message)
  )
})

test('verifyByReadback(): refuses a non-4-aligned image (uploader.py pads first)', async () => {
  await assert.rejects(
    () => new BootloaderClient(new ScriptedSerial()).verifyByReadback(new Uint8Array([1, 2, 3])),
    /4-byte aligned/
  )
})

test('flash(): rev-2 boards take the CHIP_VERIFY + READ_MULTI verify path (not GET_CRC)', async () => {
  // The dispatch on bootloaderRevision === 2 in flash() must call
  // verifyByReadback, NOT verify (GET_CRC) — sending GET_CRC to a rev-2
  // bootloader would get an INVALID OPERATION reply at best, or wedge
  // the link at worst.
  const image = padTo4(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
  const flashSize = 256
  const io = new ScriptedSerial([
    INSYNC, OK,                          // CHIP_ERASE
    INSYNC, OK,                          // PROG_MULTI (single chunk)
    INSYNC, OK,                          // CHIP_VERIFY ack
    ...Array.from(image), INSYNC, OK     // single READ_MULTI chunk + sync
    // REBOOT: no read needed.
  ])
  await new BootloaderClient(io).flash(image, flashSize, undefined, undefined, 2)
  // CHIP_VERIFY (0x24) was emitted; GET_CRC (0x29) was NOT.
  const cmds = io.writes.map((w) => w[0])
  assert.ok(cmds.includes(0x24), 'CHIP_VERIFY was sent')
  assert.ok(cmds.includes(0x28), 'READ_MULTI was sent')
  assert.ok(!cmds.includes(0x29), 'GET_CRC was NOT sent on a rev-2 board')
})

test('flash(): rev 3+ (and undefined revision) take the GET_CRC verify path (back-compat)', async () => {
  // Regression guard: existing callers that don't pass a revision must
  // continue to use the GET_CRC path. Same for any rev 3+ board.
  const image = padTo4(new Uint8Array([1, 2, 3, 4]))
  const flashSize = 256
  const crc = firmwareCrc(image, flashSize)
  const io = new ScriptedSerial([
    INSYNC, OK,                          // CHIP_ERASE
    INSYNC, OK,                          // PROG_MULTI
    ...le32(crc), INSYNC, OK             // GET_CRC + sync
  ])
  await new BootloaderClient(io).flash(image, flashSize) // no rev arg
  const cmds = io.writes.map((w) => w[0])
  assert.ok(cmds.includes(0x29), 'GET_CRC was sent on the legacy 3-arg call')
  assert.ok(!cmds.includes(0x24), 'CHIP_VERIFY was NOT sent')
  assert.ok(!cmds.includes(0x28), 'READ_MULTI was NOT sent')
})

test('flash(): one-shot retry triggers on rev-2 readback mismatch too (widened regex)', async () => {
  // The audit-22 transient-drop mitigation now covers the rev-2 path:
  // a single byte-compare mismatch triggers a re-erase + re-program +
  // re-verify, same as the GET_CRC retry.
  const image = padTo4(new Uint8Array([1, 2, 3, 4]))
  const flashSize = 256
  const correct = Array.from(image)
  const wrong = [...correct]
  wrong[0] = 0xee
  const io = new ScriptedSerial([
    INSYNC, OK,                       // erase 1
    INSYNC, OK,                       // program 1
    INSYNC, OK,                       // CHIP_VERIFY 1
    ...wrong, INSYNC, OK,             // verify 1 -> mismatch -> retry
    INSYNC, OK,                       // erase 2
    INSYNC, OK,                       // program 2
    INSYNC, OK,                       // CHIP_VERIFY 2
    ...correct, INSYNC, OK            // verify 2 -> pass
  ])
  await new BootloaderClient(io).flash(image, flashSize, undefined, undefined, 2)
})
