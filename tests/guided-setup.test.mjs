import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ArduPilotConfiguratorRuntime,
  createModeSwitchExerciseState,
  canCompleteModeSwitchExercise,
  completeModeSwitchExerciseState,
  deriveCompassSetupAvailability,
  deriveEscSetupSummary,
  deriveModeExerciseAssignments,
  deriveRcMapDraftValues,
  detectDominantRcChannelChange
} from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'

test('pre-arm issues are surfaced in the shared runtime snapshot', async () => {
  const runtime = new ArduPilotConfiguratorRuntime(createStatusTextSession('PreArm: RC not calibrated'), arducopterMetadata)

  try {
    await runtime.connect()
    const snapshot = runtime.getSnapshot()

    assert.equal(snapshot.preArmStatus.healthy, false)
    assert.equal(snapshot.preArmStatus.issues.length, 1)
    assert.equal(snapshot.preArmStatus.issues[0].text, 'PreArm: RC not calibrated')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('switch exercise can be manually completed whenever running (no visited-count gate)', () => {
  const base = {
    status: 'running',
    targetSlots: [1, 3, 6],
    visitedSlots: [],
    unexpectedSlots: [],
    currentTargetSlot: 1
  }
  // While running, Mark Complete is always available — the operator
  // confirms travel; the visit counter ignores slots outside the
  // configured FLTMODE_n set, which made the old "visited >= 2" gate
  // stay disabled in real-world 2/3-position switch flows.
  assert.equal(canCompleteModeSwitchExercise(base), true)
  assert.equal(completeModeSwitchExerciseState(base).status, 'passed')
  // One position is fine.
  const oneVisited = { ...base, visitedSlots: [1] }
  assert.equal(canCompleteModeSwitchExercise(oneVisited), true)
  assert.equal(completeModeSwitchExerciseState(oneVisited).status, 'passed')
  // Two distinct positions also fine (typical 2/3-position switch case).
  const twoVisited = { ...base, visitedSlots: [1, 3] }
  assert.equal(canCompleteModeSwitchExercise(twoVisited), true)
  assert.equal(completeModeSwitchExerciseState(twoVisited).status, 'passed')
  // Not running -> cannot complete (and complete() is a no-op).
  assert.equal(canCompleteModeSwitchExercise({ ...twoVisited, status: 'idle' }), false)
  assert.equal(completeModeSwitchExerciseState({ ...twoVisited, status: 'idle' }).status, 'idle')
})

test('detectDominantRcChannelChange finds the strongest unexcluded RC channel', () => {
  const baseline = [1500, 1500, 1000, 1500, 1500]
  const channels = [1500, 1680, 1000, 1500, 1840]

  const strongest = detectDominantRcChannelChange(channels, baseline)
  assert.equal(strongest?.channelNumber, 5)

  const nextStrongest = detectDominantRcChannelChange(channels, baseline, {
    excludedChannelNumbers: [5]
  })
  assert.equal(nextStrongest?.channelNumber, 2)
})

test('detectDominantRcChannelChange rejects throttle-like movement during roll capture', () => {
  const baseline = [1500, 1500, 1000, 1500]
  const channels = [1500, 1500, 1710, 1500]

  const rollCandidate = detectDominantRcChannelChange(channels, baseline, {
    targetAxis: 'roll'
  })
  assert.equal(rollCandidate, undefined)

  const throttleCandidate = detectDominantRcChannelChange(channels, baseline, {
    targetAxis: 'throttle'
  })
  assert.equal(throttleCandidate?.channelNumber, 3)
})

test('deriveRcMapDraftValues only stages changed RCMAP parameters', () => {
  const drafts = deriveRcMapDraftValues(
    {
      roll: 1,
      pitch: 4,
      throttle: 3,
      yaw: 2
    },
    {
      roll: 1,
      pitch: 2,
      throttle: 3,
      yaw: 4
    }
  )

  assert.deepEqual(drafts, {
    RCMAP_PITCH: '4',
    RCMAP_YAW: '2'
  })
})

test('deriveEscSetupSummary classifies analog protocols and flags invalid ranges', () => {
  const summary = deriveEscSetupSummary(
    createSnapshot({
      MOT_PWM_TYPE: 0,
      MOT_PWM_MIN: 2000,
      MOT_PWM_MAX: 1000,
      MOT_SPIN_ARM: 0.12,
      MOT_SPIN_MIN: 0.1,
      MOT_SPIN_MAX: 0.95
    })
  )

  assert.equal(summary.calibrationPath, 'analog-calibration')
  assert.ok(summary.notes.some((note) => note.includes('MOT_PWM_MIN must be lower than MOT_PWM_MAX')))
  assert.ok(summary.notes.some((note) => note.includes('MOT_SPIN_MIN should stay above MOT_SPIN_ARM')))
})

test('deriveEscSetupSummary classifies digital motor protocols', () => {
  const summary = deriveEscSetupSummary(
    createSnapshot({
      MOT_PWM_TYPE: 5,
      MOT_PWM_MIN: 1000,
      MOT_PWM_MAX: 2000,
      MOT_SPIN_ARM: 0.08,
      MOT_SPIN_MIN: 0.12,
      MOT_SPIN_MAX: 0.95
    })
  )

  assert.equal(summary.calibrationPath, 'digital-protocol')
  assert.ok(summary.notes.some((note) => note.includes('Digital motor protocols')))
})

test('deriveCompassSetupAvailability allows skipping compass calibration for builds without an enabled compass', () => {
  const noCompass = deriveCompassSetupAvailability(
    createSnapshot({
      GPS_TYPE: 9,
      GPS_TYPE2: 0,
      COMPASS_USE: 0,
      COMPASS_USE2: 0,
      COMPASS_USE3: 0
    })
  )

  assert.equal(noCompass.gpsConfigured, true)
  assert.equal(noCompass.enabledCompassCount, 0)
  assert.equal(noCompass.canSkipCalibration, true)

  const noGpsAndNoCompass = deriveCompassSetupAvailability(
    createSnapshot({
      GPS_TYPE: 0,
      GPS_TYPE2: 0,
      COMPASS_USE: 0,
      COMPASS_USE2: 0,
      COMPASS_USE3: 0
    })
  )

  assert.equal(noGpsAndNoCompass.gpsConfigured, false)
  assert.equal(noGpsAndNoCompass.enabledCompassCount, 0)
  assert.equal(noGpsAndNoCompass.canSkipCalibration, true)

  const withCompass = deriveCompassSetupAvailability(
    createSnapshot({
      GPS_TYPE: 9,
      GPS_TYPE2: 0,
      COMPASS_USE: 1,
      COMPASS_USE2: 0,
      COMPASS_USE3: 0
    })
  )

  assert.equal(withCompass.canSkipCalibration, false)
  assert.equal(withCompass.enabledCompassCount, 1)
})

test('deriveCompassSetupAvailability counts only COMPASS_USE slots backed by a detected device id', () => {
  // A bare H7 FPV board: COMPASS_USE defaults to 1 but no magnetometer is
  // wired, so COMPASS_DEV_ID is present-and-0. Counting COMPASS_USE alone
  // would claim a compass exists and refuse to skip calibration, then fire
  // DO_START_MAG_CAL at hardware that never reports MAG_CAL_PROGRESS.
  const bareBoard = deriveCompassSetupAvailability(
    createSnapshot({
      GPS_TYPE: 9,
      COMPASS_USE: 1,
      COMPASS_USE2: 0,
      COMPASS_USE3: 0,
      COMPASS_DEV_ID: 0,
      COMPASS_DEV_ID2: 0,
      COMPASS_DEV_ID3: 0
    })
  )
  assert.equal(bareBoard.enabledCompassCount, 0)
  assert.equal(bareBoard.canSkipCalibration, true)

  // A real ArduCopter quad (verified on hardware): all three COMPASS_USE* are
  // 1, but only instance 1 has a device — DEV_ID2/DEV_ID3 are 0. That is one
  // physical compass, not three.
  const singlePhysicalCompass = deriveCompassSetupAvailability(
    createSnapshot({
      GPS_TYPE: 9,
      COMPASS_USE: 1,
      COMPASS_USE2: 1,
      COMPASS_USE3: 1,
      COMPASS_DEV_ID: 97539,
      COMPASS_DEV_ID2: 0,
      COMPASS_DEV_ID3: 0
    })
  )
  assert.equal(singlePhysicalCompass.enabledCompassCount, 1)
  assert.equal(singlePhysicalCompass.canSkipCalibration, false)
})

test('deriveCompassSetupAvailability detects a compass whose priority and state-slot indices diverged', () => {
  // Reported live-FC case: the user disabled the secondary/tertiary compass
  // instances. COMPASS_USE* is priority-indexed while COMPASS_DEV_ID* is
  // state-slot indexed, so the one remaining enabled compass sits at priority
  // 0 (COMPASS_USE=1, COMPASS_PRIO1_ID=<id>) but its dev id persisted in a
  // different state slot — COMPASS_DEV_ID itself reads 0. Pairing USE↔DEV_ID by
  // index undercounted to zero, so the app claimed "no compass" and got stuck
  // refusing to calibrate a vehicle that plainly has one. The priority-list id
  // (COMPASS_PRIO1_ID) is the correct presence signal for priority 0.
  const divergedIndices = deriveCompassSetupAvailability(
    createSnapshot({
      GPS_TYPE: 9,
      COMPASS_USE: 1,
      COMPASS_USE2: 0,
      COMPASS_USE3: 0,
      COMPASS_PRIO1_ID: 97539,
      COMPASS_PRIO2_ID: 0,
      COMPASS_PRIO3_ID: 0,
      COMPASS_DEV_ID: 0,
      COMPASS_DEV_ID2: 0,
      COMPASS_DEV_ID3: 97539
    })
  )
  assert.equal(divergedIndices.enabledCompassCount, 1)
  assert.equal(divergedIndices.canSkipCalibration, false)

  // The no-hang guard still holds: a bare board reports the priority-list ids
  // as present-and-zero (no compass ever registered), so the count stays 0.
  const bareBoardWithPriorityList = deriveCompassSetupAvailability(
    createSnapshot({
      GPS_TYPE: 9,
      COMPASS_USE: 1,
      COMPASS_USE2: 0,
      COMPASS_USE3: 0,
      COMPASS_PRIO1_ID: 0,
      COMPASS_PRIO2_ID: 0,
      COMPASS_PRIO3_ID: 0,
      COMPASS_DEV_ID: 0,
      COMPASS_DEV_ID2: 0,
      COMPASS_DEV_ID3: 0
    })
  )
  assert.equal(bareBoardWithPriorityList.enabledCompassCount, 0)
  assert.equal(bareBoardWithPriorityList.canSkipCalibration, true)
})

test('mode-switch exercise targets distinct configured flight-mode positions, not every FLTMODEn slot', () => {
  const snapshot = createSnapshot({
    FLTMODE1: 0,
    FLTMODE2: 0,
    FLTMODE3: 0,
    FLTMODE4: 2,
    FLTMODE5: 0,
    FLTMODE6: 16,
    FLTMODE_CH: 7
  })

  snapshot.liveVerification.rcInput = {
    verified: true,
    channelCount: 8,
    channels: [1500, 1500, 1000, 1500, 1500, 1500, 1000, 1500]
  }

  const assignments = deriveModeExerciseAssignments(snapshot)
  assert.deepEqual(
    assignments.map((assignment) => assignment.slot),
    [1, 4, 6]
  )

  const state = createModeSwitchExerciseState(snapshot)
  assert.equal(state.status, 'running')
  assert.deepEqual(state.targetSlots, [1, 4, 6])
  assert.equal(state.currentTargetSlot, 1)
})

test('mode-switch exercise is vehicle-aware: a Rover reads the MODE* family, not FLTMODE*', () => {
  const snapshot = createSnapshot({
    MODE1: 0,
    MODE2: 0,
    MODE3: 0,
    MODE4: 2,
    MODE5: 0,
    MODE6: 16,
    MODE_CH: 7
  })
  snapshot.vehicle.vehicle = 'ArduRover'
  snapshot.liveVerification.rcInput = {
    verified: true,
    channelCount: 8,
    channels: [1500, 1500, 1000, 1500, 1500, 1500, 1000, 1500]
  }

  // The bug: without the vehicle arg it defaults to ArduCopter and reads
  // FLTMODE1..6 — absent on a Rover (it uses MODE1..6) — so the exercise
  // could never start on a correctly-configured Rover.
  const copterDefault = createModeSwitchExerciseState(snapshot)
  assert.equal(copterDefault.status, 'failed')

  // Vehicle-aware: reads MODE1..6 and runs with the real Rover slots.
  assert.deepEqual(
    deriveModeExerciseAssignments(snapshot, 'ArduRover').map((assignment) => assignment.slot),
    [1, 4, 6]
  )
  const rover = createModeSwitchExerciseState(snapshot, 'ArduRover')
  assert.equal(rover.status, 'running')
  assert.deepEqual(rover.targetSlots, [1, 4, 6])
  assert.equal(rover.currentTargetSlot, 1)
})

function createSnapshot(parameterValues) {
  return {
    connection: { kind: 'connected' },
    vehicle: {
      firmware: 'ArduPilot',
      vehicle: 'ArduCopter',
      systemId: 1,
      componentId: 1,
      armed: false,
      flightMode: 'Stabilize'
    },
    parameterStats: {
      downloaded: Object.keys(parameterValues).length,
      total: Object.keys(parameterValues).length,
      duplicateFrames: 0,
      status: 'complete',
      progress: 1
    },
    parameters: Object.entries(parameterValues).map(([id, value], index, entries) => ({
      id,
      value,
      index,
      count: entries.length,
      definition: arducopterMetadata.parameters[id]
    })),
    setupSections: [],
    guidedActions: {
      'request-parameters': {
        actionId: 'request-parameters',
        status: 'idle',
        summary: '',
        instructions: [],
        statusTexts: []
      },
      'calibrate-accelerometer': {
        actionId: 'calibrate-accelerometer',
        status: 'idle',
        summary: '',
        instructions: [],
        statusTexts: []
      },
      'calibrate-compass': {
        actionId: 'calibrate-compass',
        status: 'idle',
        summary: '',
        instructions: [],
        statusTexts: []
      },
      'reboot-autopilot': {
        actionId: 'reboot-autopilot',
        status: 'idle',
        summary: '',
        instructions: [],
        statusTexts: []
      }
    },
    motorTest: {
      status: 'idle',
      summary: '',
      instructions: []
    },
    liveVerification: {
      satisfiedSignals: [],
      rcInput: {
        verified: false,
        channelCount: 0,
        channels: []
      },
      batteryTelemetry: {
        verified: false
      },
      attitudeTelemetry: {
        verified: false
      }
    },
    preArmStatus: {
      healthy: true,
      issues: []
    },
    statusTexts: []
  }
}

function createStatusTextSession(statusText) {
  const statusListeners = []
  const messageListeners = []
  let connected = false

  const emit = (message) => {
    messageListeners.forEach((listener) =>
      listener({
        header: {
          systemId: 1,
          componentId: 1,
          sequence: 0
        },
        message,
        timestampMs: Date.now()
      })
    )
  }

  return {
    getTransportStatus() {
      return connected ? { kind: 'connected' } : { kind: 'disconnected' }
    },
    onStatus(listener) {
      statusListeners.push(listener)
      return () => {}
    },
    onMessage(listener) {
      messageListeners.push(listener)
      return () => {}
    },
    async connect() {
      connected = true
      statusListeners.forEach((listener) => listener({ kind: 'connected' }))
      emit({
        type: 'HEARTBEAT',
        autopilot: 3,
        vehicleType: 2,
        baseMode: 0,
        customMode: 0,
        systemStatus: 4,
        mavlinkVersion: 3
      })
      emit({
        type: 'STATUSTEXT',
        severity: 4,
        text: statusText
      })
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send() {}
  }
}

test('throttle capture accepts a Mode 2 throttle resting mid-travel at baseline', () => {
  // Regression (real-hardware field test, Mode 2 transmitter): throttle has
  // no centering spring, so the baseline snapshot routinely catches it
  // mid-travel (~1400-1500µs). The old "baseline ≤1200µs and moving up"
  // filter rejected the correctly-detected channel and the mapping step
  // could never capture throttle.
  const baseline = [1500, 1500, 1480, 1500]
  const channels = [1500, 1500, 1900, 1500]

  const candidate = detectDominantRcChannelChange(channels, baseline, {
    targetAxis: 'throttle'
  })
  assert.equal(candidate?.channelNumber, 3)
})

test('throttle capture accepts a downward sweep (reversed channel or high resting point)', () => {
  const baseline = [1500, 1500, 1800, 1500]
  const channels = [1500, 1500, 1100, 1500]

  const candidate = detectDominantRcChannelChange(channels, baseline, {
    targetAxis: 'throttle'
  })
  assert.equal(candidate?.channelNumber, 3)
})

test('throttle capture demands a larger swing than the sprung axes', () => {
  // 160µs clears the generic 120µs threshold but not the throttle-specific
  // 250µs one — the raised bar replaces the old baseline filter as the
  // guard against capturing an accidentally-brushed sprung stick.
  const baseline = [1500, 1500, 1480, 1500]
  const channels = [1500, 1500, 1640, 1500]

  const throttleCandidate = detectDominantRcChannelChange(channels, baseline, {
    targetAxis: 'throttle'
  })
  assert.equal(throttleCandidate, undefined)

  // The same movement still reads as a valid sprung-axis candidate.
  const rollCandidate = detectDominantRcChannelChange(channels, baseline, {
    targetAxis: 'roll'
  })
  assert.equal(rollCandidate?.channelNumber, 3)
})
