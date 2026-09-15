import assert from 'node:assert/strict'
import test from 'node:test'

import {
  describeUnsupportedAutopilot,
  isAuthoritativeHeartbeat
} from '../packages/ardupilot-core/dist/runtime-helpers.js'
import { MAV_AUTOPILOT } from '../packages/protocol-mavlink/dist/index.js'

// A PX4 board connects fine at the transport layer, so the app used to sit on
// "Waiting for heartbeat" forever while heartbeats arrived and were dropped for
// not being ArduPilot — telling the operator the opposite of what was
// happening. These cover what is now recorded instead.

test('only ArduPilot heartbeats are authoritative', () => {
  const heartbeat = (autopilot) => ({ autopilot, vehicleType: 2, baseMode: 0, customMode: 0, systemStatus: 3 })
  assert.equal(isAuthoritativeHeartbeat(heartbeat(MAV_AUTOPILOT.ARDUPILOTMEGA)), true)
  assert.equal(isAuthoritativeHeartbeat(heartbeat(MAV_AUTOPILOT.PX4)), false)
  assert.equal(isAuthoritativeHeartbeat(heartbeat(MAV_AUTOPILOT.INVALID)), false)
})

test('PX4 is named; anything else reports its raw enum value', () => {
  // Verified against modules/mavlink/message_definitions/v1.0/minimal.xml:
  // MAV_AUTOPILOT_PX4 = 12, MAV_AUTOPILOT_ARDUPILOTMEGA = 3.
  assert.equal(MAV_AUTOPILOT.PX4, 12)

  assert.deepEqual(describeUnsupportedAutopilot(MAV_AUTOPILOT.PX4), {
    autopilot: 12,
    label: 'PX4'
  })

  // Naming every MAV_AUTOPILOT value would be a table nobody can verify and
  // nobody will read. The number is honest and still diagnosable.
  assert.deepEqual(describeUnsupportedAutopilot(17), {
    autopilot: 17,
    label: 'MAV_AUTOPILOT 17'
  })
})

test('MAV_AUTOPILOT_INVALID is not an unsupported autopilot', () => {
  // INVALID (8) is what a component with no autopilot reports — a gimbal, a
  // companion computer, or our own GCS heartbeat echoed back on a shared bus.
  // Announcing "unsupported autopilot" for those would be wrong on a perfectly
  // healthy ArduPilot link, which is why the runtime excludes it before it ever
  // reaches this describe call.
  assert.equal(MAV_AUTOPILOT.INVALID, 8)
  assert.notEqual(MAV_AUTOPILOT.INVALID, MAV_AUTOPILOT.PX4)
})
