import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MavlinkV2Codec,
  createArduCopterMockScenario,
  decodeSingleV2Envelope
} from '../packages/protocol-mavlink/dist/index.js'

const codec = new MavlinkV2Codec()

function outbound(message) {
  return codec.encode({
    header: { systemId: 255, componentId: 0, sequence: 0 },
    message,
    timestampMs: 0
  })
}

function decodeAll(frames) {
  return frames.map((frame) => decodeSingleV2Envelope(frame).message)
}

test('mock scenario answers LOG_REQUEST_LIST with the fake onboard log entries', () => {
  const scenario = createArduCopterMockScenario()
  const responses = decodeAll(
    scenario.respondToOutbound(
      outbound({ type: 'LOG_REQUEST_LIST', targetSystem: 1, targetComponent: 1, start: 0, end: 0xffff })
    )
  )

  assert.equal(responses.length, 2)
  assert.ok(responses.every((m) => m.type === 'LOG_ENTRY'))
  assert.deepEqual(
    responses.map((m) => m.id),
    [1, 2]
  )
  assert.ok(responses.every((m) => m.numLogs === 2 && m.lastLogNum === 2))
  assert.deepEqual(
    responses.map((m) => m.size),
    [256, 117]
  )
})

test('mock scenario streams LOG_DATA chunks that assemble to the deterministic log bytes', () => {
  const scenario = createArduCopterMockScenario()
  const chunks = decodeAll(
    scenario.respondToOutbound(
      outbound({
        type: 'LOG_REQUEST_DATA',
        targetSystem: 1,
        targetComponent: 1,
        id: 1,
        ofs: 0,
        count: 0xffffffff
      })
    )
  )

  assert.ok(chunks.length >= 3, 'a 256-byte log needs 90+90+76 chunks')
  assert.ok(chunks.every((m) => m.type === 'LOG_DATA' && m.id === 1))
  assert.equal(chunks.at(-1).count, 256 - 90 * 2) // 76 — short final chunk = end-of-log

  const assembled = new Uint8Array(256)
  for (const chunk of chunks) {
    assembled.set(chunk.data.subarray(0, chunk.count), chunk.ofs)
  }
  for (let i = 0; i < 256; i += 1) {
    assert.equal(assembled[i], (1 * 31 + i) & 0xff, `byte ${i}`)
  }
})

test('mock scenario honors a non-zero LOG_REQUEST_DATA start offset', () => {
  const scenario = createArduCopterMockScenario()
  const chunks = decodeAll(
    scenario.respondToOutbound(
      outbound({ type: 'LOG_REQUEST_DATA', targetSystem: 1, targetComponent: 1, id: 2, ofs: 90, count: 0xffffffff })
    )
  )
  assert.ok(chunks.length >= 1)
  assert.equal(chunks[0].ofs, 90)
  const tailBytes = chunks.reduce((sum, c) => sum + c.count, 0)
  assert.equal(tailBytes, 117 - 90) // remaining bytes of the 117-byte log
})

test('mock scenario emits nothing for LOG_REQUEST_END', () => {
  const scenario = createArduCopterMockScenario()
  const responses = scenario.respondToOutbound(
    outbound({ type: 'LOG_REQUEST_END', targetSystem: 1, targetComponent: 1 })
  )
  assert.deepEqual(responses, [])
})

test('mock scenario returns no LOG_DATA for an unknown log id', () => {
  const scenario = createArduCopterMockScenario()
  const responses = scenario.respondToOutbound(
    outbound({ type: 'LOG_REQUEST_DATA', targetSystem: 1, targetComponent: 1, id: 99, ofs: 0, count: 0xffffffff })
  )
  assert.deepEqual(responses, [])
})
