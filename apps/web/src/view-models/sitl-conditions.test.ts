import { describe, expect, it } from 'vitest'

import {
  SIM_CONTROL_GROUPS,
  activeFaultCount,
  availableGroups,
  formatControlValue,
  healthyWrites,
  switchIsOn,
  switchValue,
  type SimControl
} from './sitl-conditions'

/** Every parameter the panel can offer, as one flat list. */
const everyParameter = SIM_CONTROL_GROUPS.flatMap((group) =>
  group.controls.map((control) => control.parameter)
)

/** A vehicle carrying all of them, at rest. */
const healthy: Record<string, number> = {
  SIM_SPEEDUP: 1,
  SIM_WIND_SPD: 0,
  SIM_WIND_DIR: 180,
  SIM_WIND_TURB: 0,
  SIM_BATT_VOLTAGE: 12.6,
  SIM_BATT_CAP_AH: 3.3,
  SIM_GPS1_ENABLE: 1,
  SIM_GPS1_JAM: 0,
  SIM_GPS1_NUMSATS: 10,
  SIM_MAG1_FAIL: 0,
  SIM_BARO_DISABLE: 0,
  SIM_RC_FAIL: 0,
  SIM_ENGINE_MUL: 0,
  SIM_ENGINE_FAIL: 0
}

const control = (name: string): SimControl => {
  const found = SIM_CONTROL_GROUPS.flatMap((group) => group.controls).find(
    (entry) => entry.parameter === name
  )
  if (!found) throw new Error(`no control for ${name}`)
  return found
}

describe('declaring the controls', () => {
  it('only offers SIM_ parameters', () => {
    // The panel's whole premise is that it drives the simulator and nothing
    // else. A control on a non-SIM_ parameter would be reconfiguring the
    // vehicle under the guise of changing the weather.
    expect(everyParameter.every((name) => name.startsWith('SIM_'))).toBe(true)
  })

  it('names each parameter once', () => {
    expect(new Set(everyParameter).size).toBe(everyParameter.length)
  })

  it('gives every slider a range and every choice its options', () => {
    for (const group of SIM_CONTROL_GROUPS) {
      for (const entry of group.controls) {
        if (entry.kind === 'slider') {
          expect(entry.min, entry.parameter).toBeTypeOf('number')
          expect(entry.max, entry.parameter).toBeTypeOf('number')
          expect(entry.max as number, entry.parameter).toBeGreaterThan(entry.min as number)
        }
        if (entry.kind === 'choice') expect(entry.choices?.length ?? 0).toBeGreaterThan(1)
        // Hints are the only thing saying what a control does to the vehicle.
        expect(entry.hint.length, entry.parameter).toBeGreaterThan(10)
      }
    }
  })
})

describe('offering only what the build has', () => {
  it('keeps the controls the vehicle carries', () => {
    const groups = availableGroups(healthy)
    expect(groups.flatMap((group) => group.controls).length).toBe(everyParameter.length)
  })

  it('drops a control whose parameter this build does not have', () => {
    // The WebAssembly build carries 384 of the ~630 SIM_ parameters upstream
    // documents, and which ones depends on the vehicle. A missing one means
    // this build does not simulate that part -- not that the control is
    // broken -- so it goes away rather than showing up disabled.
    const { SIM_BARO_DISABLE: _dropped, ...withoutBaro } = healthy
    const names = availableGroups(withoutBaro).flatMap((group) =>
      group.controls.map((entry) => entry.parameter)
    )
    expect(names).not.toContain('SIM_BARO_DISABLE')
    expect(names).toContain('SIM_MAG1_FAIL')
  })

  it('drops a group left with nothing in it', () => {
    const windless = { ...healthy }
    delete windless.SIM_WIND_SPD
    delete windless.SIM_WIND_DIR
    delete windless.SIM_WIND_TURB
    expect(availableGroups(windless).map((group) => group.id)).not.toContain('wind')
  })

  it('offers nothing without a vehicle', () => {
    expect(availableGroups(undefined)).toEqual([])
  })
})

describe('switch polarity', () => {
  it('reads an enable-shaped parameter as a fault when it is off', () => {
    // SIM_GPS1_ENABLE is 1 when the GPS is WORKING, but it sits under Faults
    // where every switch means "this is broken". Getting this backwards would
    // present a healthy vehicle as having lost its GPS.
    const gps = control('SIM_GPS1_ENABLE')
    expect(switchIsOn(gps, 1)).toBe(false)
    expect(switchIsOn(gps, 0)).toBe(true)
    expect(switchValue(gps, true)).toBe(0)
    expect(switchValue(gps, false)).toBe(1)
  })

  it('reads a fail-shaped parameter as a fault when it is on', () => {
    const mag = control('SIM_MAG1_FAIL')
    expect(switchIsOn(mag, 1)).toBe(true)
    expect(switchIsOn(mag, 0)).toBe(false)
    expect(switchValue(mag, true)).toBe(1)
    expect(switchValue(mag, false)).toBe(0)
  })

  it('round-trips every switch through both positions', () => {
    for (const entry of SIM_CONTROL_GROUPS.flatMap((group) => group.controls)) {
      if (entry.kind !== 'switch') continue
      expect(switchIsOn(entry, switchValue(entry, true)), entry.parameter).toBe(true)
      expect(switchIsOn(entry, switchValue(entry, false)), entry.parameter).toBe(false)
    }
  })

  it('is off when the vehicle has not reported the parameter', () => {
    expect(switchIsOn(control('SIM_MAG1_FAIL'), undefined)).toBe(false)
  })
})

describe('showing a value', () => {
  it('takes its precision from the step', () => {
    expect(formatControlValue(control('SIM_WIND_DIR'), 180)).toBe('180 °')
    expect(formatControlValue(control('SIM_WIND_SPD'), 12.5)).toBe('12.5 m/s')
    expect(formatControlValue(control('SIM_ENGINE_MUL'), 0.25)).toBe('0.25')
  })

  it('says nothing rather than zero for a value it does not have', () => {
    expect(formatControlValue(control('SIM_WIND_SPD'), undefined)).toBe('—')
  })
})

describe('counting what is broken', () => {
  const count = (overrides: Record<string, number>) => {
    const parameters = { ...healthy, ...overrides }
    return activeFaultCount(availableGroups(parameters), parameters)
  }

  it('finds nothing wrong with a healthy vehicle', () => {
    expect(count({})).toBe(0)
  })

  it('counts a failed compass and a lost GPS', () => {
    expect(count({ SIM_MAG1_FAIL: 1 })).toBe(1)
    expect(count({ SIM_MAG1_FAIL: 1, SIM_GPS1_ENABLE: 0 })).toBe(2)
  })

  it('counts a degraded fix but not a healthy satellite count', () => {
    expect(count({ SIM_GPS1_NUMSATS: 10 })).toBe(0)
    expect(count({ SIM_GPS1_NUMSATS: 4 })).toBe(1)
  })

  it('counts the failed-motor mask, not the scaler beside it', () => {
    // SIM_ENGINE_MUL alone does nothing: it scales thrust on whichever
    // motors SIM_ENGINE_FAIL names, and by default it names none. Its own
    // default is 0, so treating "not 1" as a fault would report every
    // untouched vehicle as having a dead motor.
    expect(count({ SIM_ENGINE_MUL: 0 })).toBe(0)
    expect(count({ SIM_ENGINE_FAIL: 1 })).toBe(1)
    expect(count({ SIM_ENGINE_MUL: 0, SIM_ENGINE_FAIL: 1 })).toBe(1)
  })

  it('does not count the weather as a fault', () => {
    expect(count({ SIM_WIND_SPD: 20, SIM_WIND_TURB: 10, SIM_SPEEDUP: 5 })).toBe(0)
  })

  it('counts a broken radio link', () => {
    expect(count({ SIM_RC_FAIL: 1 })).toBe(1)
  })
})

describe('putting the faults back', () => {
  const writes = (overrides: Record<string, number>) => {
    const parameters = { ...healthy, ...overrides }
    return healthyWrites(availableGroups(parameters), parameters)
  }

  it('writes nothing to a vehicle with nothing wrong', () => {
    expect(writes({})).toEqual([])
  })

  it('leaves the thrust scaler alone', () => {
    // It is inert while no motor is masked in, and its resting value is 0,
    // so "putting it back" would mean writing a value it never had.
    expect(writes({ SIM_ENGINE_MUL: 0, SIM_ENGINE_FAIL: 2 })).toEqual([
      { parameter: 'SIM_ENGINE_FAIL', value: 0 }
    ])
  })

  it('writes only the faults that are actually set', () => {
    // A "clear" that rewrites all eight every time would report eight
    // verified changes for one broken compass, which is not what happened.
    expect(writes({ SIM_MAG1_FAIL: 1 })).toEqual([{ parameter: 'SIM_MAG1_FAIL', value: 0 }])
  })

  it('restores a healthy value that is not zero', () => {
    expect(writes({ SIM_GPS1_ENABLE: 0, SIM_GPS1_NUMSATS: 0 })).toEqual([
      { parameter: 'SIM_GPS1_ENABLE', value: 1 },
      { parameter: 'SIM_GPS1_NUMSATS', value: 10 }
    ])
  })

  it('leaves the weather and the clock alone', () => {
    // Wind is a condition, not a fault. Clearing faults on a windy day must
    // not quietly land the vehicle in still air.
    const touched = writes({ SIM_WIND_SPD: 20, SIM_SPEEDUP: 5, SIM_MAG1_FAIL: 1 })
    expect(touched.map((entry) => entry.parameter)).toEqual(['SIM_MAG1_FAIL'])
  })

  it('clears everything activeFaultCount can see', () => {
    const broken = {
      ...healthy,
      SIM_GPS1_ENABLE: 0,
      SIM_GPS1_JAM: 1,
      SIM_GPS1_NUMSATS: 2,
      SIM_MAG1_FAIL: 1,
      SIM_BARO_DISABLE: 1,
      SIM_RC_FAIL: 1,
      SIM_ENGINE_MUL: 0,
      SIM_ENGINE_FAIL: 3
    }
    const groups = availableGroups(broken)
    expect(activeFaultCount(groups, broken)).toBeGreaterThan(0)
    const after: Record<string, number> = { ...broken }
    for (const entry of healthyWrites(groups, broken)) after[entry.parameter] = entry.value
    expect(activeFaultCount(availableGroups(after), after)).toBe(0)
  })
})
