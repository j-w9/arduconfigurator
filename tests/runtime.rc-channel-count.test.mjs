import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { MAV_AUTOPILOT, MAV_TYPE } from '../packages/protocol-mavlink/dist/index.js'

/*
 * Field report: MAVLink over ELRS showed 8 RC channels in the configurator and
 * 16 in Mission Planner, with those 8 moving correctly.
 *
 * The cause is that RC_CHANNELS carries two things that can disagree.
 * ArduPilot fills the frame with `rc().get_radio_in(values, 18)`, which writes
 * MIN(18, NUM_RC_CHANNELS) = 16 real channels, and separately sets `chancount`
 * to MIN(NUM_RC_CHANNELS, hal.rcin->num_channels()) — GCS_Common.cpp
 * send_rc_channels() and RC_Channels.cpp. When the backend reports fewer
 * channels than the frame carries, chancount under-reports live data that is
 * right there in the message. Mission Planner reads the values and ignores the
 * count, which is why the two disagreed.
 *
 * So the runtime must not let chancount bound the channel list.
 */

function createSession() {
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
    },
    async disconnect() {
      connected = false
      statusListeners.forEach((listener) => listener({ kind: 'disconnected', reason: 'test' }))
    },
    destroy() {},
    async send() {},
    inject(envelope) {
      messageListeners.forEach((listener) => listener(envelope))
    }
  }
}

function heartbeat() {
  return {
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
  }
}

function rcChannels(channels, channelCount) {
  return {
    header: { systemId: 1, componentId: 1, sequence: 0 },
    message: {
      type: 'RC_CHANNELS',
      timeBootMs: 1000,
      channelCount,
      channels: [...channels, ...Array(18 - channels.length).fill(0)],
      rssi: 120
    },
    timestampMs: Date.now()
  }
}

async function withRuntime(run) {
  const session = createSession()
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata)
  try {
    await runtime.connect()
    session.inject(heartbeat())
    await runtime.waitForVehicle({ timeoutMs: 500 }).catch(() => {})
    await run(session, runtime)
  } finally {
    await runtime.disconnect().catch(() => {})
    runtime.destroy()
  }
}

test('16 live channels are all reported even when chancount says 8', async () => {
  await withRuntime(async (session, runtime) => {
    // Exactly the reported shape: sixteen channels of real PWM, chancount 8.
    const sixteen = Array.from({ length: 16 }, (_, index) => 1000 + index * 50)
    session.inject(rcChannels(sixteen, 8))

    const rc = runtime.getSnapshot().liveVerification.rcInput
    assert.equal(rc.channelCount, 16, 'the eight channels past chancount are real and must be reported')
    assert.equal(rc.channels.length, 16)
    assert.deepEqual(rc.channels.slice(0, 16), sixteen)
    assert.equal(rc.verified, true)
  })
})

test('a genuine 8-channel receiver still reports 8', async () => {
  await withRuntime(async (session, runtime) => {
    // Channels 9-18 are zero, which is what an 8-channel link actually sends.
    session.inject(rcChannels([1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800], 8))

    const rc = runtime.getSnapshot().liveVerification.rcInput
    assert.equal(rc.channelCount, 8, 'zeros past channel 8 are not channels')
    assert.equal(rc.verified, true)
  })
})

test('chancount is still the floor when it exceeds the populated channels', async () => {
  await withRuntime(async (session, runtime) => {
    // Six live channels but the autopilot claims 12: believe the larger claim,
    // so a receiver mid-handshake does not appear to lose channels.
    session.inject(rcChannels([1100, 1200, 1300, 1400, 1500, 1600], 12))

    const rc = runtime.getSnapshot().liveVerification.rcInput
    assert.equal(rc.channelCount, 12)
  })
})

function rcChannelsRaw(channels, port = 0) {
  return {
    header: { systemId: 1, componentId: 1, sequence: 0 },
    message: {
      type: 'RC_CHANNELS_RAW',
      timeBootMs: 1000,
      port,
      channels: [...channels, ...Array(8 - channels.length).fill(0)],
      rssi: 200
    },
    timestampMs: Date.now()
  }
}

/*
 * RC_CHANNELS_RAW is the MAVLink1-era message. ArduPilot only sends it to a
 * MAVLink1 GCS (send_rc_channels_raw returns early unless sending_mavlink1()),
 * so on a healthy v2 link it never arrives. It is decoded as a fallback for
 * links where 65 never shows up at all — a bridge or OSD-oriented path that
 * forwards only the legacy message — where the alternative is no sticks.
 */
test('RC_CHANNELS_RAW drives the sticks when RC_CHANNELS never arrives', async () => {
  await withRuntime(async (session, runtime) => {
    session.inject(rcChannelsRaw([1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800]))

    const rc = runtime.getSnapshot().liveVerification.rcInput
    assert.equal(rc.verified, true, 'the legacy message is still real RC input')
    assert.equal(rc.channels[0], 1100)
    assert.equal(rc.channels[7], 1800)
  })
})

test('RC_CHANNELS_RAW never truncates a live 16-channel RC_CHANNELS', async () => {
  await withRuntime(async (session, runtime) => {
    const sixteen = Array.from({ length: 16 }, (_, index) => 1000 + index * 50)
    session.inject(rcChannels(sixteen, 16))
    // A stray legacy frame carrying only eight channels must not demote the
    // receiver to eight — that would reintroduce the reported bug by a
    // different route.
    session.inject(rcChannelsRaw([1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500]))

    const rc = runtime.getSnapshot().liveVerification.rcInput
    assert.equal(rc.channelCount, 16, 'RC_CHANNELS wins while it is arriving')
    assert.deepEqual(rc.channels.slice(0, 16), sixteen)
  })
})
