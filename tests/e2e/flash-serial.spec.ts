import { deflateSync } from 'node:zlib'

import { expect, test, type Page } from '@playwright/test'

import { fakeSerialFlashHex, fakeSerialStats, installFakeSerial, plugFakeSerial } from './support/fake-serial'

// The .apj flash path, end to end, against the fake ArduPilot bootloader in
// support/fake-serial.ts. Until now the protocol had unit tests over a
// scripted mock and the Flash tab had none past "it renders": Playwright has
// no serial port. The fake gives it one, in whatever Chromium build the
// project runs (see the channel projects in playwright.config.ts), so a
// Chromium Web Serial change that breaks our flash shows up here before it
// reaches a user with an erased board.
//
// The path driven is the connected one: with a vehicle on the demo link the
// Flash button reboots it into its bootloader over MAVLink (the demo acks
// the command), lets go of the link and waits for the bootloader's port to
// appear -- a `connect` event or a new getPorts() entry for a port the
// browser already knows, or the "Select the bootloader port" picker for one
// it does not. Both are covered below. The unplug/replug prompt of the
// not-connected path is the same catch loop behind a different prompt.
//
// What the fake proves is our protocol and UI logic under each browser's
// Web Serial implementation. It is not the OS serial driver, whose pacing
// is what refused PROG_MULTI frames in the field; a real board on a real
// cable stays the last rung for that.

const BOARD_ID = 140
const IMAGE_BYTES = 252 * 16
const PROG_MULTI = 0x27
const CHUNK = 252
const VEHICLE_CONNECT_TIMEOUT = 20_000

/** Deterministic pseudo-random bytes (xorshift32), so a run is reproducible. */
function pseudoRandomImage(length: number, seed = 0x2545f491): Uint8Array {
  const out = new Uint8Array(length)
  let x = seed >>> 0
  for (let i = 0; i < length; i += 1) {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    out[i] = x & 0xff
  }
  return out
}

/** A minimal valid .apj: JSON with the board id and a zlib-deflated image. */
function buildApj(image: Uint8Array, boardId = BOARD_ID): Buffer {
  return Buffer.from(
    JSON.stringify({
      board_id: boardId,
      board_revision: 0,
      image_size: image.length,
      image: deflateSync(Buffer.from(image)).toString('base64')
    })
  )
}

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

async function connectDemo(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByTestId('transport-mode-select').selectOption('demo')
  await page.getByTestId('connect-button').click()
  await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
}

async function stageFirmware(page: Page, apj: Buffer): Promise<void> {
  await page.getByTestId('view-button-flash').click()
  await page.getByTestId('firmware-file').setInputFiles({ name: 'test.apj', mimeType: 'application/json', buffer: apj })
  await expect(page.getByTestId('firmware-loaded')).toContainText(`board id ${BOARD_ID}`)
  await page.getByTestId('firmware-confirm').getByRole('checkbox').check()
  await expect(page.getByTestId('firmware-flash')).toBeEnabled()
}

test.describe('Flash firmware over Web Serial (fake bootloader)', () => {
  test('a granted bootloader port that appears after the reboot is caught, written, verified and rebooted', async ({ page }) => {
    const image = pseudoRandomImage(IMAGE_BYTES)
    // Granted but not present: the board is on its firmware port; its
    // bootloader port shows up once it has rebooted.
    await installFakeSerial(page, { boardId: BOARD_ID, granted: true, plugged: false })
    await connectDemo(page)
    await stageFirmware(page, buildApj(image))

    await page.getByTestId('firmware-flash').click()
    // The vehicle was told to reboot into its bootloader; the flasher now
    // waits for that port.
    await expect(page.getByTestId('firmware-await-bootloader')).toBeVisible()
    await plugFakeSerial(page)

    await expect(page.getByTestId('firmware-done')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('firmware-done')).toHaveText('Flash complete — rebooting')
    await expect(page.getByTestId('firmware-error')).toHaveCount(0)
    // The bootloader answers BOOT, then drops off USB ~100 ms later.
    await expect.poll(async () => (await fakeSerialStats(page)).rebooted).toBe(true)

    const stats = await fakeSerialStats(page)
    expect(stats.connectEvents).toBe(1)
    expect(stats.requestPortCalls).toBe(0)
    expect(stats.baudRates).toEqual([115200])
    expect(stats.erases).toBe(1)
    // GET_CRC twice: the skip-if-same check before the erase, the verify after.
    expect(stats.crcQueries).toBe(2)
    expect(stats.rebooted).toBe(true)
    expect(stats.disconnectEvents).toBe(1)

    // Every PROG_MULTI frame arrived as ONE write (command, length, payload,
    // EOC), in order, and none was refused.
    const frames = stats.frames.filter((frame) => frame.command === PROG_MULTI)
    expect(frames).toHaveLength(IMAGE_BYTES / CHUNK)
    expect(frames.map((frame) => frame.status)).toEqual(frames.map(() => 'ok'))
    expect(frames.map((frame) => frame.writes)).toEqual(frames.map(() => 1))
    expect(frames.map((frame) => frame.offset)).toEqual(frames.map((_, index) => index * CHUNK))
    expect(stats.progMulti).toMatchObject({ refused: 0, splitFrames: 0, windowMisses: 0, injectedRefusals: 0 })

    // The flash holds the fixture, byte for byte, and nothing past it.
    expect(stats.programmedBytes).toBe(IMAGE_BYTES)
    expect(await fakeSerialFlashHex(page, 0, IMAGE_BYTES)).toBe(hex(image))
    expect(await fakeSerialFlashHex(page, IMAGE_BYTES, IMAGE_BYTES + 16)).toBe('ff'.repeat(16))
  })

  test('a frame the bootloader swallows without a reply is resent after the filler and resync', async ({ page }) => {
    // Field report (MicoAir743v2): 66 s into Writing the client saw no
    // INVALID, just "serial read timed out waiting for 1 bytes". A silent
    // ack takes the same recovery as a refused one.
    const image = pseudoRandomImage(IMAGE_BYTES, 0x7a3b1c9d)
    await installFakeSerial(page, {
      boardId: BOARD_ID,
      granted: true,
      plugged: false,
      silentProgMultiOnce: true,
      silentProgMultiAt: 5
    })
    await connectDemo(page)
    await stageFirmware(page, buildApj(image))

    await page.getByTestId('firmware-flash').click()
    await expect(page.getByTestId('firmware-await-bootloader')).toBeVisible()
    await plugFakeSerial(page)

    await expect(page.getByTestId('firmware-done')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('firmware-error')).toHaveCount(0)
    await expect.poll(async () => (await fakeSerialStats(page)).rebooted).toBe(true)

    const stats = await fakeSerialStats(page)
    expect(stats.progMulti.injectedSilences).toBe(1)
    const frames = stats.frames.filter((frame) => frame.command === PROG_MULTI && frame.status !== 'ignored')
    const silentIndex = frames.findIndex((frame) => frame.status === 'silent')
    expect(silentIndex).toBeGreaterThanOrEqual(0)
    const resent = frames.slice(silentIndex + 1).find((frame) => frame.status === 'ok')
    expect(resent).toMatchObject({ offset: frames[silentIndex].offset, writes: 1 })
    expect(stats.programmedBytes).toBe(IMAGE_BYTES)
    expect(await fakeSerialFlashHex(page, 0, IMAGE_BYTES)).toBe(hex(image))
  })

  test('a refused frame whose tail opens a payload read on the bootloader is still resent', async ({ page }) => {
    // The hazard: after a refusal the bootloader parses the frame's tail as
    // commands. A 0x27 followed by a multiple-of-4 byte near the end of the
    // tail starts a PROG_MULTI "payload" read that would swallow the
    // client's resync GET_SYNC. The client now sends a zero filler first,
    // which completes that read and makes the bootloader refuse the stray
    // frame (0x00 is not EOC) without writing anything.
    const image = pseudoRandomImage(IMAGE_BYTES, 0x1234abcd)
    image[CHUNK - 2] = PROG_MULTI
    image[CHUNK - 1] = 0xfc
    await installFakeSerial(page, {
      boardId: BOARD_ID,
      granted: true,
      plugged: false,
      rejectProgMultiOnce: true,
      rejectProgMultiAt: 1
    })
    await connectDemo(page)
    await stageFirmware(page, buildApj(image))

    await page.getByTestId('firmware-flash').click()
    await expect(page.getByTestId('firmware-await-bootloader')).toBeVisible()
    await plugFakeSerial(page)

    await expect(page.getByTestId('firmware-done')).toBeVisible({ timeout: 40_000 })
    await expect(page.getByTestId('firmware-error')).toHaveCount(0)
    await expect.poll(async () => (await fakeSerialStats(page)).rebooted).toBe(true)

    const stats = await fakeSerialStats(page)
    expect(stats.progMulti.injectedRefusals).toBe(1)
    const frames = stats.frames.filter((frame) => frame.command === PROG_MULTI && frame.status !== 'ignored')
    const refusedIndex = frames.findIndex((frame) => frame.status === 'invalid' && /injected/.test(frame.reason ?? ''))
    expect(refusedIndex).toBeGreaterThanOrEqual(0)
    // The stray 0x27 in the tail became a frame of its own, refused on the
    // filler, and wrote nothing: the resend still lands at offset 0.
    const stray = frames.slice(refusedIndex + 1).find((frame) => frame.status === 'invalid' && frame.arg === 0xfc)
    expect(stray).toBeDefined()
    const resent = frames.slice(refusedIndex + 1).find((frame) => frame.status === 'ok' && frame.arg === CHUNK)
    expect(resent).toMatchObject({ offset: 0, writes: 1 })
    expect(stats.programmedBytes).toBe(IMAGE_BYTES)
    expect(await fakeSerialFlashHex(page, 0, IMAGE_BYTES)).toBe(hex(image))
  })

  test('a refused PROG_MULTI frame is resent at the same offset; the port comes through the picker', async ({ page }) => {
    const image = pseudoRandomImage(IMAGE_BYTES, 0x9e3779b9)
    // The refused frame's payload is read back as commands by the bootloader
    // (as on a real board). Pick a chunk with no PROG_MULTI byte in it: a
    // 0x27 in that tail would make the bootloader swallow the client's
    // resync as payload -- a hazard of the client's resend path, not of this
    // test, which is about the resend itself.
    const rejectAt = 1 + Array.from({ length: IMAGE_BYTES / CHUNK }, (_, i) => i).find(
      (i) => !image.subarray(i * CHUNK, (i + 1) * CHUNK).includes(PROG_MULTI)
    )!
    // Present but never granted: only the picker can hand it over. No
    // GET_VERSION either, as on a smaller-flash board, so the client's
    // re-sync after an INVALID runs too.
    await installFakeSerial(page, {
      boardId: BOARD_ID,
      granted: false,
      plugged: true,
      bootloaderVersion: null,
      rejectProgMultiOnce: true,
      rejectProgMultiAt: rejectAt
    })
    await connectDemo(page)
    await stageFirmware(page, buildApj(image))

    await page.getByTestId('firmware-flash').click()
    await expect(page.getByTestId('firmware-await-bootloader')).toBeVisible()
    // The browser does not know this port: the operator picks it.
    await page.getByTestId('firmware-await-pick').click()

    await expect(page.getByTestId('firmware-done')).toBeVisible({ timeout: 40_000 })
    await expect(page.getByTestId('firmware-error')).toHaveCount(0)
    await expect.poll(async () => (await fakeSerialStats(page)).rebooted).toBe(true)

    const stats = await fakeSerialStats(page)
    expect(stats.requestPortCalls).toBe(1)
    expect(stats.connectEvents).toBe(0)
    expect(stats.progMulti.injectedRefusals).toBe(1)
    expect(stats.progMulti.splitFrames).toBe(0)
    expect(stats.progMulti.windowMisses).toBe(0)

    // The refused frame, then the same offset again, accepted; the address
    // never advanced on the refusal, so the image still lands contiguously.
    const frames = stats.frames.filter((frame) => frame.command === PROG_MULTI && frame.status !== 'ignored')
    const refusedIndex = frames.findIndex((frame) => frame.status === 'invalid' && /injected/.test(frame.reason ?? ''))
    expect(refusedIndex).toBeGreaterThanOrEqual(0)
    const refused = frames[refusedIndex]
    expect(refused.offset).toBe((rejectAt - 1) * CHUNK)
    const resent = frames.slice(refusedIndex + 1).find((frame) => frame.arg === CHUNK)
    expect(resent).toMatchObject({ status: 'ok', offset: refused.offset, writes: 1 })
    const accepted = frames.filter((frame) => frame.status === 'ok')
    expect(accepted).toHaveLength(IMAGE_BYTES / CHUNK)
    expect(accepted.map((frame) => frame.writes)).toEqual(accepted.map(() => 1))
    expect(accepted.map((frame) => frame.offset)).toEqual(accepted.map((_, index) => index * CHUNK))

    expect(stats.programmedBytes).toBe(IMAGE_BYTES)
    expect(await fakeSerialFlashHex(page, 0, IMAGE_BYTES)).toBe(hex(image))
    expect(stats.rebooted).toBe(true)
  })
})
