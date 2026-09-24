import assert from 'node:assert/strict'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { MAV_AUTOPILOT, MAV_TYPE } from '../packages/protocol-mavlink/dist/index.js'

/*
 * The live stream rates are chosen for a radio link, where every message is
 * bandwidth something else is not getting. GLOBAL_POSITION_INT at 5 Hz is the
 * right call there.
 *
 * The WebAssembly simulator has no link -- the "radio" is a memcpy between a
 * worker and the main thread in the same tab -- and 5 Hz is what makes a
 * sped-up simulation look like it is teleporting: at 5x the vehicle covers
 * five times the ground between fixes, so the map advances in long jumps
 * however smoothly it draws them.
 *
 * So a runtime told its vehicle is local asks for position faster. What must
 * not happen is that rate reaching a real vehicle, which is what this pins.
 */

const SET_MESSAGE_INTERVAL = 511
const GLOBAL_POSITION_INT = 33

function createSession(sent) {
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
    async send(message) {
      sent.push(message)
    },
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

/** The interval this runtime asked for, in microseconds. */
async function positionIntervalUs(options) {
  const sent = []
  const session = createSession(sent)
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, options)
  try {
    await runtime.connect()
    session.inject(heartbeat())
    await runtime.waitForVehicle({ timeoutMs: 500 }).catch(() => {})
    // The stream run is fired off unawaited from the heartbeat handler.
    await new Promise((resolve) => setTimeout(resolve, 60))
  } finally {
    await runtime.disconnect().catch(() => {})
  }

  const request = sent.find(
    (message) =>
      message?.type === 'COMMAND_LONG' &&
      message.command === SET_MESSAGE_INTERVAL &&
      message.params?.[0] === GLOBAL_POSITION_INT
  )
  assert.ok(request, 'expected a SET_MESSAGE_INTERVAL for GLOBAL_POSITION_INT')
  return request.params[1]
}

test('a vehicle on a radio link keeps the conservative position rate', async () => {
  assert.equal(await positionIntervalUs(undefined), 200000)
  assert.equal(await positionIntervalUs({}), 200000)
  assert.equal(await positionIntervalUs({ localVehicle: false }), 200000)
})

test('a vehicle running in this tab is asked for position faster', async () => {
  const interval = await positionIntervalUs({ localVehicle: true })
  assert.ok(
    interval < 200000,
    `expected a shorter interval than the radio-link default, got ${interval}`
  )
  assert.equal(interval, 40000)
})

test('the faster rate is confined to the position stream', async () => {
  // Every other stream is either already fast enough or genuinely cheap, and
  // raising them wholesale would be a change nobody asked for.
  const sent = []
  const session = createSession(sent)
  const runtime = new ArduPilotConfiguratorRuntime(session, arducopterMetadata, { localVehicle: true })
  try {
    await runtime.connect()
    session.inject(heartbeat())
    await runtime.waitForVehicle({ timeoutMs: 500 }).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 60))
  } finally {
    await runtime.disconnect().catch(() => {})
  }

  const baseline = []
  const baseSession = createSession(baseline)
  const baseRuntime = new ArduPilotConfiguratorRuntime(baseSession, arducopterMetadata)
  try {
    await baseRuntime.connect()
    baseSession.inject(heartbeat())
    await baseRuntime.waitForVehicle({ timeoutMs: 500 }).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 60))
  } finally {
    await baseRuntime.disconnect().catch(() => {})
  }

  const intervals = (messages) =>
    messages
      .filter(
        (message) => message?.type === 'COMMAND_LONG' && message.command === SET_MESSAGE_INTERVAL
      )
      .map((message) => [message.params[0], message.params[1]])

  const local = new Map(intervals(sent))
  const radio = new Map(intervals(baseline))
  assert.ok(radio.size > 1, 'expected the baseline run to request several streams')
  assert.equal(local.size, radio.size)

  for (const [messageId, radioInterval] of radio) {
    if (messageId === GLOBAL_POSITION_INT) continue
    assert.equal(
      local.get(messageId),
      radioInterval,
      `stream ${messageId} should be unchanged for a local vehicle`
    )
  }
})
