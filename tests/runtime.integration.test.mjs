import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ArduPilotConfiguratorRuntime,
  ParameterBatchWriteError,
  createParameterBackup,
  createParameterProvisioningLibrary,
  createParameterProvisioningProfile,
  createParameterSnapshot,
  createParameterSnapshotLibrary,
  deriveDraftValuesFromParameterBackup,
  deriveProvisioningProfileBackup,
  parseParameterBackup,
  parseParameterProvisioningLibrary,
  parseParameterSnapshotInput,
  parseParameterSnapshotLibrary,
  resolveParameterSnapshotInput,
  serializeParameterProvisioningLibrary,
  serializeParameterBackup,
  serializeParameterSnapshotLibrary
} from '../packages/ardupilot-core/dist/index.js'
import { createMockSITL } from '../packages/mock-sitl/dist/index.js'
import { arducopterMetadata, arduplaneMetadata, arduroverMetadata, ardusubMetadata } from '../packages/param-metadata/dist/index.js'
import { MAV_AUTOPILOT, MAV_CMD, MAV_RESULT, MAV_TYPE, MAVLINK_MESSAGE_IDS } from '../packages/protocol-mavlink/dist/index.js'

test('mock SITL connects and syncs a full parameter table', async () => {
  const sitl = createMockSITL()

  try {
    const snapshot = await sitl.connectAndSync({
      heartbeatTimeoutMs: 2000,
      parameterTimeoutMs: 5000
    })

    assert.equal(snapshot.connection.kind, 'connected')
    assert.equal(snapshot.vehicle?.vehicle, 'ArduCopter')
    assert.equal(snapshot.parameterStats.status, 'complete')
    assert.ok(snapshot.parameterStats.downloaded >= 10)
  } finally {
    await sitl.disconnect().catch(() => {})
    sitl.destroy()
  }
})

test('mock SITL exposes live global position telemetry for map surfaces', async () => {
  const sitl = createMockSITL()

  try {
    const snapshot = await sitl.connectAndSync({
      heartbeatTimeoutMs: 2000,
      parameterTimeoutMs: 5000
    })

    assert.equal(snapshot.liveVerification.globalPosition.verified, true)
    assert.equal(snapshot.liveVerification.globalPosition.latitudeDeg, 37.77493)
    assert.equal(snapshot.liveVerification.globalPosition.longitudeDeg, -122.41942)
    assert.equal(snapshot.liveVerification.globalPosition.relativeAltitudeM, 1.2)
  } finally {
    await sitl.disconnect().catch(() => {})
    sitl.destroy()
  }
})

test('mock SITL exposes board identity and UART mapping via AUTOPILOT_VERSION and MAVFTP', async () => {
  const sitl = createMockSITL()

  try {
    await sitl.connectAndSync({
      heartbeatTimeoutMs: 2000,
      parameterTimeoutMs: 5000
    })

    await waitFor(() => sitl.runtime.getSnapshot().hardware.uartsFile.status === 'ready', 1000)

    const snapshot = sitl.runtime.getSnapshot()
    assert.equal(snapshot.hardware.board?.boardType, 59)
    assert.equal(snapshot.hardware.board?.ftpSupported, true)
    assert.equal(snapshot.hardware.uartsFile.status, 'ready')
    assert.equal(snapshot.hardware.uartsFile.mappings.find((mapping) => mapping.serialPortNumber === 1)?.hardwarePort, 'UART7')
  } finally {
    await sitl.disconnect().catch(() => {})
    sitl.destroy()
  }
})

test('mock SITL supports MAVFTP directory browse, upload, download, and delete operations under @SYS', async () => {
  const sitl = createMockSITL()

  try {
    await sitl.connectAndSync({
      heartbeatTimeoutMs: 2000,
      parameterTimeoutMs: 5000
    })

    const initialEntries = await sitl.runtime.listRemoteDirectory('@SYS')
    assert.deepEqual(
      initialEntries.map((entry) => `${entry.kind}:${entry.name}`),
      ['directory:scripts', 'file:timers.txt', 'file:uarts.txt']
    )

    const scriptBytes = await sitl.runtime.downloadRemoteFile('@SYS/scripts/hello.lua')
    assert.match(new TextDecoder().decode(scriptBytes), /hello from @SYS\/scripts\/hello\.lua/)

    const uploadPath = '@SYS/scripts/upload-test.lua'
    await sitl.runtime.uploadRemoteFile(uploadPath, new TextEncoder().encode("return 'uploaded from test'\n"))

    const scriptDirectoryEntries = await sitl.runtime.listRemoteDirectory('@SYS/scripts')
    assert.ok(scriptDirectoryEntries.some((entry) => entry.kind === 'file' && entry.name === 'upload-test.lua'))

    const uploadedBytes = await sitl.runtime.downloadRemoteFile(uploadPath)
    assert.equal(new TextDecoder().decode(uploadedBytes), "return 'uploaded from test'\n")

    await sitl.runtime.deleteRemotePath(uploadPath)

    const afterDeleteEntries = await sitl.runtime.listRemoteDirectory('@SYS/scripts')
    assert.ok(!afterDeleteEntries.some((entry) => entry.path === uploadPath))
  } finally {
    await sitl.disconnect().catch(() => {})
    sitl.destroy()
  }
})

test('verified parameter writes resolve on PARAM_VALUE readback', async () => {
  const sitl = createMockSITL()

  try {
    await sitl.connectAndSync({
      heartbeatTimeoutMs: 2000,
      parameterTimeoutMs: 5000
    })

    const result = await sitl.runtime.setParameter('FLTMODE1', 5, {
      verifyTimeoutMs: 1000
    })

    assert.equal(result.paramId, 'FLTMODE1')
    assert.equal(result.confirmedValue, 5)
    assert.equal(
      sitl.runtime.getSnapshot().parameters.find((parameter) => parameter.id === 'FLTMODE1')?.value,
      5
    )
  } finally {
    await sitl.disconnect().catch(() => {})
    sitl.destroy()
  }
})

test('parameter sync retries when the initial stream stalls before the full table arrives', async () => {
  const sentMessages = []
  const runtime = new ArduPilotConfiguratorRuntime(
    createStalledParamSession(
      {
        FLTMODE1: 0,
        FLTMODE2: 1,
        FRAME_CLASS: 1,
        FRAME_TYPE: 1
      },
      sentMessages
    ),
    arducopterMetadata
  )

  // The completion path overwrites the request-parameters summary, so
  // the retry summary must be captured live across every emit.
  const requestParamSummaries = []
  const unsubscribe = runtime.subscribe((snapshot) => {
    const summary = snapshot.guidedActions['request-parameters']?.summary
    if (summary) {
      requestParamSummaries.push(summary)
    }
  })

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    const stats = await runtime.waitForParameterSync({ timeoutMs: 4000 })

    assert.equal(stats.status, 'complete')
    assert.equal(stats.downloaded, 4)
    assert.equal(
      sentMessages.filter((message) => message.type === 'PARAM_REQUEST_LIST').length,
      2
    )
    assert.match(
      runtime.getSnapshot().statusTexts.map((entry) => entry.text).join('\n'),
      /Re-requesting the table/
    )
    // The retry recovery is a full PARAM_REQUEST_LIST re-stream; the
    // surfaced summary must say so and must never claim a targeted
    // "missing values" re-request the runtime does not perform.
    const allSummaries = requestParamSummaries.join('\n')
    assert.match(allSummaries, /Re-requesting the full parameter table/)
    assert.doesNotMatch(allSummaries, /missing values/)
  } finally {
    unsubscribe()
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('batch writes roll back earlier changes when a later verification fails', async () => {
  const runtime = new ArduPilotConfiguratorRuntime(
    createEchoSession({
      FLTMODE1: 0,
      FLTMODE2: 1
    }, ({ paramId, paramValue }) => paramId === 'FLTMODE2' && paramValue === 6),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    let capturedError
    try {
      await runtime.setParameters(
        [
          { paramId: 'FLTMODE1', paramValue: 5 },
          { paramId: 'FLTMODE2', paramValue: 6 }
        ],
        { verifyTimeoutMs: 50 }
      )
    } catch (error) {
      capturedError = error
    }

    assert.ok(capturedError instanceof ParameterBatchWriteError)
    assert.equal(capturedError.result.applied.length, 1)
    assert.equal(capturedError.result.rolledBack.length, 1)
    assert.match(capturedError.message, /Rolled back 1 previously applied parameter change/)

    const snapshot = runtime.getSnapshot()
    assert.equal(snapshot.parameters.find((parameter) => parameter.id === 'FLTMODE1')?.value, 0)
    assert.equal(snapshot.parameters.find((parameter) => parameter.id === 'FLTMODE2')?.value, 1)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('batch writes report progress once per request (drives the "Writing… (N/M)" label)', async () => {
  const runtime = new ArduPilotConfiguratorRuntime(
    createEchoSession({ FLTMODE1: 0, FLTMODE2: 1, FLTMODE3: 2 }, () => false),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    const progress = []
    const result = await runtime.setParameters(
      [
        { paramId: 'FLTMODE1', paramValue: 5 },
        // No-op: already at 2. Must still tick progress so the bar advances.
        { paramId: 'FLTMODE3', paramValue: 2 },
        { paramId: 'FLTMODE2', paramValue: 6 }
      ],
      { verifyTimeoutMs: 200 },
      (entry) => progress.push({ ...entry })
    )

    assert.equal(result.applied.length, 2, 'two real writes, one skipped no-op')
    assert.deepEqual(progress.map((entry) => entry.completed), [1, 2, 3])
    assert.ok(progress.every((entry) => entry.total === 3))
    assert.deepEqual(progress.map((entry) => entry.paramId), ['FLTMODE1', 'FLTMODE3', 'FLTMODE2'])
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('a batch that fails because the link dropped reports rollback as NOT attempted, without "Rollback failed" spam', async () => {
  // The realistic mid-batch failure: the link drops. Rollback re-issues
  // writes, so it is ALSO impossible — the old code let every rollback
  // setParameter throw and logged N "Rollback failed for X" lines that
  // read as "the vehicle is in an unknown half-rolled-back state". The
  // truth is the opposite: nothing was sent, the applied changes are
  // intact as written. The summary must say so, once.
  let sessionRef
  const session = createEchoSession(
    { FLTMODE1: 0, FLTMODE2: 1 },
    // Drop the FLTMODE2 write so the batch fails on it.
    ({ paramId }) => paramId === 'FLTMODE2',
    () => false,
    // When the FLTMODE2 PARAM_SET goes out, the link drops.
    (message) => {
      if (message.type === 'PARAM_SET' && message.paramId === 'FLTMODE2') {
        queueMicrotask(() => sessionRef.disconnect())
      }
    }
  )
  sessionRef = session
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    let capturedError
    try {
      await runtime.setParameters(
        [
          { paramId: 'FLTMODE1', paramValue: 5 },
          { paramId: 'FLTMODE2', paramValue: 6 }
        ],
        { verifyTimeoutMs: 200 }
      )
    } catch (error) {
      capturedError = error
    }

    assert.ok(capturedError instanceof ParameterBatchWriteError)
    assert.equal(capturedError.result.applied.length, 1, 'FLTMODE1 was applied before the drop')
    assert.equal(capturedError.result.rolledBack.length, 0, 'rollback was not attempted')
    assert.match(capturedError.message, /Rollback NOT attempted/)
    assert.match(capturedError.message, /remain on the vehicle as written/)
    assert.match(capturedError.message, /require an active vehicle connection/)
    assert.match(capturedError.message, /may or may not have been applied/)

    const statusLog = runtime
      .getSnapshot()
      .statusTexts.map((entry) => entry.text)
      .join('\n')
    assert.doesNotMatch(statusLog, /Rollback failed for/, 'no per-write rollback-failed spam')
    assert.match(statusLog, /Could not roll back 1 applied parameter change/)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('parameter backups round-trip into staged restore diffs', async () => {
  const sitl = createMockSITL()

  try {
    const initialSnapshot = await sitl.connectAndSync({
      heartbeatTimeoutMs: 2000,
      parameterTimeoutMs: 5000
    })

    const backup = createParameterBackup(initialSnapshot)
    const modeEntry = backup.parameters.find((parameter) => parameter.id === 'FLTMODE1')
    assert.ok(modeEntry)
    modeEntry.value = 5

    const restore = deriveDraftValuesFromParameterBackup(
      initialSnapshot.parameters,
      parseParameterBackup(serializeParameterBackup(backup))
    )

    assert.equal(restore.changedCount, 1)
    assert.deepEqual(restore.draftValues, {
      FLTMODE1: '5'
    })
  } finally {
    await sitl.disconnect().catch(() => {})
    sitl.destroy()
  }
})

test('snapshot backups exclude volatile STAT_ parameters and ignore them on restore', () => {
  const snapshot = {
    vehicle: {
      firmware: 'ArduPilot',
      vehicle: 'ArduCopter',
      systemId: 1,
      componentId: 1,
      flightMode: 'Stabilize'
    },
    parameters: [
      {
        id: 'FLTMODE1',
        value: 0,
        index: 0,
        count: 3,
        definition: arducopterMetadata.parameters.FLTMODE1
      },
      {
        id: 'STAT_RUNTIME',
        value: 100,
        index: 1,
        count: 3
      },
      {
        id: 'STAT_BOOTCNT',
        value: 12,
        index: 2,
        count: 3
      }
    ]
  }

  const backup = createParameterBackup(snapshot)
  assert.equal(backup.parameterCount, 1)
  assert.deepEqual(
    backup.parameters.map((parameter) => parameter.id),
    ['FLTMODE1']
  )

  const legacyBackupWithStats = {
    ...backup,
    parameterCount: 3,
    parameters: [
      ...backup.parameters,
      { id: 'STAT_RUNTIME', value: 999 },
      { id: 'STAT_BOOTCNT', value: 99 }
    ]
  }

  const restore = deriveDraftValuesFromParameterBackup(snapshot.parameters, legacyBackupWithStats)
  assert.equal(restore.changedCount, 0)
  assert.deepEqual(restore.draftValues, {})
  assert.deepEqual(restore.unknownParameterIds, [])
})

test('snapshot restore ignores benign float variance when values are effectively equal', () => {
  const snapshot = {
    vehicle: {
      firmware: 'ArduPilot',
      vehicle: 'ArduCopter',
      systemId: 1,
      componentId: 1,
      flightMode: 'Stabilize'
    },
    parameters: [
      {
        id: 'ATC_INPUT_TC',
        value: 0.15000000596046448,
        index: 0,
        count: 1,
        definition: arducopterMetadata.parameters.ATC_INPUT_TC
      }
    ]
  }

  const backup = createParameterBackup(snapshot)
  backup.parameters[0].value = 0.15

  const restore = deriveDraftValuesFromParameterBackup(snapshot.parameters, backup)
  assert.equal(restore.changedCount, 0)
  assert.equal(restore.unchangedCount, 1)
  assert.deepEqual(restore.draftValues, {})
})

test('snapshot libraries round-trip and select snapshots by label', async () => {
  const sitl = createMockSITL()

  try {
    const initialSnapshot = await sitl.connectAndSync({
      heartbeatTimeoutMs: 2000,
      parameterTimeoutMs: 5000
    })

    const baselineBackup = createParameterBackup(initialSnapshot)
    const modifiedBackup = createParameterBackup(initialSnapshot)
    modifiedBackup.parameters.find((parameter) => parameter.id === 'FLTMODE1').value = 5

    const library = createParameterSnapshotLibrary('MOZ7 Baselines', [
      createParameterSnapshot(modifiedBackup, 'Aggressive tune', {
        source: 'captured',
        tags: ['moz7', 'tune']
      }),
      createParameterSnapshot(baselineBackup, 'Known-good baseline', {
        source: 'captured',
        protected: true
      })
    ])

    const parsedLibrary = parseParameterSnapshotLibrary(serializeParameterSnapshotLibrary(library))
    assert.equal(parsedLibrary.snapshots.length, 2)

    const selectedSnapshot = resolveParameterSnapshotInput(
      parseParameterSnapshotInput(serializeParameterSnapshotLibrary(library)),
      {
        label: 'Known-good baseline'
      }
    )

    assert.equal(selectedSnapshot.label, 'Known-good baseline')
    assert.equal(selectedSnapshot.protected, true)
    assert.deepEqual(selectedSnapshot.tags, [])
  } finally {
    await sitl.disconnect().catch(() => {})
    sitl.destroy()
  }
})

test('provisioning profiles round-trip and apply overlay parameters on top of a snapshot baseline', async () => {
  const sitl = createMockSITL()

  try {
    const initialSnapshot = await sitl.connectAndSync({
      heartbeatTimeoutMs: 2000,
      parameterTimeoutMs: 5000
    })

    const baseBackup = createParameterBackup(initialSnapshot)
    const profile = createParameterProvisioningProfile(baseBackup, 'Battalion night ops', {
      model: 'BETAFPV Pavo20',
      fleet: '3rd Battalion',
      mission: 'Night ops',
      tags: ['batch', 'night'],
      sourceSnapshotLabel: 'Known-good baseline',
      overlayParameters: [
        {
          id: 'FLTMODE1',
          value: 5,
          category: 'Flight modes',
          label: 'Flight Mode 1'
        }
      ],
      validationChecklist: ['Motor order verified', 'Receiver responds']
    })

    const library = createParameterProvisioningLibrary('Field kits', [profile])
    const parsedLibrary = parseParameterProvisioningLibrary(serializeParameterProvisioningLibrary(library))

    assert.equal(parsedLibrary.profiles.length, 1)
    assert.equal(parsedLibrary.profiles[0].fleet, '3rd Battalion')
    assert.equal(parsedLibrary.profiles[0].validationChecklist.length, 2)

    const effectiveBackup = deriveProvisioningProfileBackup(parsedLibrary.profiles[0])
    const restore = deriveDraftValuesFromParameterBackup(initialSnapshot.parameters, effectiveBackup)

    assert.equal(restore.changedCount, 1)
    assert.deepEqual(restore.draftValues, {
      FLTMODE1: '5'
    })
  } finally {
    await sitl.disconnect().catch(() => {})
    sitl.destroy()
  }
})

test('guided accelerometer flow completes through mock status text feedback', async () => {
  const sitl = createMockSITL()

  try {
    await sitl.connectAndSync({
      heartbeatTimeoutMs: 2000,
      parameterTimeoutMs: 5000
    })

    // The mock now mirrors real ArduPilot: it stops after the first pose
    // prompt and waits for the operator to confirm each of the six poses
    // before sending the next prompt. Drive the calibration through to
    // completion by issuing six advance commands.
    await sitl.runtime.runGuidedAction('calibrate-accelerometer')
    for (let step = 0; step < 6; step += 1) {
      await waitFor(
        () => sitl.runtime.getSnapshot().guidedActions['calibrate-accelerometer'].ctaLabel !== undefined,
        2000
      )
      await sitl.runtime.runGuidedAction('calibrate-accelerometer')
    }
    await waitFor(
      () => sitl.runtime.getSnapshot().guidedActions['calibrate-accelerometer'].status === 'succeeded',
      5000
    )

    const action = sitl.runtime.getSnapshot().guidedActions['calibrate-accelerometer']
    assert.equal(action.status, 'succeeded')
    assert.equal(action.summary, 'Accelerometer calibration complete.')
    assert.ok(action.statusTexts.some((text) => text.includes('Place vehicle')))
  } finally {
    await sitl.disconnect().catch(() => {})
    sitl.destroy()
  }
})

test('guided accelerometer flow also completes when the autopilot emits a generic calibration successful status text', async () => {
  const runtime = new ArduPilotConfiguratorRuntime(createGuidedActionStatusSession('Calibration successful'), arducopterMetadata)

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    await runtime.runGuidedAction('calibrate-accelerometer')
    await waitFor(
      () => runtime.getSnapshot().guidedActions['calibrate-accelerometer'].status === 'succeeded',
      1000
    )

    const action = runtime.getSnapshot().guidedActions['calibrate-accelerometer']
    assert.equal(action.status, 'succeeded')
    assert.equal(action.summary, 'Accelerometer calibration complete.')
    assert.ok(action.statusTexts.some((text) => text.includes('Calibration successful')))
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('guided accelerometer flow completes on a bare successful status text while active', async () => {
  const runtime = new ArduPilotConfiguratorRuntime(createGuidedActionStatusSession('Successful'), arducopterMetadata)

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    await runtime.runGuidedAction('calibrate-accelerometer')
    await waitFor(
      () => runtime.getSnapshot().guidedActions['calibrate-accelerometer'].status === 'succeeded',
      1000
    )

    const action = runtime.getSnapshot().guidedActions['calibrate-accelerometer']
    assert.equal(action.status, 'succeeded')
    assert.equal(action.summary, 'Accelerometer calibration complete.')
    assert.ok(action.statusTexts.some((text) => text.includes('Successful')))
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('guided compass flow fails fast when no enabled compass is present after parameter sync', async () => {
  const runtime = new ArduPilotConfiguratorRuntime(createCompasslessCalibrationSession(), arducopterMetadata)

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    await runtime.runGuidedAction('calibrate-compass')
    await waitFor(() => runtime.getSnapshot().guidedActions['calibrate-compass'].status === 'failed', 2000)

    const action = runtime.getSnapshot().guidedActions['calibrate-compass']
    assert.equal(action.status, 'failed')
    assert.equal(action.summary, 'No enabled compass detected on this vehicle. Skip this step or enable a compass first.')
    assert.match(runtime.getSnapshot().statusTexts.map((entry) => entry.text).join('\n'), /No enabled compass detected/)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('guided compass flow fails when the autopilot acknowledges calibration but never emits compass guidance', async () => {
  const runtime = new ArduPilotConfiguratorRuntime(createSilentCompassCalibrationSession(), arducopterMetadata, {
    compassGuidanceTimeoutMs: 40
  })

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    await runtime.runGuidedAction('calibrate-compass')
    await waitFor(() => runtime.getSnapshot().guidedActions['calibrate-compass'].status === 'failed', 500)

    const action = runtime.getSnapshot().guidedActions['calibrate-compass']
    assert.equal(action.status, 'failed')
    assert.equal(
      action.summary,
      'No compass calibration guidance arrived from the autopilot even though it accepted the start command. The onboard calibration was cancelled — check the link and the SRx_EXTRA3 telemetry stream rate, then re-run the calibration.'
    )
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('guided accelerometer flow exposes posture confirmation steps after the calibration command is accepted', async () => {
  const { session, sentMessages } = createAccelerometerHandshakeSession()
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {
    accelerometerInitialWarmupMs: 20,
    accelerometerStepAdvanceMs: 20
  })

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    await runtime.runGuidedAction('calibrate-accelerometer')
    let action = runtime.getSnapshot().guidedActions['calibrate-accelerometer']
    assert.equal(action.status, 'running')
    await waitFor(() => runtime.getSnapshot().guidedActions['calibrate-accelerometer'].ctaLabel === 'Confirm Level Position', 200)
    action = runtime.getSnapshot().guidedActions['calibrate-accelerometer']
    assert.equal(action.ctaLabel, 'Confirm Level Position')
    assert.equal(action.summary, 'Place the vehicle level and keep it still.')

    await runtime.runGuidedAction('calibrate-accelerometer')
    await waitFor(
      () => runtime.getSnapshot().guidedActions['calibrate-accelerometer'].status === 'succeeded',
      1500
    )

    action = runtime.getSnapshot().guidedActions['calibrate-accelerometer']
    assert.equal(action.status, 'succeeded')
    assert.equal(action.summary, 'Accelerometer calibration complete.')
    assert.ok(
      sentMessages.some(
        (message) => message.type === 'COMMAND_ACK' && message.command === 0 && message.result === MAV_RESULT.TEMPORARILY_REJECTED
      )
    )
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('guided accelerometer flow falls back to the first posture prompt when no accel prompt arrives from the FC', async () => {
  const runtime = new ArduPilotConfiguratorRuntime(createAccelerometerPromptlessHandshakeSession(), arducopterMetadata, {
    accelerometerInitialWarmupMs: 50
  })

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    await runtime.runGuidedAction('calibrate-accelerometer')
    await waitFor(() => runtime.getSnapshot().guidedActions['calibrate-accelerometer'].ctaLabel === 'Confirm Level Position', 250)

    const action = runtime.getSnapshot().guidedActions['calibrate-accelerometer']
    assert.equal(action.status, 'running')
    assert.equal(action.ctaLabel, 'Confirm Level Position')
    assert.equal(action.summary, 'Place the vehicle level and keep it still.')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('guided accelerometer flow completes after the final pose even when the FC does not emit an explicit completion message', async () => {
  const runtime = new ArduPilotConfiguratorRuntime(createAccelerometerPromptlessHandshakeSession(), arducopterMetadata, {
    accelerometerInitialWarmupMs: 10,
    accelerometerStepAdvanceMs: 10,
    accelerometerCompletionFallbackMs: 20
  })

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    await runtime.runGuidedAction('calibrate-accelerometer')
    for (let index = 0; index < 6; index += 1) {
      await waitFor(
        () => runtime.getSnapshot().guidedActions['calibrate-accelerometer'].ctaLabel !== undefined,
        250
      )
      await runtime.runGuidedAction('calibrate-accelerometer')
    }

    await waitFor(
      () => runtime.getSnapshot().guidedActions['calibrate-accelerometer'].status === 'succeeded',
      500
    )

    const action = runtime.getSnapshot().guidedActions['calibrate-accelerometer']
    assert.equal(action.status, 'succeeded')
    assert.equal(action.summary, 'Accelerometer calibration complete.')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('guided accelerometer flow fails when the autopilot reports accelerometer calibration failure after a posture confirmation', async () => {
  const runtime = new ArduPilotConfiguratorRuntime(createFailedAccelerometerHandshakeSession(), arducopterMetadata, {
    accelerometerInitialWarmupMs: 20,
    accelerometerStepAdvanceMs: 20
  })

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    await runtime.runGuidedAction('calibrate-accelerometer')
    await waitFor(() => runtime.getSnapshot().guidedActions['calibrate-accelerometer'].ctaLabel === 'Confirm Level Position', 200)
    await runtime.runGuidedAction('calibrate-accelerometer')
    await waitFor(() => runtime.getSnapshot().guidedActions['calibrate-accelerometer'].status === 'failed', 500)

    const action = runtime.getSnapshot().guidedActions['calibrate-accelerometer']
    assert.equal(action.status, 'failed')
    assert.match(action.summary, /accelerometer calibration failed/i)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('authoritative ArduPilot heartbeat target is not replaced by later non-autopilot heartbeats', async () => {
  const session = createHeartbeatSession([
    {
      atMs: 0,
      systemId: 1,
      componentId: 1,
      autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA,
      vehicleType: MAV_TYPE.QUADROTOR
    },
    {
      atMs: 10,
      systemId: 1,
      componentId: 100,
      autopilot: 0,
      vehicleType: MAV_TYPE.QUADROTOR
    }
  ])
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)

  try {
    await runtime.connect()
    await runtime.waitForVehicle({ timeoutMs: 200 })
    await sleep(40)

    const vehicle = runtime.getSnapshot().vehicle
    assert.equal(vehicle?.systemId, 1)
    assert.equal(vehicle?.componentId, 1)
    assert.equal(vehicle?.vehicle, 'ArduCopter')

    await runtime.requestParameterList({ timeoutMs: 200 })
    const request = session.sentMessages.find((message) => message.type === 'PARAM_REQUEST_LIST')
    assert.ok(request)
    assert.equal(request.targetSystem, 1)
    assert.equal(request.targetComponent, 1)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('ArduCopter detection accepts non-quad multirotor MAV types', async () => {
  const session = createHeartbeatSession([
    {
      atMs: 0,
      systemId: 1,
      componentId: 1,
      autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA,
      vehicleType: MAV_TYPE.HEXAROTOR
    }
  ])
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)

  try {
    await runtime.connect()
    const vehicle = await runtime.waitForVehicle({ timeoutMs: 200 })

    assert.equal(vehicle.firmware, 'ArduPilot')
    assert.equal(vehicle.vehicle, 'ArduCopter')
    assert.equal(runtime.getSnapshot().vehicle?.vehicle, 'ArduCopter')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('a FIXED_WING heartbeat is identified as ArduPlane', async () => {
  const session = createHeartbeatSession([
    {
      atMs: 0,
      systemId: 1,
      componentId: 1,
      autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA,
      vehicleType: MAV_TYPE.FIXED_WING
    }
  ])
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)

  try {
    await runtime.connect()
    const vehicle = await runtime.waitForVehicle({ timeoutMs: 200 })
    assert.equal(vehicle.firmware, 'ArduPilot')
    assert.equal(vehicle.vehicle, 'ArduPlane')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('a QuadPlane VTOL heartbeat is identified as ArduPlane', async () => {
  const session = createHeartbeatSession([
    {
      atMs: 0,
      systemId: 1,
      componentId: 1,
      autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA,
      vehicleType: MAV_TYPE.VTOL_TILTROTOR
    }
  ])
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)

  try {
    await runtime.connect()
    const vehicle = await runtime.waitForVehicle({ timeoutMs: 200 })
    assert.equal(vehicle.vehicle, 'ArduPlane')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('a GROUND_ROVER heartbeat is identified as ArduRover', async () => {
  const session = createHeartbeatSession([
    { atMs: 0, systemId: 1, componentId: 1, autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA, vehicleType: MAV_TYPE.GROUND_ROVER }
  ])
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)

  try {
    await runtime.connect()
    const vehicle = await runtime.waitForVehicle({ timeoutMs: 200 })
    assert.equal(vehicle.firmware, 'ArduPilot')
    assert.equal(vehicle.vehicle, 'ArduRover')
    // Real heartbeat -> createVehicleIdentity -> formatArduPilotMode
    // dispatch: Rover mode 0 is Manual (Copter 0 would be Stabilize).
    assert.equal(vehicle.flightMode, 'Manual')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('a SURFACE_BOAT heartbeat is also identified as ArduRover', async () => {
  const session = createHeartbeatSession([
    { atMs: 0, systemId: 1, componentId: 1, autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA, vehicleType: MAV_TYPE.SURFACE_BOAT }
  ])
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)

  try {
    await runtime.connect()
    const vehicle = await runtime.waitForVehicle({ timeoutMs: 200 })
    assert.equal(vehicle.vehicle, 'ArduRover')
    assert.equal(vehicle.flightMode, 'Manual')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('a SUBMARINE heartbeat is identified as ArduSub', async () => {
  const session = createHeartbeatSession([
    { atMs: 0, systemId: 1, componentId: 1, autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA, vehicleType: MAV_TYPE.SUBMARINE }
  ])
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)

  try {
    await runtime.connect()
    const vehicle = await runtime.waitForVehicle({ timeoutMs: 200 })
    assert.equal(vehicle.firmware, 'ArduPilot')
    assert.equal(vehicle.vehicle, 'ArduSub')
    // Sub mode 0 is Stabilize via the Sub-specific dispatch.
    assert.equal(vehicle.flightMode, 'Stabilize')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

// audit-32: STATUSTEXT chunked-reassembly tests share a minimal session
// that emits a HEARTBEAT then lets the test drive arbitrary STATUSTEXT
// frames through the message listener. Snapshot.statusTexts is the
// observable surface (most-recent-first per resetLiveState semantics).
function createStatusTextSession() {
  const statusListeners = []
  const messageListeners = []
  let connected = false
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
      // Emit a baseline ArduCopter heartbeat so the runtime moves out of
      // 'awaiting-vehicle' — STATUSTEXTs flow through the same processing
      // path regardless of vehicle state but doing this makes the test
      // tree closer to a real session.
      messageListeners.forEach((listener) =>
        listener({
          header: { systemId: 1, componentId: 1, sequence: 0 },
          message: {
            type: 'HEARTBEAT',
            autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA,
            vehicleType: MAV_TYPE.QUADROTOR,
            baseMode: 0,
            customMode: 0,
            systemStatus: 4,
            mavlinkVersion: 3
          },
          timestampMs: Date.now()
        })
      )
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test' }))
    },
    destroy() {},
    async send() {},
    /** Test hook: drive a STATUSTEXT through the runtime's message listener. */
    pushStatusText(severity, text, statusId = 0, chunkSequence = 0) {
      messageListeners.forEach((listener) =>
        listener({
          header: { systemId: 1, componentId: 1, sequence: 0 },
          message: { type: 'STATUSTEXT', severity, text, statusId, chunkSequence },
          timestampMs: Date.now()
        })
      )
    }
  }
}

test('audit-32: legacy single-frame STATUSTEXT (statusId=0) emits unchanged', async () => {
  const session = createStatusTextSession()
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    await runtime.waitForVehicle({ timeoutMs: 200 })
    session.pushStatusText(6, 'Boot OK', 0, 0)
    const snap = runtime.getSnapshot()
    assert.equal(snap.statusTexts[0].text, 'Boot OK')
    assert.equal(snap.statusTexts[0].severity, 'info')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('audit-32: multi-chunk STATUSTEXT (statusId != 0) reassembles via chunkSequence', async () => {
  // Pre-audit-32 each 50-char chunk was emitted as its own status entry —
  // a long pre-arm error displayed as fragments. This test sends three
  // chunks with the same statusId: two full-width (50 chars) and one
  // short final chunk, and asserts a single concatenated entry lands.
  const session = createStatusTextSession()
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    await runtime.waitForVehicle({ timeoutMs: 200 })
    const chunkA = 'A'.repeat(50)
    const chunkB = 'B'.repeat(50)
    const chunkC = 'CCC'
    session.pushStatusText(3, chunkA, 42, 0)
    session.pushStatusText(3, chunkB, 42, 1)
    // No entry yet — chunks are still buffered (both are full-width).
    let snap = runtime.getSnapshot()
    assert.equal(snap.statusTexts.length, 0, 'no entry until end-of-message')
    // The short chunk triggers flush.
    session.pushStatusText(3, chunkC, 42, 2)
    snap = runtime.getSnapshot()
    assert.equal(snap.statusTexts.length, 1, 'exactly one entry after reassembly')
    assert.equal(snap.statusTexts[0].text, chunkA + chunkB + chunkC)
    assert.equal(snap.statusTexts[0].severity, 'error')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('audit-32: out-of-order chunks are reassembled in chunkSequence order', async () => {
  // ArduPilot emits in order, but defensive correctness: the receiver
  // should sort by chunkSequence so a re-orderable transport (or a
  // hostile sender) can't shuffle a message into nonsense.
  const session = createStatusTextSession()
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    await runtime.waitForVehicle({ timeoutMs: 200 })
    const chunkA = 'A'.repeat(50)
    const chunkB = 'B'.repeat(50)
    const chunkC = 'CC'
    // Arrival order: 1, 0, 2 (chunk 2 is the short final).
    session.pushStatusText(4, chunkB, 7, 1)
    session.pushStatusText(4, chunkA, 7, 0)
    session.pushStatusText(4, chunkC, 7, 2)
    const snap = runtime.getSnapshot()
    assert.equal(snap.statusTexts.length, 1)
    assert.equal(snap.statusTexts[0].text, chunkA + chunkB + chunkC)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('audit-32: concurrent statusIds are buffered independently and emit in completion order', async () => {
  const session = createStatusTextSession()
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    await runtime.waitForVehicle({ timeoutMs: 200 })
    // Interleave two distinct multi-chunk messages; each statusId's
    // buffer is independent. The shorter one (id 2) completes first.
    session.pushStatusText(6, 'X'.repeat(50), 1, 0)
    session.pushStatusText(6, 'Y'.repeat(50), 2, 0)
    session.pushStatusText(6, 'Z', 2, 1) // id 2 done -> emit first
    let snap = runtime.getSnapshot()
    assert.equal(snap.statusTexts.length, 1)
    assert.equal(snap.statusTexts[0].text, 'Y'.repeat(50) + 'Z')
    session.pushStatusText(6, 'W', 1, 1) // id 1 done -> emit second
    snap = runtime.getSnapshot()
    assert.equal(snap.statusTexts.length, 2)
    // unshift -> most-recent first.
    assert.equal(snap.statusTexts[0].text, 'X'.repeat(50) + 'W')
    assert.equal(snap.statusTexts[1].text, 'Y'.repeat(50) + 'Z')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('audit-32: a stale partial buffer flushes (as-is) when a new STATUSTEXT arrives >2s later', async () => {
  // A link drop in the middle of a chunked message must NOT silently
  // hide the partial content — better honest partial than silent loss.
  // The flush fires on the next STATUSTEXT arrival (or, in a real link,
  // any other message processing tick — but the cheap, deterministic
  // path is the next STATUSTEXT).
  const session = createStatusTextSession()
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  const originalNow = Date.now
  let virtualNow = originalNow.call(Date)
  Date.now = () => virtualNow
  try {
    await runtime.connect()
    await runtime.waitForVehicle({ timeoutMs: 200 })
    session.pushStatusText(2, 'P'.repeat(50), 99, 0)
    // Advance the virtual clock past the 2s threshold.
    virtualNow += 2500
    // Next arrival triggers the stale-flush check.
    session.pushStatusText(6, 'next', 0, 0)
    const snap = runtime.getSnapshot()
    // We expect both: the partial 'P'.repeat(50) (from statusId 99) and
    // the 'next' single-frame. unshift -> most-recent first; the partial
    // is flushed first (during the new arrival's stale check), then
    // the 'next' is emitted, so order is ['next', 'PPPP...'].
    assert.equal(snap.statusTexts.length, 2)
    assert.equal(snap.statusTexts[0].text, 'next')
    assert.equal(snap.statusTexts[1].text, 'P'.repeat(50))
    assert.equal(snap.statusTexts[1].severity, 'error')
  } finally {
    Date.now = originalNow
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('audit-32: chunk buffers cleared on disconnect (no cross-session fusion)', async () => {
  const session = createStatusTextSession()
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    await runtime.waitForVehicle({ timeoutMs: 200 })
    // Let the connect-time SET_MESSAGE_INTERVAL loop finish so its
    // "Requested live telemetry streams" info entry lands in THIS
    // session (and is cleared by the disconnect below) — this test is
    // about chunk buffers, not the stream-request summary.
    await sleep(10)
    session.pushStatusText(2, 'A'.repeat(50), 7, 0)
    await runtime.disconnect()
    await runtime.connect()
    await runtime.waitForVehicle({ timeoutMs: 200 })
    // The chunk-1 from the new session under the same statusId would
    // fuse with the stale chunk-0 if we didn't clear on disconnect.
    session.pushStatusText(6, 'B', 7, 1)
    const snap = runtime.getSnapshot()
    // The new chunk-1 is a SHORT chunk so flushes immediately — but the
    // buffer doesn't carry the stale chunk-0, so the emitted text is
    // just 'B'.
    assert.equal(snap.statusTexts.length, 1)
    assert.equal(snap.statusTexts[0].text, 'B')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('audit-31: COAXIAL / DODECAROTOR / DECAROTOR heartbeats are identified as ArduCopter', async () => {
  // Pre-audit-31 these airframes reported as 'Unknown' even though the
  // firmware running on them is ArduCopter (just different rotor counts /
  // configs). MAV_TYPE values per MAVLink common.xml:
  // COAXIAL=3, DODECAROTOR=29, DECAROTOR=35.
  for (const vehicleType of [MAV_TYPE.COAXIAL, MAV_TYPE.DODECAROTOR, MAV_TYPE.DECAROTOR]) {
    const session = createHeartbeatSession([
      { atMs: 0, systemId: 1, componentId: 1, autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA, vehicleType }
    ])
    const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
    try {
      await runtime.connect()
      const vehicle = await runtime.waitForVehicle({ timeoutMs: 200 })
      assert.equal(vehicle.firmware, 'ArduPilot')
      assert.equal(vehicle.vehicle, 'ArduCopter', `MAV_TYPE ${vehicleType} -> ArduCopter`)
      // Copter custom_mode 0 = Stabilize (proves the Copter dispatch ran,
      // not a Plane/Rover/Sub one).
      assert.equal(vehicle.flightMode, 'Stabilize')
    } finally {
      await runtime.disconnect().catch(() => {})
      runtime.destroy()
    }
  }
})

test('audit-31: AIRSHIP / ANTENNA_TRACKER constants exist but classification stays Unknown (deferred to audit-32)', async () => {
  // These are real ArduPilot vehicles (ArduBlimp / AntennaTracker) that
  // need full vehicle-type support to classify (new VehicleIdentity.vehicle
  // string, metadata bundle, flight mode table). Constants are declared
  // so audit-32 doesn't re-derive them from MAVLink common.xml; the
  // classification stays 'Unknown' until that follow-up ships.
  for (const vehicleType of [MAV_TYPE.AIRSHIP, MAV_TYPE.ANTENNA_TRACKER]) {
    const session = createHeartbeatSession([
      { atMs: 0, systemId: 1, componentId: 1, autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA, vehicleType }
    ])
    const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
    try {
      await runtime.connect()
      const vehicle = await runtime.waitForVehicle({ timeoutMs: 200 })
      assert.equal(vehicle.firmware, 'ArduPilot')
      assert.equal(vehicle.vehicle, 'Unknown', `MAV_TYPE ${vehicleType} stays Unknown until audit-32`)
    } finally {
      await runtime.disconnect().catch(() => {})
      runtime.destroy()
    }
  }
})

test('audit-30: HEARTBEAT.system_status decodes onto vehicle.systemStatus across the MAV_STATE enum', async () => {
  // Pre-audit-30 the field was dropped on the floor — a real FC reporting
  // CRITICAL / EMERGENCY / FLIGHT_TERMINATION went invisible to the operator.
  // Cover the safety-critical states + a few normal ones, plus an
  // out-of-range code that must NOT silently map to a known label.
  const cases = [
    { code: 0, expected: 'uninit' },
    { code: 1, expected: 'boot' },
    { code: 2, expected: 'calibrating' },
    { code: 3, expected: 'standby' },
    { code: 4, expected: 'active' },
    { code: 5, expected: 'critical' },
    { code: 6, expected: 'emergency' },
    { code: 7, expected: 'poweroff' },
    { code: 8, expected: 'flight-termination' },
    { code: 99, expected: 'unknown' }
  ]
  for (const { code, expected } of cases) {
    const session = createHeartbeatSession([
      {
        atMs: 0,
        systemId: 1,
        componentId: 1,
        autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA,
        vehicleType: MAV_TYPE.QUADROTOR,
        systemStatus: code
      }
    ])
    const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
    try {
      await runtime.connect()
      const vehicle = await runtime.waitForVehicle({ timeoutMs: 200 })
      assert.equal(vehicle.systemStatus, expected, `code ${code} -> ${expected}`)
    } finally {
      await runtime.disconnect().catch(() => {})
      runtime.destroy()
    }
  }
})

test('runtime swaps to the ArduPlane metadata bundle when a Plane is detected', async () => {
  const session = createHeartbeatSession([
    {
      atMs: 0,
      systemId: 1,
      componentId: 1,
      autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA,
      vehicleType: MAV_TYPE.FIXED_WING
    }
  ])
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {
    metadataByVehicle: {
      ArduCopter: arducopterMetadata,
      ArduPlane: arduplaneMetadata
    }
  })

  try {
    // Default bundle before any heartbeat is the constructor's ArduCopter.
    assert.equal(runtime.getActiveMetadata().firmware, 'ArduCopter')

    await runtime.connect()
    await runtime.waitForVehicle({ timeoutMs: 200 })

    const active = runtime.getActiveMetadata()
    assert.equal(active.firmware, 'ArduPlane')
    // A Plane-only parameter proves the swap reached the catalog.
    assert.ok(active.parameters.Q_ENABLE, 'expected the Plane bundle to expose Q_ENABLE')
    assert.ok(active.parameters.FS_LONG_ACTN, 'expected the Plane bundle to expose FS_LONG_ACTN')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('runtime swaps to the ArduRover metadata bundle when a Rover is detected', async () => {
  const session = createHeartbeatSession([
    {
      atMs: 0,
      systemId: 1,
      componentId: 1,
      autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA,
      vehicleType: MAV_TYPE.GROUND_ROVER
    }
  ])
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {
    metadataByVehicle: {
      ArduCopter: arducopterMetadata,
      ArduPlane: arduplaneMetadata,
      ArduRover: arduroverMetadata
    }
  })

  try {
    assert.equal(runtime.getActiveMetadata().firmware, 'ArduCopter')

    await runtime.connect()
    const vehicle = await runtime.waitForVehicle({ timeoutMs: 200 })
    assert.equal(vehicle.vehicle, 'ArduRover')

    const active = runtime.getActiveMetadata()
    assert.equal(active.firmware, 'ArduRover')
    // Rover-only parameters prove the swap reached the Rover catalog and
    // it is NOT the Copter fallback (no MODE_CH/CRUISE_SPEED on Copter).
    assert.ok(active.parameters.MODE_CH, 'expected the Rover bundle to expose MODE_CH')
    assert.ok(active.parameters.CRUISE_SPEED, 'expected the Rover bundle to expose CRUISE_SPEED')
    assert.ok(active.parameters.ATC_STR_RAT_P, 'expected the Rover steering-rate gains')
    // Rover legitimately carries its own FRAME_CLASS (Rover/Boat/BalanceBot), so
    // distinguish from the Copter fallback via a Copter-only attitude param instead.
    assert.ok(!active.parameters.ATC_INPUT_TC, 'Rover bundle must not carry the Copter ATC_INPUT_TC')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('runtime swaps to the ArduSub metadata bundle when a Sub is detected', async () => {
  const session = createHeartbeatSession([
    {
      atMs: 0,
      systemId: 1,
      componentId: 1,
      autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA,
      vehicleType: MAV_TYPE.SUBMARINE
    }
  ])
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {
    metadataByVehicle: {
      ArduCopter: arducopterMetadata,
      ArduPlane: arduplaneMetadata,
      ArduRover: arduroverMetadata,
      ArduSub: ardusubMetadata
    }
  })

  try {
    assert.equal(runtime.getActiveMetadata().firmware, 'ArduCopter')

    await runtime.connect()
    const vehicle = await runtime.waitForVehicle({ timeoutMs: 200 })
    assert.equal(vehicle.vehicle, 'ArduSub')

    const active = runtime.getActiveMetadata()
    assert.equal(active.firmware, 'ArduSub')
    // Sub-only parameters prove the swap reached the real Sub catalog and
    // it is not the Copter fallback.
    assert.ok(active.parameters.FRAME_CONFIG, 'expected the Sub bundle to expose FRAME_CONFIG')
    assert.ok(active.parameters.JS_GAIN_DEFAULT, 'expected the Sub joystick gains')
    assert.ok(active.parameters.FS_LEAK_ENABLE, 'expected the Sub leak failsafe')
    assert.ok(!active.parameters.FRAME_CLASS, 'Sub bundle must not carry the Copter FRAME_CLASS')
    assert.ok(!active.parameters.MODE_CH, 'Sub bundle must not carry the Rover MODE_CH')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('runtime keeps the ArduCopter bundle when no per-vehicle map is supplied', async () => {
  const session = createHeartbeatSession([
    {
      atMs: 0,
      systemId: 1,
      componentId: 1,
      autopilot: MAV_AUTOPILOT.ARDUPILOTMEGA,
      vehicleType: MAV_TYPE.FIXED_WING
    }
  ])
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)

  try {
    await runtime.connect()
    await runtime.waitForVehicle({ timeoutMs: 200 })
    // Vehicle is ArduPlane but no metadataByVehicle was given, so the
    // single constructor bundle stays put (back-compat).
    assert.equal(runtime.getActiveMetadata().firmware, 'ArduCopter')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('live telemetry requests use responsive attitude rates and slower support streams', async () => {
  const outbound = []
  const runtime = new ArduPilotConfiguratorRuntime(
    createEchoSession({}, () => false, () => false, (message) => {
      outbound.push(message)
    }),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    await sleep(10)

    const telemetryRequests = outbound.filter(
      (message) => message.type === 'COMMAND_LONG' && message.command === MAV_CMD.SET_MESSAGE_INTERVAL
    )

    assert.deepEqual(
      telemetryRequests.map((message) => [message.params[0], message.params[1]]),
      [
        // 5 Hz GLOBAL_POSITION_INT — bumped from 2 Hz so the Setup-page
        // Live GPS map looks like it's actually moving when a Here3 is.
        [MAVLINK_MESSAGE_IDS.GLOBAL_POSITION_INT, 200000],
        [MAVLINK_MESSAGE_IDS.ATTITUDE, 25000],
        // Quaternion attitude for the singularity-free craft view, same 40 Hz
        // cadence as ATTITUDE.
        [MAVLINK_MESSAGE_IDS.ATTITUDE_QUATERNION, 25000],
        [MAVLINK_MESSAGE_IDS.RC_CHANNELS, 50000],
        [MAVLINK_MESSAGE_IDS.SYS_STATUS, 500000],
        // DroneCAN node discovery requires explicitly streaming
        // UAVCAN_NODE_STATUS — ArduPilot does not include msgid 310 in
        // any default stream. Without this request the bridge stays
        // silent and the "DroneCAN bus" UI never populates even when a
        // CAN peripheral is alive on the FC.
        [MAVLINK_MESSAGE_IDS.UAVCAN_NODE_STATUS, 1000000],
        // Mag-cal feedback rides the EXTRA3 stream group; on a link with
        // SRx_EXTRA3=0 an onboard calibration runs blind and the guidance
        // timeout falsely fails the guided action. Idle cost is zero —
        // ArduPilot only fills these while a calibrator is running.
        [MAVLINK_MESSAGE_IDS.MAG_CAL_PROGRESS, 500000],
        [MAVLINK_MESSAGE_IDS.MAG_CAL_REPORT, 1000000]
      ]
    )
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('parameter verification waiters are cleaned up when outbound PARAM_SET send fails', async () => {
  const runtime = new ArduPilotConfiguratorRuntime(
    createEchoSession(
      {
        FLTMODE1: 0
      },
      () => false,
      (message) => message.type === 'PARAM_SET'
    ),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    await assert.rejects(() => runtime.setParameter('FLTMODE1', 5, { verifyTimeoutMs: 50 }), /simulated send failure/i)
    assert.equal(runtime.parameterValueWaiters.size, 0)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('command ack waiters are cleaned up when outbound COMMAND_LONG send fails', async () => {
  const runtime = new ArduPilotConfiguratorRuntime(
    createEchoSession(
      {
        FLTMODE1: 0
      },
      () => false,
      (message) => message.type === 'COMMAND_LONG'
    ),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    await assert.rejects(
      () => runtime.sendCommand(MAV_CMD.DO_MOTOR_TEST, [1, 0, 5, 1, 1, 0, 0], { waitForAck: true, ackTimeoutMs: 50 }),
      /simulated send failure/i
    )
    assert.equal(runtime.commandAckWaiters.size, 0)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('motor test supports all mapped motors in sequence', async () => {
  const sentMessages = []
  const runtime = new ArduPilotConfiguratorRuntime(
    createMotorTestAckSession(
      {
        FLTMODE1: 0,
        FRAME_CLASS: 1,
        FRAME_TYPE: 1,
        SERVO1_FUNCTION: 33,
        SERVO2_FUNCTION: 34,
        SERVO3_FUNCTION: 35,
        SERVO4_FUNCTION: 36
      },
      sentMessages
    ),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    await runtime.runMotorTest({
      runAllOutputs: true,
      throttlePercent: 5,
      durationSeconds: 1
    })

    const command = sentMessages.find((message) => message.type === 'COMMAND_LONG' && message.command === MAV_CMD.DO_MOTOR_TEST)
    assert.ok(command)
    assert.deepEqual(command.params.slice(0, 6), [1, 0, 5, 1, 4, 1])

    const snapshot = runtime.getSnapshot()
    assert.equal(snapshot.motorTest.status, 'running')
    assert.equal(snapshot.motorTest.allOutputsSelected, true)
    assert.equal(snapshot.motorTest.selectedOutputCount, 4)
    assert.match(snapshot.motorTest.summary, /all 4 mapped motors/i)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('simultaneous motor test fires one DO_MOTOR_TEST per motor (Mission Planner "Test all motors")', async () => {
  // ArduPilot _output_test_seq writes only the matching motor and never
  // zeroes the others, so firing one DO_MOTOR_TEST per motor back-to-back
  // leaves them all spinning together until the shared timeout.
  const sentMessages = []
  const runtime = new ArduPilotConfiguratorRuntime(
    createMotorTestAckSession(
      {
        FLTMODE1: 0,
        FRAME_CLASS: 1,
        FRAME_TYPE: 1,
        SERVO1_FUNCTION: 33,
        SERVO2_FUNCTION: 34,
        SERVO3_FUNCTION: 35,
        SERVO4_FUNCTION: 36
      },
      sentMessages
    ),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    await runtime.runMotorTest({
      runAllOutputsSimultaneous: true,
      throttlePercent: 5,
      durationSeconds: 1
    })

    const commands = sentMessages.filter(
      (message) => message.type === 'COMMAND_LONG' && message.command === MAV_CMD.DO_MOTOR_TEST
    )
    assert.equal(commands.length, 4, 'one DO_MOTOR_TEST per mapped motor')
    for (const command of commands) {
      assert.equal(command.params[4], 1, 'motor_count = 1 (FC must not sweep)')
    }
    assert.deepEqual(
      commands.map((command) => command.params[0]).sort((left, right) => left - right),
      [1, 2, 3, 4],
      'every motor test-order sequence is commanded once'
    )

    const snapshot = runtime.getSnapshot()
    assert.equal(snapshot.motorTest.status, 'running')
    assert.equal(snapshot.motorTest.simultaneousOutputs, true)
    assert.equal(snapshot.motorTest.selectedOutputCount, 4)
    assert.match(snapshot.motorTest.summary, /simultaneously/i)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('expert duration ceiling is honored by the ENFORCED gate, not just the UI gate', async () => {
  // Field report: "didn't work even in expert mode for the longer spin".
  // The UI gate passed expertMode to the eligibility check but
  // runtime.runMotorTest re-evaluated WITHOUT it, so a 10 s request was
  // rejected at the 5 s default even with Expert mode on.
  const sentMessages = []
  const runtime = new ArduPilotConfiguratorRuntime(
    createMotorTestAckSession(
      { FLTMODE1: 0, FRAME_CLASS: 1, FRAME_TYPE: 1, SERVO1_FUNCTION: 33 },
      sentMessages
    ),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    // Without expert options: >5 s is still rejected (the default cap).
    await assert.rejects(
      () => runtime.runMotorTest({ outputChannel: 1, throttlePercent: 5, durationSeconds: 10 }),
      /Duration must stay between/
    )

    // With expert options: the same request goes through to the FC.
    await runtime.runMotorTest(
      { outputChannel: 1, throttlePercent: 5, durationSeconds: 10 },
      { expertMode: true }
    )
    const command = sentMessages.find(
      (message) => message.type === 'COMMAND_LONG' && message.command === MAV_CMD.DO_MOTOR_TEST
    )
    assert.ok(command, 'expert-mode 10s motor test must reach the wire')
    assert.equal(command.params[3], 10, 'duration param carries the expert 10s')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('single motor test translates the MOT number into the frame TEST ORDER on a remapped BF_X quad (conformance fix)', async () => {
  // Conformance fix: ArduCopter matches DO_MOTOR_TEST param1 against the
  // frame's TESTING ORDER (AP_MotorsMatrix _test_order), not the MOT_n
  // number, and ignores the param6 "test order" field entirely. This
  // test previously locked the OLD bytes ([motorNumber, ..., BOARD]) —
  // a mapping the audit + a live SITL run proved spins the wrong motor.
  //
  // Setup: BF_X quad (FRAME_TYPE 12, test-order table [M1:2, M2:1,
  // M3:3, M4:4]) remapped so OUT2 carries Motor 1 (SERVO2_FUNCTION=33).
  // Requesting OUT2 → M1 → BF_X test order 2 on the wire (the old code
  // sent 1, which is M2's slot on BF_X). param6 is DEFAULT(0) — BOARD
  // implied a routing ArduCopter never honored.
  const sentMessages = []
  const runtime = new ArduPilotConfiguratorRuntime(
    createMotorTestAckSession(
      {
        FLTMODE1: 0,
        FRAME_CLASS: 1,
        FRAME_TYPE: 12,
        SERVO1_FUNCTION: 34,
        SERVO2_FUNCTION: 33,
        SERVO3_FUNCTION: 36,
        SERVO4_FUNCTION: 35
      },
      sentMessages
    ),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    await runtime.runMotorTest({
      outputChannel: 2,
      throttlePercent: 5,
      durationSeconds: 1
    })

    const command = sentMessages.find((message) => message.type === 'COMMAND_LONG' && message.command === MAV_CMD.DO_MOTOR_TEST)
    assert.ok(command)
    assert.deepEqual(command.params.slice(0, 6), [2, 0, 5, 1, 1, 0])

    const snapshot = runtime.getSnapshot()
    assert.equal(snapshot.motorTest.status, 'running')
    assert.equal(snapshot.motorTest.selectedOutputChannel, 2)
    assert.equal(snapshot.motorTest.selectedMotorNumber, 1)
    assert.match(snapshot.motorTest.summary, /OUT2 \/ M1/i)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('stopMotorTest aborts an in-flight test with a zero-throttle command and clears the completion timer', async () => {
  const sentMessages = []
  const runtime = new ArduPilotConfiguratorRuntime(
    createMotorTestAckSession(
      { FLTMODE1: 0, FRAME_CLASS: 1, FRAME_TYPE: 12, SERVO1_FUNCTION: 33, SERVO2_FUNCTION: 34, SERVO3_FUNCTION: 35, SERVO4_FUNCTION: 36 },
      sentMessages
    ),
    arducopterMetadata
  )

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    await runtime.runMotorTest({ outputChannel: 1, throttlePercent: 5, durationSeconds: 2 })
    assert.equal(runtime.getSnapshot().motorTest.status, 'running')

    await runtime.stopMotorTest()

    const motorTestCommands = sentMessages.filter(
      (message) => message.type === 'COMMAND_LONG' && message.command === MAV_CMD.DO_MOTOR_TEST
    )
    assert.equal(motorTestCommands.length, 2, 'a second DO_MOTOR_TEST (the abort) was sent')
    assert.equal(motorTestCommands[1].params[2], 0, 'the abort carries zero throttle')

    const stopped = runtime.getSnapshot().motorTest
    assert.equal(stopped.status, 'failed')
    assert.match(stopped.summary, /stopped on request/i)

    // The completion timer must have been cleared: well past the original
    // 2s window the state must NOT flip to 'succeeded'.
    await sleep(2400)
    assert.equal(runtime.getSnapshot().motorTest.status, 'failed', 'no late completion-timer flip after a stop')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('battery current stays sticky across a SYS_STATUS that omits it (-1), instead of flickering to no-telemetry', async () => {
  const messageListeners = []
  const statusListeners = []
  let connected = false
  const emit = (message) =>
    messageListeners.forEach((l) =>
      l({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )
  const sysStatus = (currentBatteryCa, voltageBatteryMv = 16000) => ({
    type: 'SYS_STATUS',
    sensorsPresent: 0,
    sensorsEnabled: 0,
    sensorsHealth: 0,
    load: 100,
    voltageBatteryMv,
    currentBatteryCa,
    batteryRemaining: 80,
    dropRateComm: 0,
    errorsComm: 0,
    errorsCount1: 0,
    errorsCount2: 0,
    errorsCount3: 0,
    errorsCount4: 0,
    sensorsPresentExtended: 0,
    sensorsEnabledExtended: 0,
    sensorsHealthExtended: 0
  })
  const session = {
    getTransportStatus: () => (connected ? { kind: 'connected' } : { kind: 'disconnected' }),
    onStatus(l) {
      statusListeners.push(l)
      return () => {}
    },
    onMessage(l) {
      messageListeners.push(l)
      return () => {}
    },
    async connect() {
      connected = true
      statusListeners.forEach((l) => l({ kind: 'connected' }))
    },
    async disconnect() {
      connected = false
    },
    destroy() {},
    async send() {}
  }
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
    emit(sysStatus(50))
    assert.equal(runtime.getSnapshot().liveVerification.batteryTelemetry.currentA, 0.5)
    // A SYS_STATUS that omits current (-1) while the battery stays verified must
    // keep the last reading, not flicker to "no telemetry".
    emit(sysStatus(-1))
    assert.equal(runtime.getSnapshot().liveVerification.batteryTelemetry.currentA, 0.5, 'sticky across a -1 gap')
    // A genuine loss of battery telemetry (voltage unavailable) still clears it.
    emit(sysStatus(-1, 0xffff))
    assert.equal(runtime.getSnapshot().liveVerification.batteryTelemetry.currentA, undefined, 'cleared when battery telemetry is gone')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('SYS_STATUS surfaces barometer presence/health from the sensor bitmask, EKF-independent', async () => {
  // Regression: the baro indicator was inferred from GLOBAL_POSITION_INT
  // altitude, which ArduPilot only streams once the EKF has a position
  // solution — so a healthy baro on a no-GPS bench read as absent. The
  // SYS_STATUS sensor bitmask is the authoritative, EKF-independent
  // truth and was decoded but discarded (battery only).
  const ABSOLUTE_PRESSURE = 0x8
  const sysStatusSession = (sensorsPresent, sensorsHealth) => {
    const messageListeners = []
    const statusListeners = []
    let connected = false
    const emit = (message) =>
      messageListeners.forEach((l) =>
        l({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
      )
    return {
      getTransportStatus: () => (connected ? { kind: 'connected' } : { kind: 'disconnected' }),
      onStatus(l) {
        statusListeners.push(l)
        return () => {}
      },
      onMessage(l) {
        messageListeners.push(l)
        return () => {}
      },
      async connect() {
        connected = true
        statusListeners.forEach((l) => l({ kind: 'connected' }))
        emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
        emit({
          type: 'SYS_STATUS',
          sensorsPresent,
          sensorsEnabled: sensorsPresent,
          sensorsHealth,
          load: 100,
          voltageBatteryMv: 16000,
          currentBatteryCa: 50,
          batteryRemaining: 80,
          dropRateComm: 0,
          errorsComm: 0,
          errorsCount1: 0,
          errorsCount2: 0,
          errorsCount3: 0,
          errorsCount4: 0,
          sensorsPresentExtended: 0,
          sensorsEnabledExtended: 0,
          sensorsHealthExtended: 0
        })
      },
      async disconnect() {
        connected = false
        statusListeners.forEach((l) => l({ kind: 'disconnected', reason: 'test' }))
      },
      destroy() {},
      async send() {}
    }
  }

  // Present + healthy → verified; battery still derived (no regression).
  const healthy = new ArduPilotConfiguratorRuntime(sysStatusSession(ABSOLUTE_PRESSURE, ABSOLUTE_PRESSURE), arducopterMetadata)
  try {
    await healthy.connect()
    const baro = healthy.getSnapshot().liveVerification.baroSensor
    assert.deepEqual({ present: baro.present, healthy: baro.healthy, verified: baro.verified }, { present: true, healthy: true, verified: true })
    assert.equal(healthy.getSnapshot().liveVerification.batteryTelemetry.verified, true, 'battery still derived from the same SYS_STATUS')
  } finally {
    await healthy.disconnect().catch(() => {})
    healthy.destroy()
  }

  // Present but unhealthy → not verified.
  const unhealthy = new ArduPilotConfiguratorRuntime(sysStatusSession(ABSOLUTE_PRESSURE, 0), arducopterMetadata)
  try {
    await unhealthy.connect()
    const baro = unhealthy.getSnapshot().liveVerification.baroSensor
    assert.deepEqual({ present: baro.present, healthy: baro.healthy, verified: baro.verified }, { present: true, healthy: false, verified: false })
  } finally {
    await unhealthy.disconnect().catch(() => {})
    unhealthy.destroy()
  }

  // No baro bit (FC bound no barometer) → absent, honestly.
  const absent = new ArduPilotConfiguratorRuntime(sysStatusSession(0, 0), arducopterMetadata)
  try {
    await absent.connect()
    const baro = absent.getSnapshot().liveVerification.baroSensor
    assert.deepEqual({ present: baro.present, verified: baro.verified }, { present: false, verified: false })
  } finally {
    await absent.disconnect().catch(() => {})
    absent.destroy()
  }
})

test('SYS_STATUS surfaces gyro/accel presence/health, distinctly, EKF-independent (audit-19)', async () => {
  // audit-19: the gyro AND accel header chips both keyed on
  // attitudeTelemetry.verified (an ATTITUDE/AHRS stream) — EKF/AHRS-
  // gated like baro was, and accel was literally aliased to gyro. The
  // 3D_GYRO (0x1) / 3D_ACCEL (0x2) SYS_STATUS bits are the authoritative,
  // EKF-independent truth and must be surfaced distinctly.
  const GYRO = 0x1
  const ACCEL = 0x2
  const mkSession = (present, health) => {
    const ls = []
    const emit = (m) => ls.forEach((l) => l({ header: { systemId: 1, componentId: 1, sequence: 0 }, message: m, timestampMs: Date.now() }))
    let connected = false
    return {
      getTransportStatus: () => (connected ? { kind: 'connected' } : { kind: 'disconnected' }),
      onStatus: () => () => {},
      onMessage(l) {
        ls.push(l)
        return () => {}
      },
      async connect() {
        connected = true
        emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
        emit({
          type: 'SYS_STATUS', sensorsPresent: present, sensorsEnabled: present, sensorsHealth: health,
          load: 100, voltageBatteryMv: 16000, currentBatteryCa: 50, batteryRemaining: 80,
          dropRateComm: 0, errorsComm: 0, errorsCount1: 0, errorsCount2: 0, errorsCount3: 0, errorsCount4: 0,
          sensorsPresentExtended: 0, sensorsEnabledExtended: 0, sensorsHealthExtended: 0
        })
      },
      async disconnect() {
        connected = false
      },
      destroy() {},
      async send() {}
    }
  }
  const pick = (s) => ({ present: s.present, healthy: s.healthy, verified: s.verified })

  // Both present + healthy → both verified, independently.
  const r1 = new ArduPilotConfiguratorRuntime(mkSession(GYRO | ACCEL, GYRO | ACCEL), arducopterMetadata)
  try {
    await r1.connect()
    const lv = r1.getSnapshot().liveVerification
    assert.deepEqual(pick(lv.gyroSensor), { present: true, healthy: true, verified: true })
    assert.deepEqual(pick(lv.accelSensor), { present: true, healthy: true, verified: true })
  } finally {
    await r1.disconnect().catch(() => {})
    r1.destroy()
  }

  // Gyro present+healthy, accel NOT present → accel must be distinct (off).
  const r2 = new ArduPilotConfiguratorRuntime(mkSession(GYRO, GYRO), arducopterMetadata)
  try {
    await r2.connect()
    const lv = r2.getSnapshot().liveVerification
    assert.deepEqual(pick(lv.gyroSensor), { present: true, healthy: true, verified: true })
    assert.deepEqual(pick(lv.accelSensor), { present: false, healthy: false, verified: false }, 'accel is NOT aliased to gyro')
  } finally {
    await r2.disconnect().catch(() => {})
    r2.destroy()
  }

  // Both present but unhealthy → present, not verified.
  const r3 = new ArduPilotConfiguratorRuntime(mkSession(GYRO | ACCEL, 0), arducopterMetadata)
  try {
    await r3.connect()
    const lv = r3.getSnapshot().liveVerification
    assert.deepEqual(pick(lv.gyroSensor), { present: true, healthy: false, verified: false })
    assert.deepEqual(pick(lv.accelSensor), { present: true, healthy: false, verified: false })
  } finally {
    await r3.disconnect().catch(() => {})
    r3.destroy()
  }
})

test('SYS_STATUS surfaces 3D_MAG presence/health distinctly, EKF-independent (audit-21)', async () => {
  // audit-21: the Mag header chip keyed solely on the param-derived
  // enabled-compass count, so a present+healthy compass on a freshly
  // probed FC could read inactive until params synced. Surface the
  // EKF-independent 3D_MAG (0x4) SYS_STATUS bit distinctly; the chip
  // becomes a strict superset (param-enabled OR this). The compass-cal
  // / Setup gating still keys on the param count and is NOT touched.
  const GYRO = 0x1
  const ACCEL = 0x2
  const MAG = 0x4
  const mkSession = (present, health) => {
    const ls = []
    const emit = (m) => ls.forEach((l) => l({ header: { systemId: 1, componentId: 1, sequence: 0 }, message: m, timestampMs: Date.now() }))
    let connected = false
    return {
      getTransportStatus: () => (connected ? { kind: 'connected' } : { kind: 'disconnected' }),
      onStatus: () => () => {},
      onMessage(l) {
        ls.push(l)
        return () => {}
      },
      async connect() {
        connected = true
        emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
        emit({
          type: 'SYS_STATUS', sensorsPresent: present, sensorsEnabled: present, sensorsHealth: health,
          load: 100, voltageBatteryMv: 16000, currentBatteryCa: 50, batteryRemaining: 80,
          dropRateComm: 0, errorsComm: 0, errorsCount1: 0, errorsCount2: 0, errorsCount3: 0, errorsCount4: 0,
          sensorsPresentExtended: 0, sensorsEnabledExtended: 0, sensorsHealthExtended: 0
        })
      },
      async disconnect() {
        connected = false
      },
      destroy() {},
      async send() {}
    }
  }
  const pick = (s) => ({ present: s.present, healthy: s.healthy, verified: s.verified })

  // Mag present + healthy → verified.
  const r1 = new ArduPilotConfiguratorRuntime(mkSession(MAG, MAG), arducopterMetadata)
  try {
    await r1.connect()
    const lv = r1.getSnapshot().liveVerification
    assert.deepEqual(pick(lv.magSensor), { present: true, healthy: true, verified: true })
  } finally {
    await r1.disconnect().catch(() => {})
    r1.destroy()
  }

  // Gyro+accel present, mag NOT present → mag must be distinct (off),
  // not aliased to the IMU bits.
  const r2 = new ArduPilotConfiguratorRuntime(mkSession(GYRO | ACCEL, GYRO | ACCEL), arducopterMetadata)
  try {
    await r2.connect()
    const lv = r2.getSnapshot().liveVerification
    assert.deepEqual(pick(lv.magSensor), { present: false, healthy: false, verified: false }, 'mag is NOT aliased to gyro/accel')
  } finally {
    await r2.disconnect().catch(() => {})
    r2.destroy()
  }

  // Mag present but unhealthy → present, not verified.
  const r3 = new ArduPilotConfiguratorRuntime(mkSession(MAG, 0), arducopterMetadata)
  try {
    await r3.connect()
    const lv = r3.getSnapshot().liveVerification
    assert.deepEqual(pick(lv.magSensor), { present: true, healthy: false, verified: false })
  } finally {
    await r3.disconnect().catch(() => {})
    r3.destroy()
  }
})

test('SYS_STATUS GPS present is latched for the session (configured does not bounce)', async () => {
  // Regression: with a ublox the "GPS configured" state flickered between
  // configured/not-configured because ArduPilot's SYS_STATUS GPS bit (0x20)
  // can drop out transiently frame-to-frame (driver re-probe, blending, a
  // GPS still negotiating). A configured GPS doesn't come and go, so
  // gpsSensor.present is latched true for the session once seen; `healthy`
  // still tracks the live fix bit each frame.
  const SENSOR_GPS = 0x20
  // Session that emits a sequence of SYS_STATUS (present, health) frames.
  const gpsSequenceSession = (frames) => {
    const messageListeners = []
    const statusListeners = []
    let connected = false
    const emit = (message) =>
      messageListeners.forEach((l) =>
        l({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
      )
    const sysStatus = (present, health) => ({
      type: 'SYS_STATUS',
      sensorsPresent: present,
      sensorsEnabled: present,
      sensorsHealth: health,
      load: 100,
      voltageBatteryMv: 16000,
      currentBatteryCa: 50,
      batteryRemaining: 80,
      dropRateComm: 0,
      errorsComm: 0,
      errorsCount1: 0,
      errorsCount2: 0,
      errorsCount3: 0,
      errorsCount4: 0,
      sensorsPresentExtended: 0,
      sensorsEnabledExtended: 0,
      sensorsHealthExtended: 0
    })
    return {
      getTransportStatus: () => (connected ? { kind: 'connected' } : { kind: 'disconnected' }),
      onStatus(l) { statusListeners.push(l); return () => {} },
      onMessage(l) { messageListeners.push(l); return () => {} },
      async connect() {
        connected = true
        statusListeners.forEach((l) => l({ kind: 'connected' }))
        emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
        for (const [present, health] of frames) emit(sysStatus(present, health))
      },
      async disconnect() { connected = false; statusListeners.forEach((l) => l({ kind: 'disconnected', reason: 'test' })) },
      destroy() {},
      async send() {}
    }
  }

  // Frame 1: GPS present + healthy. Frame 2: GPS bit gone entirely.
  // Latched present must stay true; healthy follows the latest frame.
  const flapping = new ArduPilotConfiguratorRuntime(
    gpsSequenceSession([[SENSOR_GPS, SENSOR_GPS], [0, 0]]),
    arducopterMetadata
  )
  try {
    await flapping.connect()
    const gps = flapping.getSnapshot().liveVerification.gpsSensor
    assert.equal(gps.present, true, 'present must latch true after the GPS bit appeared once')
    assert.equal(gps.healthy, false, 'healthy follows the latest frame (GPS bit gone)')
  } finally {
    await flapping.disconnect().catch(() => {})
    flapping.destroy()
  }

  // Control: a session that never reports GPS present stays not-present.
  const never = new ArduPilotConfiguratorRuntime(
    gpsSequenceSession([[0, 0], [0, 0]]),
    arducopterMetadata
  )
  try {
    await never.connect()
    assert.equal(never.getSnapshot().liveVerification.gpsSensor.present, false, 'no GPS bit ever → not present')
  } finally {
    await never.disconnect().catch(() => {})
    never.destroy()
  }
})

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await sleep(25)
  }

  throw new Error(`Condition did not become true within ${timeoutMs}ms.`)
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs))
}

function createHeartbeatSession(events) {
  const statusListeners = []
  const messageListeners = []
  const timers = new Set()
  const sentMessages = []
  let connected = false

  const emit = ({ systemId, componentId, autopilot, vehicleType, customMode = 0, baseMode = 0, systemStatus = 4 }) => {
    messageListeners.forEach((listener) =>
      listener({
        header: {
          systemId,
          componentId,
          sequence: 0
        },
        message: {
          type: 'HEARTBEAT',
          autopilot,
          vehicleType,
          baseMode,
          customMode,
          systemStatus,
          mavlinkVersion: 3
        },
        timestampMs: Date.now()
      })
    )
  }

  return {
    sentMessages,
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
      events.forEach((event) => {
        const timer = setTimeout(() => {
          timers.delete(timer)
          if (!connected) {
            return
          }
          emit(event)
        }, event.atMs)
        timers.add(timer)
      })
    },
    async disconnect() {
      connected = false
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    },
    async send(message) {
      sentMessages.push(message)
    }
  }
}

function createEchoSession(initialParameters, shouldDropWrite, shouldThrowSend = () => false, onSend = () => {}) {
  const statusListeners = []
  const messageListeners = []
  const parameters = { ...initialParameters }
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
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      onSend(message)

      if (shouldThrowSend(message)) {
        throw new Error('simulated send failure')
      }

      if (message.type === 'PARAM_REQUEST_LIST') {
        Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
          emit({
            type: 'PARAM_VALUE',
            paramId,
            paramValue,
            paramType: 9,
            paramCount: entries.length,
            paramIndex: index
          })
        })
        return
      }

      if (message.type === 'PARAM_SET') {
        if (shouldDropWrite({ paramId: message.paramId, paramValue: message.paramValue })) {
          return
        }

        parameters[message.paramId] = message.paramValue
        emit({
          type: 'PARAM_VALUE',
          paramId: message.paramId,
          paramValue: message.paramValue,
          paramType: 9,
          paramCount: Object.keys(parameters).length,
          paramIndex: Object.keys(parameters).indexOf(message.paramId)
        })
      }
    }
  }
}

function createMotorTestAckSession(initialParameters, sentMessages = []) {
  const statusListeners = []
  const messageListeners = []
  const parameters = { ...initialParameters }
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
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      sentMessages.push(message)

      if (message.type === 'PARAM_REQUEST_LIST') {
        Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
          emit({
            type: 'PARAM_VALUE',
            paramId,
            paramValue,
            paramType: 9,
            paramCount: entries.length,
            paramIndex: index
          })
        })
        return
      }

      if (message.type === 'COMMAND_LONG' && message.command === MAV_CMD.DO_MOTOR_TEST) {
        emit({
          type: 'COMMAND_ACK',
          command: MAV_CMD.DO_MOTOR_TEST,
          result: MAV_RESULT.ACCEPTED,
          progress: 0,
          resultParam2: 0,
          targetSystem: 1,
          targetComponent: 1
        })
      }
    }
  }
}

function createStalledParamSession(initialParameters, sentMessages) {
  const statusListeners = []
  const messageListeners = []
  const parameters = { ...initialParameters }
  let connected = false
  let parameterRequestCount = 0

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
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      sentMessages.push(message)

      if (message.type !== 'PARAM_REQUEST_LIST') {
        return
      }

      parameterRequestCount += 1
      const entries = Object.entries(parameters)
      const visibleEntries =
        parameterRequestCount === 1
          ? entries.slice(0, Math.max(entries.length - 1, 1))
          : entries

      visibleEntries.forEach(([paramId, paramValue]) => {
        emit({
          type: 'PARAM_VALUE',
          paramId,
          paramValue,
          paramType: 9,
          paramCount: entries.length,
          paramIndex: entries.findIndex(([candidateParamId]) => candidateParamId === paramId)
        })
      })
    }
  }
}

function createGuidedActionStatusSession(statusText) {
  const statusListeners = []
  const messageListeners = []
  const parameters = {
    FRAME_CLASS: 1,
    FRAME_TYPE: 1,
    AHRS_ORIENTATION: 0,
    FLTMODE1: 0
  }
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
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      if (message.type === 'PARAM_REQUEST_LIST') {
        Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
          emit({
            type: 'PARAM_VALUE',
            paramId,
            paramValue,
            paramType: 9,
            paramCount: entries.length,
            paramIndex: index
          })
        })
        return
      }

      if (message.type === 'COMMAND_LONG' && message.command === MAV_CMD.PREFLIGHT_CALIBRATION) {
        emit({
          type: 'COMMAND_ACK',
          command: MAV_CMD.PREFLIGHT_CALIBRATION,
          result: MAV_RESULT.ACCEPTED,
          progress: 0,
          resultParam2: 0,
          targetSystem: 255,
          targetComponent: 190
        })
        emit({
          type: 'STATUSTEXT',
          severity: 6,
          text: 'Accelerometer calibration started.',
          statusId: 0,
          chunkSequence: 0
        })
        setTimeout(() => {
          emit({
            type: 'STATUSTEXT',
            severity: 6,
            text: statusText,
            statusId: 0,
            chunkSequence: 0
          })
        }, 10)
      }
    }
  }
}

function createCompasslessCalibrationSession() {
  const statusListeners = []
  const messageListeners = []
  const parameters = {
    FRAME_CLASS: 1,
    FRAME_TYPE: 1,
    AHRS_ORIENTATION: 0,
    FLTMODE1: 0,
    GPS_TYPE: 0,
    GPS_TYPE2: 0,
    COMPASS_USE: 0,
    COMPASS_USE2: 0,
    COMPASS_USE3: 0
  }
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
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      if (message.type === 'PARAM_REQUEST_LIST') {
        Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
          emit({
            type: 'PARAM_VALUE',
            paramId,
            paramValue,
            paramType: 9,
            paramCount: entries.length,
            paramIndex: index
          })
        })
        return
      }

      if (message.type === 'COMMAND_LONG' && message.command === MAV_CMD.DO_START_MAG_CAL) {
        emit({
          type: 'COMMAND_ACK',
          command: MAV_CMD.DO_START_MAG_CAL,
          result: MAV_RESULT.ACCEPTED,
          progress: 0,
          resultParam2: 0,
          targetSystem: 255,
          targetComponent: 190
        })
      }
    }
  }
}

function createSilentCompassCalibrationSession() {
  const statusListeners = []
  const messageListeners = []
  const parameters = {
    FRAME_CLASS: 1,
    FRAME_TYPE: 1,
    AHRS_ORIENTATION: 0,
    FLTMODE1: 0,
    GPS_TYPE: 0,
    GPS_TYPE2: 0,
    COMPASS_USE: 1,
    COMPASS_USE2: 0,
    COMPASS_USE3: 0
  }
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
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      if (message.type === 'PARAM_REQUEST_LIST') {
        Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
          emit({
            type: 'PARAM_VALUE',
            paramId,
            paramValue,
            paramType: 9,
            paramCount: entries.length,
            paramIndex: index
          })
        })
        return
      }

      if (message.type === 'COMMAND_LONG' && message.command === MAV_CMD.DO_START_MAG_CAL) {
        emit({
          type: 'COMMAND_ACK',
          command: MAV_CMD.DO_START_MAG_CAL,
          result: MAV_RESULT.ACCEPTED,
          progress: 0,
          resultParam2: 0,
          targetSystem: 255,
          targetComponent: 190
        })
      }
    }
  }
}

function createAccelerometerHandshakeSession() {
  const statusListeners = []
  const messageListeners = []
  const sentMessages = []
  const parameters = {
    FRAME_CLASS: 1,
    FRAME_TYPE: 1,
    AHRS_ORIENTATION: 0,
    FLTMODE1: 0
  }
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
    sentMessages,
    session: {
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
      },
      async disconnect() {
        connected = false
        statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
      },
      destroy() {},
      async send(message) {
        sentMessages.push(message)

        if (message.type === 'PARAM_REQUEST_LIST') {
          Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
            emit({
              type: 'PARAM_VALUE',
              paramId,
              paramValue,
              paramType: 9,
              paramCount: entries.length,
              paramIndex: index
            })
          })
          return
        }

        if (message.type === 'COMMAND_LONG' && message.command === MAV_CMD.PREFLIGHT_CALIBRATION) {
          emit({
            type: 'COMMAND_ACK',
            command: MAV_CMD.PREFLIGHT_CALIBRATION,
            result: MAV_RESULT.ACCEPTED,
            progress: 0,
            resultParam2: 0,
            targetSystem: 255,
            targetComponent: 190
          })
          setTimeout(() => {
            emit({
              type: 'COMMAND_LONG',
              command: MAV_CMD.ACCELCAL_VEHICLE_POS,
              targetSystem: 0,
              targetComponent: 0,
              confirmation: 0,
              params: [1, 0, 0, 0, 0, 0, 0]
            })
          }, 10)
          return
        }

        if (message.type === 'COMMAND_ACK' && message.command === 0 && message.result === MAV_RESULT.TEMPORARILY_REJECTED) {
          setTimeout(() => {
            emit({
              type: 'STATUSTEXT',
              severity: 6,
              text: 'Accelerometer calibration complete.',
              statusId: 0,
              chunkSequence: 0
            })
          }, 10)
        }
      }
    }
  }
}

function createFailedAccelerometerHandshakeSession() {
  const statusListeners = []
  const messageListeners = []
  const parameters = {
    FRAME_CLASS: 1,
    FRAME_TYPE: 1,
    AHRS_ORIENTATION: 0,
    FLTMODE1: 0
  }
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
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      if (message.type === 'PARAM_REQUEST_LIST') {
        Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
          emit({
            type: 'PARAM_VALUE',
            paramId,
            paramValue,
            paramType: 9,
            paramCount: entries.length,
            paramIndex: index
          })
        })
        return
      }

      if (message.type === 'COMMAND_LONG' && message.command === MAV_CMD.PREFLIGHT_CALIBRATION) {
        emit({
          type: 'COMMAND_ACK',
          command: MAV_CMD.PREFLIGHT_CALIBRATION,
          result: MAV_RESULT.ACCEPTED,
          progress: 0,
          resultParam2: 0,
          targetSystem: 255,
          targetComponent: 190
        })
        return
      }

      if (message.type === 'COMMAND_ACK' && message.command === 0 && message.result === MAV_RESULT.TEMPORARILY_REJECTED) {
        setTimeout(() => {
          emit({
            type: 'COMMAND_LONG',
            command: MAV_CMD.ACCELCAL_VEHICLE_POS,
            targetSystem: 0,
            targetComponent: 0,
            confirmation: 0,
            params: [16777216, 0, 0, 0, 0, 0, 0]
          })
        }, 10)
      }
    }
  }
}

function createAccelerometerPromptlessHandshakeSession() {
  const statusListeners = []
  const messageListeners = []
  const parameters = {
    FRAME_CLASS: 1,
    FRAME_TYPE: 1,
    AHRS_ORIENTATION: 0,
    FLTMODE1: 0
  }
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
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      if (message.type === 'PARAM_REQUEST_LIST') {
        Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
          emit({
            type: 'PARAM_VALUE',
            paramId,
            paramValue,
            paramType: 9,
            paramCount: entries.length,
            paramIndex: index
          })
        })
        return
      }

      if (message.type === 'COMMAND_LONG' && message.command === MAV_CMD.PREFLIGHT_CALIBRATION) {
        emit({
          type: 'COMMAND_ACK',
          command: MAV_CMD.PREFLIGHT_CALIBRATION,
          result: MAV_RESULT.ACCEPTED,
          progress: 0,
          resultParam2: 0,
          targetSystem: 255,
          targetComponent: 190
        })
      }
    }
  }
}

// Real-FC behavior reproduced from a live BrainFPV probe: on PREFLIGHT_CALIBRATION
// param5=2 (level/trim cal) the autopilot emits a STATUSTEXT explaining the
// refusal ("trim over maximum of 10 degrees") together with a result=FAILED
// COMMAND_ACK. The runtime must surface that STATUSTEXT in the rejection error
// so the operator sees the actual cause instead of just "(Failed)".
function createLevelCalRejectionWithStatusTextSession() {
  const statusListeners = []
  const messageListeners = []
  const parameters = { FRAME_CLASS: 1, FRAME_TYPE: 1, AHRS_ORIENTATION: 0 }
  let connected = false

  const emit = (message) => {
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
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
      emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      if (message.type === 'PARAM_REQUEST_LIST') {
        Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
          emit({
            type: 'PARAM_VALUE',
            paramId,
            paramValue,
            paramType: 9,
            paramCount: entries.length,
            paramIndex: index
          })
        })
        return
      }

      if (message.type === 'COMMAND_LONG' && message.command === MAV_CMD.PREFLIGHT_CALIBRATION) {
        // Mirror the real-FC interleaving from the BrainFPV probe: STATUSTEXT
        // first (severity=6 = info), then the FAILED ACK a tick later. Both
        // arrive inside the ~2s window the runtime correlates against.
        setTimeout(() => {
          emit({ type: 'STATUSTEXT', severity: 6, text: 'trim over maximum of 10 degrees' })
        }, 5)
        setTimeout(() => {
          emit({
            type: 'COMMAND_ACK',
            command: MAV_CMD.PREFLIGHT_CALIBRATION,
            result: MAV_RESULT.FAILED,
            progress: 0,
            resultParam2: 0,
            targetSystem: 255,
            targetComponent: 190
          })
        }, 20)
      }
    }
  }
}

// Modern firmware (ArduPilot 4.5+) reports per-instance GPS params (GPS1_TYPE,
// GPS1_RATE_MS, GPS1_GNSS_MODE, GPS2_TYPE) instead of the legacy unsuffixed
// names the curated catalog still references. The runtime mirrors the value
// under the legacy id so existing curated UI code keeps working, and routes
// writes against the legacy id to the modern name on the wire.
function createModernGpsParamSession() {
  const statusListeners = []
  const messageListeners = []
  const parameters = {
    GPS1_TYPE: 1,
    GPS2_TYPE: 0,
    GPS1_RATE_MS: 200,
    GPS1_GNSS_MODE: 0,
    FRAME_CLASS: 1,
    FRAME_TYPE: 1,
    FLTMODE1: 0
  }
  const sentMessages = []
  let connected = false

  const emit = (message) => {
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )
  }

  return {
    sentMessages,
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
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      sentMessages.push(message)
      if (message.type === 'PARAM_REQUEST_LIST') {
        Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
          emit({
            type: 'PARAM_VALUE',
            paramId,
            paramValue,
            paramType: 9,
            paramCount: entries.length,
            paramIndex: index
          })
        })
        return
      }
      if (message.type === 'PARAM_SET') {
        parameters[message.paramId] = message.paramValue
        const entries = Object.entries(parameters)
        const index = entries.findIndex(([id]) => id === message.paramId)
        emit({
          type: 'PARAM_VALUE',
          paramId: message.paramId,
          paramValue: message.paramValue,
          paramType: 9,
          paramCount: entries.length,
          paramIndex: index
        })
      }
    }
  }
}

function createPlaneAirspeedRenameSession() {
  const statusListeners = []
  const messageListeners = []
  const parameters = {
    AIRSPEED_MIN: 12,
    AIRSPEED_MAX: 22,
    FLTMODE1: 0
  }
  let connected = false
  const emit = (message) => {
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )
  }
  return {
    getTransportStatus() { return connected ? { kind: 'connected' } : { kind: 'disconnected' } },
    onStatus(listener) { statusListeners.push(listener); return () => {} },
    onMessage(listener) { messageListeners.push(listener); return () => {} },
    async connect() {
      connected = true
      statusListeners.forEach((listener) => listener({ kind: 'connected' }))
      emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 1, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      if (message.type === 'PARAM_REQUEST_LIST') {
        Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
          emit({ type: 'PARAM_VALUE', paramId, paramValue, paramType: 9, paramCount: entries.length, paramIndex: index })
        })
      }
    }
  }
}

test('modern ArduPlane firmware: Q_A_RATE_RLL/PIT/YAW_MAX reads via legacy ids resolve to Q_A_RATE_R/P/Y_MAX', async () => {
  // ArduPlane 4.5+ shortened the QuadPlane attitude rate-limit names
  // (RLL/PIT/YAW -> R/P/Y). Same unit (deg/s) and same bounds, so the
  // alias shim mirrors raw values. (ACCEL -> ACC is intentionally NOT
  // aliased — that rename also changed cd/s² -> deg/s².)
  const session = createPlaneRateLimitRenameSession()
  const runtime = new ArduPilotConfiguratorRuntime(session, arduplaneMetadata)
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })
    const snapshot = runtime.getSnapshot()
    const byId = new Map(snapshot.parameters.map((p) => [p.id, p]))
    // FC streams the modern names; legacy reads resolve to the same values.
    assert.equal(byId.get('Q_A_RATE_R_MAX')?.value, 220)
    assert.equal(byId.get('Q_A_RATE_RLL_MAX')?.value, 220)
    assert.equal(byId.get('Q_A_RATE_P_MAX')?.value, 200)
    assert.equal(byId.get('Q_A_RATE_PIT_MAX')?.value, 200)
    assert.equal(byId.get('Q_A_RATE_Y_MAX')?.value, 100)
    assert.equal(byId.get('Q_A_RATE_YAW_MAX')?.value, 100)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

function createPlaneRateLimitRenameSession() {
  const statusListeners = []
  const messageListeners = []
  const parameters = {
    Q_A_RATE_R_MAX: 220,
    Q_A_RATE_P_MAX: 200,
    Q_A_RATE_Y_MAX: 100,
    FLTMODE1: 0
  }
  let connected = false
  const emit = (message) => {
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )
  }
  return {
    getTransportStatus() { return connected ? { kind: 'connected' } : { kind: 'disconnected' } },
    onStatus(listener) { statusListeners.push(listener); return () => {} },
    onMessage(listener) { messageListeners.push(listener); return () => {} },
    async connect() {
      connected = true
      statusListeners.forEach((listener) => listener({ kind: 'connected' }))
      emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 1, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      if (message.type === 'PARAM_REQUEST_LIST') {
        Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
          emit({ type: 'PARAM_VALUE', paramId, paramValue, paramType: 9, paramCount: entries.length, paramIndex: index })
        })
      }
    }
  }
}

test('modern ArduPlane firmware: ARSPD_FBW_MIN/MAX reads via legacy id resolve to AIRSPEED_MIN/MAX', async () => {
  // Mirror of the GPS test. ArduPlane renamed the airspeed bounds in 4.5+:
  // ARSPD_FBW_MIN -> AIRSPEED_MIN, ARSPD_FBW_MAX -> AIRSPEED_MAX. Same units
  // (m/s) on both names so the runtime alias shim mirrors the value under
  // the legacy id, keeping the curated UI working without per-callsite
  // changes. (TRIM_ARSPD_CM -> AIRSPEED_CRUISE is intentionally NOT aliased
  // because the unit also changed cm/s -> m/s; the catalog carries both
  // entries so the user can edit whichever the FC reports.)
  const runtime = new ArduPilotConfiguratorRuntime(createPlaneAirspeedRenameSession(), arduplaneMetadata)
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })
    const snapshot = runtime.getSnapshot()
    const byId = new Map(snapshot.parameters.map((p) => [p.id, p]))
    assert.equal(byId.get('AIRSPEED_MIN')?.value, 12)
    assert.equal(byId.get('ARSPD_FBW_MIN')?.value, 12)
    assert.equal(byId.get('AIRSPEED_MAX')?.value, 22)
    assert.equal(byId.get('ARSPD_FBW_MAX')?.value, 22)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('modern ArduCopter firmware: SYSID_THISMAV / SYSID_MYGCS / MODE_CH reads via legacy id resolve to MAV_SYSID / MAV_GCS_SYSID / FLTMODE_CH', async () => {
  // ArduCopter 4.5+ renamed the MAVLink identifiers and flight-mode channel
  // param. Same range and no unit change, so the alias shim mirrors raw
  // values. UI code that hard-codes the legacy names keeps working on
  // modern firmware via this shim.
  const session = createCopterIdentifierRenameSession()
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })
    const snapshot = runtime.getSnapshot()
    const byId = new Map(snapshot.parameters.map((p) => [p.id, p]))
    assert.equal(byId.get('MAV_SYSID')?.value, 7)
    assert.equal(byId.get('SYSID_THISMAV')?.value, 7)
    assert.equal(byId.get('MAV_GCS_SYSID')?.value, 42)
    assert.equal(byId.get('SYSID_MYGCS')?.value, 42)
    assert.equal(byId.get('FLTMODE_CH')?.value, 5)
    assert.equal(byId.get('MODE_CH')?.value, 5)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

function createCopterIdentifierRenameSession() {
  const statusListeners = []
  const messageListeners = []
  const parameters = {
    MAV_SYSID: 7,
    MAV_GCS_SYSID: 42,
    FLTMODE_CH: 5
  }
  let connected = false
  const emit = (message) => {
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )
  }
  return {
    getTransportStatus() { return connected ? { kind: 'connected' } : { kind: 'disconnected' } },
    onStatus(listener) { statusListeners.push(listener); return () => {} },
    onMessage(listener) { messageListeners.push(listener); return () => {} },
    async connect() {
      connected = true
      statusListeners.forEach((listener) => listener({ kind: 'connected' }))
      // Copter heartbeat: MAV_TYPE_QUADROTOR = 2.
      emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      if (message.type === 'PARAM_REQUEST_LIST') {
        Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
          emit({ type: 'PARAM_VALUE', paramId, paramValue, paramType: 9, paramCount: entries.length, paramIndex: index })
        })
      }
    }
  }
}

test('stable ArduCopter firmware: SYSID_THISMAV reads also resolve via MAV_SYSID (alias mirrors LEGACY -> MASTER too)', async () => {
  // Live-FC verification on a Radix 2 HD running 4.6.3 (2026-05-27) found
  // the alias mirror was unidirectional (MODERN -> LEGACY only): when the
  // FC streams the legacy name (which stable Copter still does for SYSID),
  // the master-name slot stayed empty. Forward-compat code referencing
  // MAV_SYSID then failed silently on stable. The fix mirrors in both
  // directions so lookups via either id resolve regardless of which name
  // the FC streamed.
  const session = createStableCopterIdentifierSession()
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })
    const snapshot = runtime.getSnapshot()
    const byId = new Map(snapshot.parameters.map((p) => [p.id, p]))
    // FC streamed only the legacy names (stable-firmware pattern); the
    // bidirectional mirror surfaces them under the master ids too.
    assert.equal(byId.get('SYSID_THISMAV')?.value, 7)
    assert.equal(byId.get('MAV_SYSID')?.value, 7)
    assert.equal(byId.get('SYSID_MYGCS')?.value, 42)
    assert.equal(byId.get('MAV_GCS_SYSID')?.value, 42)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('createParameterBackup excludes alias-mirror entries (no duplicate writes on restore)', async () => {
  // Live-FC observation (Radix 2 HD, 2026-05-27): the bidirectional alias
  // mirror added in #452 surfaces aliased pairs under BOTH names in the
  // snapshot so byId lookups via either name resolve. The mirror copies
  // carry `aliasedFrom`; parameter-backup serialization must filter them
  // out so the backup file doesn't double-write the same value under two
  // names. A naive backup of a stable-Copter session would serialize
  // SYSID_THISMAV AND MAV_SYSID with the same value — twice the bytes
  // per aliased pair, twice the writes on restore.
  const session = createStableCopterIdentifierSession()
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })
    const snapshot = runtime.getSnapshot()
    // Both names present in the snapshot (alias mirror working):
    const byId = new Map(snapshot.parameters.map((p) => [p.id, p]))
    assert.equal(byId.get('SYSID_THISMAV')?.value, 7)
    assert.equal(byId.get('MAV_SYSID')?.value, 7)
    assert.equal(byId.get('MAV_SYSID')?.aliasedFrom, 'SYSID_THISMAV', 'mirror entry flagged')
    assert.equal(byId.get('SYSID_THISMAV')?.aliasedFrom, undefined, 'real arrival not flagged')
    // Backup excludes the mirror:
    const backup = createParameterBackup(snapshot)
    const backupIds = backup.parameters.map((p) => p.id)
    assert.ok(backupIds.includes('SYSID_THISMAV'), 'real arrival in backup')
    assert.ok(!backupIds.includes('MAV_SYSID'), 'alias mirror NOT in backup')
    assert.ok(backupIds.includes('SYSID_MYGCS'), 'real arrival in backup')
    assert.ok(!backupIds.includes('MAV_GCS_SYSID'), 'alias mirror NOT in backup')
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

function createStableCopterIdentifierSession() {
  const statusListeners = []
  const messageListeners = []
  // FC streams the LEGACY names only (matches real Copter 4.6.3 wire pattern).
  const parameters = {
    SYSID_THISMAV: 7,
    SYSID_MYGCS: 42
  }
  const sentMessages = []
  let connected = false
  const emit = (message) => {
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )
  }
  return {
    sentMessages,
    getTransportStatus() { return connected ? { kind: 'connected' } : { kind: 'disconnected' } },
    onStatus(listener) { statusListeners.push(listener); return () => {} },
    onMessage(listener) { messageListeners.push(listener); return () => {} },
    async connect() {
      connected = true
      statusListeners.forEach((listener) => listener({ kind: 'connected' }))
      emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      sentMessages.push(message)
      if (message.type === 'PARAM_REQUEST_LIST') {
        Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
          emit({ type: 'PARAM_VALUE', paramId, paramValue, paramType: 9, paramCount: entries.length, paramIndex: index })
        })
        return
      }
      if (message.type === 'PARAM_SET') {
        // Echo back so the verify waiter resolves — matches the modern
        // GPS session factory. Only echo for params we actually expose;
        // a stable FC would silently drop a PARAM_SET for a name it does
        // not recognize (this is exactly the failure mode audit-39
        // surfaces — pre-fix, the misrouted PARAM_SET MAV_SYSID would
        // arrive here and be ignored, then the waiter would time out).
        if (Object.prototype.hasOwnProperty.call(parameters, message.paramId)) {
          parameters[message.paramId] = message.paramValue
          const entries = Object.entries(parameters)
          const index = entries.findIndex(([id]) => id === message.paramId)
          emit({
            type: 'PARAM_VALUE',
            paramId: message.paramId,
            paramValue: message.paramValue,
            paramType: 9,
            paramCount: entries.length,
            paramIndex: index
          })
        }
      }
    }
  }
}

test('modern ArduRover firmware: TURN_MAX_G reads via legacy id resolve to ATC_TURN_MAX_G', async () => {
  // Rover 4.3 rehomed the cornering-limit param under AR_AttitudeControl
  // (TURN_MAX_G -> ATC_TURN_MAX_G). Same unit (g) and same range, so the
  // alias shim mirrors raw values. Sibling NAVL1_* / WP_OVERSHOOT are NOT
  // aliased — those have no modern replacement (s-curve planner uses
  // WP_ACCEL/WP_JERK instead) so there is nothing to mirror them to.
  const session = createRoverTurnMaxGRenameSession()
  const runtime = new ArduPilotConfiguratorRuntime(session, arduroverMetadata)
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })
    const snapshot = runtime.getSnapshot()
    const byId = new Map(snapshot.parameters.map((p) => [p.id, p]))
    // FC streams the modern name; legacy read resolves to the same value.
    assert.equal(byId.get('ATC_TURN_MAX_G')?.value, 0.6)
    assert.equal(byId.get('TURN_MAX_G')?.value, 0.6)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

function createRoverTurnMaxGRenameSession() {
  const statusListeners = []
  const messageListeners = []
  const parameters = {
    ATC_TURN_MAX_G: 0.6,
    FLTMODE1: 0
  }
  let connected = false
  const emit = (message) => {
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )
  }
  return {
    getTransportStatus() { return connected ? { kind: 'connected' } : { kind: 'disconnected' } },
    onStatus(listener) { statusListeners.push(listener); return () => {} },
    onMessage(listener) { messageListeners.push(listener); return () => {} },
    async connect() {
      connected = true
      statusListeners.forEach((listener) => listener({ kind: 'connected' }))
      // Rover heartbeat: MAV_TYPE_GROUND_ROVER = 10.
      emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 10, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      if (message.type === 'PARAM_REQUEST_LIST') {
        Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
          emit({ type: 'PARAM_VALUE', paramId, paramValue, paramType: 9, paramCount: entries.length, paramIndex: index })
        })
      }
    }
  }
}

test('modern firmware GPS param rename: reads via legacy id resolve to the per-instance value', async () => {
  const session = createModernGpsParamSession()
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    const snapshot = runtime.getSnapshot()
    const byId = new Map(snapshot.parameters.map((p) => [p.id, p]))
    // The FC reported GPS1_TYPE; the runtime mirrors it under GPS_TYPE so the
    // curated UI's `selectParameterById(snapshot, 'GPS_TYPE')` continues to
    // find the value.
    assert.equal(byId.get('GPS1_TYPE')?.value, 1)
    assert.equal(byId.get('GPS_TYPE')?.value, 1)
    assert.equal(byId.get('GPS_TYPE2')?.value, 0)
    assert.equal(byId.get('GPS_RATE_MS')?.value, 200)
    assert.equal(byId.get('GPS_GNSS_MODE')?.value, 0)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('modern firmware GPS param rename: writes via legacy id forward to the per-instance name on the wire', async () => {
  const session = createModernGpsParamSession()
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    // Caller still uses the legacy id; the runtime translates the on-wire
    // paramId to GPS1_TYPE since that's what the FC actually exposes.
    await runtime.setParameter('GPS_TYPE', 2)

    const sentSet = session.sentMessages.find((m) => m.type === 'PARAM_SET')
    assert.ok(sentSet, 'PARAM_SET was sent')
    assert.equal(sentSet.paramId, 'GPS1_TYPE', 'wire paramId routed to the modern name')
    assert.equal(sentSet.paramValue, 2)
    const snapshot = runtime.getSnapshot()
    const byId = new Map(snapshot.parameters.map((p) => [p.id, p]))
    assert.equal(byId.get('GPS1_TYPE')?.value, 2)
    assert.equal(byId.get('GPS_TYPE')?.value, 2)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('audit-39: stable firmware setParameter via legacy id stays on the legacy name (not misrouted to the alias mirror)', async () => {
  // Regression for audit-39: setParameter detected "FC streamed the modern
  // name" by checking `parameters.has(modernAlias)`. After the bidirectional
  // alias mirror landed (createParameterBackup test above documents it),
  // `parameters.has(modernAlias)` returned true for ANY aliased pair the FC
  // streamed — including stable firmware that only ever sent the legacy id.
  // The write was then sent under the modern name the stable FC silently
  // drops, and the verify waiter timed out.
  //
  // The fix swaps the detection to `realParameterIdsReceived.has`, the
  // alias-free set the param-sync completion gate already uses. This test
  // exercises the stable-firmware shape (FC streamed SYSID_THISMAV only)
  // and asserts the PARAM_SET goes out under SYSID_THISMAV, not MAV_SYSID.
  const session = createStableCopterIdentifierSession()
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    // Both ids visible in the snapshot due to the bidirectional mirror, but
    // only SYSID_THISMAV is the real FC arrival — MAV_SYSID is the mirror.
    const preSnapshot = runtime.getSnapshot()
    const preById = new Map(preSnapshot.parameters.map((p) => [p.id, p]))
    assert.equal(preById.get('SYSID_THISMAV')?.value, 7)
    assert.equal(preById.get('MAV_SYSID')?.aliasedFrom, 'SYSID_THISMAV')

    await runtime.setParameter('SYSID_THISMAV', 99)

    const sentSet = session.sentMessages.find((m) => m.type === 'PARAM_SET')
    assert.ok(sentSet, 'PARAM_SET was sent')
    assert.equal(
      sentSet.paramId,
      'SYSID_THISMAV',
      'wire paramId stays on the legacy name (the only name a stable FC will recognize)'
    )
    assert.equal(sentSet.paramValue, 99)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('audit-40: parameter-sync stall-retry fires even when alias mirrors inflate parameters.size past totalParameters', async () => {
  // Regression for audit-40: retryParameterSync()'s early-exit gate used
  // `this.parameters.size` (mirror-inflated) against `this.totalParameters`
  // (the FC-reported paramCount, ALIAS-FREE). On a real catalog where N of
  // the streamed params have aliases, parameters.size exceeds
  // totalParameters once realParameterIdsReceived.size reaches total - N
  // — so a stall in the LAST N real arrivals silently skipped the retry.
  // The completion gate at runtime.ts line 1486-1489 already uses
  // realParameterIdsReceived.size for exactly this reason; this fix makes
  // the retry gate consistent.
  //
  // Test shape: a session that reports paramCount = 3 and streams only 2
  // of them. One of the streamed ids has an alias (SYSID_THISMAV ->
  // MAV_SYSID), so the bidirectional mirror makes parameters.size = 3
  // even though realParameterIdsReceived.size = 2. Pre-fix the retry
  // gate sees parameters.size (3) >= totalParameters (3) and returns
  // without re-issuing PARAM_REQUEST_LIST. Post-fix the gate sees
  // realParameterIdsReceived.size (2) < totalParameters (3) and the
  // retry fires.
  const session = createStallingAliasParamSession()
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {
    parameterSyncStallRetryMs: 30
  })

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })

    // Wait long enough for the stall-retry timer (30ms) to fire + the
    // retry to schedule a second PARAM_REQUEST_LIST.
    await new Promise((resolve) => setTimeout(resolve, 120))

    const requestLists = session.sentMessages.filter((m) => m.type === 'PARAM_REQUEST_LIST')
    assert.ok(
      requestLists.length >= 2,
      `expected the stall-retry to send a second PARAM_REQUEST_LIST, got ${requestLists.length}`
    )

    // And the user-facing "stalled at X/Y" status entry should report
    // the alias-free count, not the inflated parameters.size — matches
    // the getSnapshot() parameterSync.downloaded value.
    const snapshot = runtime.getSnapshot()
    const stallEntry = snapshot.statusTexts.find((e) =>
      e.text.includes('Parameter stream stalled at')
    )
    assert.ok(stallEntry, 'a stall status entry was appended')
    assert.match(
      stallEntry.text,
      /Parameter stream stalled at 2\/3/,
      `stall label should report realParameterIdsReceived.size (2) / total (3), got: ${stallEntry.text}`
    )
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

function createStallingAliasParamSession() {
  const statusListeners = []
  const messageListeners = []
  const sentMessages = []
  let connected = false

  // FC reports paramCount = 3 but we stream only 2 real arrivals.
  // SYSID_THISMAV is in LEGACY_PARAM_ALIASES (-> MAV_SYSID), so the
  // bidirectional mirror in processParamValue populates MAV_SYSID
  // too. After the burst: parameters.size = 3, but
  // realParameterIdsReceived.size = 2 and totalParameters = 3.
  const REAL_TOTAL = 3
  const REAL_STREAMED = [
    ['SYSID_THISMAV', 7],
    ['SYSID_MYGCS', 42]
  ]

  const emit = (message) => {
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )
  }

  return {
    sentMessages,
    getTransportStatus() { return connected ? { kind: 'connected' } : { kind: 'disconnected' } },
    onStatus(listener) { statusListeners.push(listener); return () => {} },
    onMessage(listener) { messageListeners.push(listener); return () => {} },
    async connect() {
      connected = true
      statusListeners.forEach((listener) => listener({ kind: 'connected' }))
      emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      sentMessages.push(message)
      if (message.type === 'PARAM_REQUEST_LIST') {
        // Stream the partial set only on the FIRST request. Retries
        // leave the stream stalled — we just want to observe the retry
        // path firing.
        if (sentMessages.filter((m) => m.type === 'PARAM_REQUEST_LIST').length === 1) {
          REAL_STREAMED.forEach(([paramId, paramValue], index) => {
            emit({
              type: 'PARAM_VALUE',
              paramId,
              paramValue,
              paramType: 9,
              paramCount: REAL_TOTAL,
              paramIndex: index
            })
          })
        }
      }
    }
  }
}

test('level calibration rejection surfaces the autopilot STATUSTEXT reason verbatim', async () => {
  // Regression for real-FC report: level cal failed with a bare "(Failed)"
  // when the actual cause from the firmware was "trim over maximum of 10
  // degrees" — see commit message in fix/cal-statustext-reason for the probe
  // log. The runtime now surfaces STATUSTEXTs received within ~2s of a
  // rejected COMMAND_ACK as the rejection reason.
  const runtime = new ArduPilotConfiguratorRuntime(createLevelCalRejectionWithStatusTextSession(), arducopterMetadata)

  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })

    await assert.rejects(
      () => runtime.sendCommand(MAV_CMD.PREFLIGHT_CALIBRATION, [0, 0, 0, 0, 2, 0, 0], { waitForAck: true, ackTimeoutMs: 1000 }),
      (error) => {
        assert.match(error.message, /Autopilot rejected/i)
        assert.match(error.message, /Failed/i)
        assert.match(error.message, /trim over maximum of 10 degrees/)
        return true
      }
    )
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

// "RCOut: PWM:1-N" boot-banner parser — the only on-wire signal for how many
// physical PWM outputs a board exposes. ArduPilot allocates SERVOn_FUNCTION
// params up to MAX_SERVO regardless, so counting SERVOn params is misleading.
import { parsePwmOutputCountFromBanner } from '../packages/ardupilot-core/dist/index.js'

test('parsePwmOutputCountFromBanner reads N from "RCOut: PWM:1-N"', () => {
  assert.equal(parsePwmOutputCountFromBanner('RCOut: PWM:1-11'), 11)
  assert.equal(parsePwmOutputCountFromBanner('RCOut:PWM:1-16'), 16)
  // Tolerate the multi-range form some boards emit ("PWM:1-8 PWM:9-12"); take
  // the highest endpoint so the operator sees the total available channels.
  assert.equal(parsePwmOutputCountFromBanner('RCOut: PWM:1-8 PWM:9-12'), 12)
  // Wrong prefix doesn't match.
  assert.equal(parsePwmOutputCountFromBanner('Frame: UNSUPPORTED'), undefined)
  assert.equal(parsePwmOutputCountFromBanner('PWM:1-11 (no RCOut prefix)'), undefined)
  // Implausible counts (>64 or <1) are rejected.
  assert.equal(parsePwmOutputCountFromBanner('RCOut: PWM:1-999'), undefined)
})

// Real-FC end-to-end: a STATUSTEXT with the boot banner pumps the count into
// snapshot.hardware.pwmOutputCount so the Outputs overview can show the
// physical channel count separately from the SERVOn slot count.
function createBootBannerSession(bannerLines) {
  const statusListeners = []
  const messageListeners = []
  let connected = false
  const emit = (message) => {
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )
  }
  return {
    getTransportStatus() { return connected ? { kind: 'connected' } : { kind: 'disconnected' } },
    onStatus(listener) { statusListeners.push(listener); return () => {} },
    onMessage(listener) { messageListeners.push(listener); return () => {} },
    async connect() {
      connected = true
      statusListeners.forEach((listener) => listener({ kind: 'connected' }))
      emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
      for (const line of bannerLines) {
        emit({ type: 'STATUSTEXT', severity: 6, text: line })
      }
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send() {}
  }
}

// Real-FC bug regression: with FRAME_CLASS=0 on the wire, the Airframe setup
// section was showing "complete" — because the param was technically present,
// even though the value (0) meant the operator had not chosen a frame and
// ArduPilot was rejecting every calibration with "PreArm: Motors: Check frame
// class and type". A SetupSectionDefinition.requiredNonZeroParameters list
// now catches the present-but-unset case.
function createFrameClassZeroSession() {
  const statusListeners = []
  const messageListeners = []
  const parameters = {
    FRAME_CLASS: 0,
    FRAME_TYPE: 1,
    FLTMODE1: 0
  }
  let connected = false
  const emit = (message) => {
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )
  }
  return {
    getTransportStatus() { return connected ? { kind: 'connected' } : { kind: 'disconnected' } },
    onStatus(listener) { statusListeners.push(listener); return () => {} },
    onMessage(listener) { messageListeners.push(listener); return () => {} },
    async connect() {
      connected = true
      statusListeners.forEach((listener) => listener({ kind: 'connected' }))
      emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      if (message.type === 'PARAM_REQUEST_LIST') {
        Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
          emit({ type: 'PARAM_VALUE', paramId, paramValue, paramType: 9, paramCount: entries.length, paramIndex: index })
        })
      }
    }
  }
}

// Real-FC bug regression: previously-calibrated FCs were stuck on
// "in-progress" forever because the runtime required the cal-success banner
// to fire IN THIS SESSION. ArduPilot only emits that banner during a fresh
// cal run, so any subsequent reconnect lost the signal. Cal-output params
// (INS_ACCOFFS_*, AHRS_TRIM_*, COMPASS_OFS_*) persist on the autopilot — if
// any are non-zero, the cal happened.
function createPreCalibratedSession(extraParameters) {
  const statusListeners = []
  const messageListeners = []
  const parameters = {
    FRAME_CLASS: 1,
    FRAME_TYPE: 1,
    FLTMODE1: 0,
    AHRS_ORIENTATION: 0,
    AHRS_TRIM_X: 0,
    AHRS_TRIM_Y: 0,
    COMPASS_USE: 1,
    COMPASS_OFS_X: 0,
    COMPASS_OFS_Y: 0,
    COMPASS_OFS_Z: 0,
    INS_ACCOFFS_X: 0,
    INS_ACCOFFS_Y: 0,
    INS_ACCOFFS_Z: 0,
    ...extraParameters
  }
  let connected = false
  const emit = (message) => {
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )
  }
  return {
    getTransportStatus() { return connected ? { kind: 'connected' } : { kind: 'disconnected' } },
    onStatus(listener) { statusListeners.push(listener); return () => {} },
    onMessage(listener) { messageListeners.push(listener); return () => {} },
    async connect() {
      connected = true
      statusListeners.forEach((listener) => listener({ kind: 'connected' }))
      emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      if (message.type === 'PARAM_REQUEST_LIST') {
        Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
          emit({ type: 'PARAM_VALUE', paramId, paramValue, paramType: 9, paramCount: entries.length, paramIndex: index })
        })
      }
    }
  }
}

test('previously-calibrated cal sections read "complete" without seeing the cal-success STATUSTEXT', async () => {
  // FC reports non-zero cal outputs across all three cal sections — the
  // operator ran these calibrations on a previous session. The autopilot
  // does NOT re-emit the "Compass calibration complete" / "Board level
  // calibration complete" / "Accelerometer calibration complete" banners
  // on reconnect, but each section now also accepts the cal-output param
  // values as proof.
  const session = createPreCalibratedSession({
    AHRS_TRIM_X: 0.013, // prior level cal
    INS_ACCOFFS_X: 0.18, // prior accel cal
    COMPASS_OFS_X: 42 // prior compass cal
  })
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })
    const snapshot = runtime.getSnapshot()
    for (const id of ['accelerometer', 'level', 'compass']) {
      const section = snapshot.setupSections.find((s) => s.id === id)
      assert.ok(section, `${id} section present`)
      assert.equal(
        section.status,
        'complete',
        `${id}: prior-cal evidence (non-zero output param) must read complete; got ${section.status} with notes ${JSON.stringify(section.notes)}`
      )
    }
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('cal sections still read "in-progress" when no prior-cal evidence exists and no STATUSTEXT seen', async () => {
  // Sanity: a fresh-flashed FC with all cal-output params at 0 should still
  // show in-progress (or attention) — the fix must not turn into
  // "always complete".
  const runtime = new ArduPilotConfiguratorRuntime(createPreCalibratedSession({}), arducopterMetadata)
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })
    const snapshot = runtime.getSnapshot()
    for (const id of ['accelerometer', 'level', 'compass']) {
      const section = snapshot.setupSections.find((s) => s.id === id)
      assert.notEqual(
        section?.status,
        'complete',
        `${id}: must not read complete on a fresh FC with all cal outputs at 0`
      )
    }
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('Outputs section reads in-progress when every SERVOn_FUNCTION is still 0', async () => {
  // Real-FC audit follow-up: with FRAME_CLASS=0 ArduPilot never auto-assigns
  // motor functions, so SERVO1..8_FUNCTION are all 0 on a fresh FC. The
  // Outputs section was passing the bare presence check and reading complete
  // — but with no motor function assigned anywhere, props-on testing would
  // do literally nothing. Same "present but unset" trap as Airframe and
  // Battery, fixed by an OR-of-non-zero check across the first 8 channels.
  const session = createPreCalibratedSession({
    FRAME_CLASS: 0,
    SERVO1_FUNCTION: 0,
    SERVO2_FUNCTION: 0,
    SERVO3_FUNCTION: 0,
    SERVO4_FUNCTION: 0,
    SERVO5_FUNCTION: 0,
    SERVO6_FUNCTION: 0,
    SERVO7_FUNCTION: 0,
    SERVO8_FUNCTION: 0
  })
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })
    const snapshot = runtime.getSnapshot()
    const outputs = snapshot.setupSections.find((s) => s.id === 'outputs')
    assert.ok(outputs, 'outputs section present')
    assert.notEqual(outputs.status, 'complete', 'outputs must not read complete when no SERVOn_FUNCTION is assigned')
    assert.ok(
      outputs.notes.some((note) => /At least one of SERVO\d+_FUNCTION/.test(note)),
      `expected "at least one of SERVOn_FUNCTION" note; got ${JSON.stringify(outputs.notes)}`
    )
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('Outputs section reads complete when at least one SERVOn_FUNCTION is a motor (post-FRAME_CLASS set)', async () => {
  // Sanity: with FRAME_CLASS=1 (Quad X) ArduPilot auto-assigns SERVO1..4 to
  // motor functions 33..36. The new OR-of-non-zero check must allow that
  // case to read complete.
  const session = createPreCalibratedSession({
    FRAME_CLASS: 1,
    SERVO1_FUNCTION: 33,
    SERVO2_FUNCTION: 34,
    SERVO3_FUNCTION: 35,
    SERVO4_FUNCTION: 36,
    BATT_MONITOR: 4
  })
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })
    const snapshot = runtime.getSnapshot()
    const outputs = snapshot.setupSections.find((s) => s.id === 'outputs')
    assert.ok(outputs, 'outputs section present')
    assert.equal(outputs.status, 'complete', `outputs must read complete with motor functions assigned; got notes ${JSON.stringify(outputs.notes)}`)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

// Helper for cross-vehicle BATT_MONITOR=0 regression tests. Mirrors the
// minimal session shape used elsewhere in this file but accepts any metadata
// bundle so the same shape covers Plane / Rover / Sub.
function createBattMonitorZeroSession(extraParameters) {
  const statusListeners = []
  const messageListeners = []
  const parameters = {
    BATT_MONITOR: 0,
    BATT_CAPACITY: 3300,
    FLTMODE1: 0,
    ...extraParameters
  }
  let connected = false
  const emit = (message) => {
    messageListeners.forEach((listener) =>
      listener({ header: { systemId: 1, componentId: 1, sequence: 0 }, message, timestampMs: Date.now() })
    )
  }
  return {
    getTransportStatus() { return connected ? { kind: 'connected' } : { kind: 'disconnected' } },
    onStatus(listener) { statusListeners.push(listener); return () => {} },
    onMessage(listener) { messageListeners.push(listener); return () => {} },
    async connect() {
      connected = true
      statusListeners.forEach((listener) => listener({ kind: 'connected' }))
      emit({ type: 'HEARTBEAT', autopilot: 3, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 4, mavlinkVersion: 3 })
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test disconnect' }))
    },
    destroy() {},
    async send(message) {
      if (message.type === 'PARAM_REQUEST_LIST') {
        Object.entries(parameters).forEach(([paramId, paramValue], index, entries) => {
          emit({ type: 'PARAM_VALUE', paramId, paramValue, paramType: 9, paramCount: entries.length, paramIndex: index })
        })
      }
    }
  }
}

for (const [vehicleLabel, metadata] of [
  ['Plane', arduplaneMetadata],
  ['Rover', arduroverMetadata],
  ['Sub', ardusubMetadata]
]) {
  test(`${vehicleLabel}: BATT_MONITOR=0 keeps the Battery setup section out of "complete" state`, async () => {
    const runtime = new ArduPilotConfiguratorRuntime(createBattMonitorZeroSession(), metadata)
    try {
      await runtime.connect()
      await runtime.requestParameterList({ timeoutMs: 200 })
      await runtime.waitForParameterSync({ timeoutMs: 200 })
      const snapshot = runtime.getSnapshot()
      const battery = snapshot.setupSections.find((s) => s.id === 'power')
      assert.ok(battery, `${vehicleLabel} power section present`)
      assert.notEqual(battery.status, 'complete', `${vehicleLabel} power must not read complete when BATT_MONITOR=0`)
      assert.ok(
        battery.notes.some((note) => /BATT_MONITOR/.test(note) && /unset/i.test(note)),
        `${vehicleLabel}: expected "BATT_MONITOR unset" note; got ${JSON.stringify(battery.notes)}`
      )
    } finally {
      await runtime.disconnect().catch(() => {})
      runtime.destroy()
    }
  })
}

test('BATT_MONITOR=0 keeps the Battery setup section out of "complete" state', async () => {
  // Real-FC bug regression: BATT_MONITOR=0 disables battery monitoring
  // entirely (no voltage / current / failsafe), but the section read
  // "complete" because the param was technically present. Same present-but-
  // unset trap as the Airframe FRAME_CLASS=0 case.
  const session = createPreCalibratedSession({
    BATT_MONITOR: 0,
    BATT_CAPACITY: 3300,
    BATT_ARM_VOLT: 0,
    BATT_ARM_MAH: 0
  })
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })
    const snapshot = runtime.getSnapshot()
    const battery = snapshot.setupSections.find((s) => s.id === 'power')
    assert.ok(battery, 'power section present')
    assert.notEqual(battery.status, 'complete', 'power must not read complete when BATT_MONITOR=0')
    assert.ok(
      battery.notes.some((note) => /BATT_MONITOR/.test(note) && /unset/i.test(note)),
      `expected an "unset" note mentioning BATT_MONITOR; got ${JSON.stringify(battery.notes)}`
    )
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('FRAME_CLASS=0 keeps the Airframe setup section out of "complete" state', async () => {
  const runtime = new ArduPilotConfiguratorRuntime(createFrameClassZeroSession(), arducopterMetadata)
  try {
    await runtime.connect()
    await runtime.requestParameterList({ timeoutMs: 200 })
    await runtime.waitForParameterSync({ timeoutMs: 200 })
    const snapshot = runtime.getSnapshot()
    const airframe = snapshot.setupSections.find((s) => s.id === 'airframe')
    assert.ok(airframe, 'airframe section present')
    assert.notEqual(airframe.status, 'complete', 'airframe must not read complete when FRAME_CLASS=0')
    assert.ok(
      airframe.notes.some((note) => /FRAME_CLASS/.test(note) && /unset/i.test(note)),
      `expected an "unset" note mentioning FRAME_CLASS; got ${JSON.stringify(airframe.notes)}`
    )
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})

test('runtime captures the physical PWM count from the boot banner STATUSTEXT', async () => {
  const session = createBootBannerSession([
    'ArduCopter V4.6.3 (3fc7011a)',
    'ChibiOS: 88b84600',
    'RADIX2HD 00430023 3532510E 32323631',
    'RCOut: PWM:1-11',
    'Frame: UNSUPPORTED'
  ])
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    // Banner STATUSTEXTs arrive synchronously on connect; give the runtime one
    // tick to process them.
    await new Promise((r) => setTimeout(r, 50))
    const snapshot = runtime.getSnapshot()
    assert.equal(snapshot.hardware.pwmOutputCount, 11)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
})
