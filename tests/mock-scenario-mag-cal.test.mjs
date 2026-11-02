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

function gcsHeartbeat() {
  return { type: 'HEARTBEAT', autopilot: 8, vehicleType: 6, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 }
}

test('calibrationAftermath: the previous mag cal SUCCESS report keeps streaming and lands once more before the next start ack', () => {
  const scenario = createArduCopterMockScenario({ calibrationAftermath: true })
  decodeAll(scenario.respondToOutbound(outbound(commandLong(MAV_CMD.DO_START_MAG_CAL, [0, 1, 1, 0, 0, 0, 0]))))

  // The terminal calibrators report on every EXTRA3 tick — modelled on the
  // GCS heartbeat.
  const tick = decodeAll(scenario.respondToOutbound(outbound(gcsHeartbeat())))
  assert.deepEqual(tick.map((m) => m.type), ['MAG_CAL_REPORT'])
  assert.equal(tick[0].calStatus, 4)

  // The next start: the stale report precedes the ack on the wire.
  const second = decodeAll(scenario.respondToOutbound(outbound(commandLong(MAV_CMD.DO_START_MAG_CAL, [0, 1, 1, 0, 0, 0, 0]))))
  assert.equal(second[0].type, 'MAG_CAL_REPORT', 'stale report first')
  assert.equal(second[1].type, 'COMMAND_ACK')
  assert.equal(second.filter((m) => m.type === 'MAG_CAL_REPORT').length, 2, 'stale + this run\'s own report')

  // DO_CANCEL_MAG_CAL stop()s the calibrators, which is the one thing that
  // ends the stream.
  decodeAll(scenario.respondToOutbound(outbound(commandLong(MAV_CMD.DO_CANCEL_MAG_CAL))))
  assert.deepEqual(decodeAll(scenario.respondToOutbound(outbound(gcsHeartbeat()))), [])
})

test('calibrationAftermath: the accel SUCCESS sentinel repeats on every heartbeat tick until a new cal starts', () => {
  const scenario = createArduCopterMockScenario({ calibrationAftermath: true })
  const start = () => decodeAll(scenario.respondToOutbound(outbound(commandLong(MAV_CMD.PREFLIGHT_CALIBRATION, [0, 0, 0, 0, 1, 0, 0]))))
  const confirm = () =>
    decodeAll(
      scenario.respondToOutbound(
        outbound({ type: 'COMMAND_ACK', command: 0, result: MAV_RESULT.TEMPORARILY_REJECTED, progress: 0, resultParam2: 0, targetSystem: 1, targetComponent: 1 })
      )
    )
  start()
  for (let pose = 0; pose < 6; pose += 1) confirm()

  const tick = decodeAll(scenario.respondToOutbound(outbound(gcsHeartbeat())))
  const sentinel = tick.find((m) => m.type === 'COMMAND_LONG' && m.command === MAV_CMD.ACCELCAL_VEHICLE_POS)
  assert.ok(sentinel, 'sentinel re-sent on the tick')
  assert.equal(sentinel.params[0], 16777215)

  // AP_AccelCal::start() resets _last_result: no sentinel while a cal runs.
  start()
  assert.equal(
    decodeAll(scenario.respondToOutbound(outbound(gcsHeartbeat()))).some((m) => m.type === 'COMMAND_LONG'),
    false
  )
})

test('without calibrationAftermath a GCS heartbeat answers with nothing (demo traffic unchanged)', () => {
  const scenario = createArduCopterMockScenario()
  decodeAll(scenario.respondToOutbound(outbound(commandLong(MAV_CMD.DO_START_MAG_CAL, [0, 1, 1, 0, 0, 0, 0]))))
  assert.deepEqual(scenario.respondToOutbound(outbound(gcsHeartbeat())), [])
  const second = decodeAll(scenario.respondToOutbound(outbound(commandLong(MAV_CMD.DO_START_MAG_CAL, [0, 1, 1, 0, 0, 0, 0]))))
  assert.equal(second[0].type, 'COMMAND_ACK')
})

test('mock scenario answers a by-name PARAM_REQUEST_READ with the current value at its real index', () => {
  const scenario = createArduCopterMockScenario()
  const responses = decodeAll(
    scenario.respondToOutbound(outbound({ type: 'PARAM_REQUEST_READ', targetSystem: 1, targetComponent: 1, paramId: 'COMPASS_OFS_X', paramIndex: -1 }))
  )
  assert.equal(responses.length, 1)
  assert.equal(responses[0].type, 'PARAM_VALUE')
  assert.equal(responses[0].paramId, 'COMPASS_OFS_X')
  assert.equal(responses[0].paramValue, -12.5)
  assert.ok(responses[0].paramIndex >= 0 && responses[0].paramIndex < responses[0].paramCount)
  // Unknown name → nothing, like a real FC.
  assert.deepEqual(
    scenario.respondToOutbound(outbound({ type: 'PARAM_REQUEST_READ', targetSystem: 1, targetComponent: 1, paramId: 'NOPE_X', paramIndex: -1 })),
    []
  )
})
