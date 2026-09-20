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

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

describe('capturing settings already on the vehicle', () => {
  // 94 steps take account of parameters they do not set. Rendering that needs
  // the firmware's own defaults, so both states matter: what the step says
  // when it has them, and what it says when it does not.
  // RC_SPEED matches the `RC_.*` pattern a step declares; RC1_MIN does not,
  // because that pattern needs a literal `RC_` prefix and RC1_ is a different
  // family. Worth keeping both here: it is exactly the mistake that makes a
  // capture rule look broken when it is the fixture that is wrong.
  const RC_DEFAULTS = new Map([
    ['RC_SPEED', 490],
    ['RC1_MIN', 1100],
    ['RC1_MAX', 1900]
  ])
  const RC_LIVE = { RC_SPEED: 400, RC1_MIN: 982, RC1_MAX: 1900 }

  it('asks for the defaults rather than looking like it found nothing', async () => {
    const onReadDefaults = vi.fn()
    render(<AmcGuidedView {...base} connected parameters={RC_LIVE} onReadDefaults={onReadDefaults} />)
    await whenLoaded()
    await waitFor(() => expect(screen.getAllByText(/needs defaults/i).length).toBeGreaterThan(0), { timeout: 5000 })

    // The offer is real: pressing it asks the vehicle.
    const [step] = screen.getAllByText(/needs defaults/i)
    step.closest('button')?.click()
    await waitFor(() => expect(screen.getAllByText(/Read them from the vehicle/i).length).toBeGreaterThan(0), {
      timeout: 5000
    })
    screen.getAllByText(/Read them from the vehicle/i)[0].click()
    expect(onReadDefaults).toHaveBeenCalled()
  })

  it('claims a changed value once the defaults are known', async () => {
    render(<AmcGuidedView {...base} connected parameters={RC_LIVE} defaults={RC_DEFAULTS} />)
    await whenLoaded()
    // Nothing asks for defaults any more...
    await waitFor(() => expect(screen.queryAllByText(/needs defaults/i)).toEqual([]), { timeout: 5000 })

    // ...and the step that owns RC_SPEED claims it. The claim lives in the
    // step's body, so the step has to be open to see it -- which is the whole
    // reason this is a component test and not a view-model one.
    const step = await waitFor(
      () => {
        const found = screen.getByText(/Remote controller receiver/i).closest('button')
        if (!found) throw new Error('step not rendered yet')
        return found
      },
      { timeout: 5000 }
    )
    step.click()
    const claim = await waitFor(() => screen.getByText(/belong to this step/i), { timeout: 5000 })
    // Scoped to the step. RC_SPEED also appears in the configuration summary,
    // which is a different statement about the same parameter: one says the
    // step is responsible for it, the other that it differs from default.
    const within = claim.closest('details')
    expect(within?.textContent).toContain('RC_SPEED')
  })

  it('claims nothing when every value is already its default', async () => {
    render(
      <AmcGuidedView
        {...base}
        connected
        parameters={{ RC_SPEED: 490, RC1_MIN: 1100 }}
        defaults={RC_DEFAULTS}
      />
    )
    await whenLoaded()
    await waitFor(() => expect(screen.queryAllByText(/needs defaults/i)).toEqual([]), { timeout: 5000 })
    // Open the same step: with nothing changed there is nothing to claim.
    screen.getByText(/Remote controller receiver/i).closest('button')?.click()
    await waitFor(() => expect(screen.getByText(/Declare the vehicle/i)).toBeTruthy(), { timeout: 5000 })
    expect(screen.queryAllByText(/belong to this step/i)).toEqual([])
  })
})

describe('what this vehicle has', () => {
  // The summary exists to separate what somebody chose from what the vehicle
  // wrote about itself, so the interesting assertions are about that split --
  // and about saying so when the split cannot be made.
  const DEFAULTS = new Map([
    ['RC_SPEED', 490],
    ['COMPASS_OFS_X', 0],
    ['SYSID_THISMAV', 1]
  ])
  const LIVE = { RC_SPEED: 400, COMPASS_OFS_X: 42, SYSID_THISMAV: 7 }

  it('says nothing at all without the vehicle\'s defaults', async () => {
    // Every category is a statement about differing from a default.
    render(<AmcGuidedView {...base} connected parameters={LIVE} />)
    await whenLoaded()
    expect(screen.queryByText(/What this vehicle has/i)).toBeNull()
  })

  it('counts what differs from the firmware default', async () => {
    render(<AmcGuidedView {...base} connected parameters={LIVE} defaults={DEFAULTS} />)
    await whenLoaded()
    await waitFor(() => expect(screen.getByText(/What this vehicle has/i)).toBeTruthy(), { timeout: 5000 })
    expect(screen.getByText(/of 3/)).toBeTruthy()
  })

  it('keeps the vehicle\'s identity out of the decisions', async () => {
    render(<AmcGuidedView {...base} connected parameters={LIVE} defaults={DEFAULTS} />)
    await whenLoaded()
    await waitFor(() => expect(screen.getByText('Identity')).toBeTruthy(), { timeout: 5000 })
    expect(screen.getByText('Decisions')).toBeTruthy()
  })

  it('admits when the documentation cannot separate calibration from choice', async () => {
    // The app's generated metadata carries no @ReadOnly or @Calibration, so
    // every changed value would otherwise be presented as a decision.
    render(<AmcGuidedView {...base} connected parameters={LIVE} defaults={DEFAULTS} />)
    await whenLoaded()
    await waitFor(
      () => expect(screen.getByText(/does not carry those flags/i)).toBeTruthy(),
      { timeout: 5000 }
    )
    expect(screen.queryByText('From calibration')).toBeNull()
  })
})

describe('the configuration directory', () => {
  it('will not write an empty one', async () => {
    // An undeclared vehicle derives nothing, so the directory would record
    // nothing -- and a file that looks like a saved configuration but holds no
    // decisions is worse than no file.
    render(<AmcGuidedView {...base} />)
    await whenLoaded()
    const download = screen.getByRole('button', { name: /Download the directory/i })
    expect((download as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/Nothing is declared yet/i)).toBeTruthy()
  })

  it('writes once the vehicle is declared, and says what it wrote', async () => {
    const key = 'arduconfig.amc-progress.uid:export'
    saveAmcProgress(key, {
      vehicleKind: 'ArduCopter',
      declaration: { 'Propellers/Specifications/Diameter_inches': '10' },
      reviewed: []
    })

    // jsdom has neither of these, and a download that silently did nothing
    // would look exactly like one that worked.
    const createObjectURL = vi.fn(() => 'blob:vehicle')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    const clicked: HTMLAnchorElement[] = []
    const realClick = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      clicked.push(this)
    }

    try {
      render(<AmcGuidedView {...base} progressKey={key} />)
      await whenLoaded()
      await waitFor(() => expect(screen.getByDisplayValue('10')).toBeTruthy(), { timeout: 5000 })

      screen.getByRole('button', { name: /Download the directory/i }).click()

      await waitFor(() => expect(clicked.length).toBe(1), { timeout: 5000 })
      // Named for the vehicle, so two exports are told apart by something
      // other than "(1)".
      expect(clicked[0]?.download).toMatch(/^ArduCopter.*\.zip$/)
      expect(createObjectURL).toHaveBeenCalledTimes(1)
      // Revoked: a blob URL held open pins the whole archive in memory.
      expect(revokeObjectURL).toHaveBeenCalledTimes(1)
      expect(screen.getByText(/Written(,| ).*(files|step)/i)).toBeTruthy()
    } finally {
      HTMLAnchorElement.prototype.click = realClick
    }
  })

  it('offers a control to open one back up', async () => {
    render(<AmcGuidedView {...base} />)
    await whenLoaded()
    expect(screen.getByText(/Open a directory/i)).toBeTruthy()
  })

  it('refuses to open one before the sequence it reads against exists', async () => {
    // The silent drop this replaced: the sequence is dynamic-imported, and a
    // directory picked before it arrived was read against nothing and
    // discarded without a word. The control now says it is not ready instead.
    render(<AmcGuidedView {...base} />)
    // Read synchronously, on the first paint: the sequence resolves fast
    // enough here that any await would step past the window being asserted.
    expect((screen.getByTestId('amc-open-project') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/Loading the sequence/i)).toBeTruthy()

    await whenLoaded()
    await waitFor(() => expect((screen.getByTestId('amc-open-project') as HTMLInputElement).disabled).toBe(false))
  })
})

describe('connection fields', () => {
  it('marks the protocols seen with the declared connection type', async () => {
    // A CAN link carries DroneCAN and a serial one does not. The templates are
    // evidence, so the list is reordered and annotated rather than cut — the
    // operator can see their own wiring and we cannot.
    render(<AmcGuidedView {...base} />)
    await whenLoaded()

    // The GNSS receiver, because the sequence asks for both halves of its
    // connection. (The ESC's control connection has only a Protocol field —
    // nothing reads its Type — so there is no pair there to constrain.)
    await waitFor(
      () => expect(document.getElementById('amc-field-GNSS-Receiver-FC-Connection-Type')).toBeTruthy(),
      { timeout: 5000 }
    )
    const gnssType = document.getElementById(
      'amc-field-GNSS-Receiver-FC-Connection-Type'
    ) as HTMLSelectElement
    const gnssProtocol = document.getElementById(
      'amc-field-GNSS-Receiver-FC-Connection-Protocol'
    ) as HTMLSelectElement

    const before = [...gnssProtocol.options].map((o) => o.value)
    expect(before.length).toBeGreaterThan(1)

    // A CAN link carries DroneCAN; declaring one should float it to the top.
    await act(async () => {
      fireEvent.change(gnssType, { target: { value: 'CAN1' } })
    })

    const after = [...gnssProtocol.options]
    const marked = after.filter((o) => o.textContent?.includes('seen with this connection'))
    expect(marked.length).toBeGreaterThan(0)
    // And nothing was taken away: the guarantee that makes evidence safe to
    // act on at all.
    const afterValues = after.map((o) => o.value)
    for (const value of before) expect(afterValues).toContain(value)
  })
})
