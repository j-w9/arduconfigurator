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
