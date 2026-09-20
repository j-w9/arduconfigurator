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
