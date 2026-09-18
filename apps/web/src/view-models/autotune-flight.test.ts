import { describe, expect, it } from 'vitest'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import {
  AUTOTUNE_AXIS_BITS,
  compareAutotuneGains,
  describeAxisMask,
  readAutotuneGains
} from './autotune-flight'

// AUTOTUNE_AXES is a bitmask — AC_AutoTune_Multi.cpp, "@Bitmask: 0:Roll,
// 1:Pitch,2:Yaw,3:YawD", default 7.

function snapshotWith(values: Record<string, number>): ConfiguratorSnapshot {
  return {
    parameters: Object.entries(values).map(([id, value], index) => ({ id, value, index, count: 0 }))
  } as unknown as ConfiguratorSnapshot
}

const ROLL_PITCH = AUTOTUNE_AXIS_BITS.ROLL | AUTOTUNE_AXIS_BITS.PITCH

const BEFORE = {
  ATC_RAT_RLL_P: 0.135,
  ATC_RAT_RLL_I: 0.135,
  ATC_RAT_RLL_D: 0.0036,
  ATC_ANG_RLL_P: 4.5,
  ATC_RAT_PIT_P: 0.135,
  ATC_RAT_PIT_I: 0.135,
  ATC_RAT_PIT_D: 0.0036,
  ATC_ANG_PIT_P: 4.5
}

describe('autotune flight comparison', () => {
  it('reads only the gains for the requested axes', () => {
    const gains = readAutotuneGains(snapshotWith({ ...BEFORE, ATC_RAT_YAW_P: 0.18 }), ROLL_PITCH)
    expect(Object.keys(gains).sort()).toEqual(
      ['ATC_ANG_PIT_P', 'ATC_ANG_RLL_P', 'ATC_RAT_PIT_D', 'ATC_RAT_PIT_I', 'ATC_RAT_PIT_P', 'ATC_RAT_RLL_D', 'ATC_RAT_RLL_I', 'ATC_RAT_RLL_P']
    )
    expect(gains.ATC_RAT_YAW_P).toBeUndefined()
  })

  it('reports a completed tune when the gains moved', () => {
    const after = snapshotWith({ ...BEFORE, ATC_RAT_RLL_P: 0.162, ATC_RAT_PIT_P: 0.151 })
    const result = compareAutotuneGains(BEFORE, after, ROLL_PITCH)
    expect(result.changedAxes).toEqual(['Roll', 'Pitch'])
    expect(result.complete).toBe(true)
  })

  it('reports PER AXIS, because autotune can finish one and not the other', () => {
    // Roll saved, pitch did not. "It didn't work" would be wrong about half of
    // this flight, and the operator needs to know which axis to re-fly.
    const after = snapshotWith({ ...BEFORE, ATC_RAT_RLL_P: 0.162 })
    const result = compareAutotuneGains(BEFORE, after, ROLL_PITCH)
    expect(result.changedAxes).toEqual(['Roll'])
    expect(result.unchangedAxes).toEqual(['Pitch'])
    expect(result.complete).toBe(false)
  })

  it('counts an axis as tuned when ANY of its gains moved', () => {
    // Autotune does not necessarily rewrite every term; requiring all of them
    // would report a successful tune as a failure.
    const after = snapshotWith({ ...BEFORE, ATC_RAT_RLL_D: 0.0041 })
    expect(compareAutotuneGains(BEFORE, after, AUTOTUNE_AXIS_BITS.ROLL).changedAxes).toEqual(['Roll'])
  })

  it('treats untouched gains as not tuned', () => {
    const result = compareAutotuneGains(BEFORE, snapshotWith(BEFORE), ROLL_PITCH)
    expect(result.changedAxes).toEqual([])
    expect(result.complete).toBe(false)
  })

  it('names the axes in a mask', () => {
    expect(describeAxisMask(7)).toBe('Roll, Pitch, Yaw')
    expect(describeAxisMask(AUTOTUNE_AXIS_BITS.ROLL)).toBe('Roll')
    expect(describeAxisMask(0)).toBe('none')
  })
})

describe('zeroize tune', () => {
  it('stages only the gains that actually differ from stock', async () => {
    const { autotuneGainsToReset, AUTOTUNE_GAIN_DEFAULTS } = await import('./autotune-flight')
    // Roll tuned away from stock, pitch left at stock.
    const after = snapshotWith({
      ...BEFORE,
      ATC_RAT_RLL_P: 0.162,
      ATC_RAT_RLL_D: 0.0051
    })
    const reset = autotuneGainsToReset(after, ROLL_PITCH)
    expect(reset.map((entry) => entry.id).sort()).toEqual(['ATC_RAT_RLL_D', 'ATC_RAT_RLL_P'])
    // Targets are ArduCopter's own defaults, not zero — "zeroize" means back to
    // stock, and a literal zero P gain would be unflyable.
    expect(reset.find((entry) => entry.id === 'ATC_RAT_RLL_P')?.to).toBe(AUTOTUNE_GAIN_DEFAULTS.ATC_RAT_RLL_P)
    expect(reset.find((entry) => entry.id === 'ATC_RAT_RLL_P')?.to).toBe(0.135)
  })

  it('stages nothing when the axis is already stock', async () => {
    const { autotuneGainsToReset } = await import('./autotune-flight')
    expect(autotuneGainsToReset(snapshotWith(BEFORE), ROLL_PITCH)).toEqual([])
  })

  it('leaves axes outside the mask alone', async () => {
    const { autotuneGainsToReset } = await import('./autotune-flight')
    const after = snapshotWith({ ...BEFORE, ATC_RAT_YAW_P: 0.33 })
    expect(autotuneGainsToReset(after, ROLL_PITCH)).toEqual([])
  })
})

describe('float32 parameter precision', () => {
  it('does not report a float32 round-trip as a changed gain', async () => {
    const { autotuneGainsToReset, compareAutotuneGains, AUTOTUNE_GAIN_DEFAULTS } = await import(
      './autotune-flight'
    )
    // MAVLink carries parameters as float32: a firmware value of exactly 0.135
    // arrives as 0.135000005364418. Comparing that to a float64 literal with a
    // tight epsilon invents a difference — the zeroize hint said 7 gains needed
    // resetting on a vehicle where only 4 did.
    const asFloat32 = (value: number) => Math.fround(value)
    const wire = snapshotWith({
      ATC_RAT_RLL_P: asFloat32(AUTOTUNE_GAIN_DEFAULTS.ATC_RAT_RLL_P),
      ATC_RAT_RLL_I: asFloat32(AUTOTUNE_GAIN_DEFAULTS.ATC_RAT_RLL_I),
      ATC_RAT_RLL_D: asFloat32(AUTOTUNE_GAIN_DEFAULTS.ATC_RAT_RLL_D),
      ATC_ANG_RLL_P: asFloat32(AUTOTUNE_GAIN_DEFAULTS.ATC_ANG_RLL_P)
    })
    expect(autotuneGainsToReset(wire, AUTOTUNE_AXIS_BITS.ROLL)).toEqual([])

    // ...and the same tolerance must not hide a real tune, which moves gains by
    // far more than float32 noise.
    const tuned = snapshotWith({ ATC_RAT_RLL_P: 0.162, ATC_RAT_RLL_I: 0.135, ATC_RAT_RLL_D: 0.0036, ATC_ANG_RLL_P: 4.5 })
    expect(
      compareAutotuneGains({ ATC_RAT_RLL_P: 0.135, ATC_RAT_RLL_I: 0.135, ATC_RAT_RLL_D: 0.0036, ATC_ANG_RLL_P: 4.5 }, tuned, AUTOTUNE_AXIS_BITS.ROLL).changedAxes
    ).toEqual(['Roll'])
  })
})
