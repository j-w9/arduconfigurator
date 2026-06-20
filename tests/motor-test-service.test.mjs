import assert from 'node:assert/strict'
import test from 'node:test'

import { MotorTestService } from '../packages/ardupilot-core/dist/runtime-motor-test-service.js'
import { MAV_CMD, MOTOR_TEST_ORDER, MOTOR_TEST_THROTTLE_TYPE } from '../packages/protocol-mavlink/dist/index.js'

function createIdleLiveVerification() {
  return {
    satisfiedSignals: [],
    rcInput: { verified: false, channelCount: 0, channels: [] },
    batteryTelemetry: { verified: false },
    attitudeTelemetry: { verified: false },
    globalPosition: { verified: false },
    baroSensor: { verified: false, present: false, healthy: false },
    gyroSensor: { verified: false, present: false, healthy: false },
    accelSensor: { verified: false, present: false, healthy: false },
    magSensor: { verified: false, present: false, healthy: false },
    opticalFlow: { verified: false }
  }
}

function createHostHarness(overrides = {}) {
  const sentCommands = []
  const statusEntries = []
  let emits = 0
  let snapshot = {
    connection: { kind: 'connected' },
    vehicle: { firmware: 'ArduPilot', vehicle: 'ArduCopter', systemId: 1, componentId: 1, armed: false, flightMode: 'STABILIZE' },
    hardware: { board: undefined, uartsFile: { status: 'idle', path: '', mappings: [] } },
    parameterStats: { downloaded: 100, total: 100, duplicateFrames: 0, status: 'complete', progress: 1 },
    parameters: [{ id: 'SERVO1_FUNCTION', value: 33, definition: { id: 'SERVO1_FUNCTION', label: 'Motor 1', description: '', category: 'outputs' } }],
    motorTest: { status: 'idle', summary: '', instructions: [] },
    guidedActions: {},
    preArmStatus: { healthy: true, issues: [], updatedAtMs: 0 },
    liveVerification: createIdleLiveVerification(),
    canBus: { status: 'idle', bus: undefined, error: undefined, framesReceived: 0, nodes: [] },
    statusTexts: [],
    setupSections: [],
    ...overrides.snapshotOverrides
  }

  const host = {
    getSnapshot: () => snapshot,
    sendCommand: async (command, params) => {
      sentCommands.push({ command, params })
      // Default: ack accepted. Tests can override via overrides.sendCommand.
      return { type: 'COMMAND_ACK', command, result: 0, targetSystem: 1, targetComponent: 1 }
    },
    appendStatusEntry: (severity, text) => {
      statusEntries.push({ severity, text })
    },
    emit: () => {
      emits += 1
    },
    ...overrides.host
  }

  return {
    host,
    sentCommands,
    statusEntries,
    get emits() { return emits },
    setSnapshot(next) { snapshot = next }
  }
}

test('MotorTestService refuses to run when the eligibility check fails', async () => {
  // Armed snapshot — eligibility blocks the test.
  const harness = createHostHarness({
    snapshotOverrides: {
      vehicle: { firmware: 'ArduPilot', vehicle: 'ArduCopter', systemId: 1, componentId: 1, armed: true, flightMode: 'STABILIZE' }
    }
  })
  const service = new MotorTestService(harness.host)
  try {
    await assert.rejects(
      () => service.run({ outputChannel: 1, throttlePercent: 5, durationSeconds: 1 }),
      /armed|not currently allowed/i
    )
    assert.equal(harness.sentCommands.length, 0, 'no DO_MOTOR_TEST should fire when not allowed')
    assert.equal(service.getState().status, 'idle')
  } finally {
    service.reset()
  }
})

test('MotorTestService run() sends DO_MOTOR_TEST with the requested params + flips to running', async () => {
  const harness = createHostHarness()
  const service = new MotorTestService(harness.host)
  try {
    await service.run({ outputChannel: 1, throttlePercent: 5, durationSeconds: 1 })

    const command = harness.sentCommands.find((c) => c.command === MAV_CMD.DO_MOTOR_TEST)
    assert.ok(command, 'expected a DO_MOTOR_TEST command')
    // Single-output path: [motorSeq, throttleType=PERCENT, throttlePercent,
    // durationSec, count=1, order=DEFAULT, 0]. Conformance fix: param6 was
    // BOARD, but ArduCopter ignores param6 entirely — DEFAULT matches what
    // Mission Planner sends.
    assert.equal(command.params[1], MOTOR_TEST_THROTTLE_TYPE.PERCENT)
    assert.equal(command.params[2], 5, 'throttle percent')
    assert.equal(command.params[3], 1, 'duration seconds')
    assert.equal(command.params[4], 1, 'count = 1 for single-output')
    assert.equal(command.params[5], MOTOR_TEST_ORDER.DEFAULT, 'param6 is DEFAULT (Copter ignores it; BOARD implied routing that never existed)')

    assert.equal(service.getState().status, 'running')
    assert.equal(service.hasActiveTest(), true)
  } finally {
    service.reset()
  }
})

test('single motor test translates MOT number to the frame TEST ORDER (quad-X, SITL-validated)', async () => {
  // Conformance fix: ArduCopter matches DO_MOTOR_TEST param1 against the
  // frame's testing order (AP_MotorsMatrix _test_order), NOT the MOT_n
  // number. QUAD_X test orders are M1:1 M2:3 M3:4 M4:2 — empirically
  // confirmed on real ArduCopter SITL (seq→motor {1:M1,2:M4,3:M2,4:M3}).
  // Asking for M2 must send param1=3; the OLD code sent 2, which spins M4.
  const harness = createHostHarness({
    snapshotOverrides: {
      parameters: [
        { id: 'FRAME_CLASS', value: 1, definition: { id: 'FRAME_CLASS', label: '', description: '', category: 'outputs' } },
        { id: 'FRAME_TYPE', value: 1, definition: { id: 'FRAME_TYPE', label: '', description: '', category: 'outputs' } },
        { id: 'SERVO2_FUNCTION', value: 34, definition: { id: 'SERVO2_FUNCTION', label: 'Motor 2', description: '', category: 'outputs' } }
      ]
    }
  })
  const service = new MotorTestService(harness.host)
  try {
    await service.run({ outputChannel: 2, throttlePercent: 5, durationSeconds: 1 })
    const command = harness.sentCommands.find((c) => c.command === MAV_CMD.DO_MOTOR_TEST)
    assert.ok(command)
    assert.equal(command.params[0], 3, 'M2 on quad-X maps to test-order sequence 3 (old code sent 2 = M4)')
    assert.ok(
      !harness.statusEntries.some((entry) => /no known test-order table/i.test(entry.text)),
      'known frame must not surface the unmapped warning'
    )
  } finally {
    service.reset()
  }
})

test('single motor test on an unknown frame falls back to the raw motor number with an honest warning', async () => {
  // FRAME_CLASS 6 (HELI) has no matrix test-order table — keep the
  // pre-fix bytes (raw motor number) and tell the operator that motor
  // identity is unverified rather than silently guessing.
  const harness = createHostHarness({
    snapshotOverrides: {
      parameters: [
        { id: 'FRAME_CLASS', value: 6, definition: { id: 'FRAME_CLASS', label: '', description: '', category: 'outputs' } },
        { id: 'FRAME_TYPE', value: 0, definition: { id: 'FRAME_TYPE', label: '', description: '', category: 'outputs' } },
        { id: 'SERVO1_FUNCTION', value: 34, definition: { id: 'SERVO1_FUNCTION', label: 'Motor 2', description: '', category: 'outputs' } }
      ]
    }
  })
  const service = new MotorTestService(harness.host)
  try {
    await service.run({ outputChannel: 1, throttlePercent: 5, durationSeconds: 1 })
    const command = harness.sentCommands.find((c) => c.command === MAV_CMD.DO_MOTOR_TEST)
    assert.ok(command)
    assert.equal(command.params[0], 2, 'unknown frame passes the MOT number through unchanged')
    assert.ok(
      harness.statusEntries.some((entry) => entry.severity === 'warning' && /no known test-order table/i.test(entry.text)),
      'unmapped frame surfaces the verify-which-motor warning'
    )
  } finally {
    service.reset()
  }
})

test('MotorTestService runAllOutputs uses SEQUENCE order + count=N', async () => {
  // Eligibility needs >=4 mapped motor outputs; add four SERVOn_FUNCTION
  // parameters set to motor 1..4 codes (33-36).
  const harness = createHostHarness({
    snapshotOverrides: {
      parameters: [33, 34, 35, 36].map((value, i) => ({
        id: `SERVO${i + 1}_FUNCTION`,
        value,
        definition: { id: `SERVO${i + 1}_FUNCTION`, label: `Motor ${i + 1}`, description: '', category: 'outputs' }
      }))
    }
  })
  const service = new MotorTestService(harness.host)
  try {
    await service.run({ runAllOutputs: true, throttlePercent: 5, durationSeconds: 1 })

    const command = harness.sentCommands.find((c) => c.command === MAV_CMD.DO_MOTOR_TEST)
    assert.ok(command)
    // All-outputs path: [1, throttleType=PERCENT, throttlePercent, durationSec, count=N, order=SEQUENCE, 0]
    assert.equal(command.params[4], 4, 'count = 4 mapped motors')
    assert.equal(command.params[5], MOTOR_TEST_ORDER.SEQUENCE, 'all-outputs uses SEQUENCE order')

    assert.equal(service.getState().allOutputsSelected, true)
  } finally {
    service.reset()
  }
})

test('MotorTestService stop() sends a zero-throttle abort and marks failed', async () => {
  const harness = createHostHarness()
  const service = new MotorTestService(harness.host)
  try {
    await service.run({ outputChannel: 1, throttlePercent: 5, durationSeconds: 2 })
    assert.equal(service.hasActiveTest(), true)

    await service.stop()
    // Stop sends a second DO_MOTOR_TEST with throttle=0.
    const stops = harness.sentCommands.filter((c) => c.command === MAV_CMD.DO_MOTOR_TEST && c.params[2] === 0)
    assert.equal(stops.length, 1, 'expected exactly one zero-throttle abort')
    assert.equal(service.getState().status, 'failed', 'stop marks the run as failed (operator abort)')
    assert.equal(service.hasActiveTest(), false)
  } finally {
    service.reset()
  }
})

test('MotorTestService stop() is a no-op when no test is active', async () => {
  const harness = createHostHarness()
  const service = new MotorTestService(harness.host)
  try {
    await service.stop()
    assert.equal(harness.sentCommands.length, 0)
    assert.equal(service.getState().status, 'idle')
  } finally {
    service.reset()
  }
})

test('MotorTestService run() surfaces a failed ack', async () => {
  let sentCount = 0
  const harness = createHostHarness({
    host: {
      sendCommand: async () => {
        sentCount += 1
        throw new Error('ACK REJECTED')
      }
    }
  })
  const service = new MotorTestService(harness.host)
  try {
    await assert.rejects(
      () => service.run({ outputChannel: 1, throttlePercent: 5, durationSeconds: 1 }),
      /ACK REJECTED/
    )
    assert.equal(sentCount, 1)
    assert.equal(service.getState().status, 'failed')
  } finally {
    service.reset()
  }
})

test('MotorTestService.reset() clears state + any pending completion timer', () => {
  const harness = createHostHarness()
  const service = new MotorTestService(harness.host)
  // Reset on a fresh idle service is a no-op but should not throw.
  service.reset()
  assert.equal(service.getState().status, 'idle')
})
