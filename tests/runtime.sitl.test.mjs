import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata, arduplaneMetadata } from '../packages/param-metadata/dist/index.js'
import { MavlinkSession, MavlinkV2Codec } from '../packages/protocol-mavlink/dist/index.js'
import { TcpTransport, UdpTransport, launchArduPilotDirectBinary, launchArduPilotSITL } from '../packages/sitl-harness/dist/index.js'

test('true SITL supports verified parameter write/readback', { timeout: 240000 }, async (t) => {
  const repoPath = process.env.ARDUPILOT_REPO_PATH
  const launchMode = process.env.ARDUPILOT_SITL_LAUNCH_MODE ?? 'direct-binary'
  const attachHost = process.env.ARDUPILOT_SITL_HOST
  const attachTransport =
    process.env.ARDUPILOT_SITL_TRANSPORT ?? (repoPath && launchMode === 'sim-vehicle' ? 'udp' : 'tcp')
  const attachPort = Number(process.env.ARDUPILOT_SITL_PORT ?? (attachTransport === 'udp' ? '14550' : '5760'))
  const launchWaitPort = Number(process.env.ARDUPILOT_SITL_LAUNCH_WAIT_PORT ?? '5760')

  if (!repoPath && !attachHost) {
    t.skip('Set ARDUPILOT_REPO_PATH to launch sim_vehicle.py, or ARDUPILOT_SITL_HOST/PORT to attach to an existing SITL TCP endpoint.')
    return
  }

  let sitl
  if (repoPath) {
    sitl =
      launchMode === 'sim-vehicle'
        ? await launchArduPilotSITL({
            repoPath,
            pythonExecutable: process.env.ARDUPILOT_SITL_PYTHON,
            vehicle: process.env.ARDUPILOT_SITL_VEHICLE ?? 'ArduCopter',
            frame: process.env.ARDUPILOT_SITL_FRAME ?? 'quad',
            port: launchWaitPort,
            launchTimeoutMs: Number(process.env.ARDUPILOT_SITL_LAUNCH_TIMEOUT_MS ?? '120000')
          })
        : await launchArduPilotDirectBinary({
            repoPath,
            vehicle: process.env.ARDUPILOT_SITL_VEHICLE ?? 'ArduCopter',
            frame: process.env.ARDUPILOT_SITL_FRAME ?? 'quad',
            port: launchWaitPort,
            launchTimeoutMs: Number(process.env.ARDUPILOT_SITL_LAUNCH_TIMEOUT_MS ?? '120000')
          })
  }

  const transport =
    attachTransport === 'udp'
      ? new UdpTransport('sitl-test-udp', {
          bindHost: attachHost ?? '127.0.0.1',
          bindPort: attachPort
        })
      : new TcpTransport('sitl-test-tcp', {
          host: attachHost ?? '127.0.0.1',
          port: attachPort,
          connectTimeoutMs: 10000
        })
  const session = new MavlinkSession(transport, new MavlinkV2Codec())
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {
  })

  try {
    await runtime.connect()
    await runtime.waitForVehicle({ timeoutMs: 10000 })
    await runtime.requestParameterList({ timeoutMs: 10000 })
    await runtime.waitForParameterSync({ timeoutMs: 30000 })

    const snapshot = runtime.getSnapshot()
    const parameter = snapshot.parameters.find((candidate) => candidate.id === 'FLTMODE1')
    assert.ok(parameter, 'Expected FLTMODE1 in the synced SITL parameter table.')

    const nextValue = parameter.value === 5 ? 0 : 5
    const writeResult = await runtime.setParameter(parameter.id, nextValue, {
      verifyTimeoutMs: 3000
    })
    assert.equal(writeResult.confirmedValue, nextValue)

    const rollbackResult = await runtime.setParameter(parameter.id, parameter.value, {
      verifyTimeoutMs: 3000
    })
    assert.equal(rollbackResult.confirmedValue, parameter.value)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
    await sitl?.stop().catch(() => {})
  }
})

// Opt-in (ARDUPILOT_SITL_PLANE=1) because it forces an ArduPlane binary
// build, which is heavy and irrelevant to the default Copter SITL run.
// Validates the firmware-aware path against real ArduPlane firmware:
// vehicle detection, the metadataByVehicle bundle swap, a Plane-only
// parameter in the synced table, and verified write/readback.
test('true SITL: an ArduPlane vehicle is detected and swaps to the Plane catalog', { timeout: 360000 }, async (t) => {
  const repoPath = process.env.ARDUPILOT_REPO_PATH
  const attachHost = process.env.ARDUPILOT_SITL_HOST
  const planeOptIn = process.env.ARDUPILOT_SITL_PLANE === '1'
  const attachPort = Number(process.env.ARDUPILOT_SITL_PORT ?? '5760')
  const launchWaitPort = Number(process.env.ARDUPILOT_SITL_LAUNCH_WAIT_PORT ?? '5760')

  if (!planeOptIn) {
    t.skip('Set ARDUPILOT_SITL_PLANE=1 (plus ARDUPILOT_REPO_PATH or ARDUPILOT_SITL_HOST) to validate against real ArduPlane SITL.')
    return
  }
  if (!repoPath && !attachHost) {
    t.skip('Set ARDUPILOT_REPO_PATH to launch the ArduPlane binary, or ARDUPILOT_SITL_HOST/PORT to attach to an existing endpoint.')
    return
  }

  let sitl
  if (repoPath) {
    sitl = await launchArduPilotDirectBinary({
      repoPath,
      vehicle: 'ArduPlane',
      frame: process.env.ARDUPILOT_SITL_FRAME ?? 'plane',
      port: launchWaitPort,
      launchTimeoutMs: Number(process.env.ARDUPILOT_SITL_LAUNCH_TIMEOUT_MS ?? '300000')
    })
  }

  const transport = new TcpTransport('sitl-plane-tcp', {
    host: attachHost ?? '127.0.0.1',
    port: attachPort,
    connectTimeoutMs: 10000
  })
  const session = new MavlinkSession(transport, new MavlinkV2Codec())
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {
    metadataByVehicle: {
      ArduCopter: arducopterMetadata,
      ArduPlane: arduplaneMetadata
    }
  })

  try {
    await runtime.connect()
    // ArduPlane SITL cold-start (especially right after a fresh build with
    // a wiped EEPROM) takes noticeably longer to stream its first
    // authoritative heartbeat than warm ArduCopter. Allow a generous
    // budget; the assertion below still proves correctness once it arrives.
    const vehicle = await runtime.waitForVehicle({
      timeoutMs: Number(process.env.ARDUPILOT_SITL_VEHICLE_TIMEOUT_MS ?? '45000')
    })
    assert.equal(vehicle.firmware, 'ArduPilot')
    assert.equal(vehicle.vehicle, 'ArduPlane', 'real ArduPlane SITL should identify as ArduPlane')

    // The heartbeat-driven swap should have moved the active bundle.
    assert.equal(runtime.getActiveMetadata().firmware, 'ArduPlane')

    await runtime.requestParameterList({ timeoutMs: 10000 })
    await runtime.waitForParameterSync({ timeoutMs: 30000 })

    const snapshot = runtime.getSnapshot()
    const qEnable = snapshot.parameters.find((candidate) => candidate.id === 'Q_ENABLE')
    assert.ok(qEnable, 'Expected the Plane-only Q_ENABLE parameter in the synced SITL table.')

    const parameter = snapshot.parameters.find((candidate) => candidate.id === 'FLTMODE1')
    assert.ok(parameter, 'Expected FLTMODE1 in the synced ArduPlane parameter table.')

    const nextValue = parameter.value === 5 ? 0 : 5
    const writeResult = await runtime.setParameter(parameter.id, nextValue, { verifyTimeoutMs: 3000 })
    assert.equal(writeResult.confirmedValue, nextValue)

    const rollbackResult = await runtime.setParameter(parameter.id, parameter.value, { verifyTimeoutMs: 3000 })
    assert.equal(rollbackResult.confirmedValue, parameter.value)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
    await sitl?.stop().catch(() => {})
  }
})

/**
 * The rangefinder / optical-flow Status cards depend on two messages that live
 * in STREAM_EXTRA3 and therefore only ever arrive because the runtime issues a
 * SET_MESSAGE_INTERVAL for them. NOTHING below rung 4 can prove that: the mock
 * scenario emits whatever it is told to, so the cards look perfect in demo mode
 * and in every unit test even if the requests were deleted. Only a real
 * autopilot can answer, which is why this test exists.
 *
 * Two levels of assertion:
 *   1. Always — a real ArduPilot ACCEPTS both requests. A rejected stream makes
 *      the runtime append a warning status entry naming the stream, so the
 *      absence of those entries is the proof. This runs on any SITL, with or
 *      without sensors configured.
 *   2. When the attached SITL actually has the sensors configured (set
 *      RNGFND1_TYPE=100 / FLOW_TYPE=10 / SIM_FLOW_ENABLE=1 and reboot it), the
 *      readings themselves are asserted.
 *
 * Level 2 was walked by hand against ArduCopter SITL while building this and
 * both streams arrived — rangefinder orientation 25 (down), min/max mirroring
 * RNGFND1_MIN/_MAX, signal_quality 0 (the SIM backend does not report quality);
 * optical flow quality 51 with live flowRateX/Y. It is kept conditional here so
 * the test does not require reconfiguring and rebooting the SITL mid-run.
 */
test('true SITL: the rangefinder + optical-flow streams are accepted and arrive', { timeout: 240000 }, async (t) => {
  const repoPath = process.env.ARDUPILOT_REPO_PATH
  const attachHost = process.env.ARDUPILOT_SITL_HOST
  const attachPort = Number(process.env.ARDUPILOT_SITL_PORT ?? '5760')
  const launchWaitPort = Number(process.env.ARDUPILOT_SITL_LAUNCH_WAIT_PORT ?? '5760')

  if (!repoPath && !attachHost) {
    t.skip('Set ARDUPILOT_REPO_PATH to launch SITL, or ARDUPILOT_SITL_HOST/PORT to attach to an existing endpoint.')
    return
  }

  let sitl
  if (repoPath) {
    sitl = await launchArduPilotDirectBinary({
      repoPath,
      vehicle: process.env.ARDUPILOT_SITL_VEHICLE ?? 'ArduCopter',
      frame: process.env.ARDUPILOT_SITL_FRAME ?? 'quad',
      port: launchWaitPort,
      launchTimeoutMs: Number(process.env.ARDUPILOT_SITL_LAUNCH_TIMEOUT_MS ?? '120000')
    })
  }

  const transport = new TcpTransport('sitl-sensor-streams-tcp', {
    host: attachHost ?? '127.0.0.1',
    port: attachPort,
    connectTimeoutMs: 10000
  })
  const session = new MavlinkSession(transport, new MavlinkV2Codec())
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {})

  try {
    await runtime.connect()
    await runtime.waitForVehicle({ timeoutMs: 20000 })
    await runtime.requestParameterList({ timeoutMs: 20000 })
    await runtime.waitForParameterSync({ timeoutMs: 60000 })

    // Let the SET_MESSAGE_INTERVAL ACKs land and give the streams a few
    // seconds of runway at their requested 5 Hz.
    await new Promise((resolve) => setTimeout(resolve, 8000))

    const snapshot = runtime.getSnapshot()

    // Level 1: a real autopilot took both requests. The runtime only files a
    // warning here when the FC actively refuses a stream, so a clean log means
    // DISTANCE_SENSOR and OPTICAL_FLOW were accepted as sent.
    const rejections = snapshot.statusTexts.filter(
      (entry) =>
        entry.severity !== 'info' &&
        /DISTANCE_SENSOR|OPTICAL_FLOW/.test(entry.text) &&
        /stream/i.test(entry.text)
    )
    assert.deepEqual(rejections, [], 'SITL refused one of the sensor telemetry streams.')

    // Level 2: if this SITL has the sensors configured, the readings must be
    // real — not merely "a message arrived".
    const rangefinderType = snapshot.parameters.find((entry) => entry.id === 'RNGFND1_TYPE')?.value ?? 0
    if (rangefinderType !== 0) {
      const rangefinder = snapshot.liveVerification.rangefinder
      assert.equal(rangefinder.verified, true, 'RNGFND1_TYPE is set but no DISTANCE_SENSOR arrived.')
      assert.equal(typeof rangefinder.distanceM, 'number')
      // Instance 0 == RNGFND1, and never an AP_Proximity sector (id >= 10).
      assert.ok(rangefinder.sensorId !== undefined && rangefinder.sensorId < 10)
    } else {
      t.diagnostic('RNGFND1_TYPE is 0 on this SITL — stream acceptance asserted, reading not exercised.')
    }

    const flowType = snapshot.parameters.find((entry) => entry.id === 'FLOW_TYPE')?.value ?? 0
    if (flowType !== 0) {
      const flow = snapshot.liveVerification.opticalFlow
      assert.equal(flow.verified, true, 'FLOW_TYPE is set but no OPTICAL_FLOW arrived.')
      assert.equal(typeof flow.quality, 'number')
    } else {
      t.diagnostic('FLOW_TYPE is 0 on this SITL — stream acceptance asserted, reading not exercised.')
    }
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
    await sitl?.stop().catch(() => {})
  }
})
