// @vitest-environment jsdom

// Component tests for the simulator's conditions panel.
//
// The view-model beside this file is well covered on its own, but the bug
// that reached the browser last time was in the wiring, not the logic -- a
// notice rendered in a block that unmounted at the moment it had something to
// say. These cover the wiring: what renders, and what each control writes.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SitlConditions } from './SitlConditions'

// Without this each render stacks on the last one's DOM, and every query
// after the first test answers from a stale panel.
afterEach(cleanup)

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

const renderPanel = (overrides: Record<string, number> = {}, live = true) => {
  const onSet = vi.fn().mockResolvedValue(undefined)
  render(<SitlConditions parameters={{ ...healthy, ...overrides }} onSet={onSet} live={live} />)
  return onSet
}

describe('the conditions panel', () => {
  it('shows nothing while the link is down', () => {
    // There is no vehicle to drive, and a panel of controls that silently do
    // nothing is worse than no panel.
    renderPanel({}, false)
    expect(screen.queryByText('Faults')).toBeNull()
  })

  it('groups the controls the vehicle carries', () => {
    renderPanel()
    for (const title of ['Time', 'Wind', 'Battery', 'Faults']) {
      expect(screen.getByText(title)).toBeTruthy()
    }
  })

  it('leaves out a control this build does not have', () => {
    const without = { ...healthy }
    delete without.SIM_BARO_DISABLE
    const onSet = vi.fn().mockResolvedValue(undefined)
    render(<SitlConditions parameters={without} onSet={onSet} live />)
    expect(screen.queryByLabelText(/Barometer failed/)).toBeNull()
    expect(screen.getByLabelText(/Compass failed/)).toBeTruthy()
  })

  it('writes the failed value when a fault switch is turned on', async () => {
    const onSet = renderPanel()
    await act(async () => {
      screen.getByLabelText(/Compass failed/).click()
    })
    expect(onSet).toHaveBeenCalledWith([{ parameter: 'SIM_MAG1_FAIL', value: 1 }])
  })

  it('writes zero to an enable-shaped parameter when its fault is turned on', async () => {
    // "GPS lost" on means SIM_GPS1_ENABLE off. Getting this backwards would
    // write 1 and quietly leave the GPS working.
    const onSet = renderPanel()
    await act(async () => {
      screen.getByLabelText(/GPS lost/).click()
    })
    expect(onSet).toHaveBeenCalledWith([{ parameter: 'SIM_GPS1_ENABLE', value: 0 }])
  })

  it('shows a fault switch as on when the vehicle reports the fault', () => {
    renderPanel({ SIM_GPS1_ENABLE: 0 })
    expect((screen.getByLabelText(/GPS lost/) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText(/Compass failed/) as HTMLInputElement).checked).toBe(false)
  })

  it('offers nothing to clear on a healthy vehicle', () => {
    // The thrust scaler rests at 0, not 1, so treating "not 1" as damage
    // would leave this button lit on every untouched vehicle.
    renderPanel()
    expect((screen.getByRole('button', { name: 'Clear faults' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    expect(screen.queryByText(/active/)).toBeNull()
  })

  it('clears only what is actually broken', async () => {
    const onSet = renderPanel({ SIM_MAG1_FAIL: 1, SIM_WIND_SPD: 18 })
    expect(screen.getByText('1 active')).toBeTruthy()
    await act(async () => {
      screen.getByRole('button', { name: 'Clear faults' }).click()
    })
    // The wind is a condition, not damage, and must survive the clear.
    expect(onSet).toHaveBeenCalledWith([{ parameter: 'SIM_MAG1_FAIL', value: 0 }])
  })

  it('accumulates arrow-key steps instead of snapping back each press', () => {
    // Each keypress commits, and the vehicle takes about a second to confirm.
    // If the handle drops its local position at that moment it springs back
    // to the value the vehicle still holds, so the next press starts from
    // scratch and the slider can never get past one step.
    const onSet = vi.fn().mockResolvedValue(undefined)
    render(<SitlConditions parameters={healthy} onSet={onSet} live />)
    const wind = screen.getByLabelText('Speed', { selector: '#sim-SIM_WIND_SPD' })

    for (const value of [0.5, 1, 1.5, 2]) {
      fireEvent.change(wind, { target: { value: String(value) } })
      fireEvent.keyUp(wind)
    }

    expect((wind as HTMLInputElement).value).toBe('2')
    expect(onSet).toHaveBeenLastCalledWith([{ parameter: 'SIM_WIND_SPD', value: 2 }])
  })

  it('hands the handle back to the vehicle once it confirms', () => {
    const onSet = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(<SitlConditions parameters={healthy} onSet={onSet} live />)
    const wind = screen.getByLabelText('Speed', { selector: '#sim-SIM_WIND_SPD' })
    fireEvent.change(wind, { target: { value: '6' } })
    fireEvent.keyUp(wind)

    // The vehicle confirms 6, then later reports 9 because something else
    // moved it. The handle must follow, not sit on its own stale 6.
    rerender(<SitlConditions parameters={{ ...healthy, SIM_WIND_SPD: 6 }} onSet={onSet} live />)
    rerender(<SitlConditions parameters={{ ...healthy, SIM_WIND_SPD: 9 }} onSet={onSet} live />)
    expect((screen.getByLabelText('Speed', { selector: '#sim-SIM_WIND_SPD' }) as HTMLInputElement).value).toBe('9')
  })
})
