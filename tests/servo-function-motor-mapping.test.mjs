import assert from 'node:assert/strict'
import test from 'node:test'

import {
  arducopterMotorNumberForServoFunction,
  formatArducopterServoFunction
} from '../packages/param-metadata/dist/index.js'

// Pins the SERVOn_FUNCTION -> motor-number mapping against ArduPilot's
// SRV_Channel Aux_servo_function_t enum (verified against libraries/SRV_Channel/
// SRV_Channel.h). Motors occupy THREE non-contiguous blocks: 33-40 (M1-8),
// 82-85 (M9-12), 160-179 (M13-32). A wrong mapping is flight-relevant (drives
// motor-test instance + the reorder preview), so lock the boundaries.
test('motor blocks 33-40 / 82-85 / 160-179 map to motor numbers 1-32', () => {
  const expected = new Map([
    [33, 1], [34, 2], [35, 3], [36, 4], [37, 5], [38, 6], [39, 7], [40, 8], // M1-8
    [82, 9], [83, 10], [84, 11], [85, 12], // M9-12
    [160, 13], [161, 14], [170, 23], [178, 31], [179, 32] // M13-32 (sampled)
  ])
  for (const [fn, motor] of expected) {
    assert.equal(arducopterMotorNumberForServoFunction(fn), motor, `SERVOn_FUNCTION ${fn} -> Motor ${motor}`)
  }
})

test('non-motor / out-of-block function values are not treated as motors', () => {
  for (const fn of [undefined, -1, 0, 1, 32, 41, 81, 86, 159, 180, 200]) {
    assert.equal(
      arducopterMotorNumberForServoFunction(fn),
      undefined,
      `function ${fn} must not map to a motor number`
    )
  }
})

test('Motor 13-32 functions also resolve to "Motor N" labels', () => {
  assert.equal(formatArducopterServoFunction(160), 'Motor 13')
  assert.equal(formatArducopterServoFunction(179), 'Motor 32')
  // Sanity: the existing blocks still label correctly.
  assert.equal(formatArducopterServoFunction(33), 'Motor 1')
  assert.equal(formatArducopterServoFunction(85), 'Motor 12')
})
