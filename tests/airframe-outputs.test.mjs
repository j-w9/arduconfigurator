import assert from 'node:assert/strict'
import test from 'node:test'

import {
  deriveAirframe,
  deriveArducopterAirframe,
  deriveOutputMappingSummary
} from '../packages/ardupilot-core/dist/index.js'

// Minimal snapshot — the airframe/output derivations only read
// snapshot.parameters (FRAME_CLASS/FRAME_TYPE + SERVOx_FUNCTION).
function snapshot(params) {
  return {
    parameters: Object.entries(params).map(([id, value]) => ({ id, value })),
    hardware: { uartsFile: { mappings: [] } }
  }
}

const COPTER_QUAD = snapshot({
  FRAME_CLASS: 1,
  FRAME_TYPE: 1,
  SERVO1_FUNCTION: 33,
  SERVO2_FUNCTION: 34,
  SERVO3_FUNCTION: 35,
  SERVO4_FUNCTION: 36
})

test('deriveAirframe is byte-identical to the Copter derivation for ArduCopter and the legacy default', () => {
  const copter = deriveArducopterAirframe(COPTER_QUAD)
  assert.deepEqual(deriveAirframe(COPTER_QUAD, 'ArduCopter'), copter)
  // Unknown / undefined historically used the Copter path — preserved.
  assert.deepEqual(deriveAirframe(COPTER_QUAD, undefined), copter)
  assert.deepEqual(deriveAirframe(COPTER_QUAD, 'Unknown'), copter)
  assert.equal(typeof copter.expectedMotorCount, 'number')
})

test('deriveAirframe returns honest non-Copter summaries (no motor matrix)', () => {
  for (const [vehicle, label] of [
    ['ArduPlane', 'Fixed-wing / QuadPlane'],
    ['ArduRover', 'Rover'],
    ['ArduSub', 'Sub']
  ]) {
    const af = deriveAirframe(COPTER_QUAD, vehicle)
    assert.equal(af.expectedMotorCount, undefined, `${vehicle} has no fixed motor count`)
    assert.equal(af.frameClassLabel, label)
    assert.equal(af.frameClassValue, undefined)
    assert.equal(af.frameTypeIgnored, true)
  }
})

test('deriveOutputMappingSummary threads the vehicle into its airframe', () => {
  const copterMapping = deriveOutputMappingSummary(COPTER_QUAD, 'ArduCopter')
  assert.deepEqual(copterMapping.airframe, deriveArducopterAirframe(COPTER_QUAD))
  // Servo-function classification is vehicle-independent and unchanged.
  assert.deepEqual(
    deriveOutputMappingSummary(COPTER_QUAD).outputs,
    copterMapping.outputs
  )

  const planeMapping = deriveOutputMappingSummary(COPTER_QUAD, 'ArduPlane')
  assert.equal(planeMapping.airframe.expectedMotorCount, undefined)
  assert.equal(planeMapping.airframe.frameClassLabel, 'Fixed-wing / QuadPlane')
})

test('control-surface outputs classify distinctly (Plane Aileron/Elevator/Throttle/Rudder)', () => {
  // The real ArduPlane on the bench reported SERVO1..4 = 4/19/70/21.
  const plane = snapshot({
    SERVO1_FUNCTION: 4,  // Aileron  -> control-surface
    SERVO2_FUNCTION: 19, // Elevator -> control-surface
    SERVO3_FUNCTION: 70, // Throttle -> peripheral (existing classification)
    SERVO4_FUNCTION: 21  // Rudder   -> control-surface
  })
  const mapping = deriveOutputMappingSummary(plane, 'ArduPlane')
  const byChannel = new Map(mapping.outputs.map((o) => [o.channelNumber, o]))
  assert.equal(byChannel.get(1).kind, 'control-surface')
  assert.equal(byChannel.get(2).kind, 'control-surface')
  assert.equal(byChannel.get(4).kind, 'control-surface')
  // Control surfaces are aux outputs (not motor, not unused).
  assert.ok(mapping.configuredAuxOutputs.some((o) => o.channelNumber === 1 && o.kind === 'control-surface'))
  // Elevon / VTail / Flaperon also classify as control surfaces.
  const flyingWing = snapshot({ SERVO1_FUNCTION: 77, SERVO2_FUNCTION: 78 })
  const fwMapping = deriveOutputMappingSummary(flyingWing, 'ArduPlane')
  assert.ok(fwMapping.outputs.every((o) => o.kind === 'control-surface'))
})
