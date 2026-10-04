import { describe, expect, it } from 'vitest'

import { buildMaskOutputRows, isOutputSet, normalizeMask, outputsFromServoFunctions, withOutputBit } from './output-mask'

describe('output mask helpers', () => {
  it('normalises draft text and live numbers', () => {
    expect(normalizeMask('15')).toBe(15)
    expect(normalizeMask('')).toBe(0)
    expect(normalizeMask(undefined)).toBe(0)
    expect(normalizeMask(-1)).toBe(4294967295)
  })

  it('flips only the addressed output and preserves every other bit', () => {
    // Outputs 9 and 32 are set on the vehicle but not shown as motors.
    const live = 2 ** 8 + 2 ** 31
    const on = withOutputBit(live, 1, true)
    expect(on).toBe(live + 1)
    expect(withOutputBit(on, 1, false)).toBe(live)
    // Setting an already-set bit, or clearing a clear one, is a no-op.
    expect(withOutputBit(live, 9, true)).toBe(live)
    expect(withOutputBit(live, 2, false)).toBe(live)
    expect(isOutputSet(live, 32)).toBe(true)
    expect(isOutputSet(live, 1)).toBe(false)
  })

  it('ignores outputs that cannot be addressed', () => {
    expect(withOutputBit(5, 0, true)).toBe(5)
    expect(withOutputBit(5, 33, true)).toBe(5)
    expect(isOutputSet(5, 0)).toBe(false)
  })

  it('builds output-ordered rows, motors tagged', () => {
    const rows = buildMaskOutputRows(0b0101, [
      { channelNumber: 3, motorNumber: 1 },
      { channelNumber: 2 },
      { channelNumber: 1, motorNumber: 2 }
    ])
    expect(rows.map((row) => row.label)).toEqual(['1 · M2', '2', '3 · M1'])
    expect(rows.map((row) => row.checked)).toEqual([true, false, true])
  })

  it('offers one output per reported SERVOn_FUNCTION, not 32', () => {
    const ids = ['SERVO1_FUNCTION', 'SERVO10_FUNCTION', 'SERVO2_FUNCTION', 'SERVO_BLH_BDMASK', 'SERVO2_MIN']
    expect(outputsFromServoFunctions(ids, [{ channelNumber: 2, motorNumber: 1 }])).toEqual([
      { channelNumber: 1 },
      { channelNumber: 2, motorNumber: 1 },
      { channelNumber: 10 }
    ])
  })
})
