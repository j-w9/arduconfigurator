// @vitest-environment jsdom

// Component tests for the AMC tab.
//
// These exist because two bugs reached the browser that the pure view-model
// tests could not have caught: a memo that read a ref declared below it, which
// took the tab down the moment it opened, and a save effect that fired on a
// key change carrying the previous vehicle's values, which wrote an empty
// declaration over the stored one at exactly the moment it should have been
// restored. Both are render and effect ordering, and neither is visible from
// outside a render.

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AmcGuidedView } from './AmcGuidedView'
import { UNATTACHED_KEY, loadAmcProgress, saveAmcProgress } from '../amc-progress-storage'

// Node ships an experimental localStorage that shadows jsdom's, and without a
// storage file it accepts writes and discards them -- so nothing persists and
// every restore looks like an empty slot. A working one is installed here.
// (The module under test survives the broken one; that is covered separately in
// amc-progress-storage.test.ts.)
let writes: { op: 'set' | 'remove'; key: string; value?: string }[] = []

function installStorage() {
  const map = new Map<string, string>()
  writes = []
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        writes.push({ op: 'set', key, value })
        map.set(key, value)
      },
      removeItem: (key: string) => {
        writes.push({ op: 'remove', key })
        map.delete(key)
      },
      clear: () => map.clear()
    }
  })
}

beforeEach(installStorage)

afterEach(() => {
  cleanup()
})

const base = {
  connected: false,
  parameters: {},
  staged: {},
  onStage: () => {},
  onDocsVehicleChange: () => {},
  progressKey: UNATTACHED_KEY
}

/** The sequence is dynamic-imported, so the first paint is a loading state. */
const whenLoaded = async () => {
  await waitFor(() => expect(screen.getByText(/Declare the vehicle/i)).toBeTruthy(), { timeout: 5000 })
  await waitFor(() => expect(screen.queryByText(/Loading the .* sequence/i)).toBeNull(), { timeout: 5000 })
}

describe('rendering', () => {
  it('opens without throwing', async () => {
    // The regression this file was written for: the tab crashed on open.
    render(<AmcGuidedView {...base} />)
    await whenLoaded()
    expect(screen.getByText(/AMC guided mode/i)).toBeTruthy()
  })

  it('shows the sequence grouped under its phases', async () => {
    render(<AmcGuidedView {...base} />)
    await whenLoaded()
    await waitFor(() => expect(screen.getByText('Basic mandatory configuration')).toBeTruthy(), { timeout: 5000 })
    expect(screen.getByText('Standard tuning')).toBeTruthy()
    // The optional phases are marked as such, so a required one is not mistaken
    // for something that can be skipped.
    expect(screen.getAllByText('optional').length).toBeGreaterThan(0)
    expect(screen.getAllByText('required').length).toBeGreaterThan(0)
  })

  it('names the milestones that own no steps', async () => {
    render(<AmcGuidedView {...base} />)
    await whenLoaded()
    await waitFor(
      () => expect(screen.getByText(/Assemble all components except the propellers/)).toBeTruthy(),
      { timeout: 5000 }
    )
  })
})

describe('progress', () => {
  it('restores a declaration that belongs to this vehicle', async () => {
    const key = 'arduconfig.amc-progress.uid:abc'
    saveAmcProgress(key, {
      vehicleKind: 'ArduCopter',
      declaration: { 'Propellers/Specifications/Diameter_inches': '13' },
      reviewed: []
    })
    render(<AmcGuidedView {...base} progressKey={key} />)
    await whenLoaded()
    await waitFor(() => expect(screen.getByDisplayValue('13')).toBeTruthy(), { timeout: 5000 })
  })

  it('never writes to a vehicle\'s slot before reading it', async () => {
    // The regression, stated as the invariant that failed. The key changes the
    // instant a vehicle connects, and the values in hand still belong to
    // whatever came before -- so the first thing that must happen to a slot is
    // a read, never a write. Asserting only the final stored content misses
    // this: React's effect order happens to rewrite the right values a render
    // later, so the damage is invisible by the time the dust settles. It is
    // the write in between that destroys the operator's work.
    const other = 'arduconfig.amc-progress.uid:other'
    saveAmcProgress(other, {
      vehicleKind: 'ArduCopter',
      declaration: { 'Propellers/Specifications/Diameter_inches': '7' },
      reviewed: ['05_board_orientation.param']
    })

    const view = render(<AmcGuidedView {...base} progressKey={UNATTACHED_KEY} />)
    await whenLoaded()
    writes.length = 0

    // Now "connect": the same component, a different vehicle's key.
    view.rerender(<AmcGuidedView {...base} progressKey={other} />)
    await waitFor(() => expect(screen.getByDisplayValue('7')).toBeTruthy(), { timeout: 5000 })

    // Nothing may have removed or emptied this vehicle's record along the way.
    const destructive = writes.filter(
      (write) =>
        write.key === other &&
        (write.op === 'remove' || !write.value?.includes('Diameter_inches'))
    )
    expect(destructive).toEqual([])

    const stored = loadAmcProgress(other)
    expect(stored?.declaration).toEqual({ 'Propellers/Specifications/Diameter_inches': '7' })
    expect(stored?.reviewed).toEqual(['05_board_orientation.param'])
  })

  it('offers work declared before connecting rather than applying it', async () => {
    saveAmcProgress(UNATTACHED_KEY, {
      vehicleKind: 'ArduCopter',
      declaration: { 'Propellers/Specifications/Diameter_inches': '9' },
      reviewed: []
    })
    const view = render(<AmcGuidedView {...base} progressKey={UNATTACHED_KEY} />)
    await whenLoaded()
    view.rerender(<AmcGuidedView {...base} progressKey="arduconfig.amc-progress.uid:fresh" />)

    // Offered, not applied: the field stays empty until the operator says so.
    await waitFor(() => expect(screen.getByText(/declared a vehicle before connecting/i)).toBeTruthy(), {
      timeout: 5000
    })
    expect(screen.queryByDisplayValue('9')).toBeNull()
  })

  it('fills the firmware version in from the vehicle', async () => {
    render(<AmcGuidedView {...base} connected vehicleFirmwareVersion="4.6.0 (official)" />)
    await whenLoaded()
    await waitFor(() => expect(screen.getByDisplayValue('4.6.0 (official)')).toBeTruthy(), { timeout: 5000 })
    expect(screen.getByText(/read from the vehicle/i)).toBeTruthy()
  })

  it('leaves a version the operator already answered alone', async () => {
    const key = 'arduconfig.amc-progress.uid:typed'
    saveAmcProgress(key, {
      vehicleKind: 'ArduCopter',
      declaration: { 'Flight Controller/Firmware/Version': '4.7.1 beta' },
      reviewed: []
    })
    render(<AmcGuidedView {...base} connected progressKey={key} vehicleFirmwareVersion="4.6.0" />)
    await whenLoaded()
    await waitFor(() => expect(screen.getByDisplayValue('4.7.1 beta')).toBeTruthy(), { timeout: 5000 })
    expect(screen.queryByDisplayValue('4.6.0')).toBeNull()
  })
})

describe('staging', () => {
  it('does not offer to stage without a vehicle', async () => {
    const onStage = vi.fn()
    render(<AmcGuidedView {...base} onStage={onStage} />)
    await whenLoaded()
    expect(screen.queryByText(/Stage all/i)).toBeNull()
    expect(onStage).not.toHaveBeenCalled()
  })
})
