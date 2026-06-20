import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import {
  MavlinkSession,
  MavlinkV2Codec,
  deriveSigningKeyFromPassphrase,
  currentSigningTimestamp
} from '../packages/protocol-mavlink/dist/index.js'
import {
  MAVLINK_MESSAGE_IDS,
  MAVLINK_V2_HEADER_LENGTH,
  MAVLINK_V2_INCOMPAT_FLAG_SIGNED
} from '../packages/protocol-mavlink/dist/constants.js'
import { MockTransport } from '../packages/transport/dist/index.js'

const PASSPHRASE = 'correct horse battery staple'

// A capturing mock transport: records every outbound frame the session sends
// and never replies, so tests can inspect exactly what went on the wire.
function capturingTransport() {
  const sent = []
  const transport = new MockTransport('mock-signing', {
    respondToOutbound: (frame) => {
      sent.push(Uint8Array.from(frame))
      return []
    }
  })
  return { transport, sent }
}

function makeRuntime(transport) {
  return new ArduPilotConfiguratorRuntime(
    new MavlinkSession(transport, new MavlinkV2Codec()),
    arducopterMetadata
  )
}

test('deriveSigningKeyFromPassphrase = SHA-256(utf8 passphrase), 32 bytes', () => {
  const derived = deriveSigningKeyFromPassphrase(PASSPHRASE)
  const expected = new Uint8Array(crypto.createHash('sha256').update(PASSPHRASE, 'utf8').digest())
  assert.equal(derived.length, 32)
  assert.deepEqual(Uint8Array.from(derived), expected)
})

test('configureSigningFromPassphrase derives the key and produces frames a peer codec verifies', async () => {
  const { transport, sent } = capturingTransport()
  const runtime = makeRuntime(transport)
  await runtime.connect()

  const key = runtime.configureSigningFromPassphrase(PASSPHRASE, { linkId: 3, enabled: true })
  // The key handed back is exactly SHA-256(passphrase).
  const expectedKey = new Uint8Array(crypto.createHash('sha256').update(PASSPHRASE, 'utf8').digest())
  assert.deepEqual(Uint8Array.from(key), expectedKey)

  // Send a real message; the codec should emit SIGNED frames. sendSigningSetup
  // is an unguarded direct send (no vehicle-heartbeat gate), so it's a clean
  // way to drive the codec's signing path deterministically.
  await runtime.sendSigningSetup(key)

  const signedFrame = sent.find((frame) => (frame[2] & MAVLINK_V2_INCOMPAT_FLAG_SIGNED) !== 0)
  assert.ok(signedFrame, 'expected at least one signed outbound frame')

  // A second, independent codec configured with the SAME derived key must
  // accept (verify) that signed frame — proving the derivation flowed through
  // to the codec correctly and the signature is valid against the shared key.
  // (SETUP_SIGNING has no decoder, so a verified frame yields 0 envelopes but
  // crucially 0 rejections; an unverified frame increments the rejection
  // count. That asymmetry is what distinguishes a good key from a bad one.)
  const peer = new MavlinkV2Codec()
  peer.setSigningConfig({ secretKey: expectedKey, enabled: true })
  peer.push(signedFrame)
  assert.equal(peer.getSignatureRejectionCount(), 0, 'peer with the matching key must verify the signature')

  // A peer with the WRONG key must reject it.
  const wrongPeer = new MavlinkV2Codec()
  wrongPeer.setSigningConfig({ secretKey: deriveSigningKeyFromPassphrase('different'), enabled: true })
  wrongPeer.push(signedFrame)
  assert.equal(wrongPeer.getSignatureRejectionCount(), 1, 'peer with the wrong key must reject the signature')

  await runtime.disconnect()
})

test('disableSigning restores unsigned frames', async () => {
  const { transport, sent } = capturingTransport()
  const runtime = makeRuntime(transport)
  await runtime.connect()
  const key = runtime.configureSigningFromPassphrase(PASSPHRASE, { enabled: true })
  runtime.disableSigning()
  sent.length = 0
  await runtime.sendSigningSetup(key)
  assert.ok(sent.length > 0)
  for (const frame of sent) {
    assert.equal(frame[2] & MAVLINK_V2_INCOMPAT_FLAG_SIGNED, 0, 'no frame should be signed after disable')
  }
  await runtime.disconnect()
})

test('sendSigningSetup emits SETUP_SIGNING (msgid 256) twice with the spec wire layout', async () => {
  const { transport, sent } = capturingTransport()
  const runtime = makeRuntime(transport)
  await runtime.connect()

  const key = deriveSigningKeyFromPassphrase(PASSPHRASE)
  await runtime.sendSigningSetup(key)

  const setupFrames = sent.filter((frame) => {
    const msgId = frame[7] | (frame[8] << 8) | (frame[9] << 16)
    return msgId === MAVLINK_MESSAGE_IDS.SETUP_SIGNING
  })
  // Mission Planner sends it twice; we mirror that.
  assert.equal(setupFrames.length, 2)

  const frame = setupFrames[0]
  const payload = frame.subarray(MAVLINK_V2_HEADER_LENGTH, MAVLINK_V2_HEADER_LENGTH + frame[1])
  // Wire layout (size-sorted, from the packed C struct):
  //   initial_timestamp uint64 @0, target_system @8, target_component @9,
  //   secret_key[32] @10.
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const initialTs = view.getBigUint64(0, true)
  assert.ok(initialTs > 0n, 'initial_timestamp should be seeded from the signing clock')
  // Roughly "now" in 10us-since-2015 units (within ~1 day).
  const now = currentSigningTimestamp()
  assert.ok(initialTs <= now && now - initialTs < 100n * 1000n * 60n * 60n * 24n)
  assert.equal(payload[8], 1, 'target_system defaults to 1 before vehicle detect')
  assert.equal(payload[9], 1, 'target_component defaults to 1 before vehicle detect')
  assert.deepEqual(Uint8Array.from(payload.subarray(10, 42)), key)

  await runtime.disconnect()
})

test('getSignatureRejectionCount surfaces verification drops through the runtime', async () => {
  // Forge a signed frame with the WRONG key; the transport replies with it on
  // the first outbound send, so it arrives inbound and verification drops it.
  const forger = new MavlinkV2Codec()
  forger.setSigningConfig({ secretKey: deriveSigningKeyFromPassphrase('attacker'), enabled: true })
  const badFrame = forger.encode({
    header: { systemId: 1, componentId: 1, sequence: 0 },
    message: {
      type: 'HEARTBEAT',
      customMode: 0,
      vehicleType: 2,
      autopilot: 3,
      baseMode: 0,
      systemStatus: 4,
      mavlinkVersion: 3
    },
    timestampMs: 0
  })

  let replied = false
  const transport = new MockTransport('mock-signing-rx', {
    responseDelayMs: 0,
    frameIntervalMs: 0,
    respondToOutbound: () => {
      if (replied) {
        return []
      }
      replied = true
      return [badFrame]
    }
  })
  const runtime = makeRuntime(transport)
  await runtime.connect()
  runtime.configureSigningFromKey(deriveSigningKeyFromPassphrase('rx-key'), { enabled: true })
  assert.equal(runtime.getSignatureRejectionCount(), 0)

  const rejections = []
  const unsub = runtime.onSignatureRejection((r) => rejections.push(r))

  // Any outbound send triggers the single forged reply.
  await runtime.sendSigningSetup(deriveSigningKeyFromPassphrase('rx-key'))
  // Let the queued inbound frame deliver.
  await new Promise((resolve) => setTimeout(resolve, 50))

  assert.equal(runtime.getSignatureRejectionCount(), 1)
  assert.equal(rejections.length, 1)
  assert.equal(rejections[0].reason, 'bad-signature')
  unsub()
  await runtime.disconnect()
})

test('configureSigningFromKey rejects non-32-byte keys', async () => {
  const { transport } = capturingTransport()
  const runtime = makeRuntime(transport)
  assert.throws(() => runtime.configureSigningFromKey(new Uint8Array(16), {}), /32 bytes/)
})
