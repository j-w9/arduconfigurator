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
 * Back-to-back MAVFTP downloads of SMALL files.
 *
 * Nothing below rung 4 can prove this. The failure lives in the real
 * ArduPilot FTP server's duplicate-request suppression: it replays its last
 * reply instead of executing a request whose `seq_number + 1` equals the
 * seq_number of that reply (GCS_FTP.cpp:823-829). A burst read advances the
 * server's seq_number once per STREAMED PACKET while the client only sent one
 * request, so a client that counts only its own sends falls behind — and for a
 * file small enough to fit in a single burst packet it falls behind by exactly
 * the amount that makes the follow-up TerminateSession look like a re-request.
 * The close is swallowed, the descriptor stays open, and since ArduPilot allows
 * only one open file per session (GCS_FTP.cpp:341-352) the next open is NAKed
 * with Fail until the server's 3s idle sweep runs (FTP_SESSION_TIMEOUT). Big
 * logs always outlast that timeout, which is why the log reader never saw it.
 *
 * The mock server replies with request+1 and nothing else, so it cannot
 * exhibit any of this; only a real autopilot can answer.
 *
 * The test uploads its own small files rather than trusting whatever happens to
 * be on the vehicle, so "small enough to fit one burst packet" — the exact
 * failing case — is guaranteed rather than hoped for. It also downloads a real
 * multi-burst log in the same run so a fix for the small-file case cannot quietly
 * cost us the large-file path it was built for.
 */
test('true SITL: consecutive small MAVFTP downloads all succeed', { timeout: 240000 }, async (t) => {
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

  const transport = new TcpTransport('sitl-mavftp-small-files-tcp', {
    host: attachHost ?? '127.0.0.1',
    port: attachPort,
    connectTimeoutMs: 10000
  })
  const session = new MavlinkSession(transport, new MavlinkV2Codec())
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, {})

  // `/logs` is the SITL scratch directory (the hardware equivalent is
  // `/APM/LOGS`); it is the one writable place every SITL has. Cleaned up in
  // the finally so a re-run starts from the same state.
  const smallFiles = [1, 2, 3].map((index) => ({
    path: `/logs/arduconfig-ftp-small-${index}.txt`,
    // Well under the 239-byte burst packet payload, so each download is a
    // single-packet burst — the case that used to wedge the session.
    text: `arduconfig mavftp consecutive-read probe #${index}\n`
  }))
  const uploaded = []

  try {
    await runtime.connect()
    await runtime.waitForVehicle({ timeoutMs: 20000 })

    // The runtime issues its own `@SYS/uarts.txt` read on connect. This
    // service drives every transfer through FTP session 0, so an overlapping
    // read would contend for the same server-side descriptor and muddy what
    // this test is actually measuring. Let the connect-time read finish first.
    await new Promise((resolve) => setTimeout(resolve, 4000))

    for (const file of smallFiles) {
      await runtime.uploadRemoteFile(file.path, new TextEncoder().encode(file.text), { overwrite: true })
      uploaded.push(file.path)
    }

    // The assertion: back to back, with NO spacing between them. Spacing is
    // what the private monitoring collector had to add to work around this,
    // and adding it here would hide exactly the bug under test.
    for (const file of smallFiles) {
      const bytes = await runtime.downloadMavftpLog(file.path, undefined, { silent: true })
      assert.equal(
        new TextDecoder().decode(bytes),
        file.text,
        `Consecutive MAVFTP download of ${file.path} did not return the uploaded bytes.`
      )
    }

    // Same run, same session: the multi-burst path the log reader depends on
    // must still work after (and before) the small reads.
    const logs = await runtime.listMavftpLogs()
    const bySize = logs
      .filter((entry) => (entry.sizeBytes ?? 0) > 4096)
      .sort((left, right) => (left.sizeBytes ?? 0) - (right.sizeBytes ?? 0))
    // ArduPilot streams at most 2000 packets (~478 KiB at 239 bytes each) per
    // burst request, so prefer a log past that: it forces the burstComplete
    // re-request the log reader lives on. Fall back to the largest available
    // when the SITL has nothing that big, and take the SMALLEST qualifying log
    // so the test stays quick.
    const largeLog = bySize.find((entry) => (entry.sizeBytes ?? 0) > 512 * 1024) ?? bySize[bySize.length - 1]

    if (largeLog) {
      let lastProgress = 0
      const bytes = await runtime.downloadMavftpLog(largeLog.path, (progress) => {
        lastProgress = progress.bytesReceived
      }, { silent: true })
      assert.equal(bytes.length, largeLog.sizeBytes, `Multi-burst download of ${largeLog.path} came back short.`)
      assert.ok(lastProgress > 0, 'Multi-burst download reported no progress.')
      t.diagnostic(`Multi-burst path exercised on ${largeLog.path} (${bytes.length} bytes).`)

      // And a small read still works AFTER a large one, which is the ordering
      // an operator hits when they grab a log and then a config file.
      const trailing = await runtime.downloadMavftpLog(smallFiles[0].path, undefined, { silent: true })
      assert.equal(new TextDecoder().decode(trailing), smallFiles[0].text)
    } else {
      t.diagnostic('No onboard log over 4 KiB on this SITL — the multi-burst path was not exercised.')
    }
  } finally {
    for (const path of uploaded) {
      await runtime.deleteRemotePath(path, 'file').catch(() => {})
    }
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
