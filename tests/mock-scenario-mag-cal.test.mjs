import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MavlinkV2Codec,
  MAV_CMD,
  MAV_RESULT,
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

function commandLong(command, params = [0, 0, 0, 0, 0, 0, 0]) {
  return {
    type: 'COMMAND_LONG',
    targetSystem: 1,
    targetComponent: 1,
    command,
    confirmation: 0,
    params
  }
}

test('mock scenario answers DO_START_MAG_CAL with an ack, progress stream, and a SUCCESS report', () => {
  const scenario = createArduCopterMockScenario()
  const responses = decodeAll(
    scenario.respondToOutbound(outbound(commandLong(MAV_CMD.DO_START_MAG_CAL, [0, 1, 1, 0, 0, 0, 0])))
  )

  const ack = responses.find((m) => m.type === 'COMMAND_ACK')
  assert.ok(ack, 'expected a COMMAND_ACK')
  assert.equal(ack.command, MAV_CMD.DO_START_MAG_CAL)
  assert.equal(ack.result, MAV_RESULT.ACCEPTED)

  const progress = responses.filter((m) => m.type === 'MAG_CAL_PROGRESS')
  assert.ok(progress.length >= 2, 'expected several MAG_CAL_PROGRESS frames')
  // Percentages strictly rise and finish at 100.
  for (let i = 1; i < progress.length; i += 1) {
    assert.ok(
      progress[i].completionPct > progress[i - 1].completionPct,
      'completionPct should rise monotonically'
    )
  }
  assert.equal(progress[progress.length - 1].completionPct, 100)
  assert.ok(progress.every((m) => m.completionMask instanceof Uint8Array && m.completionMask.length === 10))

  const reports = responses.filter((m) => m.type === 'MAG_CAL_REPORT')
  assert.equal(reports.length, 1)
  assert.equal(reports[0].calStatus, 4, 'MAG_CAL_STATUS_SUCCESS')
  assert.equal(reports[0].autosaved, 1)

  // The report must come after every progress frame in the wire order.
  const lastProgressIndex = responses.map((m) => m.type).lastIndexOf('MAG_CAL_PROGRESS')
  const reportIndex = responses.map((m) => m.type).indexOf('MAG_CAL_REPORT')
  assert.ok(reportIndex > lastProgressIndex, 'report should follow the progress stream')
})

test('mock scenario acks DO_ACCEPT_MAG_CAL and DO_CANCEL_MAG_CAL', () => {
  const scenario = createArduCopterMockScenario()

  for (const command of [MAV_CMD.DO_ACCEPT_MAG_CAL, MAV_CMD.DO_CANCEL_MAG_CAL]) {
    const responses = decodeAll(scenario.respondToOutbound(outbound(commandLong(command))))
    assert.equal(responses.length, 1, 'a bare ack only')
    assert.equal(responses[0].type, 'COMMAND_ACK')
    assert.equal(responses[0].command, command)
    assert.equal(responses[0].result, MAV_RESULT.ACCEPTED)
  }
})
