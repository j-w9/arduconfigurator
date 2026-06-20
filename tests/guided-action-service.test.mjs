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
  assert.equal(action.summary, 'No enabled compass detected on this vehicle. Skip this step or enable a compass first.')
  assert.ok(
    harness.statusEntries.some((entry) => entry.text.includes('No enabled compass detected'))
  )
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
  assert.equal(action.summary, 'No enabled compass detected on this vehicle. Skip this step or enable a compass first.')
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

test('reset() while disconnected does not pretend to cancel — it is honest the cal self-times-out', async () => {
  // The cancel cannot reach the vehicle once the link is down; the old
  // code fired it into a .catch(()=>{}) so it looked handled. It must
  // not send, and must say plainly the onboard cal will self-time-out.
  const { host, sentCommands, statusEntries } = createHostHarness({ isConnected: () => false })
  const service = new GuidedActionService(host)
  await service.runCalibrationAction('calibrate-compass')

  service.reset()
  assert.ok(
    !sentCommands.some((c) => c.command === MAV_CMD.DO_CANCEL_MAG_CAL),
    'no cancel is sent when disconnected'
  )
  assert.ok(
    statusEntries.some((entry) => entry.severity === 'warning' && /self-time-out/i.test(entry.text)),
    'an honest self-time-out warning is surfaced'
  )
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

    service.cancelAction('calibrate-compass')

    const action = service.getAction('calibrate-compass')
    assert.equal(action.status, 'failed')
    assert.match(action.summary, /cancelled by operator/i)
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

    const action = service.getAction('calibrate-accelerometer')
    assert.equal(action.status, 'failed')
    assert.match(action.summary, /cancelled by operator/i)
    assert.equal(service.hasActiveAction(), false)
    // MAVLink has no accel-cal abort; nothing extra goes on the wire, but
    // the operator is told the onboard routine may keep waiting.
    assert.equal(harness.sentCommands.length, commandCountBeforeCancel)
    assert.ok(harness.statusEntries.some((entry) => /onboard routine may keep waiting/i.test(entry.text)))
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
