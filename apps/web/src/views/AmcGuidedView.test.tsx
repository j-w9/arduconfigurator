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

import { parameterDocsFrom } from '@arduconfig/amc-steps'

import arducopterParams from '../generated/param-upstream/arducopter.json'

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

/**
 * ArduPilot's real parameter documentation, as the app generates it.
 *
 * Not a hand-written fixture: the labels asserted below are the ones an
 * operator actually sees, and a fixture would let them drift.
 */
const docs = parameterDocsFrom(
  arducopterParams as Readonly<Record<string, { options?: { value: number; label: string }[]; bitmask?: boolean }>>
)

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
    // getAllByText, not getByText: each phase name appears twice now, once in
    // the jump nav and once as the heading it jumps to.
    await waitFor(() => expect(screen.getAllByText('Basic mandatory configuration').length).toBe(2), {
      timeout: 5000
    })
    expect(screen.getAllByText('Standard tuning').length).toBe(2)
    // The optional phases are marked as such, so a required one is not mistaken
    // for something that can be skipped.
    expect(screen.getAllByText('optional').length).toBeGreaterThan(0)
    expect(screen.getAllByText('required').length).toBeGreaterThan(0)
  })

  it('offers a way back to each phase', async () => {
    // 63 steps in a dozen phases is one uninterrupted scroll without this —
    // you cannot see the shape of the work or return to where you were.
    render(<AmcGuidedView {...base} />)
    await whenLoaded()
    const nav = await screen.findByRole('navigation', { name: /Jump to a phase/i })
    const jumps = nav.querySelectorAll('button')
    expect(jumps.length).toBeGreaterThan(5)
    // Each carries its own progress, so the nav says where the work is.
    expect(nav.textContent).toMatch(/\d+\/\d+/)
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

    // A CAN receiver speaks DroneCAN and not a serial protocol. This is a
    // RULE, from ArduPilot's own parameter values, so it removes rather than
    // reorders — the evidence-based pairings above never do.
    const afterValues = after.map((o) => o.value)
    expect(afterValues).toContain('DroneCAN')
    expect(afterValues).not.toContain('uBlox')
    expect(before).toContain('uBlox')
  })

  it('never makes the operator\'s own answer unselectable', async () => {
    // They can see the wiring and this cannot. A declared value that vanishes
    // from the list is a value they cannot argue with.
    const key = 'arduconfig.amc-progress.uid:cascade'
    saveAmcProgress(key, {
      vehicleKind: 'ArduCopter',
      declaration: {
        'GNSS Receiver/FC Connection/Type': 'CAN1',
        'GNSS Receiver/FC Connection/Protocol': 'uBlox'
      },
      reviewed: []
    })
    render(<AmcGuidedView {...base} progressKey={key} />)
    await whenLoaded()

    await waitFor(() =>
      expect(document.getElementById('amc-field-GNSS-Receiver-FC-Connection-Protocol')).toBeTruthy()
    )
    const protocol = document.getElementById(
      'amc-field-GNSS-Receiver-FC-Connection-Protocol'
    ) as HTMLSelectElement
    // The rule says a CAN receiver is not uBlox, but they said it is.
    expect([...protocol.options].map((o) => o.value)).toContain('uBlox')
  })
})

describe('credit', () => {
  it('links AMC and the tuning guide for the selected sequence', async () => {
    // The sequence and the reasoning are AMC's work, and the guide explaining
    // a step is more use than our one-line summary of it.
    render(<AmcGuidedView {...base} />)
    await whenLoaded()

    const project = screen.getByRole('link', { name: 'Project' })
    expect(project.getAttribute('href')).toBe('https://github.com/ArduPilot/MethodicConfigurator')
    // Opened in a new tab, without handing the target window a reference back.
    expect(project.getAttribute('rel')).toContain('noopener')

    expect(screen.getByRole('link', { name: 'Introduction' }).getAttribute('href')).toBe(
      'https://discuss.ardupilot.org/t/new-ardupilot-methodic-configurator-gui/115038'
    )
    expect(screen.getByRole('link', { name: 'Documentation' }).getAttribute('href')).toBe(
      'https://ardupilot.github.io/MethodicConfigurator/'
    )

    // The guide follows the chosen sequence. AMC publishes exactly four, named
    // for the four sequence kinds, so the interpolated URL is always real —
    // this asserts the one on screen rather than the template.
    const guide = screen.getByRole('link', { name: /ArduCopter tuning guide/i })
    expect(guide.getAttribute('href')).toBe(
      'https://ardupilot.github.io/MethodicConfigurator/TUNING_GUIDE_ArduCopter'
    )
  })
})

describe('reading the declaration off the vehicle', () => {
  const configured = {
    FRAME_CLASS: 1,
    GPS1_TYPE: 2,
    SERIAL3_PROTOCOL: 5,
    RC_PROTOCOLS: 8,
    MOT_PWM_TYPE: 6,
    BATT_MONITOR: 4,
    BATT_CAPACITY: 5000,
    MOT_BAT_VOLT_MAX: 16.8
  }

  it('is not offered without a vehicle to read', async () => {
    // Nothing to read from, so the control would only ever report failure.
    render(<AmcGuidedView {...base} />)
    await whenLoaded()
    expect(screen.queryByRole('button', { name: /Read what the vehicle already knows/i })).toBeNull()
  })

  it('fills the form in from the vehicle and says what it did', async () => {
    render(<AmcGuidedView {...base} connected parameters={configured} />)
    await whenLoaded()

    const diameter = document.getElementById(
      'amc-field-Battery-Specifications-Capacity-mAh'
    ) as HTMLInputElement
    expect(diameter.value).toBe('')

    await act(async () => {
      screen.getByRole('button', { name: /Read what the vehicle already knows/i }).click()
    })

    // The capacity came off the vehicle, not out of the operator's head.
    await waitFor(() => expect(diameter.value).toBe('5000'))
    expect(screen.getByText(/Filled in \d+ fields from the vehicle/)).toBeTruthy()
  })

  it('says when it would replace an answer the operator gave', async () => {
    // A parameter says how the vehicle is configured, not how it is wired, so
    // disagreeing with the operator is worth calling out rather than doing
    // quietly.
    const key = 'arduconfig.amc-progress.uid:import'
    saveAmcProgress(key, {
      vehicleKind: 'ArduCopter',
      declaration: { 'Battery/Specifications/Capacity mAh': '1234' },
      reviewed: []
    })
    render(<AmcGuidedView {...base} connected parameters={configured} progressKey={key} />)
    await whenLoaded()
    await waitFor(() => expect(screen.getByDisplayValue('1234')).toBeTruthy())

    await act(async () => {
      screen.getByRole('button', { name: /Read what the vehicle already knows/i }).click()
    })

    await waitFor(() => expect(screen.getByText(/replaced what you had answered/)).toBeTruthy())
  })
})

describe('a step that needs a script on the vehicle', () => {
  /** The quick-tune step, which needs a Lua applet at /APM/Scripts. */
  const openQuickTune = async () => {
    const step = await screen.findByRole('button', { name: /Quick tune setup/i }, { timeout: 5000 })
    await act(async () => {
      step.click()
    })
  }

  it('offers to put it there, and says so when it has', async () => {
    const installed: { url: string; destination: string }[] = []
    render(
      <AmcGuidedView
        {...base}
        connected
        onInstallFile={async (file) => {
          installed.push({ url: file.url, destination: file.destination })
        }}
      />
    )
    await whenLoaded()
    await openQuickTune()

    const button = await screen.findByRole('button', { name: /put it on the vehicle/i })
    await act(async () => {
      button.click()
    })

    await waitFor(() => expect(installed).toHaveLength(1))
    // The destination is the sequence's, not one we invented.
    expect(installed[0]?.destination).toBe('/APM/Scripts/VTOL-quicktune.lua')
    expect(installed[0]?.url).toMatch(/VTOL-quicktune\.lua$/)
    // Scripts run from boot, so an upload nobody restarts does nothing.
    await waitFor(() => expect(screen.getByText(/Reboot the vehicle to start it/i)).toBeTruthy())
  })

  it('reports a failure rather than claiming success', async () => {
    render(
      <AmcGuidedView
        {...base}
        connected
        onInstallFile={async () => {
          throw new Error('Could not fetch VTOL-quicktune.lua: 404 Not Found')
        }}
      />
    )
    await whenLoaded()
    await openQuickTune()

    await act(async () => {
      ;(await screen.findByRole('button', { name: /put it on the vehicle/i })).click()
    })
    await waitFor(() => expect(screen.getByText(/404 Not Found/)).toBeTruthy())
  })

  it('keeps the download, and does not offer to install without a vehicle', async () => {
    // Putting a script on an aircraft is worth being able to read first, and
    // there is nothing to write to when nothing is connected.
    render(<AmcGuidedView {...base} onInstallFile={async () => {}} />)
    await whenLoaded()
    await openQuickTune()

    expect(screen.getByRole('link', { name: /Download it/i })).toBeTruthy()
    const button = await screen.findByRole('button', { name: /put it on the vehicle/i })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('writing one step at a time', () => {
  /** A vehicle reporting the parameters the first step sets. */
  const live = { INS_TCAL1_ENABLE: 0, INS_TCAL2_ENABLE: 0, INS_TCAL3_ENABLE: 0, LOG_BITMASK: 1 }

  it('writes only that step\'s parameters, and names the step', async () => {
    // The method is step-by-step: write this one, let the vehicle confirm it,
    // then move on. A bulk write at the end is a different method.
    const writes: { parameters: string[]; label: string }[] = []
    render(
      <AmcGuidedView
        {...base}
        connected
        parameters={live}
        onWriteStep={(changes, label) => {
          writes.push({ parameters: changes.map((c) => c.parameter), label })
        }}
      />
    )
    await whenLoaded()

    const step = await screen.findByRole('button', { name: /Imu temperature calibration setup/i })
    await act(async () => {
      step.click()
    })
    await act(async () => {
      ;(await screen.findByRole('button', { name: /^Write this step$/ })).click()
    })

    expect(writes).toHaveLength(1)
    expect(writes[0]?.label).toMatch(/Imu temperature calibration setup/i)
    // Its own parameters and nothing else. This step is IMU temperature
    // calibration and the logging it needs, so every name it writes is an
    // INS_ or a LOG_ one — and critically none of the attitude or motor
    // parameters that later steps own, which a bulk write would have swept in.
    expect(writes[0]?.parameters.length).toBeGreaterThan(0)
    expect(writes[0]?.parameters.every((name) => /^(INS_|LOG_)/.test(name))).toBe(true)
    expect(writes[0]?.parameters.some((name) => /^(ATC_|MOT_|PSC_)/.test(name))).toBe(false)
  })

  it('will not write without a vehicle to write to', async () => {
    render(<AmcGuidedView {...base} parameters={live} onWriteStep={() => {}} />)
    await whenLoaded()
    const step = await screen.findByRole('button', { name: /Imu temperature calibration setup/i })
    await act(async () => {
      step.click()
    })
    const write = await screen.findByRole('button', { name: /^Write this step$/ })
    expect((write as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('starting from a similar vehicle', () => {
  it('fills the form from the chosen template and says what it did', async () => {
    render(<AmcGuidedView {...base} />)
    await whenLoaded()

    const select = (await screen.findByTestId('amc-template-select')) as HTMLSelectElement
    // AMC's own vehicles, narrowed to this sequence.
    const options = [...select.options].filter((option) => option.value !== '')
    expect(options.length).toBeGreaterThan(10)
    expect(options.every((option) => option.value.startsWith('ArduCopter/'))).toBe(true)

    const declaredBefore = screen.getByText(/0 of \d+ fields/)
    expect(declaredBefore).toBeTruthy()

    await act(async () => {
      fireEvent.change(select, { target: { value: options[0]!.value } })
    })

    await waitFor(() => expect(screen.getByText(/Started from .*fields filled in/)).toBeTruthy())
    // The count on the form moved off zero, which is the thing an operator
    // sees.
    await waitFor(() => expect(screen.queryByText(/^0 of \d+ fields/)).toBeNull())
  })
})

describe('an ESC whose telemetry rides its control connection', () => {
  it('fixes the telemetry fields instead of asking twice', async () => {
    // FETtecOneWire carries telemetry back over the wire that drives the
    // motors. Asking the operator to declare it separately is a question with
    // one answer, and inviting a different one the sequence would compute from.
    const key = 'arduconfig.amc-progress.uid:mirror'
    saveAmcProgress(key, {
      vehicleKind: 'ArduCopter',
      declaration: {
        'ESC/FC->ESC Connection/Type': 'SERIAL1',
        'ESC/FC->ESC Connection/Protocol': 'FETtecOneWire'
      },
      reviewed: []
    })
    render(<AmcGuidedView {...base} progressKey={key} />)
    await whenLoaded()

    await waitFor(() =>
      expect(document.getElementById('amc-field-ESC-ESC-FC-Telemetry-Protocol')).toBeTruthy()
    )
    const protocol = document.getElementById('amc-field-ESC-ESC-FC-Telemetry-Protocol') as HTMLInputElement
    expect(protocol.value).toBe('FETtecOneWire')
    expect(protocol.readOnly).toBe(true)
    // Shown rather than hidden: the operator should see what their choice
    // implied, not wonder where the field went.
    expect(screen.getAllByText(/same as the control connection/).length).toBeGreaterThan(0)
  })

  it('still asks when the protocol leaves the question open', async () => {
    // DShot CAN answer back on the same wire, but can equally use a dedicated
    // serial port or nothing at all.
    const key = 'arduconfig.amc-progress.uid:dshot'
    saveAmcProgress(key, {
      vehicleKind: 'ArduCopter',
      declaration: {
        'ESC/FC->ESC Connection/Type': 'Main Out',
        'ESC/FC->ESC Connection/Protocol': 'DShot600'
      },
      reviewed: []
    })
    render(<AmcGuidedView {...base} progressKey={key} />)
    await whenLoaded()

    await waitFor(() =>
      expect(document.getElementById('amc-field-ESC-ESC-FC-Telemetry-Protocol')).toBeTruthy()
    )
    const protocol = document.getElementById('amc-field-ESC-ESC-FC-Telemetry-Protocol') as HTMLElement
    expect(protocol.tagName).toBe('SELECT')
    expect(screen.queryByText(/same as the control connection/)).toBeNull()
  })
})

describe('finishing a step that needs a restart', () => {
  const live = { INS_TCAL1_ENABLE: 0, LOG_BITMASK: 1, BRD_BOOT_DELAY: 3000 }
  const states = [
    { id: 'INS_TCAL1_ENABLE', value: 0, index: 0, count: 2, definition: { rebootRequired: true } },
    { id: 'LOG_BITMASK', value: 1, index: 1, count: 2, definition: {} }
  ] as never

  it('reboots, waits out the board\'s own delay, and reconnects', async () => {
    // One action, because the step is not finished when the write is
    // acknowledged — it is finished when the vehicle has restarted and read
    // the value.
    const waits: number[] = []
    render(
      <AmcGuidedView
        {...base}
        connected
        parameters={live}
        states={states}
        onRebootAndReconnect={async (seconds) => {
          waits.push(seconds)
        }}
      />
    )
    await whenLoaded()

    const step = await screen.findByRole('button', { name: /Imu temperature calibration setup/i })
    await act(async () => {
      step.click()
    })
    await act(async () => {
      ;(await screen.findByRole('button', { name: /Reboot and reconnect/i })).click()
    })

    // BRD_BOOT_DELAY is 3000 ms, so four seconds: the board's own delay plus
    // the moment it takes to boot at all.
    await waitFor(() => expect(waits).toEqual([4]))
  })

  it('falls back to a plain reboot when reconnecting is not offered', async () => {
    render(<AmcGuidedView {...base} connected parameters={live} states={states} onRequestReboot={() => {}} />)
    await whenLoaded()
    const step = await screen.findByRole('button', { name: /Imu temperature calibration setup/i })
    await act(async () => {
      step.click()
    })
    expect(await screen.findByRole('button', { name: /Reboot the vehicle/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Reboot and reconnect/i })).toBeNull()
  })
})

describe('taking the log off the vehicle', () => {
  it('fetches the newest log and reads it the way a picked file is read', async () => {
    // The vehicle has the log. Sending the operator to another tab to
    // download it, then back here to load it, is three steps for something
    // the sequence already needs.
    let asked = 0
    render(
      <AmcGuidedView
        {...base}
        connected
        onDownloadLatestLog={async () => {
          asked += 1
          // Not a real log on purpose: what matters is that the bytes reach
          // the same reader a picked file does, and that it says so when they
          // turn out not to be a log.
          return { name: '00000042.BIN', bytes: new Uint8Array([1, 2, 3]) }
        }}
      />
    )
    await whenLoaded()

    await act(async () => {
      ;(await screen.findByRole('button', { name: /take the latest off the vehicle/i })).click()
    })

    expect(asked).toBe(1)
    await waitFor(() => expect(screen.getByText(/00000042\.BIN holds no recognisable messages/)).toBeTruthy())
  })

  it('is not offered without a vehicle to take it from', async () => {
    render(<AmcGuidedView {...base} onDownloadLatestLog={async () => undefined} />)
    await whenLoaded()
    expect(screen.queryByRole('button', { name: /take the latest off the vehicle/i })).toBeNull()
  })

  it('says so when the vehicle has no logs', async () => {
    render(<AmcGuidedView {...base} connected onDownloadLatestLog={async () => undefined} />)
    await whenLoaded()
    await act(async () => {
      ;(await screen.findByRole('button', { name: /take the latest off the vehicle/i })).click()
    })
    await waitFor(() => expect(screen.getByText(/The vehicle has no logs on it/)).toBeTruthy())
  })
})

describe('stepping past what does not apply', () => {
  it('skips the steps most vehicles do not need', async () => {
    // The sequence says how mandatory each step is, and a dozen of the 63 may
    // be about a feature this aircraft does not have.
    render(<AmcGuidedView {...base} />)
    await whenLoaded()
    const next = await screen.findByRole('button', { name: /Next step that matters/i })
    expect(next).toBeTruthy()
    // It is in the phase nav, where the rest of the moving-about lives.
    expect(next.closest('nav')).toBeTruthy()
  })
})

describe('recording what the vehicle already has', () => {
  it('offers to take a step\'s values from the vehicle, where they differ', async () => {
    // Distinct from the automatic capture: that covers only the parameters a
    // step declares importable AND which differ from their default. This is
    // for an operator whose vehicle is already configured and who wants the
    // directory to record what it HAS.
    const staged: { parameter: string; value: number }[] = []
    render(
      <AmcGuidedView
        {...base}
        connected
        // A vehicle whose logging differs from what the step would impose.
        parameters={{ INS_TCAL1_ENABLE: 0, INS_TCAL2_ENABLE: 0, INS_TCAL3_ENABLE: 0, LOG_BITMASK: 999 }}
        onStage={(changes) => staged.push(...changes)}
      />
    )
    await whenLoaded()

    const step = await screen.findByRole('button', { name: /Imu temperature calibration setup/i })
    await act(async () => {
      step.click()
    })
    await act(async () => {
      ;(await screen.findByRole('button', { name: /Take \d+ from the vehicle/i })).click()
    })

    // What it staged is the VEHICLE's value, not the sequence's.
    const logBitmask = staged.find((change) => change.parameter === 'LOG_BITMASK')
    expect(logBitmask?.value).toBe(999)
  })

  it('is not offered when the vehicle already agrees with the sequence', async () => {
    // Nothing to take: the button would offer to change nothing.
    render(<AmcGuidedView {...base} connected parameters={{}} onStage={() => {}} />)
    await whenLoaded()
    const step = await screen.findByRole('button', { name: /Board orientation/i })
    await act(async () => {
      step.click()
    })
    expect(screen.queryByRole('button', { name: /Take \d+ from the vehicle/i })).toBeNull()
  })
})

describe('a parameter file from somewhere else', () => {
  // AMC's "compare and upload" window. The distinction it exists to keep is
  // that this file is NOT part of the directory: AMC uploads it with
  // persist_project_state=False, so nothing about it is written into a step.

  function paramFile(name: string, text: string): File {
    // jsdom's File does not implement text(), and the view reads the file that
    // way, so it is supplied here.
    const file = new File([text], name, { type: 'text/plain' })
    Object.defineProperty(file, 'text', { value: async () => text })
    return file
  }

  async function open(text: string, props: Partial<Parameters<typeof AmcGuidedView>[0]> = {}) {
    render(<AmcGuidedView {...base} connected parameters={{ ATC_RAT_RLL_P: 0.2 }} {...props} />)
    await whenLoaded()
    const input = screen.getByTestId('amc-open-external') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [paramFile('someone-elses.param', text)] } })
    })
  }

  it('shows what the file would change and what it would not', async () => {
    await open(['ATC_RAT_RLL_P,0.135', 'ATC_RAT_PIT_P,0.135'].join('\n'))

    await waitFor(() => expect(screen.getByText(/someone-elses\.param/)).toBeTruthy())
    // One row the vehicle has and disagrees with, one it does not have at all.
    expect(screen.getByText(/1 the vehicle does not already have/)).toBeTruthy()
    expect(screen.getByText(/1 this firmware does not have/)).toBeTruthy()
  })

  it('will not send a parameter this firmware does not have', async () => {
    await open(['ATC_RAT_RLL_P,0.135', 'ATC_RAT_PIT_P,0.135'].join('\n'))
    await waitFor(() => expect(screen.getByText(/someone-elses\.param/)).toBeTruthy())

    // Checked by default would be a write that cannot land; the box is
    // disabled rather than merely unchecked.
    const absent = screen.getByLabelText('Send ATC_RAT_PIT_P') as HTMLInputElement
    expect(absent.disabled).toBe(true)
    // And the count offered covers only the one that can be sent.
    expect(screen.getByRole('button', { name: /Stage 1 change/ })).toBeTruthy()
  })

  it('sends the checked rows without recording them anywhere', async () => {
    const staged: { parameter: string; value: number }[] = []
    await open('ATC_RAT_RLL_P,0.135', { onStage: (changes) => staged.push(...changes) })
    await waitFor(() => expect(screen.getByText(/someone-elses\.param/)).toBeTruthy())

    await act(async () => {
      screen.getByRole('button', { name: /Stage 1 change/ }).click()
    })
    expect(staged).toEqual([{ parameter: 'ATC_RAT_RLL_P', value: 0.135 }])
    // The directory is untouched: this file never became a step.
    expect(screen.queryByText(/someone-elses\.param/)?.closest('table')).toBeFalsy()
  })

  it('says so when the file holds nothing it can read', async () => {
    await open('# just a comment\n\n')
    await waitFor(() => expect(screen.getByText(/holds no parameters/)).toBeTruthy())
  })

  it('points at the app for a reset rather than offering a second one', async () => {
    // AMC puts "reset all FC parameters to defaults" on this same window. The
    // app already has that action, with its own confirmation and armed check,
    // so this offers the affordance in AMC's place without a second
    // implementation of a destructive command.
    const opened: string[] = []
    render(<AmcGuidedView {...base} connected onOpenTool={(view) => opened.push(view)} />)
    await whenLoaded()
    await act(async () => {
      screen.getByRole('button', { name: /Reset it to firmware defaults/i }).click()
    })
    expect(opened).toEqual(['flash'])
  })
})

describe('checking the declaration before anything is computed from it', () => {
  // The sequence derives everything from these values, so one that is merely
  // plausible produces a directory that is confidently wrong. AMC refuses to
  // write such a declaration; this says so without refusing.

  async function declare(entries: Record<string, string>) {
    render(<AmcGuidedView {...base} />)
    await whenLoaded()
    for (const [key, value] of Object.entries(entries)) {
      const input = document.getElementById(`amc-field-${key.replace(/[^a-zA-Z0-9]+/g, '-')}`)
      if (!input) throw new Error(`no field for ${key}`)
      await act(async () => {
        fireEvent.change(input, { target: { value } })
      })
    }
  }

  it('says when a cell voltage is ordered the wrong way round', async () => {
    // Arming below the low threshold trips the failsafe the moment the
    // vehicle arms, which is why AMC checks both sides of this one. Both
    // values are given: a blank neighbour is unanswered, not disagreed with.
    await declare({
      'Battery/Specifications/Volt per cell low': '3.6',
      'Battery/Specifications/Volt per cell arm': '3.1'
    })
    await waitFor(() =>
      expect(screen.getAllByText(/is below the Volt per cell low/).length).toBeGreaterThan(0)
    )
  })

  it('offers the value AMC would put there instead', async () => {
    await declare({ 'Battery/Specifications/Number of cells': '99' })
    const fix = await screen.findByRole('button', { name: /use 50/ })
    await act(async () => {
      fix.click()
    })
    const input = document.getElementById(
      'amc-field-Battery-Specifications-Number-of-cells'
    ) as HTMLInputElement
    expect(input.value).toBe('50')
  })

  it('wants an even number of magnetic rotor poles', async () => {
    await declare({ 'Motors/Specifications/Poles': '13' })
    // Said twice on purpose: beside the field, and again in the list above the
    // directory download, which is the moment it stops being recoverable.
    await waitFor(() =>
      expect(screen.getAllByText(/magnetic rotor poles must be even/).length).toBe(2)
    )
  })

  it('re-seeds the cell voltages when the chemistry changes', async () => {
    // Without this a pack switched from LiPo to Li-ion keeps LiPo's
    // thresholds, every one of which is then outside the new range at once.
    await declare({ 'Battery/Specifications/Chemistry': 'LiIon' })
    const low = document.getElementById(
      'amc-field-Battery-Specifications-Volt-per-cell-low'
    ) as HTMLInputElement
    // LiIon's recommended low, not LiPo's 3.6.
    expect(Number(low.value)).toBeLessThan(3.6)
  })

  it('says so beside the directory, where it would be written', async () => {
    await declare({ 'Motors/Specifications/Poles': '13' })
    await waitFor(() => expect(screen.getByText(/AMC would reject/)).toBeTruthy())
  })

  it('says nothing about a declaration that is merely unfinished', async () => {
    // Empty is not wrong -- it is 24 fields nobody has got to yet.
    render(<AmcGuidedView {...base} />)
    await whenLoaded()
    expect(screen.queryByText(/AMC would reject/)).toBeNull()
  })
})

describe('opening a directory an older AMC wrote', () => {
  // old_filenames covers the renames; what it cannot express is the rest of
  // format version 0 -> 1. Without that a pre-v1 directory reads ALMOST
  // correctly, which is the worst way to be wrong.

  function paramFile(name: string, text: string): File {
    const file = new File([text], name, { type: 'text/plain' })
    Object.defineProperty(file, 'text', { value: async () => text })
    return file
  }

  const v0 = {
    'vehicle_components.json': JSON.stringify({
      Components: { 'Flight Controller': { Firmware: { Type: 'ArduCopter' } } }
    }),
    '04_board_orientation.param':
      'AHRS_ORIENTATION,0\nBRD_HEAT_TARG,45  # @manual_override warm board\nLOG_DISARMED,1\n',
    '09_batt2.param': 'BATT2_MONITOR,4\n'
  }

  it('says the directory was an older layout, and what moved', async () => {
    render(<AmcGuidedView {...base} />)
    await whenLoaded()
    const input = screen.getByTestId('amc-open-project') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, {
        target: { files: Object.entries(v0).map(([name, text]) => paramFile(name, text)) }
      })
    })

    await waitFor(() =>
      expect(screen.getByText(/written for an older layout \(version 0\), brought up to 1/)).toBeTruthy()
    )
    // The part that matters to the operator: their values were not dropped.
    expect(screen.getByText(/parameters? moved to the step that owns/)).toBeTruthy()
  })

  it('does not call a current directory migrated', async () => {
    const current = {
      ...v0,
      'vehicle_components.json': JSON.stringify({
        'Format version': 1,
        Components: { 'Flight Controller': { Firmware: { Type: 'ArduCopter' } } }
      })
    }
    render(<AmcGuidedView {...base} />)
    await whenLoaded()
    await act(async () => {
      fireEvent.change(screen.getByTestId('amc-open-project'), {
        target: { files: Object.entries(current).map(([name, text]) => paramFile(name, text)) }
      })
    })
    await waitFor(() => expect(screen.getByText(/Read \d+ step files/)).toBeTruthy())
    expect(screen.queryByText(/older layout/)).toBeNull()
  })
})

describe('saying what a value means', () => {
  // A method whose claim is that every value carries its reason should not
  // render LOG_BITMASK as 176126 and leave it there.

  // Which values get a label, and what the label says, is covered against
  // ArduPilot's real metadata in the fork's explain-value tests. What only a
  // render can answer is whether the documentation reaches the table at all.
  it('decomposes a logging bitmask into the bits it sets', async () => {
    render(<AmcGuidedView {...base} docs={docs} />)
    await whenLoaded()
    const step = await screen.findByRole('button', { name: /Imu temperature calibration setup/i })
    await act(async () => {
      step.click()
    })
    // LOG_BITMASK is what this step sets, and it is the parameter the raw
    // number is least readable for.
    const means = [...document.querySelectorAll('.amc-step__means')].map((el) => el.textContent)
    expect(means.some((text) => /of \d+:|Attitude|nothing set/.test(text ?? ''))).toBe(true)
  })

  it('says nothing where the documentation says nothing', async () => {
    // Without docs there is no explanation to give, and inventing one for a
    // logging mask is worse than leaving the number alone.
    render(<AmcGuidedView {...base} />)
    await whenLoaded()
    const step = await screen.findByRole('button', { name: /Imu temperature calibration setup/i })
    await act(async () => {
      step.click()
    })
    expect(document.querySelectorAll('.amc-step__means').length).toBe(0)
  })
})
