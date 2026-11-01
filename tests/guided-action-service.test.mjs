import assert from 'node:assert/strict'
import test from 'node:test'

import { GuidedActionService } from '../packages/ardupilot-core/dist/index.js'
import { MAV_CMD } from '../packages/protocol-mavlink/dist/index.js'

const VEHICLE = { systemId: 1, componentId: 1, firmware: 'ArduPilot', vehicle: 'ArduCopter', armed: false }

function createHostHarness(overrides = {}) {
  const sent = []
  const sentCommands = []
  const statusEntries = []
  let emits = 0

  const host = {
    session: {
      send: async (message) => {
        sent.push(message)
      }
    },
    getVehicle: () => VEHICLE,
    // Default to a vehicle with an enabled compass so compass-calibration
    // tests get past the no-usable-compass fast-fail guard. The
    // no-compass path is covered by the integration mock
    // (createCompasslessCalibrationSession).
    getParameters: () => new Map([['COMPASS_USE', { value: 1 }]]),
    getParameterSyncStatus: () => 'complete',
    isConnected: () => true,
    sendCommand: async (command, params, options) => {
      sentCommands.push({ command, params, options })
    },
    appendStatusEntry: (severity, text) => {
      statusEntries.push({ severity, text })
    },
    emit: () => {
      emits += 1
    },
    ...overrides
  }

  return {
    host,
    sent,
    sentCommands,
    statusEntries,
    emitCount: () => emits
  }
}

test('GuidedActionService starts idle for every guided action', () => {
  const { host } = createHostHarness()
  const service = new GuidedActionService(host)

  const actions = service.getActions()
  assert.equal(actions['calibrate-accelerometer'].status, 'idle')
  assert.equal(actions['calibrate-compass'].status, 'idle')
  assert.equal(actions['request-parameters'].status, 'idle')
  assert.equal(service.hasActiveAction(), false)
})

test('GuidedActionService queues the accelerometer calibration command and waits for posture prompts', async () => {
  const harness = createHostHarness({
    accelerometerInitialWarmupMs: 10000,
    accelerometerStepAdvanceMs: 10000
  })
  const service = new GuidedActionService(harness.host)

  try {
    await service.runCalibrationAction('calibrate-accelerometer')

    const command = harness.sentCommands.find((entry) => entry.command === MAV_CMD.PREFLIGHT_CALIBRATION)
    assert.ok(command, 'expected a PREFLIGHT_CALIBRATION command')
    assert.deepEqual(command.params, [0, 0, 0, 0, 1, 0, 0])

    const action = service.getAction('calibrate-accelerometer')
    assert.equal(action.status, 'running')
    assert.equal(service.hasActiveAction(), true)
  } finally {
    service.destroy()
  }
})

test('GuidedActionService runs level calibration via PREFLIGHT_CALIBRATION param5=2', async () => {
  // Board-level calibration is one-shot: send param5=2 (NOT param5=1 which
  // kicks off the 6-pose accel cal). The runtime should NOT enter the
  // accelerometer-posture state machine.
  const harness = createHostHarness()
  const service = new GuidedActionService(harness.host)

  try {
    await service.runCalibrationAction('calibrate-level')

    const command = harness.sentCommands.find(
      (entry) => entry.command === MAV_CMD.PREFLIGHT_CALIBRATION
    )
    assert.ok(command, 'expected a PREFLIGHT_CALIBRATION command')
    assert.deepEqual(
      command.params,
      [0, 0, 0, 0, 2, 0, 0],
      'level cal must use param5=2 (board level), not param5=1 (6-pose accel cal)'
    )

    // Accelerometer action must NOT be touched.
    const accel = service.getAction('calibrate-accelerometer')
    assert.equal(accel.status, 'idle')
  } finally {
    service.destroy()
  }
})

test('GuidedActionService completes level calibration on the COMMAND_ACK (no STATUSTEXT)', async () => {
  // Regression: real ArduPilot reports board-level (accel trim) completion
  // ONLY via the COMMAND_ACK result — it sends no "level calibration
  // complete" STATUSTEXT. The action must therefore finish on the accepted
  // ack alone; waiting for a STATUSTEXT (like the accel/compass cals) hangs
  // forever on real hardware. sendCommand resolves on ACCEPTED, so a clean
  // return must leave the action succeeded WITHOUT any status text.
  const harness = createHostHarness()
  const service = new GuidedActionService(harness.host)

  try {
    await service.runCalibrationAction('calibrate-level')

    const action = service.getAction('calibrate-level')
    assert.equal(action.status, 'succeeded')
    assert.ok(action.completedAtMs, 'expected completedAtMs to be set')
    assert.ok(action.summary.toLowerCase().includes('level calibration complete'))
  } finally {
    service.destroy()
  }
})

test('GuidedActionService fails level calibration when the COMMAND_ACK is rejected', async () => {
  // The accepted-ack path completes the cal; a rejected ack (sendCommand
  // throws) must surface as a failure, not a silent hang.
  const harness = createHostHarness({
    sendCommand: async () => {
      throw new Error('PREFLIGHT_CALIBRATION rejected (MAV_RESULT_FAILED).')
    }
  })
  const service = new GuidedActionService(harness.host)

  try {
    await service.runCalibrationAction('calibrate-level').catch(() => {})

    const action = service.getAction('calibrate-level')
    assert.equal(action.status, 'failed')
  } finally {
    service.destroy()
  }
})

test('GuidedActionService: accelerometer-cal STATUSTEXTs do not flip an idle level action', () => {
  // Real-FC bug: running ACCEL cal also marked LEVEL "good to go". The 6-pose
  // accel cal emits "Place vehicle level and press any key." and, on success,
  // a trim-confirmation ("Trim OK") plus the generic "Calibration successful".
  // The level matcher's previously un-gated `trim ok` / `level calibration
  // complete` substrings caught that accel text and flipped the IDLE level
  // action to succeeded. Level cal completes on its own COMMAND_ACK, so an
  // idle level must never be moved by another cal's STATUSTEXT.
  const harness = createHostHarness()
  const service = new GuidedActionService(harness.host)

  service.setAction('calibrate-accelerometer', {
    actionId: 'calibrate-accelerometer',
    status: 'running',
    summary: 'Accelerometer calibration running.',
    instructions: [],
    statusTexts: [],
    startedAtMs: Date.now(),
    updatedAtMs: Date.now(),
    completedAtMs: undefined
  })

  service.processStatusText('Place vehicle level and press any key.')
  service.processStatusText('AHRS: Trim OK')
  service.processStatusText('Calibration successful')

  assert.equal(service.getAction('calibrate-level').status, 'idle', 'level must stay idle during accel cal')
})

test('GuidedActionService: "Trim OK" still completes an ACTIVE level cal', () => {
  // The gate must not break the legitimate path: while a level cal IS in
  // progress, the trim-confirmation STATUSTEXT still completes it.
  const harness = createHostHarness()
  const service = new GuidedActionService(harness.host)

  service.setAction('calibrate-level', {
    actionId: 'calibrate-level',
    status: 'running',
    summary: 'Board level calibration running.',
    instructions: [],
    statusTexts: [],
    startedAtMs: Date.now(),
    updatedAtMs: Date.now(),
    completedAtMs: undefined
  })

  service.processStatusText('AHRS: Trim OK')
  assert.equal(service.getAction('calibrate-level').status, 'succeeded')
})

test('GuidedActionService advances the posture step when the FC emits ACCELCAL_VEHICLE_POS', async () => {
  const harness = createHostHarness({
    accelerometerInitialWarmupMs: 10000,
    accelerometerStepAdvanceMs: 10000
  })
  const service = new GuidedActionService(harness.host)

  try {
    await service.runCalibrationAction('calibrate-accelerometer')
    service.handleCommandLong(
      { type: 'COMMAND_LONG', command: MAV_CMD.ACCELCAL_VEHICLE_POS, params: [1, 0, 0, 0, 0, 0, 0] },
      VEHICLE.systemId,
      VEHICLE.componentId
    )

    const action = service.getAction('calibrate-accelerometer')
    assert.equal(action.status, 'running')
    assert.equal(action.ctaLabel, 'Confirm Level Position')
    assert.equal(action.summary, 'Place the vehicle level and keep it still.')
  } finally {
    service.destroy()
  }
})

test('GuidedActionService ignores ACCELCAL_VEHICLE_POS from a different system', async () => {
  const harness = createHostHarness({
    accelerometerInitialWarmupMs: 10000,
    accelerometerStepAdvanceMs: 10000
  })
  const service = new GuidedActionService(harness.host)

  try {
    await service.runCalibrationAction('calibrate-accelerometer')
    service.handleCommandLong(
      { type: 'COMMAND_LONG', command: MAV_CMD.ACCELCAL_VEHICLE_POS, params: [1, 0, 0, 0, 0, 0, 0] },
      99,
      99
    )

    const action = service.getAction('calibrate-accelerometer')
    assert.equal(action.ctaLabel, undefined)
  } finally {
    service.destroy()
  }
})

test('GuidedActionService completes accelerometer calibration on the FC success sentinel', async () => {
  const harness = createHostHarness({
    accelerometerInitialWarmupMs: 10000,
    accelerometerStepAdvanceMs: 10000
  })
  const service = new GuidedActionService(harness.host)

  try {
    await service.runCalibrationAction('calibrate-accelerometer')
    service.handleCommandLong(
      { type: 'COMMAND_LONG', command: MAV_CMD.ACCELCAL_VEHICLE_POS, params: [16777215, 0, 0, 0, 0, 0, 0] },
      VEHICLE.systemId,
      VEHICLE.componentId
    )

    const action = service.getAction('calibrate-accelerometer')
    assert.equal(action.status, 'succeeded')
    assert.equal(action.summary, 'Accelerometer calibration complete.')
    assert.ok(harness.statusEntries.some((entry) => entry.text === 'Accelerometer calibration complete.'))
  } finally {
    service.destroy()
  }
})

test('GuidedActionService fails accelerometer calibration on the FC failure sentinel', async () => {
  const harness = createHostHarness({
    accelerometerInitialWarmupMs: 10000,
    accelerometerStepAdvanceMs: 10000
  })
  const service = new GuidedActionService(harness.host)

  try {
    await service.runCalibrationAction('calibrate-accelerometer')
    service.handleCommandLong(
      { type: 'COMMAND_LONG', command: MAV_CMD.ACCELCAL_VEHICLE_POS, params: [16777216, 0, 0, 0, 0, 0, 0] },
      VEHICLE.systemId,
      VEHICLE.componentId
    )

    const action = service.getAction('calibrate-accelerometer')
    assert.equal(action.status, 'failed')
    assert.match(action.summary, /accelerometer calibration failed/i)
  } finally {
    service.destroy()
  }
})

test('GuidedActionService queues the compass calibration command', async () => {
  const harness = createHostHarness({ compassGuidanceTimeoutMs: 10000 })
  const service = new GuidedActionService(harness.host)

  try {
    await service.runCalibrationAction('calibrate-compass')

    const command = harness.sentCommands.find((entry) => entry.command === MAV_CMD.DO_START_MAG_CAL)
    assert.ok(command, 'expected a DO_START_MAG_CAL command (modern onboard mag cal)')
    // mag_mask=0 (all), retry=1, autosave=1, delay=0, autoreboot=0.
    assert.deepEqual(command.params, [0, 1, 1, 0, 0, 0, 0])
    assert.equal(service.getAction('calibrate-compass').status, 'running')
  } finally {
    service.destroy()
  }
})

test('GuidedActionService advances compass calibration through autopilot status text', async () => {
  const harness = createHostHarness({ compassGuidanceTimeoutMs: 10000 })
  const service = new GuidedActionService(harness.host)

  try {
    await service.runCalibrationAction('calibrate-compass')
    service.processStatusText('Compass calibration successful')

    const action = service.getAction('calibrate-compass')
    assert.equal(action.status, 'succeeded')
    assert.ok(action.statusTexts.some((text) => text.includes('Compass calibration successful')))
  } finally {
    service.destroy()
  }
})

test('GuidedActionService fails compass calibration when no enabled compass is detected', () => {
  const harness = createHostHarness({
    getParameters: () => new Map([['COMPASS_USE', { id: 'COMPASS_USE', value: 0, type: 2 }]])
  })
  const service = new GuidedActionService(harness.host)

  service.setAction('calibrate-compass', {
    actionId: 'calibrate-compass',
    status: 'running',
    summary: 'Compass calibration command sent. Waiting for autopilot guidance.',
    instructions: [],
    statusTexts: [],
    startedAtMs: Date.now(),
    updatedAtMs: Date.now(),
    completedAtMs: undefined
  })
  service.reconcileCompassCalibrationAvailability()

  const action = service.getAction('calibrate-compass')
  assert.equal(action.status, 'failed')
  assert.equal(action.summary, 'No compass is enabled on this vehicle. Skip this step, or set COMPASS_USE and re-check.')
  assert.ok(harness.statusEntries.some((entry) => entry.text.includes('No compass is enabled')))
})

test('GuidedActionService treats COMPASS_USE=1 with COMPASS_DEV_ID=0 as no compass present', () => {
  // RADIX 2 HD / most H7 FPV boards: COMPASS_USE defaults to 1 even with no
  // magnetometer fitted, but COMPASS_DEV_ID stays 0. Keying on COMPASS_USE
  // alone used to start a mag cal that hangs forever; the slot must be backed
  // by a detected device id to count.
  const harness = createHostHarness({
    getParameters: () =>
      new Map([
        ['COMPASS_USE', { id: 'COMPASS_USE', value: 1, type: 2 }],
        ['COMPASS_DEV_ID', { id: 'COMPASS_DEV_ID', value: 0, type: 6 }],
        ['COMPASS_USE2', { id: 'COMPASS_USE2', value: 1, type: 2 }],
        ['COMPASS_DEV_ID2', { id: 'COMPASS_DEV_ID2', value: 0, type: 6 }],
        ['COMPASS_USE3', { id: 'COMPASS_USE3', value: 1, type: 2 }],
        ['COMPASS_DEV_ID3', { id: 'COMPASS_DEV_ID3', value: 0, type: 6 }]
      ])
  })
  const service = new GuidedActionService(harness.host)

  service.setAction('calibrate-compass', {
    actionId: 'calibrate-compass',
    status: 'running',
    summary: 'Compass calibration command sent. Waiting for autopilot guidance.',
    instructions: [],
    statusTexts: [],
    startedAtMs: Date.now(),
    updatedAtMs: Date.now(),
    completedAtMs: undefined
  })
  service.reconcileCompassCalibrationAvailability()

  const action = service.getAction('calibrate-compass')
  assert.equal(action.status, 'failed')
  // The operator HAS enabled a compass, so "enable a compass first" would send
  // them to re-set a parameter that is already set. The blocker is that nothing
  // answered on the bus, which is a wiring/boot problem.
  assert.match(action.summary, /enabled \(COMPASS_USE is set\) but the autopilot detected no compass hardware/)
  assert.match(action.summary, /COMPASS_DEV_ID is 0/)
  assert.match(action.summary, /separate I2C device \(SDA\/SCL\) from the GPS UART/)
  assert.doesNotMatch(action.summary, /enable a compass first/)
})

test('GuidedActionService counts a compass slot backed by a non-zero COMPASS_DEV_ID', () => {
  // A real external mag: COMPASS_USE=1 AND COMPASS_DEV_ID!=0 -> the slot counts
  // and compass cal is allowed to proceed.
  const harness = createHostHarness({
    getParameters: () =>
      new Map([
        ['COMPASS_USE', { id: 'COMPASS_USE', value: 1, type: 2 }],
        ['COMPASS_DEV_ID', { id: 'COMPASS_DEV_ID', value: 97539, type: 6 }]
      ])
  })
  const service = new GuidedActionService(harness.host)

  service.setAction('calibrate-compass', {
    actionId: 'calibrate-compass',
    status: 'running',
    summary: 'Compass calibration command sent. Waiting for autopilot guidance.',
    instructions: [],
    statusTexts: [],
    startedAtMs: Date.now(),
    updatedAtMs: Date.now(),
    completedAtMs: undefined
  })
  service.reconcileCompassCalibrationAvailability()

  // Still running — availability reconcile did NOT fail it out.
  assert.equal(service.getAction('calibrate-compass').status, 'running')
})

test('GuidedActionService reset returns every action to idle', async () => {
  const harness = createHostHarness({
    accelerometerInitialWarmupMs: 10000,
    accelerometerStepAdvanceMs: 10000
  })
  const service = new GuidedActionService(harness.host)

  await service.runCalibrationAction('calibrate-accelerometer')
  assert.equal(service.hasActiveAction(), true)

  service.reset()
  assert.equal(service.hasActiveAction(), false)
  assert.equal(service.getAction('calibrate-accelerometer').status, 'idle')
})

function magCalProgress(overrides = {}) {
  return {
    type: 'MAG_CAL_PROGRESS',
    compassId: 0,
    calMask: 1,
    calStatus: 2,
    attempt: 1,
    completionPct: 0,
    completionMask: new Uint8Array(10),
    directionX: 0,
    directionY: 0,
    directionZ: 0,
    ...overrides
  }
}

function magCalReport(overrides = {}) {
  return {
    type: 'MAG_CAL_REPORT',
    compassId: 0,
    calMask: 1,
    calStatus: 4,
    autosaved: 0,
    fitness: 2,
    ofsX: 0,
    ofsY: 0,
    ofsZ: 0,
    diagX: 1,
    diagY: 1,
    diagZ: 1,
    offdiagX: 0,
    offdiagY: 0,
    offdiagZ: 0,
    orientationConfidence: 1,
    oldOrientation: 0,
    newOrientation: 0,
    scaleFactor: 1,
    ...overrides
  }
}

test('compass calibration sends DO_START_MAG_CAL (not legacy PREFLIGHT_CALIBRATION)', async () => {
  const { host, sentCommands } = createHostHarness()
  const service = new GuidedActionService(host)
  await service.runCalibrationAction('calibrate-compass')

  assert.equal(sentCommands.length, 1)
  assert.equal(sentCommands[0].command, MAV_CMD.DO_START_MAG_CAL)
  assert.notEqual(MAV_CMD.DO_START_MAG_CAL, MAV_CMD.PREFLIGHT_CALIBRATION)
  assert.equal(service.getAction('calibrate-compass').status, 'running')
})

test('MAG_CAL_PROGRESS drives the compass action percentage', async () => {
  const { host } = createHostHarness()
  const service = new GuidedActionService(host)
  await service.runCalibrationAction('calibrate-compass')

  service.handleMagCalProgress(magCalProgress({ completionPct: 57 }))
  const action = service.getAction('calibrate-compass')
  assert.equal(action.status, 'running')
  assert.match(action.summary, /57%/)
  assert.equal(action.progressPct, 57, 'structured progressPct surfaced for the UI bar')
})

test('a progress gap longer than the guidance timeout does NOT fail an active compass calibration', async () => {
  // Regression: mag cal is human-paced (rotate an axis, pause,
  // reposition) so multi-second gaps between MAG_CAL_PROGRESS are
  // normal. Re-arming the "did it start?" guidance timeout on every
  // progress made such a gap abort a working calibration with a false
  // "No compass calibration guidance arrived" message — only the fast
  // mock hid it. Once progress proves it started, the guard is done.
  const { host, statusEntries } = createHostHarness({ compassGuidanceTimeoutMs: 40 })
  const service = new GuidedActionService(host)
  await service.runCalibrationAction('calibrate-compass')

  service.handleMagCalProgress(magCalProgress({ completionPct: 30 }))
  // Wait well past the guidance timeout with NO further progress.
  await new Promise((resolve) => setTimeout(resolve, 120))

  const action = service.getAction('calibrate-compass')
  assert.equal(action.status, 'running', 'an in-progress calibration must survive a >timeout progress gap')
  assert.equal(action.progressPct, 30)
  assert.ok(
    !statusEntries.some((entry) => /guidance arrived/i.test(entry.text)),
    'no false "no guidance arrived" warning after progress was already seen'
  )
})

test('MAG_CAL_REPORT success accepts the fit and completes the action', async () => {
  const { host, sentCommands } = createHostHarness()
  const service = new GuidedActionService(host)
  await service.runCalibrationAction('calibrate-compass')

  service.handleMagCalReport(magCalReport({ calStatus: 4, autosaved: 0 }))
  assert.equal(service.getAction('calibrate-compass').status, 'succeeded')
  assert.ok(
    sentCommands.some((c) => c.command === MAV_CMD.DO_ACCEPT_MAG_CAL),
    'expected DO_ACCEPT_MAG_CAL when the autopilot did not auto-save'
  )
})

test('MAG_CAL_REPORT success that auto-saved does not re-send accept', async () => {
  const { host, sentCommands } = createHostHarness()
  const service = new GuidedActionService(host)
  await service.runCalibrationAction('calibrate-compass')

  service.handleMagCalReport(magCalReport({ calStatus: 4, autosaved: 1 }))
  assert.equal(service.getAction('calibrate-compass').status, 'succeeded')
  assert.ok(!sentCommands.some((c) => c.command === MAV_CMD.DO_ACCEPT_MAG_CAL))
})

test('MAG_CAL_REPORT bad-orientation fails the compass action with a clear reason', async () => {
  const { host } = createHostHarness()
  const service = new GuidedActionService(host)
  await service.runCalibrationAction('calibrate-compass')

  service.handleMagCalReport(magCalReport({ calStatus: 6 }))
  const action = service.getAction('calibrate-compass')
  assert.equal(action.status, 'failed')
  assert.match(action.summary, /orientation/i)
})

test('reset cancels an in-flight mag calibration', async () => {
  const { host, sentCommands } = createHostHarness()
  const service = new GuidedActionService(host)
  await service.runCalibrationAction('calibrate-compass')

  service.reset()
  assert.ok(sentCommands.some((c) => c.command === MAV_CMD.DO_CANCEL_MAG_CAL))
  assert.equal(service.getAction('calibrate-compass').status, 'idle')
})

test('reset() while disconnected does not pretend to cancel — it says the onboard cal keeps running', async () => {
  // The cancel cannot reach the vehicle once the link is down; the old
  // code fired it into a .catch(()=>{}) so it looked handled. It must
  // not send, and must say what the vehicle does: CompassCalibrator has no
  // timeout — it fits until a result (autosaved) or a reboot.
  const { host, sentCommands, statusEntries } = createHostHarness({ isConnected: () => false })
  const service = new GuidedActionService(host)
  await service.runCalibrationAction('calibrate-compass')

  service.reset()
  assert.ok(
    !sentCommands.some((c) => c.command === MAV_CMD.DO_CANCEL_MAG_CAL),
    'no cancel is sent when disconnected'
  )
  assert.ok(
    statusEntries.some((entry) => entry.severity === 'warning' && /keeps running/i.test(entry.text) && /only stops on a reboot/i.test(entry.text)),
    'an honest "keeps running until reboot" warning is surfaced'
  )
  assert.ok(!statusEntries.some((entry) => /time-out|times out/i.test(entry.text)), 'no invented onboard timeout')
  assert.equal(service.getAction('calibrate-compass').status, 'idle')
})

test('multi-compass MAG_CAL_REPORT: first SUCCESS does NOT finalize — waits for every compass in cal_mask (conformance fix)', async () => {
  // ArduPilot emits one MAG_CAL_REPORT per compass instance. Pre-fix the
  // FIRST report decided the whole calibration: compass 0's SUCCESS
  // declared "complete" and a later FAILED from compass 1 was silently
  // dropped by the already-succeeded guard.
  const { host, sentCommands } = createHostHarness()
  const service = new GuidedActionService(host)
  await service.runCalibrationAction('calibrate-compass')

  // Two compasses being calibrated (mask 0b11). Compass 0 reports first.
  service.handleMagCalReport(magCalReport({ compassId: 0, calMask: 0b11, calStatus: 4, autosaved: 0 }))
  const interim = service.getAction('calibrate-compass')
  assert.equal(interim.status, 'running', 'must NOT succeed on the first of two compasses')
  assert.match(interim.summary, /compass 1: success/i)
  assert.match(interim.summary, /waiting for 1 more compass/i)
  assert.ok(
    !sentCommands.some((c) => c.command === MAV_CMD.DO_ACCEPT_MAG_CAL),
    'accept must NOT be sent while another compass is still calibrating — upstream accept(mask 0) stops EVERY calibrator'
  )

  // Compass 1 reports success too — NOW finalize + accept once.
  service.handleMagCalReport(magCalReport({ compassId: 1, calMask: 0b11, calStatus: 4, autosaved: 0 }))
  const done = service.getAction('calibrate-compass')
  assert.equal(done.status, 'succeeded')
  assert.match(done.summary, /all 2 compasses/i)
  assert.equal(
    sentCommands.filter((c) => c.command === MAV_CMD.DO_ACCEPT_MAG_CAL).length,
    1,
    'one accept after all compasses reported'
  )
})

test('multi-compass MAG_CAL_REPORT: a later FAILED fails the whole cal naming the bad compass', async () => {
  const { host } = createHostHarness()
  const service = new GuidedActionService(host)
  await service.runCalibrationAction('calibrate-compass')

  service.handleMagCalReport(magCalReport({ compassId: 0, calMask: 0b11, calStatus: 4, autosaved: 1 }))
  assert.equal(service.getAction('calibrate-compass').status, 'running')

  // Compass 1 fails with BAD_RADIUS — the cal must fail, not stay
  // "succeeded from compass 0".
  service.handleMagCalReport(magCalReport({ compassId: 1, calMask: 0b11, calStatus: 7, autosaved: 0 }))
  const action = service.getAction('calibrate-compass')
  assert.equal(action.status, 'failed')
  assert.match(action.summary, /compass 2: bad radius/i)
})

test('multi-compass MAG_CAL_REPORT: all auto-saved means no accept is sent', async () => {
  const { host, sentCommands } = createHostHarness()
  const service = new GuidedActionService(host)
  await service.runCalibrationAction('calibrate-compass')

  service.handleMagCalReport(magCalReport({ compassId: 0, calMask: 0b11, calStatus: 4, autosaved: 1 }))
  service.handleMagCalReport(magCalReport({ compassId: 1, calMask: 0b11, calStatus: 4, autosaved: 1 }))
  assert.equal(service.getAction('calibrate-compass').status, 'succeeded')
  assert.ok(!sentCommands.some((c) => c.command === MAV_CMD.DO_ACCEPT_MAG_CAL))
})

test('MAG_CAL_PROGRESS/REPORT are ignored when no compass action is active', () => {
  const { host } = createHostHarness()
  const service = new GuidedActionService(host)
  service.handleMagCalProgress(magCalProgress({ completionPct: 50 }))
  service.handleMagCalReport(magCalReport())
  assert.equal(service.getAction('calibrate-compass').status, 'idle')
})

test('per-pose retry STATUSTEXT does not fail the whole accelerometer calibration', async () => {
  // Regression: real-FC user reported accel cal "fails to capture or keeps wanting
  // the same pose" with a red error notice. Root cause: matchesGenericCalibrationFailure
  // matched the bare substring 'failed', so a per-pose retry hint from ArduPilot
  // (e.g. "Bad cal sample - try again", "FAIL: bad sample") tripped the whole cal
  // into hard-failed state. The matcher now requires a 'calibration'/'cal ' anchor.
  const { host } = createHostHarness()
  const service = new GuidedActionService(host)

  await service.runCalibrationAction('calibrate-accelerometer')
  assert.equal(service.getAction('calibrate-accelerometer').status, 'running')

  for (const retryHint of [
    'Bad cal sample - try again',
    'FAIL: bad sample, retry pose',
    'sample failed, try again'
  ]) {
    service.processStatusText(retryHint)
    assert.notEqual(
      service.getAction('calibrate-accelerometer').status,
      'failed',
      `STATUSTEXT "${retryHint}" should not fail the whole accelerometer cal`
    )
  }

  // A real hard-failure phrase that includes 'calibration' DOES still fail.
  service.processStatusText('Calibration FAILED')
  assert.equal(service.getAction('calibrate-accelerometer').status, 'failed')
})

test('compass report watchdog fails a calibration whose terminal reports never arrive', async () => {
  // Regression: a lost MAG_CAL_REPORT left calibrate-compass 'running'
  // forever, which write-blocked the whole session (hasActiveAction gates
  // every PARAM_SET) until the user power-cycled the FC.
  const { host, sentCommands, statusEntries } = createHostHarness({ compassReportWatchdogMs: 40 })
  const service = new GuidedActionService(host)
  try {
    await service.runCalibrationAction('calibrate-compass')

    service.handleMagCalProgress(magCalProgress({ completionPct: 95 }))
    // No report ever arrives — watchdog must reclaim the session.
    await new Promise((resolve) => setTimeout(resolve, 120))

    const action = service.getAction('calibrate-compass')
    assert.equal(action.status, 'failed')
    assert.match(action.summary, /No compass calibration messages arrived/i)
    assert.equal(service.hasActiveAction(), false, 'write gate must clear')
    assert.ok(
      sentCommands.some((c) => c.command === MAV_CMD.DO_CANCEL_MAG_CAL),
      'expected a best-effort DO_CANCEL_MAG_CAL for any calibrator still running onboard'
    )
    assert.ok(statusEntries.some((entry) => entry.severity === 'warning'))
  } finally {
    service.destroy()
  }
})

test('compass report watchdog is fed by progress and never fires on an active calibration', async () => {
  const { host } = createHostHarness({ compassReportWatchdogMs: 60 })
  const service = new GuidedActionService(host)
  try {
    await service.runCalibrationAction('calibrate-compass')

    // Stream progress at well under the watchdog interval for ~3 windows.
    for (let i = 0; i < 9; i += 1) {
      service.handleMagCalProgress(magCalProgress({ completionPct: 10 * (i + 1) }))
      await new Promise((resolve) => setTimeout(resolve, 20))
    }

    assert.equal(service.getAction('calibrate-compass').status, 'running')

    // The terminal report still finalizes normally after all that.
    service.handleMagCalReport(magCalReport({ calStatus: 4, autosaved: 1 }))
    assert.equal(service.getAction('calibrate-compass').status, 'succeeded')
  } finally {
    service.destroy()
  }
})

test('compass report watchdog covers a lost remainder of a multi-compass report set', async () => {
  const { host } = createHostHarness({ compassReportWatchdogMs: 40 })
  const service = new GuidedActionService(host)
  try {
    await service.runCalibrationAction('calibrate-compass')

    // Compass 0 of a two-compass mask reports; compass 1's report is lost.
    service.handleMagCalReport(magCalReport({ compassId: 0, calMask: 0b11, calStatus: 4, autosaved: 1 }))
    assert.equal(service.getAction('calibrate-compass').status, 'running')

    await new Promise((resolve) => setTimeout(resolve, 120))
    const action = service.getAction('calibrate-compass')
    assert.equal(action.status, 'failed')
    assert.equal(service.hasActiveAction(), false)
  } finally {
    service.destroy()
  }
})

test('cancelAction aborts a running compass calibration and clears the write gate', async () => {
  const { host, sentCommands } = createHostHarness()
  const service = new GuidedActionService(host)
  try {
    await service.runCalibrationAction('calibrate-compass')
    service.handleMagCalProgress(magCalProgress({ completionPct: 40 }))
    assert.equal(service.hasActiveAction(), true)

    await service.cancelAction('calibrate-compass')

    // Cancelling is a decision, not an error: the card returns to its idle
    // start state so the operator can simply run it again, rather than having
    // to clear a failure they caused on purpose.
    const action = service.getAction('calibrate-compass')
    assert.equal(action.status, 'idle')
    assert.equal(service.hasActiveAction(), false, 'write gate must clear without a reboot')
    assert.ok(
      sentCommands.some((c) => c.command === MAV_CMD.DO_CANCEL_MAG_CAL),
      'expected DO_CANCEL_MAG_CAL so the onboard calibrators stop'
    )
  } finally {
    service.destroy()
  }
})

test('cancelAction aborts an abandoned accelerometer calibration without sending a command', async () => {
  const harness = createHostHarness({
    accelerometerInitialWarmupMs: 10000,
    accelerometerStepAdvanceMs: 10000
  })
  const service = new GuidedActionService(harness.host)
  try {
    await service.runCalibrationAction('calibrate-accelerometer')
    assert.equal(service.hasActiveAction(), true)
    const commandCountBeforeCancel = harness.sentCommands.length

    service.cancelAction('calibrate-accelerometer')

    // Back to the first step, not stranded partway through the pose sequence:
    // the pose guide reads which posture to show from this action, so a
    // cancelled run that stayed 'failed' left the operator looking at the pose
    // they abandoned instead of a cal they can start over.
    const action = service.getAction('calibrate-accelerometer')
    assert.equal(action.status, 'idle')
    assert.equal(action.statusTexts.length, 0, 'the abandoned run must not leave its prompts behind')
    assert.equal(service.hasActiveAction(), false)
    // MAVLink has no accel-cal abort; nothing extra goes on the wire, but
    // the operator is told the onboard routine may keep waiting.
    assert.equal(harness.sentCommands.length, commandCountBeforeCancel)
    assert.ok(harness.statusEntries.some((entry) => /no MAVLink command to abort the onboard routine/i.test(entry.text)))
    // Truthful about the vehicle side: AP_AccelCal has no timeout while it
    // waits for a posture; only a reboot (or arming) ends it.
    assert.ok(!harness.statusEntries.some((entry) => /times out/i.test(entry.text)))
  } finally {
    service.destroy()
  }
})

test('cancelAction is a no-op for idle and terminal actions', async () => {
  const { host, sentCommands } = createHostHarness()
  const service = new GuidedActionService(host)
  try {
    service.cancelAction('calibrate-compass')
    assert.equal(service.getAction('calibrate-compass').status, 'idle')
    assert.equal(sentCommands.length, 0)

    await service.runCalibrationAction('calibrate-compass')
    service.handleMagCalReport(magCalReport({ calStatus: 4, autosaved: 1 }))
    assert.equal(service.getAction('calibrate-compass').status, 'succeeded')

    service.cancelAction('calibrate-compass')
    assert.equal(
      service.getAction('calibrate-compass').status,
      'succeeded',
      'a finished calibration must not be retroactively cancelled'
    )
  } finally {
    service.destroy()
  }
})

// --- Accelerometer auto-confirm -------------------------------------------
// Field request: the operator should only click twice (Start, then "I'm
// level") and the remaining five postures should record themselves once the
// frame is placed. These pin the behaviour that makes that safe — a posture is
// only captured when the frame is BOTH aligned and holding still, because
// sampling mid-settle is how a calibration ends up silently wrong.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Drive the service to the posture the FC is currently asking for. */
function promptPose(service, commandValue) {
  service.handleCommandLong({ command: MAV_CMD.ACCELCAL_VEHICLE_POS, params: [commandValue] }, 1, 1)
}

/** COMMAND_ACK is what advanceAccelerometerCalibration emits to confirm a pose. */
const confirmCount = (harness) => harness.sent.filter((m) => m.type === 'COMMAND_ACK').length

async function startCalibration(harness) {
  const service = new GuidedActionService(harness.host)
  await service.runCalibrationAction('calibrate-accelerometer')
  return service
}

test('auto-confirm records a posture once the frame is aligned AND has held still', async () => {
  const harness = createHostHarness({
    accelerometerAutoHoldMs: 40,
    accelerometerStepAdvanceMs: 10000,
    accelerometerInitialWarmupMs: 10000
  })
  const service = await startCalibration(harness)
  try {
    promptPose(service, 2) // left side: roll -90
    const before = confirmCount(harness)

    // Arrives in the pose — but the hold has not elapsed yet.
    service.handleAttitudeSample(-90, 0)
    assert.equal(confirmCount(harness), before, 'must not capture the instant the pose is reached')

    await sleep(60)
    service.handleAttitudeSample(-90, 0)
    assert.equal(confirmCount(harness), before + 1, 'captures once the frame has held the pose still')
  } finally {
    service.destroy()
  }
})

test('auto-confirm does NOT fire for the level posture — that stays the operator click', async () => {
  // A bench vehicle is already level when the calibration starts, so
  // auto-confirming level would fire before the operator had placed anything.
  const harness = createHostHarness({
    accelerometerAutoHoldMs: 20,
    accelerometerStepAdvanceMs: 10000,
    accelerometerInitialWarmupMs: 10000
  })
  const service = await startCalibration(harness)
  try {
    promptPose(service, 1) // level
    const before = confirmCount(harness)
    service.handleAttitudeSample(0, 0)
    await sleep(40)
    service.handleAttitudeSample(0, 0)
    assert.equal(confirmCount(harness), before, 'level must wait for the explicit click')
  } finally {
    service.destroy()
  }
})

test('auto-confirm tolerates a hand-held wobble', async () => {
  // The stillness tolerance is 6 degrees. It was 3, which a hand-held frame
  // almost never settled inside: every small correction restarted the hold, so
  // the auto-progression that exists to save the operator a click frequently
  // never fired and they clicked anyway. A few degrees of hand tremor has to be
  // tolerated; a real move to another posture must not be, which is the test
  // immediately below.
  const harness = createHostHarness({
    accelerometerAutoHoldMs: 40,
    accelerometerStepAdvanceMs: 10000,
    accelerometerInitialWarmupMs: 10000
  })
  const service = await startCalibration(harness)
  try {
    promptPose(service, 3) // right side: roll +90
    const before = confirmCount(harness)

    service.handleAttitudeSample(90, 0)
    await sleep(30)
    // 4 degrees of wobble: inside the tolerance, so the hold keeps running
    // rather than starting over.
    service.handleAttitudeSample(86, 0)
    await sleep(30)
    service.handleAttitudeSample(90, 0)

    assert.equal(
      confirmCount(harness),
      before + 1,
      'a frame held by hand, wobbling a few degrees, must still auto-confirm'
    )
  } finally {
    service.destroy()
  }
})

test('auto-confirm will not capture a frame that has left the pose', async () => {
  // What actually protects the sample is the ALIGNMENT check, not the drift
  // tolerance — which is now 15 degrees against a 17-degree acceptance window
  // and so has almost no room left to fire in. Every sample is re-tested
  // against the pose target on arrival, and a frame that has moved out of that
  // window clears the hold outright.
  //
  // The test this replaces moved the frame 8 degrees and asserted no capture,
  // but it asserted that BETWEEN samples, with the hold not yet elapsed — it
  // passed with the drift set to zero, so it proved nothing about drift at any
  // tolerance.
  const harness = createHostHarness({
    accelerometerAutoHoldMs: 40,
    accelerometerStepAdvanceMs: 10000,
    accelerometerInitialWarmupMs: 10000
  })
  const service = await startCalibration(harness)
  try {
    promptPose(service, 3) // right side: roll +90
    const before = confirmCount(harness)

    service.handleAttitudeSample(90, 0)
    await sleep(60)
    // Rolled well away from "right side" — outside the acceptance window, so
    // the hold is discarded no matter how long it had been running.
    service.handleAttitudeSample(40, 0)
    assert.equal(confirmCount(harness), before, 'a frame outside the pose must not be captured')

    // Back in the window, held: it captures.
    service.handleAttitudeSample(90, 0)
    await sleep(60)
    service.handleAttitudeSample(90, 0)
    assert.equal(confirmCount(harness), before + 1, 'captures once it is back in the pose and settled')
  } finally {
    service.destroy()
  }
})

test('auto-confirm ignores an attitude that is not the requested posture', async () => {
  const harness = createHostHarness({
    accelerometerAutoHoldMs: 20,
    accelerometerStepAdvanceMs: 10000,
    accelerometerInitialWarmupMs: 10000
  })
  const service = await startCalibration(harness)
  try {
    promptPose(service, 6) // back: roll 180
    const before = confirmCount(harness)
    // Sitting level instead of on its back.
    service.handleAttitudeSample(0, 0)
    await sleep(40)
    service.handleAttitudeSample(0, 0)
    assert.equal(confirmCount(harness), before, 'the wrong posture must never be captured')
  } finally {
    service.destroy()
  }
})

test('accelerometerAutoHoldMs = 0 disables auto-confirm (click-every-pose flow)', async () => {
  const harness = createHostHarness({
    accelerometerAutoHoldMs: 0,
    accelerometerStepAdvanceMs: 10000,
    accelerometerInitialWarmupMs: 10000
  })
  const service = await startCalibration(harness)
  try {
    promptPose(service, 2)
    const before = confirmCount(harness)
    service.handleAttitudeSample(-90, 0)
    await sleep(40)
    service.handleAttitudeSample(-90, 0)
    assert.equal(confirmCount(harness), before, 'auto-confirm must be fully defeatable')
  } finally {
    service.destroy()
  }
})

// ---------------------------------------------------------------------------
// Post-calibration aftermath (ArduPilot keeps streaming terminal results)
// ---------------------------------------------------------------------------

function accelPoseCommand(value) {
  return { type: 'COMMAND_LONG', command: MAV_CMD.ACCELCAL_VEHICLE_POS, params: [value, 0, 0, 0, 0, 0, 0] }
}

test('the 1 Hz SUCCESS sentinel after an accel cal does not re-complete the action every second', async () => {
  // AP_AccelCal::update re-sends ACCELCAL_VEHICLE_POS 16777215 every second
  // for the rest of the boot once a cal has finished. Pre-fix each one
  // re-ran completeAccelerometerCalibration(): completedAtMs advanced and a
  // new status entry was pushed, so the reboot prompt keyed on completedAtMs
  // could never stay dismissed.
  const harness = createHostHarness({ accelerometerInitialWarmupMs: 10000, accelerometerStepAdvanceMs: 10000 })
  const service = new GuidedActionService(harness.host)
  try {
    await service.runCalibrationAction('calibrate-accelerometer')
    service.handleCommandLong(accelPoseCommand(16777215), VEHICLE.systemId, VEHICLE.componentId)
    const done = service.getAction('calibrate-accelerometer')
    assert.equal(done.status, 'succeeded')
    const completeEntries = () => harness.statusEntries.filter((e) => e.text === 'Accelerometer calibration complete.').length
    assert.equal(completeEntries(), 1)

    await new Promise((resolve) => setTimeout(resolve, 5))
    service.handleCommandLong(accelPoseCommand(16777215), VEHICLE.systemId, VEHICLE.componentId)
    await new Promise((resolve) => setTimeout(resolve, 5))
    service.handleCommandLong(accelPoseCommand(16777215), VEHICLE.systemId, VEHICLE.componentId)

    const after = service.getAction('calibrate-accelerometer')
    assert.equal(after.status, 'succeeded')
    assert.equal(after.completedAtMs, done.completedAtMs, 'completedAtMs must not move on a re-sent sentinel')
    assert.equal(completeEntries(), 1, 'no duplicate "complete" status entries')
  } finally {
    service.destroy()
  }
})

test('a FAILED sentinel left over from a previous run does not touch an idle accelerometer action', () => {
  const harness = createHostHarness()
  const service = new GuidedActionService(harness.host)
  service.handleCommandLong(accelPoseCommand(16777216), VEHICLE.systemId, VEHICLE.componentId)
  assert.equal(service.getAction('calibrate-accelerometer').status, 'idle')
  assert.equal(harness.statusEntries.length, 0)
})

test('a stale MAG_CAL_REPORT arriving before the DO_START_MAG_CAL ack is ignored; the ack opens the gate', async () => {
  // Compass::send_mag_cal_report streams a report for every calibrator in a
  // terminal state until stop() — the autosave path never stops them, so the
  // previous run's SUCCESS keeps arriving. Pre-fix 'requested' accepted it
  // and the new run was "complete" before the autopilot had started it.
  let resolveStart
  const harness = createHostHarness({
    sendCommand: (command) => {
      if (command === MAV_CMD.DO_START_MAG_CAL) {
        return new Promise((resolve) => {
          resolveStart = resolve
        })
      }
      return Promise.resolve()
    }
  })
  const service = new GuidedActionService(harness.host)
  try {
    const run = service.runCalibrationAction('calibrate-compass')
    assert.equal(service.getAction('calibrate-compass').status, 'requested')

    // Stale terminal report from the previous run lands before the ack.
    service.handleMagCalReport(magCalReport({ calStatus: 4, autosaved: 1 }))
    assert.equal(service.getAction('calibrate-compass').status, 'requested', 'must not finalize on a pre-ack report')
    service.handleMagCalProgress(magCalProgress({ completionPct: 99 }))
    assert.equal(service.getAction('calibrate-compass').progressPct, undefined, 'pre-ack progress is not this run')

    // The vehicle's ACCEPTED ack, delivered in wire order, opens the gate.
    service.handleCommandAck(
      { type: 'COMMAND_ACK', command: MAV_CMD.DO_START_MAG_CAL, result: 0, progress: 0, resultParam2: 0, targetSystem: 255, targetComponent: 190 },
      VEHICLE.systemId,
      VEHICLE.componentId
    )
    assert.equal(service.getAction('calibrate-compass').status, 'running')
    service.handleMagCalProgress(magCalProgress({ completionPct: 10 }))
    assert.equal(service.getAction('calibrate-compass').progressPct, 10)

    resolveStart()
    await run
    assert.equal(service.getAction('calibrate-compass').status, 'running')

    service.handleMagCalReport(magCalReport({ calStatus: 4, autosaved: 1 }))
    assert.equal(service.getAction('calibrate-compass').status, 'succeeded')
  } finally {
    service.destroy()
  }
})

test('handleCommandAck ignores acks from other systems and non-ACCEPTED results', async () => {
  let resolveStart
  const harness = createHostHarness({
    sendCommand: () =>
      new Promise((resolve) => {
        resolveStart = resolve
      })
  })
  const service = new GuidedActionService(harness.host)
  try {
    const run = service.runCalibrationAction('calibrate-compass')
    const ack = (overrides, systemId = VEHICLE.systemId, componentId = VEHICLE.componentId) =>
      service.handleCommandAck(
        { type: 'COMMAND_ACK', command: MAV_CMD.DO_START_MAG_CAL, result: 0, progress: 0, resultParam2: 0, targetSystem: 255, targetComponent: 190, ...overrides },
        systemId,
        componentId
      )
    ack({}, 2, 191)
    assert.equal(service.getAction('calibrate-compass').status, 'requested', 'foreign ack')
    ack({ result: 5 })
    assert.equal(service.getAction('calibrate-compass').status, 'requested', 'IN_PROGRESS is not a start')
    ack({ command: MAV_CMD.PREFLIGHT_CALIBRATION })
    assert.equal(service.getAction('calibrate-compass').status, 'requested', 'another command')
    resolveStart()
    await run
  } finally {
    service.destroy()
  }
})

test('the PREFLIGHT_CALIBRATION ack opens the accelerometer gate in wire order (prompt in the same chunk is taken)', async () => {
  let resolveStart
  const harness = createHostHarness({
    accelerometerInitialWarmupMs: 10000,
    accelerometerStepAdvanceMs: 10000,
    sendCommand: () =>
      new Promise((resolve) => {
        resolveStart = resolve
      })
  })
  const service = new GuidedActionService(harness.host)
  try {
    const run = service.runCalibrationAction('calibrate-accelerometer')
    // A sentinel from the previous run, still streaming before our ack.
    service.handleCommandLong(accelPoseCommand(16777215), VEHICLE.systemId, VEHICLE.componentId)
    assert.equal(service.getAction('calibrate-accelerometer').status, 'requested')

    service.handleCommandAck(
      { type: 'COMMAND_ACK', command: MAV_CMD.PREFLIGHT_CALIBRATION, result: 0, progress: 0, resultParam2: 0, targetSystem: 255, targetComponent: 190 },
      VEHICLE.systemId,
      VEHICLE.componentId
    )
    assert.equal(service.getAction('calibrate-accelerometer').status, 'running')
    // The first pose prompt right behind the ack (same transport chunk).
    service.handleCommandLong(accelPoseCommand(1), VEHICLE.systemId, VEHICLE.componentId)
    assert.equal(service.getAction('calibrate-accelerometer').ctaLabel, 'Confirm Level Position')

    resolveStart()
    await run
    // The awaiting runner must not reset the step the prompt already set.
    assert.equal(service.getAction('calibrate-accelerometer').ctaLabel, 'Confirm Level Position')
  } finally {
    service.destroy()
  }
})

// ---------------------------------------------------------------------------
// Accelerometer start ack: budget + late-start resume
// ---------------------------------------------------------------------------

const ACK_TIMEOUT_ERROR = 'Timed out waiting for PREFLIGHT_CALIBRATION acknowledgment after 15000ms. No COMMAND_ACKs received during the wait.'

test('the accelerometer start ack budget covers the blocking gyro calibration (15 s, like level)', async () => {
  // GCS_Common.cpp runs calibrate_gyros() BEFORE acking PREFLIGHT_CALIBRATION
  // param5=1 — 1-30 s depending on how still the vehicle is. A 3 s budget
  // timed out healthy starts.
  const harness = createHostHarness({ accelerometerInitialWarmupMs: 10000 })
  const service = new GuidedActionService(harness.host)
  try {
    await service.runCalibrationAction('calibrate-accelerometer')
    const start = harness.sentCommands.find((c) => c.command === MAV_CMD.PREFLIGHT_CALIBRATION)
    assert.equal(start.options.ackTimeoutMs, 15000)
  } finally {
    service.destroy()
  }
})

test('a pose prompt shortly after a timed-out start resumes the accelerometer calibration', async () => {
  const harness = createHostHarness({
    accelerometerInitialWarmupMs: 10000,
    accelerometerStepAdvanceMs: 10000,
    sendCommand: async (command) => {
      if (command === MAV_CMD.PREFLIGHT_CALIBRATION) throw new Error(ACK_TIMEOUT_ERROR)
    }
  })
  const service = new GuidedActionService(harness.host)
  try {
    await service.runCalibrationAction('calibrate-accelerometer').catch(() => {})
    assert.equal(service.getAction('calibrate-accelerometer').status, 'failed')

    // The autopilot was merely slow: it now asks for the level pose.
    service.handleCommandLong(accelPoseCommand(1), VEHICLE.systemId, VEHICLE.componentId)
    const resumed = service.getAction('calibrate-accelerometer')
    assert.equal(resumed.status, 'running')
    assert.equal(resumed.ctaLabel, 'Confirm Level Position')
    assert.ok(harness.statusEntries.some((e) => /resuming/i.test(e.text)))
    assert.equal(service.hasActiveAction(), true)
  } finally {
    service.destroy()
  }
})

test('a late ACCEPTED ack after a timed-out start also resumes the accelerometer calibration', async () => {
  const harness = createHostHarness({
    accelerometerInitialWarmupMs: 10000,
    sendCommand: async (command) => {
      if (command === MAV_CMD.PREFLIGHT_CALIBRATION) throw new Error(ACK_TIMEOUT_ERROR)
    }
  })
  const service = new GuidedActionService(harness.host)
  try {
    await service.runCalibrationAction('calibrate-accelerometer').catch(() => {})
    service.handleCommandAck(
      { type: 'COMMAND_ACK', command: MAV_CMD.PREFLIGHT_CALIBRATION, result: 0, progress: 0, resultParam2: 0, targetSystem: 255, targetComponent: 190 },
      VEHICLE.systemId,
      VEHICLE.componentId
    )
    assert.equal(service.getAction('calibrate-accelerometer').status, 'running')
  } finally {
    service.destroy()
  }
})

test('the late-start resume does not apply to a rejected start, a stale sentinel, or after the window', async () => {
  // Rejected (not timed out): the vehicle said no, nothing to resume.
  const rejected = createHostHarness({
    sendCommand: async () => {
      throw new Error('Autopilot rejected PREFLIGHT_CALIBRATION (FAILED).')
    }
  })
  const rejectedService = new GuidedActionService(rejected.host)
  await rejectedService.runCalibrationAction('calibrate-accelerometer').catch(() => {})
  rejectedService.handleCommandLong(accelPoseCommand(1), VEHICLE.systemId, VEHICLE.componentId)
  assert.equal(rejectedService.getAction('calibrate-accelerometer').status, 'failed', 'rejection is final')
  rejectedService.destroy()

  // Timed out, but only a sentinel (previous run's aftermath) arrives.
  const sentinel = createHostHarness({
    sendCommand: async () => {
      throw new Error(ACK_TIMEOUT_ERROR)
    }
  })
  const sentinelService = new GuidedActionService(sentinel.host)
  await sentinelService.runCalibrationAction('calibrate-accelerometer').catch(() => {})
  sentinelService.handleCommandLong(accelPoseCommand(16777215), VEHICLE.systemId, VEHICLE.componentId)
  assert.equal(sentinelService.getAction('calibrate-accelerometer').status, 'failed', 'a sentinel is not a live cal')
  sentinelService.destroy()

  // Timed out, prompt arrives after the window.
  const late = createHostHarness({
    accelerometerLateStartResumeWindowMs: 20,
    sendCommand: async () => {
      throw new Error(ACK_TIMEOUT_ERROR)
    }
  })
  const lateService = new GuidedActionService(late.host)
  await lateService.runCalibrationAction('calibrate-accelerometer').catch(() => {})
  await new Promise((resolve) => setTimeout(resolve, 40))
  lateService.handleCommandLong(accelPoseCommand(1), VEHICLE.systemId, VEHICLE.componentId)
  assert.equal(lateService.getAction('calibrate-accelerometer').status, 'failed', 'window closed')
  lateService.destroy()
})

// ---------------------------------------------------------------------------
// The posture step follows the autopilot's prompts, not a timer
// ---------------------------------------------------------------------------

test('the posture step does not advance on the timer — it waits for the autopilot\'s next prompt', async () => {
  // Pre-fix a 1.5 s timer moved the guide to the next pose on its own, so a
  // re-asked pose (rejected sample) or a slow autopilot left the guide a
  // posture ahead of the vehicle.
  const harness = createHostHarness({ accelerometerInitialWarmupMs: 10000, accelerometerStepAdvanceMs: 20 })
  const service = new GuidedActionService(harness.host)
  try {
    await service.runCalibrationAction('calibrate-accelerometer')
    service.handleCommandLong(accelPoseCommand(1), VEHICLE.systemId, VEHICLE.componentId)
    await service.runCalibrationAction('calibrate-accelerometer') // confirm level
    await new Promise((resolve) => setTimeout(resolve, 60))

    const waiting = service.getAction('calibrate-accelerometer')
    assert.equal(waiting.status, 'running')
    assert.equal(waiting.ctaLabel, undefined, 'no next posture is offered until the autopilot asks for one')
    assert.match(waiting.summary, /waiting for the autopilot's next posture prompt/i)

    // The autopilot rejected the sample and asks for level AGAIN.
    service.handleCommandLong(accelPoseCommand(1), VEHICLE.systemId, VEHICLE.componentId)
    assert.equal(service.getAction('calibrate-accelerometer').ctaLabel, 'Confirm Level Position')
    // …and then moves on.
    service.handleCommandLong(accelPoseCommand(2), VEHICLE.systemId, VEHICLE.componentId)
    assert.equal(service.getAction('calibrate-accelerometer').ctaLabel, 'Confirm Left Side Position')
  } finally {
    service.destroy()
  }
})

test('auto-confirm never acks a posture the autopilot has not prompted', async () => {
  // AP_AccelCal consumes a GCS ack only while _waiting_for_mavlink_ack, set
  // when it prints a NEW pose. An ack sent for a pose it has not asked for
  // is dropped — or, if it is still on the previous pose, taken for that one.
  const harness = createHostHarness({
    accelerometerInitialWarmupMs: 10000,
    accelerometerStepAdvanceMs: 20,
    accelerometerAutoHoldMs: 20
  })
  const service = new GuidedActionService(harness.host)
  try {
    await service.runCalibrationAction('calibrate-accelerometer')
    service.handleCommandLong(accelPoseCommand(1), VEHICLE.systemId, VEHICLE.componentId)
    await service.runCalibrationAction('calibrate-accelerometer') // confirm level
    const acksAfterLevel = harness.sent.filter((m) => m.type === 'COMMAND_ACK').length
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Frame already on its left side, held still — but the autopilot has not
    // asked for "left" yet.
    service.handleAttitudeSample(-90, 0)
    await new Promise((resolve) => setTimeout(resolve, 40))
    service.handleAttitudeSample(-90, 0)
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(harness.sent.filter((m) => m.type === 'COMMAND_ACK').length, acksAfterLevel, 'no ack for an unprompted posture')

    // Now the autopilot asks for left: the same held frame auto-confirms.
    service.handleCommandLong(accelPoseCommand(2), VEHICLE.systemId, VEHICLE.componentId)
    service.handleAttitudeSample(-90, 0)
    await new Promise((resolve) => setTimeout(resolve, 40))
    service.handleAttitudeSample(-90, 0)
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.equal(harness.sent.filter((m) => m.type === 'COMMAND_ACK').length, acksAfterLevel + 1)
  } finally {
    service.destroy()
  }
})

test('after the sixth posture the action waits for the autopilot\'s verdict instead of declaring success on a timer', async () => {
  // The vehicle repeats its real verdict (STATUSTEXT, then the 1 Hz
  // sentinel) indefinitely, so a 4 s "assume it worked" was never needed and
  // could report a success the vehicle never had.
  const harness = createHostHarness({
    accelerometerInitialWarmupMs: 10000,
    accelerometerStepAdvanceMs: 20,
    accelerometerCompletionFallbackMs: 20
  })
  const service = new GuidedActionService(harness.host)
  try {
    await service.runCalibrationAction('calibrate-accelerometer')
    service.handleCommandLong(accelPoseCommand(6), VEHICLE.systemId, VEHICLE.componentId)
    await service.runCalibrationAction('calibrate-accelerometer') // confirm back
    await new Promise((resolve) => setTimeout(resolve, 80))

    const action = service.getAction('calibrate-accelerometer')
    assert.equal(action.status, 'running', 'no verdict yet → still running')
    assert.match(action.summary, /waiting for the autopilot's verdict/i)
    assert.ok(!harness.statusEntries.some((e) => e.text === 'Accelerometer calibration complete.'))

    // The real verdict completes it.
    service.handleCommandLong(accelPoseCommand(16777215), VEHICLE.systemId, VEHICLE.componentId)
    assert.equal(service.getAction('calibrate-accelerometer').status, 'succeeded')
  } finally {
    service.destroy()
  }
})

// ---------------------------------------------------------------------------
// Accelerometer no-prompt watchdog + vehicle restart
// ---------------------------------------------------------------------------

test('accel prompt watchdog fails a running calibration whose autopilot has gone silent', async () => {
  // AP_AccelCal re-sends the current posture every second. An FC that
  // rebooted on a link that survived (WS bridge, SITL, Ethernet) sends
  // nothing, and pre-fix the action stayed 'running' — blocking every
  // parameter write — until the operator found Cancel.
  const harness = createHostHarness({
    accelerometerInitialWarmupMs: 10000,
    accelerometerStepAdvanceMs: 10000,
    accelerometerPromptWatchdogMs: 40
  })
  const service = new GuidedActionService(harness.host)
  try {
    await service.runCalibrationAction('calibrate-accelerometer')
    service.handleCommandLong(accelPoseCommand(2), VEHICLE.systemId, VEHICLE.componentId)
    assert.equal(service.hasActiveAction(), true)

    await new Promise((resolve) => setTimeout(resolve, 100))
    const action = service.getAction('calibrate-accelerometer')
    assert.equal(action.status, 'failed')
    assert.match(action.summary, /no accelerometer calibration prompt arrived/i)
    assert.equal(service.hasActiveAction(), false, 'write gate must clear')
    assert.ok(harness.statusEntries.some((e) => e.severity === 'warning' && /prompt arrived/i.test(e.text)))
  } finally {
    service.destroy()
  }
})

test('accel prompt watchdog is fed by the autopilot\'s 1 Hz prompt re-sends and never fires on a live calibration', async () => {
  const harness = createHostHarness({
    accelerometerInitialWarmupMs: 10000,
    accelerometerStepAdvanceMs: 10000,
    accelerometerPromptWatchdogMs: 60
  })
  const service = new GuidedActionService(harness.host)
  try {
    await service.runCalibrationAction('calibrate-accelerometer')
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 30))
      service.handleCommandLong(accelPoseCommand(2), VEHICLE.systemId, VEHICLE.componentId)
    }
    assert.equal(service.getAction('calibrate-accelerometer').status, 'running')
    assert.equal(service.getAction('calibrate-accelerometer').ctaLabel, 'Confirm Left Side Position')
  } finally {
    service.destroy()
  }
})

test('handleVehicleRestart fails active calibrations and completes a pending reboot request', async () => {
  const harness = createHostHarness({ accelerometerInitialWarmupMs: 10000, compassGuidanceTimeoutMs: 10000 })
  const service = new GuidedActionService(harness.host)
  try {
    await service.runCalibrationAction('calibrate-compass')
    service.handleMagCalProgress(magCalProgress({ completionPct: 30 }))
    service.setAction('reboot-autopilot', {
      actionId: 'reboot-autopilot',
      status: 'running',
      summary: 'Reboot request sent.',
      instructions: [],
      statusTexts: [],
      startedAtMs: Date.now(),
      updatedAtMs: Date.now(),
      completedAtMs: undefined
    })
    assert.equal(service.hasActiveAction(), true)

    service.handleVehicleRestart()

    assert.equal(service.getAction('calibrate-compass').status, 'failed')
    assert.match(service.getAction('calibrate-compass').summary, /restarted mid-calibration/i)
    assert.equal(service.getAction('reboot-autopilot').status, 'succeeded')
    assert.equal(service.getAction('calibrate-accelerometer').status, 'idle', 'idle actions untouched')
    assert.equal(service.hasActiveAction(), false)
  } finally {
    service.destroy()
  }
})

// ---------------------------------------------------------------------------
// reboot-autopilot waits for its ack
// ---------------------------------------------------------------------------

test('reboot-autopilot succeeds on the ACCEPTED ack instead of waiting for a STATUSTEXT that never comes', async () => {
  // GCS_Common.cpp acks PREFLIGHT_REBOOT_SHUTDOWN before rebooting and sends
  // no "reboot requested" text. Pre-fix the action sat 'running' (blocking
  // parameter writes on link-persistent transports) until disconnect.
  const harness = createHostHarness({
    sendCommand: async (command, params, options) => {
      harness.sentCommands.push({ command, params, options })
      return { type: 'COMMAND_ACK', command, result: 0, progress: 0, resultParam2: 0, targetSystem: 255, targetComponent: 190 }
    }
  })
  const service = new GuidedActionService(harness.host)
  await service.runCalibrationAction('reboot-autopilot')

  const sent = harness.sentCommands.find((c) => c.command === MAV_CMD.PREFLIGHT_REBOOT_SHUTDOWN)
  assert.deepEqual(sent.params, [1, 0, 0, 0, 0, 0, 0])
  assert.equal(sent.options?.waitForAck, true)
  assert.equal(sent.options?.ackTimeoutMs, 3000)
  const action = service.getAction('reboot-autopilot')
  assert.equal(action.status, 'succeeded')
  assert.ok(action.completedAtMs)
  assert.equal(service.hasActiveAction(), false)
})

test('reboot-autopilot fails when the autopilot rejects or never acks the request', async () => {
  const rejected = createHostHarness({
    sendCommand: async () => {
      throw new Error('Autopilot rejected PREFLIGHT_REBOOT_SHUTDOWN (DENIED).')
    }
  })
  const rejectedService = new GuidedActionService(rejected.host)
  await rejectedService.runCalibrationAction('reboot-autopilot').catch(() => {})
  assert.equal(rejectedService.getAction('reboot-autopilot').status, 'failed')
  assert.equal(rejectedService.hasActiveAction(), false)

  const silent = createHostHarness({
    sendCommand: async () => {
      throw new Error('Timed out waiting for PREFLIGHT_REBOOT_SHUTDOWN acknowledgment after 3000ms.')
    }
  })
  const silentService = new GuidedActionService(silent.host)
  await silentService.runCalibrationAction('reboot-autopilot').catch(() => {})
  assert.equal(silentService.getAction('reboot-autopilot').status, 'failed')
  assert.match(silentService.getAction('reboot-autopilot').summary, /timed out/i)
})

test('the autopilot re-sending the same pose prompt every second does not restart the auto-confirm hold', async () => {
  // AP_AccelCal re-sends ACCELCAL_VEHICLE_POS for the posture it is waiting
  // on every ~1 s. handleCommandLong treated each re-send as a step change
  // and cleared the hold, so a 1.2 s hold could never complete on a frame
  // that was perfectly still and aligned — observed on true SITL (120
  // ATTITUDE samples inside the window, zero auto-confirms) and reported
  // from real hardware.
  const harness = createHostHarness({
    accelerometerAutoHoldMs: 60,
    accelerometerStepAdvanceMs: 10000,
    accelerometerInitialWarmupMs: 10000
  })
  const service = new GuidedActionService(harness.host)
  try {
    await service.runCalibrationAction('calibrate-accelerometer')
    service.handleCommandLong(accelPoseCommand(2), VEHICLE.systemId, VEHICLE.componentId) // left
    const acks = () => harness.sent.filter((m) => m.type === 'COMMAND_ACK').length
    const before = acks()

    service.handleAttitudeSample(-90, 0)
    await new Promise((resolve) => setTimeout(resolve, 25))
    service.handleCommandLong(accelPoseCommand(2), VEHICLE.systemId, VEHICLE.componentId) // re-send
    service.handleAttitudeSample(-90, 0)
    await new Promise((resolve) => setTimeout(resolve, 25))
    service.handleCommandLong(accelPoseCommand(2), VEHICLE.systemId, VEHICLE.componentId) // re-send
    service.handleAttitudeSample(-90, 0)
    await new Promise((resolve) => setTimeout(resolve, 25))
    service.handleAttitudeSample(-90, 0)
    await new Promise((resolve) => setTimeout(resolve, 5))

    assert.equal(acks(), before + 1, 'a still, aligned frame auto-confirms despite the re-sent prompts')
    assert.equal(service.getAction('calibrate-accelerometer').ctaLabel, undefined, 'posture confirmed')
  } finally {
    service.destroy()
  }
})

// ---------------------------------------------------------------------------
// Cancel waits for DO_CANCEL_MAG_CAL to be acknowledged
// ---------------------------------------------------------------------------

test('cancelling a compass calibration awaits the DO_CANCEL_MAG_CAL ack and reads "Cancelling" meanwhile', async () => {
  let resolveCancel
  const harness = createHostHarness({
    sendCommand: (command, params, options) => {
      harness.sentCommands.push({ command, params, options })
      if (command === MAV_CMD.DO_CANCEL_MAG_CAL) {
        return new Promise((resolve) => {
          resolveCancel = resolve
        })
      }
      return Promise.resolve()
    }
  })
  const service = new GuidedActionService(harness.host)
  try {
    await service.runCalibrationAction('calibrate-compass')
    service.handleMagCalProgress(magCalProgress({ completionPct: 40 }))

    const cancelling = service.cancelAction('calibrate-compass')
    const mid = service.getAction('calibrate-compass')
    assert.equal(mid.status, 'running', 'still active until the autopilot confirms')
    assert.match(mid.summary, /cancelling compass calibration/i)
    assert.equal(mid.progressPct, undefined)
    const cancel = harness.sentCommands.find((c) => c.command === MAV_CMD.DO_CANCEL_MAG_CAL)
    assert.equal(cancel.options?.waitForAck, true)
    assert.equal(cancel.options?.ackTimeoutMs, 3000)

    // A second click while the first is in flight does not re-send.
    void service.cancelAction('calibrate-compass')
    assert.equal(harness.sentCommands.filter((c) => c.command === MAV_CMD.DO_CANCEL_MAG_CAL).length, 1)

    resolveCancel({ type: 'COMMAND_ACK', command: MAV_CMD.DO_CANCEL_MAG_CAL, result: 0, progress: 0, resultParam2: 0, targetSystem: 255, targetComponent: 190 })
    await cancelling
    assert.equal(service.getAction('calibrate-compass').status, 'idle')
    assert.equal(service.hasActiveAction(), false)
  } finally {
    service.destroy()
  }
})

test('a compass cancel the autopilot does not acknowledge is reported as a failed cancel, not a clean stop', async () => {
  const harness = createHostHarness({
    sendCommand: async (command, params, options) => {
      harness.sentCommands.push({ command, params, options })
      if (command === MAV_CMD.DO_CANCEL_MAG_CAL) {
        throw new Error('Timed out waiting for DO_CANCEL_MAG_CAL acknowledgment after 3000ms.')
      }
    }
  })
  const service = new GuidedActionService(harness.host)
  try {
    await service.runCalibrationAction('calibrate-compass')
    await service.cancelAction('calibrate-compass')

    const action = service.getAction('calibrate-compass')
    assert.equal(action.status, 'failed')
    assert.match(action.summary, /did not confirm the compass calibration cancel/i)
    assert.match(action.summary, /autosave/i)
    assert.match(action.summary, /only stops on a reboot/i)
    assert.equal(service.hasActiveAction(), false, 'the write gate still clears — the configurator-side wait is over')
    assert.ok(harness.statusEntries.some((e) => e.severity === 'warning' && /did not confirm/i.test(e.text)))
  } finally {
    service.destroy()
  }
})

// ---------------------------------------------------------------------------
// MAG_CAL_PROGRESS attempt > 1 (retry=1 means a bad fit never reports)
// ---------------------------------------------------------------------------

test('a compass retrying its fit (attempt > 1) is named in the summary while the action stays cancellable', async () => {
  // With retry=1 in DO_START_MAG_CAL a FAILED/BAD_* fit restarts the
  // calibrator with attempt++ and never reaches MAG_CAL_REPORT, so a compass
  // that cannot fit spins forever at "N% — keep rotating" with no hint why.
  const { host } = createHostHarness()
  const service = new GuidedActionService(host)
  try {
    await service.runCalibrationAction('calibrate-compass')
    service.handleMagCalProgress(magCalProgress({ compassId: 0, calMask: 0b11, completionPct: 80, attempt: 1 }))
    assert.doesNotMatch(service.getAction('calibrate-compass').summary, /retry/i)

    service.handleMagCalProgress(magCalProgress({ compassId: 1, calMask: 0b11, completionPct: 12, attempt: 3 }))
    const action = service.getAction('calibrate-compass')
    assert.equal(action.status, 'running', 'Cancel must stay available')
    assert.match(action.summary, /compass 2 failed its fit — retrying, attempt 3/i)
    assert.match(action.summary, /interference|orientation/i)

    // The hint persists across the healthy compass's next progress frame.
    service.handleMagCalProgress(magCalProgress({ compassId: 0, calMask: 0b11, completionPct: 85, attempt: 1 }))
    assert.match(service.getAction('calibrate-compass').summary, /compass 2 failed its fit/i)

    // A new run starts clean.
    service.handleMagCalReport(magCalReport({ compassId: 0, calMask: 0b11, calStatus: 4, autosaved: 1 }))
    service.handleMagCalReport(magCalReport({ compassId: 1, calMask: 0b11, calStatus: 4, autosaved: 1 }))
    assert.equal(service.getAction('calibrate-compass').status, 'succeeded')
    await service.runCalibrationAction('calibrate-compass')
    service.handleMagCalProgress(magCalProgress({ completionPct: 5, attempt: 1 }))
    assert.doesNotMatch(service.getAction('calibrate-compass').summary, /retry/i)
  } finally {
    service.destroy()
  }
})

// ---------------------------------------------------------------------------
// Level ack payload + post-calibration parameter re-reads
// ---------------------------------------------------------------------------

test('level calibration does not report success on an IN_PROGRESS ack whose final result never came', async () => {
  // The waiter resolves with the remembered IN_PROGRESS beat when no final
  // ack arrives. calibrate_trim() answers synchronously, so that is not a
  // stored trim; pre-fix the action ignored the payload and said "complete".
  const harness = createHostHarness({
    sendCommand: async (command) => ({ type: 'COMMAND_ACK', command, result: 5, progress: 50, resultParam2: 0, targetSystem: 255, targetComponent: 190 })
  })
  const service = new GuidedActionService(harness.host)
  await service.runCalibrationAction('calibrate-level').catch(() => {})
  const action = service.getAction('calibrate-level')
  assert.equal(action.status, 'failed')
  assert.match(action.summary, /never confirmed it finished/i)
})

function matchingIds(patterns, ids) {
  return ids.filter((id) => patterns.some((pattern) => pattern.test(id)))
}

const CAL_PARAM_IDS = [
  'AHRS_TRIM_X', 'AHRS_TRIM_Y', 'AHRS_TRIM_Z', 'AHRS_ORIENTATION',
  'INS_ACCOFFS_X', 'INS_ACC2OFFS_Z', 'INS_ACC3SCAL_Y', 'INS_ACC_ID', 'INS_ACC2_ID', 'INS_ACCEL_FILTER', 'INS_GYROFFS_X',
  'COMPASS_OFS_X', 'COMPASS_OFS2_Y', 'COMPASS_DIA3_Z', 'COMPASS_ODI_X', 'COMPASS_SCALE', 'COMPASS_SCALE2', 'COMPASS_ORIENT2', 'COMPASS_USE', 'COMPASS_DEV_ID'
]

test('a successful level calibration re-reads AHRS_TRIM_X/Y and nothing else', async () => {
  const refreshed = []
  const harness = createHostHarness({
    sendCommand: async (command) => ({ type: 'COMMAND_ACK', command, result: 0, progress: 0, resultParam2: 0, targetSystem: 255, targetComponent: 190 }),
    refreshParameters: async (patterns) => {
      refreshed.push(...matchingIds(patterns, CAL_PARAM_IDS))
    }
  })
  const service = new GuidedActionService(harness.host)
  await service.runCalibrationAction('calibrate-level')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(service.getAction('calibrate-level').status, 'succeeded')
  assert.deepEqual(refreshed.sort(), ['AHRS_TRIM_X', 'AHRS_TRIM_Y'])
})

test('a successful accelerometer calibration re-reads the INS_ACC offsets/scales/ids and the trim', async () => {
  const refreshed = []
  const harness = createHostHarness({
    accelerometerInitialWarmupMs: 10000,
    refreshParameters: async (patterns) => {
      refreshed.push(...matchingIds(patterns, CAL_PARAM_IDS))
    }
  })
  const service = new GuidedActionService(harness.host)
  try {
    await service.runCalibrationAction('calibrate-accelerometer')
    service.handleCommandLong(accelPoseCommand(16777215), VEHICLE.systemId, VEHICLE.componentId)
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(
      refreshed.sort(),
      ['AHRS_TRIM_X', 'AHRS_TRIM_Y', 'INS_ACC2OFFS_Z', 'INS_ACC2_ID', 'INS_ACC3SCAL_Y', 'INS_ACCOFFS_X', 'INS_ACC_ID']
    )
    assert.ok(!refreshed.includes('INS_ACCEL_FILTER') && !refreshed.includes('INS_GYROFFS_X'))
  } finally {
    service.destroy()
  }
})

test('a successful compass calibration re-reads COMPASS_OFS/DIA/ODI/SCALE/ORIENT', async () => {
  const refreshed = []
  const harness = createHostHarness({
    refreshParameters: async (patterns) => {
      refreshed.push(...matchingIds(patterns, CAL_PARAM_IDS))
    }
  })
  const service = new GuidedActionService(harness.host)
  await service.runCalibrationAction('calibrate-compass')
  service.handleMagCalReport(magCalReport({ calStatus: 4, autosaved: 1 }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(service.getAction('calibrate-compass').status, 'succeeded')
  assert.deepEqual(
    refreshed.sort(),
    ['COMPASS_DIA3_Z', 'COMPASS_ODI_X', 'COMPASS_OFS2_Y', 'COMPASS_OFS_X', 'COMPASS_ORIENT2', 'COMPASS_SCALE', 'COMPASS_SCALE2']
  )
  assert.ok(!refreshed.includes('COMPASS_USE') && !refreshed.includes('COMPASS_DEV_ID'))
})

// ---------------------------------------------------------------------------
// STATUSTEXT matching stays about the calibration (true-SITL findings)
// ---------------------------------------------------------------------------

test('unrelated "complete" status texts do not finish a running compass or accelerometer calibration', async () => {
  const { host } = createHostHarness({ accelerometerInitialWarmupMs: 10000 })
  const service = new GuidedActionService(host)
  try {
    await service.runCalibrationAction('calibrate-compass')
    for (const text of [
      'EKF3 IMU0 tilt alignment complete',
      'EKF3 IMU1 MAG0 initial yaw alignment complete',
      'Barometer 1 calibration complete',
      'Successful'
    ]) {
      service.processStatusText(text)
      assert.equal(service.getAction('calibrate-compass').status, 'running', `"${text}" must not complete the compass cal`)
    }
    // The verdict is the report.
    service.handleMagCalReport(magCalReport({ calStatus: 4, autosaved: 1 }))
    assert.equal(service.getAction('calibrate-compass').status, 'succeeded')

    // A finished compass cal is not re-opened by the pre-arm text that
    // mentions it.
    service.processStatusText('PreArm: Compass calibration running')
    assert.equal(service.getAction('calibrate-compass').status, 'succeeded')
  } finally {
    service.destroy()
  }

  const accelHarness = createHostHarness({ accelerometerInitialWarmupMs: 10000 })
  const accelService = new GuidedActionService(accelHarness.host)
  try {
    await accelService.runCalibrationAction('calibrate-accelerometer')
    accelService.processStatusText('EKF3 IMU0 tilt alignment complete')
    accelService.processStatusText('Successful')
    assert.equal(accelService.getAction('calibrate-accelerometer').status, 'running')
    // AP_AccelCal's own verdict still counts.
    accelService.processStatusText('Calibration successful')
    assert.equal(accelService.getAction('calibrate-accelerometer').status, 'succeeded')
  } finally {
    accelService.destroy()
  }
})
