import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MSP_COMMANDS,
  MSP_REBOOT_MODES,
  MspSession,
  MspV1Decoder,
  decodeBoardInfo,
  decodeFcVariant,
  decodeSerialConfig,
  encodeMspV1Request,
  mspV1Checksum
} from '../packages/protocol-msp/dist/index.js'
import { MockTransport } from '../packages/transport/dist/index.js'

// Values verified against Betaflight source, not recalled:
//   src/main/msp/msp_protocol.h  — command ids
//   src/main/msp/msp.c           — the MSP_REBOOT mode enum
//   src/main/msp/msp_serial.c    — v1 framing and the XOR checksum
// The BOARD_INFO payload shape is additionally confirmed against a real
// captured frame in ExpressLRS's own test suite.

test('command ids match Betaflight msp_protocol.h', () => {
  assert.equal(MSP_COMMANDS.API_VERSION, 1)
  assert.equal(MSP_COMMANDS.FC_VARIANT, 2)
  assert.equal(MSP_COMMANDS.FC_VERSION, 3)
  assert.equal(MSP_COMMANDS.BOARD_INFO, 4)
  assert.equal(MSP_COMMANDS.CF_SERIAL_CONFIG, 54)
  // MSP_REBOOT, not "MSP_SET_REBOOT" — that name does not exist upstream.
  assert.equal(MSP_COMMANDS.REBOOT, 68)
})

test('reboot modes match the enum in msp.c', () => {
  assert.equal(MSP_REBOOT_MODES.FIRMWARE, 0)
  assert.equal(MSP_REBOOT_MODES.BOOTLOADER_ROM, 1)
  assert.equal(MSP_REBOOT_MODES.MSC, 2)
  assert.equal(MSP_REBOOT_MODES.MSC_UTC, 3)
  assert.equal(MSP_REBOOT_MODES.BOOTLOADER_FLASH, 4)
})

test('a v1 request frames as $M< with an XOR over size+cmd+payload', () => {
  const frame = encodeMspV1Request(MSP_COMMANDS.FC_VARIANT)
  assert.deepEqual(
    [...frame],
    [0x24, 0x4d, 0x3c, 0x00, 0x02, 0x02],
    "'$','M','<', size 0, cmd 2, checksum 0 ^ 2"
  )

  // With a payload: the DFU reboot this feature exists to send.
  const reboot = encodeMspV1Request(MSP_COMMANDS.REBOOT, Uint8Array.from([MSP_REBOOT_MODES.BOOTLOADER_ROM]))
  assert.deepEqual([...reboot.subarray(0, 5)], [0x24, 0x4d, 0x3c, 0x01, 68])
  assert.equal(reboot[5], MSP_REBOOT_MODES.BOOTLOADER_ROM)
  assert.equal(reboot[6], mspV1Checksum(68, Uint8Array.from([1])), 'checksum covers the payload')
  assert.equal(reboot[6], 1 ^ 68 ^ 1)
})

/** Build a reply the way a flight controller would. */
function reply(command, payload = []) {
  const bytes = Uint8Array.from(payload)
  const frame = new Uint8Array(6 + bytes.length)
  frame.set([0x24, 0x4d, 0x3e, bytes.length, command], 0)
  frame.set(bytes, 5)
  frame[5 + bytes.length] = mspV1Checksum(command, bytes)
  return frame
}

test('the decoder resynchronises past noise and splits joined frames', () => {
  const decoder = new MspV1Decoder()
  // A booting board prints console text on the same wire; a decoder that
  // trusted position would never recover from it.
  const noise = new TextEncoder().encode('Betaflight boot chatter\r\n')
  const joined = new Uint8Array([...noise, ...reply(2, [66, 84, 70, 76]), ...reply(3, [4, 5, 1])])

  const frames = decoder.push(joined)
  assert.equal(frames.length, 2)
  assert.equal(decodeFcVariant(frames[0].payload), 'BTFL')
  assert.deepEqual([...frames[1].payload], [4, 5, 1])
})

test('a frame split across chunks is held until complete', () => {
  const decoder = new MspV1Decoder()
  const frame = reply(2, [66, 84, 70, 76])
  assert.deepEqual(decoder.push(frame.subarray(0, 4)), [], 'nothing yet')
  const done = decoder.push(frame.subarray(4))
  assert.equal(done.length, 1)
  assert.equal(decodeFcVariant(done[0].payload), 'BTFL')
})

test('a corrupt checksum does not yield a frame', () => {
  const decoder = new MspV1Decoder()
  const frame = reply(2, [66, 84, 70, 76])
  frame[frame.length - 1] ^= 0xff
  assert.deepEqual(decoder.push(frame), [])
})

test('BOARD_INFO decodes the real ExpressLRS capture', () => {
  // From ExpressLRS src/test/test_msp2crsf2msp/test_msp2crsf2msp.cpp, which
  // captures an actual board's reply: "S405" / STM32F405 / OMNIBUSF4 / AIRB.
  const payload = Uint8Array.from([
    83, 52, 48, 53, 0, 0, 2, 55,
    9, 83, 84, 77, 51, 50, 70, 52, 48, 53,
    9, 79, 77, 78, 73, 66, 85, 83, 70, 52,
    4, 65, 73, 82, 66
  ])
  assert.deepEqual(decodeBoardInfo(payload), {
    boardIdentifier: 'S405',
    hardwareRevision: 0,
    targetName: 'STM32F405',
    boardName: 'OMNIBUSF4',
    manufacturerId: 'AIRB'
  })
})

test('BOARD_INFO from older firmware keeps what it does report', () => {
  // The name fields were added over successive API versions; their absence is
  // not an error, and must not lose the board identifier.
  const info = decodeBoardInfo(Uint8Array.from([83, 52, 48, 53, 3, 0]))
  assert.equal(info.boardIdentifier, 'S405')
  assert.equal(info.hardwareRevision, 3)
  assert.equal(info.targetName, undefined)
})

test('serial config decodes one record per UART', () => {
  const ports = decodeSerialConfig(Uint8Array.from([0, 1, 0, 4, 4, 4, 4, 1, 0, 0, 4, 4, 4, 4]))
  assert.equal(ports.length, 2)
  assert.equal(ports[0].identifier, 0)
  assert.equal(ports[0].functionMask, 1)
  assert.equal(ports[1].identifier, 1)
  assert.equal(ports[1].functionMask, 0)
})

test('a session identifies a board and requests the DFU reboot', async () => {
  const transport = new MockTransport('msp-test', {
    frameIntervalMs: 0,
    responseDelayMs: 0,
    respondToOutbound: (frame) => {
      const command = frame[4]
      switch (command) {
        case MSP_COMMANDS.FC_VARIANT:
          return [reply(command, [66, 84, 70, 76])]
        case MSP_COMMANDS.FC_VERSION:
          return [reply(command, [4, 5, 1])]
        case MSP_COMMANDS.API_VERSION:
          return [reply(command, [0, 1, 46])]
        case MSP_COMMANDS.BOARD_INFO:
          return [reply(command, [83, 52, 48, 53, 0, 0, 2, 55, 9, 83, 84, 77, 51, 50, 70, 52, 48, 53])]
        case MSP_COMMANDS.REBOOT:
          // The FC echoes the mode back, then reboots.
          return [reply(command, [MSP_REBOOT_MODES.BOOTLOADER_ROM])]
        default:
          return []
      }
    }
  })

  const session = new MspSession(transport, { timeoutMs: 1500 })
  await session.connect()
  try {
    const identity = await session.readIdentity()
    assert.equal(identity.fcVariant, 'BTFL')
    assert.equal(identity.fcVersion, '4.5.1')
    assert.equal(identity.apiVersion, '1.46')
    assert.equal(identity.targetName, 'STM32F405')

    await session.rebootToBootloader()
  } finally {
    await session.disconnect()
  }
})

test('a reboot acknowledged as a DIFFERENT mode is treated as a failure', async () => {
  // Answering FIRMWARE means the board is about to restart normally, not enter
  // DFU. Reporting success would leave the operator waiting for a DFU device
  // that never appears.
  const transport = new MockTransport('msp-reboot-wrong', {
    frameIntervalMs: 0,
    responseDelayMs: 0,
    respondToOutbound: (frame) =>
      frame[4] === MSP_COMMANDS.REBOOT ? [reply(MSP_COMMANDS.REBOOT, [MSP_REBOOT_MODES.FIRMWARE])] : []
  })

  const session = new MspSession(transport, { timeoutMs: 1500 })
  await session.connect()
  try {
    await assert.rejects(() => session.rebootToBootloader(), /different reboot mode/i)
  } finally {
    await session.disconnect()
  }
})

test('the CLI capture enters, reads, and always leaves', async () => {
  // `diff` is a CLI command — there is no MSP message that returns a board's
  // non-default settings, which is why the old "dump" held only the ports.
  const { captureCliCommand, cleanCliCapture } = await import('../packages/protocol-msp/dist/index.js')

  const sent = []
  const listeners = new Set()
  const encoder = new TextEncoder()
  const transport = {
    async send(frame) {
      const text = new TextDecoder().decode(frame)
      sent.push(text)
      // A board answers '#' with the prompt, and a command with its output.
      if (text === '#') {
        queueMicrotask(() => listeners.forEach((l) => l(encoder.encode('\r\n# '))))
      } else if (text.startsWith('diff')) {
        queueMicrotask(() =>
          listeners.forEach((l) => l(encoder.encode('diff\r\n# version\r\nboard_name MATEKH743\r\n\r\n# ')))
        )
      }
    },
    onFrame(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }

  const raw = await captureCliCommand(transport, 'diff', { quietMs: 30, enterTimeoutMs: 1500 })
  assert.equal(sent[0], '#', 'enters the CLI first')
  assert.ok(sent.some((line) => line.startsWith('diff')), 'runs the command')
  // `noreboot`: a bare `exit` reboots the board (cli.c cliExitCmd), which would
  // drop the MSP link the operator is about to hand to DFU.
  assert.ok(sent.includes('exit noreboot\r\n'), 'leaves the CLI without rebooting')

  // The echoed command and trailing prompt are not part of the file.
  const cleaned = cleanCliCapture(raw, 'diff')
  assert.ok(cleaned.startsWith('# version'), `unexpected start: ${JSON.stringify(cleaned.slice(0, 40))}`)
  assert.ok(cleaned.includes('board_name MATEKH743'))
  assert.ok(!cleaned.trimEnd().endsWith('#'), 'trailing prompt removed')
})

test('a board that never shows a prompt is not sent the command', async () => {
  // Sending `diff` into whatever mode the board is actually in is worse than
  // failing: the point of waiting for the prompt is to know where we are.
  const { captureCliCommand } = await import('../packages/protocol-msp/dist/index.js')
  const sent = []
  const transport = {
    async send(frame) {
      sent.push(new TextDecoder().decode(frame))
    },
    onFrame() {
      return () => {}
    }
  }

  await assert.rejects(
    () => captureCliCommand(transport, 'diff', { enterTimeoutMs: 120, quietMs: 20 }),
    /CLI prompt/i
  )
  assert.ok(!sent.some((line) => line.startsWith('diff')), 'never sent the command')
  assert.ok(sent.includes('exit noreboot\r\n'), 'still tried to leave the CLI')
})
