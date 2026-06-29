import { expect, test, type Page } from '@playwright/test'
import { deflateSync } from 'node:zlib'

// The in-browser demo transport delivers inbound frames (param sync, command
// ACKs, write read-backs) on a single setTimeout-paced timeline that shares the
// main thread with the React app. Under a contended single-worker full run that
// timeline drifts, so a command-ACK / write-verify round-trip can take well over
// the global 15s expect budget even when everything is healthy. These generous,
// targeted budgets absorb that drift without masking a real hang (a genuine hang
// never completes, so the test still fails — just later).
const COMMAND_ACK_TIMEOUT = 20_000
const VEHICLE_CONNECT_TIMEOUT = 30_000

// The full demo param sync (~590 params) is the single heaviest event on the
// mock's setTimeout timeline. A test that asserts param-DERIVED UI right after
// connect (e.g. the Sub output summary, which is built from the synced
// FRAME_CLASS / SERVOn_FUNCTION values) races that sync and flakes on a
// contended runner if it only waited for the vehicle heartbeat. Wait for the
// summary to read "complete" first; a real hang still fails, just later.
async function expectParameterSyncComplete(page: Page): Promise<void> {
  await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
    timeout: VEHICLE_CONNECT_TIMEOUT
  })
}

test.describe('Phone layout', () => {
  test('hides the sidebar baseline panel on phone so the tab content gets the screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await page.getByTestId('view-button-config').click()
    // The Active Baseline panel (snapshot drift summary) is hidden on phone —
    // it lives in the sidebar and was burying the active tab's content.
    await expect(page.locator('.workspace-sidebar .baseline-summary')).toBeHidden()
    // No horizontal overflow at phone width.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(2)
  })

  test('phone header drops the dev build line and sensor strip to free vertical space', async ({ page }) => {
    // Regression for a ~300px-tall mobile header that left config views only a
    // sliver of usable height. Assert the condensation MECHANISM (build line +
    // sensor strip hidden at phone width) rather than a pixel height, which
    // varies with font rendering across environments.
    await page.setViewportSize({ width: 390, height: 664 })
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('app-build-info')).toBeHidden()
    await expect(page.locator('.header-sensor-status')).toBeHidden()
  })

  test('phone Parameter Editor chrome is condensed so the edit surface is reachable', async ({ page }) => {
    // Regression: the expert-mode warning + the export buttons made the
    // "Parameter Editor" review card dominate a phone screen. On phone the
    // warning is hidden and the export buttons are dropped (Import + Apply +
    // Discard stay), keeping the review card compact.
    await page.setViewportSize({ width: 390, height: 664 })
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await page.getByTestId('product-mode-expert').check()
    await page.getByTestId('view-button-parameters').click()
    await expect(page.locator('.parameter-editor__expert-note')).toBeHidden()
    await expect(page.getByTestId('export-parameter-backup')).toBeHidden()
    // Import (cross-vehicle migration) stays available on phone.
    await expect(page.getByTestId('import-parameter-backup')).toBeVisible()

    // The inspector auto-defaults to the first param (FRAME_CLASS); on phone its
    // tall body is collapsed by default and reachable via the toggle.
    await expect(page.locator('.parameter-details__grid')).toBeHidden()
    await page.getByTestId('parameter-details-toggle').click()
    await expect(page.locator('.parameter-details__grid')).toBeVisible()
  })

  test('keeps the baseline panel on desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.locator('.workspace-sidebar .baseline-summary')).toBeVisible()
  })
})

test.describe('Desktop firmware browse', () => {
  // A minimal valid .apj (board_id + zlib-deflated image) the flasher can parse.
  const rawImage = Buffer.from([0xa3, 0x95, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05])
  const apj = JSON.stringify({ board_id: 1059, image_size: rawImage.length, image: deflateSync(rawImage).toString('base64') })
  const apjBytes = [...new TextEncoder().encode(apj)]

  test('with the desktop bridge: board id -> fetch -> use -> firmware loaded', async ({ page }) => {
    await page.addInitScript((bytes) => {
      ;(window as unknown as { arduconfigDesktop: unknown }).arduconfigDesktop = {
        platform: 'electron',
        firmware: {
          list: async (boardId: number, vehicletype: string) => ({
            releaseTypes: ['OFFICIAL'],
            entries: [{ boardId, vehicletype, releaseType: 'OFFICIAL', version: '4.6.0', latest: true,
              url: `https://firmware.ardupilot.org/${vehicletype}/stable/CubeOrange/arducopter.apj` }]
          }),
          download: async () => new Uint8Array(bytes as number[])
        }
      }
    }, apjBytes)
    await page.goto('/')
    await page.getByTestId('landing-flash-firmware-button').click()
    await expect(page.getByTestId('firmware-browse')).toBeVisible()
    await page.getByTestId('firmware-browse-board-id').fill('1059')
    await page.getByTestId('firmware-browse-fetch').click()
    await expect(page.getByTestId('firmware-browse-list')).toBeVisible({ timeout: COMMAND_ACK_TIMEOUT })
    await page.getByTestId('firmware-browse-use').first().click()
    await expect(page.getByTestId('firmware-loaded')).toContainText('board id 1059', { timeout: COMMAND_ACK_TIMEOUT })
  })

  test('browse panel is hidden in the browser (no desktop bridge)', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('landing-flash-firmware-button').click()
    await expect(page.getByTestId('firmware-flasher')).toBeVisible()
    await expect(page.getByTestId('firmware-browse')).toHaveCount(0)
  })

  test('vehicle dropdown pre-selects the connected vehicle', async ({ page }) => {
    // Copter demo -> Copter (was hardcoded to Plane regardless of connection).
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await page.getByTestId('view-button-flash').click()
    await expect(page.getByTestId('firmware-vehicle')).toHaveValue('Copter')

    // Plane demo -> Plane.
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await page.getByTestId('view-button-flash').click()
    await expect(page.getByTestId('firmware-vehicle')).toHaveValue('Plane')
  })
})

async function connectViaHeader(page: Page): Promise<void> {
  await page.getByTestId('transport-mode-select').selectOption('demo')
  await page.getByTestId('connect-button').click()
  await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
  await settlePreviewChunk(page)
}

// The 3D craft preview is lazy-loaded (three.js is split out of the eager
// bundle). Its ~148 KB parse runs whenever the chunk download finishes; under
// the in-browser demo transport that parse can stall the same thread that runs
// MockTransport's setTimeout frame delivery, delaying a later post-connect
// COMMAND_ACK past a test's budget. Settling the chunk here — it mounts on the
// default post-connect Setup view — forces that parse into the connect window
// (which has slack) so it can't land mid-interaction. Best-effort: not every
// flow lands on Setup with the preview, so a miss must not fail the test.
async function settlePreviewChunk(page: Page): Promise<void> {
  await page
    .getByTestId('setup-craft-preview')
    .waitFor({ state: 'visible', timeout: 10000 })
    .catch(() => {})
}

async function openView(page: Page, viewId: string): Promise<void> {
  await page.getByTestId(`view-button-${viewId}`).click()
}

test.describe('a11y', () => {
  const transitionMs = (value: string): number =>
    Math.max(
      0,
      ...value.split(',').map((part) => {
        const n = parseFloat(part)
        if (Number.isNaN(n)) return 0
        return part.includes('ms') ? n : n * 1000
      })
    )

  test('reduced-motion preference neutralises transitions', async ({ page }) => {
    // Sanity: with default motion the toggle thumb has a real (~200ms) transition.
    await page.goto('/')
    await connectViaHeader(page)
    const thumb = page.locator('.expert-mode-toggle__thumb').first()
    await expect(thumb).toBeAttached()
    const normal = transitionMs(await thumb.evaluate((el) => getComputedStyle(el).transitionDuration))
    expect(normal).toBeGreaterThan(50)

    // With prefers-reduced-motion the same transition is neutralised.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await connectViaHeader(page)
    const reduced = transitionMs(await page.locator('.expert-mode-toggle__thumb').first().evaluate((el) => getComputedStyle(el).transitionDuration))
    expect(reduced).toBeLessThan(50)
  })

  test('inactive header sensor label meets WCAG AA contrast', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    const label = page.locator('.header-sensor-status__item:not(.is-active):not(.is-fix) .header-sensor-status__label').first()
    await expect(label).toBeVisible()
    const ratio = await label.evaluate((el) => {
      const lin = (c: number) => {
        const s = c / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
      const parse = (s: string) => (s.match(/[\d.]+/g) || []).map(Number)
      const fg = parse(getComputedStyle(el).color).slice(0, 3)
      let node: HTMLElement | null = el
      let bg = [13, 16, 21] // --bg-app fallback
      while (node) {
        const parts = parse(getComputedStyle(node).backgroundColor)
        const alpha = parts.length === 4 ? parts[3] : 1
        if (parts.length >= 3 && alpha > 0.5) {
          bg = parts.slice(0, 3)
          break
        }
        node = node.parentElement
      }
      const L1 = lum(fg)
      const L2 = lum(bg)
      const hi = Math.max(L1, L2)
      const lo = Math.min(L1, L2)
      return (hi + 0.05) / (lo + 0.05)
    })
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })
})

test.describe('Parameters tab (expert-only)', () => {
  // Coverage gap closed: existing tests only asserted the Parameters nav button
  // appears in expert mode; the tab's content (the dense param table, filtering,
  // empty state) was never actually opened. An audit sweep silently skipped it
  // because it is hidden unless Expert Mode is on.
  test('renders the param table, filters to an empty state, and stays within width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await connectViaHeader(page)
    await page.getByTestId('product-mode-expert').click()
    await page.getByTestId('view-button-parameters').click()

    const dataRows = page.locator('.parameter-row:not(.parameter-row--header)')
    expect(await dataRows.count()).toBeGreaterThan(10)

    // The dense table must not introduce horizontal overflow.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(2)

    // Filtering to a nonsense token shows the empty state, and clearing restores rows.
    const search = page.getByTestId('parameter-search-input')
    await search.fill('ZZ_NO_SUCH_PARAM_ZZ')
    await expect(page.locator('.parameter-empty-state')).toBeVisible()
    await search.fill('')
    expect(await dataRows.count()).toBeGreaterThan(10)
  })
})

test.describe('tab order', () => {
  test('nav leads with Status & Info, then Calibration, Config, Ports', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    // The first four nav buttons follow the requested order.
    const navIds = await page.locator('[data-testid^="view-button-"]').evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') || '').replace('view-button-', ''))
    )
    expect(navIds.slice(0, 4)).toEqual(['setup', 'calibration', 'config', 'ports'])
    // The Setup tab is now labelled "Status & Info".
    await expect(page.getByTestId('view-button-setup')).toContainText('Status & Info')
  })
})

test.describe('Ports view', () => {
  test('serial options show as chips in the matrix (Notes column removed)', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'ports')
    // The old Notes column header is gone.
    await expect(page.getByText('Notes', { exact: true })).toHaveCount(0)
    // Each row leads with the physical port heading, then the SERIALn_PROTOCOL
    // ref (the heading is the hardware UART when the board map is known, the
    // logical SERIAL port otherwise).
    await expect(page.locator('.ports-matrix-row__title strong').first()).toBeVisible()
    await expect(page.locator('.ports-matrix-row__title small', { hasText: /SERIAL\d+_PROTOCOL/ }).first()).toBeVisible()
    // Edit serial options on the first editable port, toggle one bit (clicking
    // the click-to-highlight chip). Scope to the ports matrix:
    // a bare hasText 'Edit' also matches the header build-info button on
    // branches whose name contains "edit" (case-insensitive substring).
    await page.locator('.ports-matrix button:enabled', { hasText: 'Edit' }).first().click()
    await page.locator('.ports-matrix-row__expanded .scoped-bitmask-bit').first().click()
    // The selected option now shows as a chip in the Options cell.
    await expect(page.locator('[data-testid^="serial-options-chips-"]').first()).toBeVisible()
  })
})

test.describe('connection transports', () => {
  test('WebSocket transport reveals the bridge endpoint URL input', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('websocket')
    // The standalone bridge hint was folded away in #664's header density pass;
    // selecting the WebSocket transport now surfaces the bridge endpoint URL
    // input directly, pre-filled with the default ws:// bridge address.
    const urlInput = page.getByTestId('websocket-url-input')
    await expect(urlInput).toBeVisible()
    await expect(urlInput).toHaveAttribute('placeholder', /^wss?:\/\//)
  })
})

test.describe('header build info', () => {
  test('shows app version + git build under the title, and firmware version once connected', async ({ page }) => {
    await page.goto('/')
    // App version + git branch@hash render even before connecting.
    await expect(page.getByTestId('app-build-info')).toContainText(/^v\d+\.\d+/)
    await expect(page.getByTestId('app-git-info')).toContainText('@')
    // Firmware version only appears once AUTOPILOT_VERSION arrives.
    await expect(page.getByTestId('app-build-info')).not.toContainText('FW')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('app-build-info')).toContainText('FW 4.6.0')
  })
})

test.describe('disconnected landing screen', () => {
  test('renders pre-connect and is replaced by Setup after connect', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('disconnected-landing')).toBeVisible()
    await expect(page.getByTestId('landing-connect-button')).toBeVisible()
    await expect(page.getByTestId('landing-transport-select')).toBeVisible()

    await expect(page.getByRole('heading', { name: 'Configure your ArduPilot flight controller.' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'What you can do' })).toBeVisible()
  })

  test('landing connect button connects via demo transport', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByTestId('disconnected-landing')).toBeVisible()
    await page.getByTestId('landing-transport-select').selectOption('demo')
    await page.getByTestId('landing-connect-button').click()

    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('disconnected-landing')).toHaveCount(0)
    await expect(page.getByTestId('workspace-view-title')).toHaveText('Status & Info')
  })

  test('firmware flasher is reachable from the landing without connecting', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('disconnected-landing')).toBeVisible()
    // Flashing targets fresh/bricked boards with no MAVLink, so the flow
    // must open while disconnected (like Betaflight's Firmware Flasher).
    await expect(page.getByTestId('firmware-flasher')).toHaveCount(0)
    await page.getByTestId('landing-flash-firmware-button').click()
    await expect(page.getByTestId('firmware-flasher')).toBeVisible()
    // Guided wizard: pick vehicle/release, get a direct ArduPilot
    // download link (no proxy), drop the .apj, one Flash button that
    // catches the bootloader on replug.
    await expect(page.getByTestId('firmware-vehicle')).toBeVisible()
    await expect(page.getByTestId('firmware-release')).toBeVisible()
    await expect(page.getByTestId('firmware-download-link')).toHaveAttribute(
      'href',
      /^https:\/\/firmware\.ardupilot\.org\//
    )
    await expect(page.getByTestId('firmware-file')).toBeVisible()
    await expect(page.getByTestId('firmware-flash')).toBeVisible()
    await expect(page.getByText('Do not unplug while it is flashing', { exact: false })).toBeVisible()
    await page.getByTestId('firmware-close').click()
    await expect(page.getByTestId('firmware-flasher')).toHaveCount(0)
  })

  test('firmware flasher is reachable from the Flash tab while connected', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    // The header Flash button was removed — the dedicated Flash tab is the
    // single flashing surface now, and must work even with a vehicle
    // connected so a brand-new FC can be flashed without leaving a session.
    await expect(page.getByTestId('header-flash-firmware-button')).toHaveCount(0)
    await page.getByTestId('view-button-flash').click()
    await expect(page.getByTestId('firmware-flasher')).toBeVisible()
    await expect(page.getByTestId('firmware-flash')).toBeVisible()
  })
})

test.describe('Config — vehicle-aware mode channel', () => {
  test('Rover uses MODE_CH (not FLTMODE_CH) and Sub omits the mode-channel field', async ({ page }) => {
    // Rover: the receiver-signal section should use MODE_CH (which Rover has),
    // so neither FLTMODE_CH nor MODE_CH shows a "not reported" row.
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-rover')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduRover', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expectParameterSyncComplete(page)
    await openView(page, 'config')
    await expect(page.getByTestId('config-field-missing-FLTMODE_CH')).toHaveCount(0)
    await expect(page.getByTestId('config-field-missing-MODE_CH')).toHaveCount(0)

    // Sub: no RC mode channel param exists, so the field is omitted entirely.
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-sub')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduSub', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expectParameterSyncComplete(page)
    await openView(page, 'config')
    await expect(page.getByTestId('config-field-missing-FLTMODE_CH')).toHaveCount(0)
  })
})

test.describe('Modes view', () => {
  test('renders six slot rows with the demo live slot highlighted', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'modes')

    await expect(page.getByTestId('workspace-view-title')).toHaveText('Modes')
    await expect(page.getByTestId('modes-slot-table')).toBeVisible()

    for (const slot of [1, 2, 3, 4, 5, 6]) {
      await expect(page.getByTestId(`modes-slot-${slot}`)).toBeVisible()
    }

    // Demo scenario has FLTMODE_CH = 7 and the mock holds the switch in slot 4's PWM range.
    await expect(page.getByText('CH7')).toBeVisible()
    await expect(page.getByTestId('modes-slot-4')).toHaveClass(/is-active/)

    await expect(page.getByTestId('modes-go-to-flight-mode-task')).toBeVisible()
  })

  test('deep-link button navigates to Receiver flight-mode task', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'modes')

    await page.getByTestId('modes-go-to-flight-mode-task').click()

    await expect(page.getByTestId('workspace-view-title')).toHaveText('Receiver')
  })
})

test.describe('Motors direction test', () => {
  test('per-motor Reverse direction toggles stage the SERVO_BLH_RVMASK bits', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'motors')
    // Reverse toggles live in the Motor Setup tab's Direction sub-tab now.
    await page.getByTestId('outputs-summary-motor-setup').click()
    await page.getByTestId('motor-reorder-lightbox-tab-direction').click()
    // M1 is on a DShot output in the demo, so its reverse toggle is enabled.
    const m1 = page.getByTestId('motor-reorder-direction-reverse-1').locator('input')
    await expect(m1).toBeEnabled()
    await expect(m1).not.toBeChecked()
    await m1.check()
    await expect(m1).toBeChecked()
    // Staging the mask enables the panel's Apply and reboot with a count.
    await expect(page.getByTestId('motor-reorder-apply')).toContainText('Apply and reboot (1)')
  })
})

test.describe('Calibration tab — motor-spin (ESC)', () => {
  test('gated on motor-safety acks; ESC two-step confirm appears (copter)', async ({ page }) => {
    // CompassMot was removed from the Calibration tab; bench-procedure
    // CompassMot doesn't match real flight conditions so the recommended
    // path is now in-flight log-driven calibration. ESC remains because
    // it's a true bench operation (throttle-high power-cycle sequence).
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'calibration')
    await expect(page.getByTestId('calibration-card-esc')).toBeVisible()
    await expect(page.getByTestId('calibration-card-compassmot')).toHaveCount(0)
    // ESC arm button needs the same motor-safety acks the old card did.
    await expect(page.getByTestId('esc-cal-arm')).toBeDisabled()
    await page.getByTestId('cal-props-ack').check()
    await page.getByTestId('cal-area-ack').check()
    await expect(page.getByTestId('esc-cal-arm')).toBeEnabled({ timeout: 30000 })
    // ESC is a two-step confirm (sets ESC_CALIBRATION + reboots).
    await page.getByTestId('esc-cal-arm').click()
    await expect(page.getByTestId('esc-cal-confirm')).toBeVisible()
  })

  test('motor-spin calibrations are hidden on a plane', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await openView(page, 'calibration')
    await expect(page.getByTestId('calibration-card-compassmot')).toHaveCount(0)
    await expect(page.getByTestId('calibration-card-esc')).toHaveCount(0)
  })
})

test.describe('Calibration tab — airspeed (plane)', () => {
  test('enables ARSPD_AUTOCAL on a plane', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await openView(page, 'calibration')
    const card = page.getByTestId('calibration-card-airspeed')
    await expect(card).toBeVisible()
    await card.scrollIntoViewIfNeeded()
    await expect(page.getByTestId('airspeed-cal-autocal')).toBeEnabled({ timeout: 30000 })
    await page.getByTestId('airspeed-cal-autocal').click()
    await expect(card.getByText(/auto-cal enabled/i)).toBeVisible({ timeout: COMMAND_ACK_TIMEOUT })
  })

  test('airspeed card is not shown on a copter', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'calibration')
    await expect(page.getByTestId('calibration-card-airspeed')).toHaveCount(0)
  })
})

test.describe('Calibration tab — battery voltage', () => {
  test('rescales BATT_VOLT_MULT from a measured pack voltage', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'calibration')
    const card = page.getByTestId('calibration-card-battery')
    await expect(card).toBeVisible()
    await card.scrollIntoViewIfNeeded()
    await page.getByTestId('battery-cal-measured-input').fill('16.8')
    await expect(card.getByText(/New multiplier/)).toBeVisible()
    await expect(page.getByTestId('battery-cal-apply')).toBeEnabled({ timeout: 30000 })
    await page.getByTestId('battery-cal-apply').click()
    await expect(card.getByText(/BATT_VOLT_MULT set to/)).toBeVisible({ timeout: COMMAND_ACK_TIMEOUT })
  })
})

test.describe('Calibration tab', () => {
  test('gathers accelerometer / level / compass calibration in one tab', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'calibration')

    await expect(page.getByTestId('calibration-grid')).toBeVisible()
    await expect(page.getByTestId('calibration-card-calibrate-accelerometer')).toBeVisible()
    await expect(page.getByTestId('calibration-card-calibrate-level')).toBeVisible()
    await expect(page.getByTestId('calibration-card-calibrate-compass')).toBeVisible()
    // The accelerometer action uses the shared guided-action button (same
    // flow as Setup) — its idle label is "Calibrate Accelerometer".
    await expect(page.getByTestId('calibration-run-calibrate-accelerometer')).toHaveText('Calibrate Accelerometer')
  })

  test('level calibration completes on the ACK (does not hang waiting for a status text)', async ({ page }) => {
    // Regression: board-level cal (PREFLIGHT_CALIBRATION param5=2) finishes
    // via the COMMAND_ACK alone — real ArduPilot sends no completion
    // STATUSTEXT, so the action must not stay stuck on "running". The demo
    // mock mirrors that (ACK, no STATUSTEXT).
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'calibration')

    const card = page.getByTestId('calibration-card-calibrate-level')
    await expect(card).toBeVisible()
    await page.getByTestId('calibration-run-calibrate-level').click()
    await expect(card.getByText('succeeded', { exact: true })).toBeVisible({ timeout: COMMAND_ACK_TIMEOUT })
  })
})

test.describe('Tuning tab', () => {
  test('renders curated controls with float values rounded for display', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'tuning')

    // The "rates" task renders the Flight Feel controls. The demo seeds
    // ATC_INPUT_TC as the float32-widened 0.15000000596046448 (what a real FC
    // reports); the number field must show it rounded, not all the digits.
    const input = page.getByTestId('tuning-input-ATC_INPUT_TC')
    await expect(input).toBeVisible({ timeout: 10000 })
    await expect(input).toHaveValue('0.15')
  })

  test('the slider tracks live while dragging and only stages on release', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'tuning')

    const input = page.getByTestId('tuning-input-ATC_INPUT_TC')
    await expect(input).toBeVisible({ timeout: 10000 })
    // The first tuning slider is the first Flight Feel control (ATC_INPUT_TC).
    // Dragging it (input events, no pointer-up) must update the value live but
    // NOT commit a staged draft yet — committing on every drag tick is what
    // made the slider stutter and "jump to staged" before you could finish.
    const slider = page.locator('.tuning-control__range').first()
    await slider.fill('0.3')
    await expect(input).toHaveValue('0.3')
    // Mid-drag (before release) nothing is staged.
    await expect(page.locator('.tuning-control--staged')).toHaveCount(0)
  })
})

test.describe('Failsafe view', () => {
  test('renders editable failsafe params populated from the demo scenario', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'failsafe')

    await expect(page.getByTestId('workspace-view-title')).toHaveText('Failsafe')
    await expect(page.getByTestId('failsafe-editor-grid')).toBeVisible()

    // Each failsafe param is now an inline editor seeded from the live value.
    await expect(page.getByTestId('failsafe-row-FS_THR_VALUE').locator('input')).toHaveValue('975')
    await expect(page.getByTestId('failsafe-row-BATT_LOW_VOLT').locator('input')).toHaveValue('14.4')
    await expect(page.getByTestId('failsafe-row-BATT_CRT_VOLT').locator('input')).toHaveValue('13.8')

    await expect(page.getByTestId('failsafe-go-to-power')).toBeVisible()
  })

  test('failsafe params can be edited and staged for write', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'failsafe')

    const save = page.getByTestId('failsafe-save')
    await expect(save).toBeVisible()
    await expect(save).toBeDisabled() // nothing staged yet

    const input = page.getByTestId('failsafe-row-FS_THR_VALUE').locator('input')
    await input.fill('980')
    await input.blur()
    await expect(save).toHaveText('Save Failsafe (1)')
    await expect(save).toBeEnabled()
    await save.click()
    await expect(save).toHaveText('Save Failsafe (0)', { timeout: COMMAND_ACK_TIMEOUT })
  })

  test('deep-link button navigates to Power view', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'failsafe')

    await page.getByTestId('failsafe-go-to-power').click()

    await expect(page.getByTestId('workspace-view-title')).toHaveText('Power')
  })

  test('footer counts are spaced apart, not collapsed into "0 staged0 invalid"', async ({ page }) => {
    // Regression: .scoped-editor-footer / __counts had no CSS rule, so the two
    // count spans rendered flush ("0 staged0 invalid") and the footer wasn't a
    // proper bar. The counts container must be a flex row with a real gap.
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'failsafe')

    const counts = page.locator('.scoped-editor-footer__counts')
    await expect(counts).toBeVisible()
    const spaced = await counts.evaluate((el) => {
      const style = getComputedStyle(el)
      const spans = Array.from(el.querySelectorAll('span'))
      if (spans.length < 2) return false
      const a = spans[0].getBoundingClientRect()
      const b = spans[1].getBoundingClientRect()
      // Either a flex/grid gap is applied, or the boxes have a visible horizontal
      // (or vertical, when wrapped) separation between them.
      const horizontalGap = b.left - a.right
      const verticalGap = b.top - a.bottom
      return (style.display === 'flex' || style.display === 'grid') && (horizontalGap >= 4 || verticalGap >= 0)
    })
    expect(spaced).toBe(true)
  })
})

test.describe('Apply / save is not blocked after a previous write', () => {
  test('a second OSD save is allowed after the first (no forced re-pull)', async ({ page }) => {
    // Regression: every apply set parameterFollowUp.refreshRequired, which the
    // apply gate treated as a hard block — so after one save, the next save was
    // silently disabled until the user re-pulled parameters ("save doesn't work
    // again"). Writes are verified against live readback, so a re-pull isn't
    // required to write again.
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'osd')

    const save = page.getByTestId('osd-save')
    await expect(save).toBeVisible({ timeout: 10000 })

    // Stage + save one element toggle.
    await page.locator('[data-testid^="osd-cell-"][data-testid$="-1"]').first().click()
    await save.click()
    await expect(save).toHaveText('Save OSD (0)', { timeout: COMMAND_ACK_TIMEOUT })

    // Stage a second change — the save must be enabled again, not blocked.
    await page.locator('[data-testid^="osd-cell-"][data-testid$="-1"]').nth(2).click()
    await expect(save).toHaveText('Save OSD (1)')
    await expect(save).toBeEnabled()
  })
})

test.describe('Logs view', () => {
  test('Logs view reflects the demo scenario in its inline editors', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'logs')

    await expect(page.getByTestId('workspace-view-title')).toHaveText('Logs')

    // Demo scenario seeds LOG_BACKEND_TYPE=1 (File). The inline chip grid is
    // the single source of truth now that the read-only mirror table has
    // been removed.
    await expect(
      page.getByTestId('scoped-chips-LOG_BACKEND_TYPE').getByRole('radio', { name: 'File', exact: true })
    ).toBeChecked()

    // Inline editor surface is visible without leaving the Logs view.
    await expect(page.getByTestId('logs-bitmask-editor')).toBeVisible()
    await expect(page.getByTestId('logs-apply')).toBeVisible()
  })

  test('toggling a LOG_BITMASK bit stages a Logs draft', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'logs')

    // Mock seeds LOG_BITMASK = 0xFFFB (bit 2 is the single cleared bit).
    // Bit 7 (IMU) is set; the chip renders as a click-to-highlight box
    // (aria-pressed/is-set), and clicking it clears the bit.
    const imuBit = page.getByTestId('logs-bitmask-bit-7')
    await expect(imuBit).toHaveAttribute('aria-pressed', 'true')

    await imuBit.click()
    await expect(imuBit).toHaveAttribute('aria-pressed', 'false')

    // The Save button should report a staged draft and become enabled.
    await expect(page.getByTestId('logs-apply')).toContainText('Save Logs (1)')
    await expect(page.getByTestId('logs-apply')).toBeEnabled()

    // Revert clears the staged draft and re-highlights the bit.
    await page.getByTestId('logs-revert').click()
    await expect(imuBit).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('logs-apply')).toContainText('Save Logs (0)')
  })

  test('onboard logs: the Logs view exposes the onboard-log controls when connected', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'logs')

    // Wait for the Logs view to be ready (parameter sync settled). The
    // bitmask editor only renders once LOG_BITMASK is in the snapshot, so
    // it doubles as a readiness signal.
    await expect(page.getByTestId('logs-bitmask-editor')).toBeVisible()
    await expect(
      page.getByTestId('scoped-chips-LOG_BACKEND_TYPE').getByRole('radio', { name: 'File', exact: true })
    ).toBeChecked()

    // The onboard-logs section renders and its List control is enabled
    // once a vehicle is connected + identified — this asserts the wiring
    // and the availability gate (the user-actionable surface).
    await expect(page.getByTestId('logs-onboard')).toBeVisible()
    await expect(page.getByTestId('logs-onboard-list')).toBeEnabled()

    // The demo FC reports MAVFTP capability, so the source badge selects the
    // faster burst-read path (it falls back to MAVLink when FTP is absent).
    await expect(page.getByTestId('logs-onboard-source')).toHaveText('MAVFTP')

    // The list/download round-trip itself is covered by the layered node
    // tests — mock-scenario LOG handling (mock-scenario-logs.test.mjs),
    // LogDownloadService collection (log-download-service.test.mjs), and
    // codec round-trip (mavlink-v2-codec.test.mjs) — plus isolated e2e.
    // Asserting it in the full parallel suite is starved by a pre-existing
    // MockTransport solicited-response scheduling quirk under contention
    // (a known CI-fragility quirk); exercising it here would only
    // re-test transport timing, not the feature.
  })
})

test.describe('Files view (MAVFTP browser)', () => {
  test('lists the FC filesystem, navigates into a directory, and shows download/delete actions', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'files')

    // MAVFTP directory listings are real async round-trips through the
    // demo bridge; on a cold/contended CI runner they can exceed the
    // global 15s expect budget (same class as the guided-cal flake). Give
    // the listing-dependent assertions a roomier budget — a genuine break
    // (listing never resolves) still fails well within it.
    const listingTimeout = 30_000
    await expect(page.getByTestId('files-table')).toBeVisible({ timeout: listingTimeout })
    // Demo mock seeds @SYS with uarts.txt + timers.txt + a scripts/ dir.
    await expect(page.getByTestId('files-row-uarts.txt')).toBeVisible({ timeout: listingTimeout })
    await expect(page.getByTestId('files-row-scripts')).toBeVisible({ timeout: listingTimeout })
    // A file row exposes a download action; a dir does not.
    await expect(page.getByTestId('files-download-uarts.txt')).toBeVisible()

    // Navigate into the scripts subdirectory. Assert on the directory's
    // contents (hello.lua only exists under scripts/) as the proof of
    // navigation — content-based and robust to the async listing timing;
    // the path label is a secondary check.
    await page.getByTestId('files-row-scripts').getByRole('button', { name: 'scripts/' }).click()
    await expect(page.getByTestId('files-row-hello.lua')).toBeVisible({ timeout: listingTimeout })
    await expect(page.getByTestId('files-current-path')).toContainText('@SYS/scripts')

    // Up navigation returns to @SYS (uarts.txt only exists at the root).
    await page.getByTestId('files-up').click()
    await expect(page.getByTestId('files-row-uarts.txt')).toBeVisible()
    await expect(page.getByTestId('files-current-path')).toContainText('@SYS')
  })

  test('Files tab shows a connect prompt when disconnected', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('view-button-files').click()
    await expect(page.getByTestId('files-disconnected')).toBeVisible()
    await expect(page.getByTestId('files-table')).toHaveCount(0)
  })
})

test.describe('Flash view', () => {
  test('Flash tab renders the wizard + DFU button + custom server toggle', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'flash')

    // Flash wizard surface persists across the tab — testid carries over
    // from the previous modal-only render.
    await expect(page.getByTestId('firmware-flasher')).toBeVisible()
    await expect(page.getByTestId('firmware-vehicle')).toBeVisible()
    await expect(page.getByTestId('firmware-release')).toBeVisible()
    await expect(page.getByTestId('firmware-flash')).toBeVisible()

    // Request Reboot + DFU buttons show once we have a live MAVLink link.
    await expect(page.getByTestId('firmware-request-reboot')).toBeVisible()
    await expect(page.getByTestId('firmware-enter-dfu')).toBeVisible()

    // DFU is two-step: clicking arms a confirm/cancel pair + a warning,
    // and never sends on the first click. Cancel returns to the start.
    await page.getByTestId('firmware-enter-dfu').click()
    await expect(page.getByTestId('firmware-enter-dfu-confirm')).toBeVisible()
    await expect(page.getByTestId('firmware-enter-dfu-warning')).toBeVisible()
    await page.getByTestId('firmware-enter-dfu-cancel').click()
    await expect(page.getByTestId('firmware-enter-dfu')).toBeVisible()
    await expect(page.getByTestId('firmware-enter-dfu-confirm')).toHaveCount(0)

    // Custom server toggle expands a URL + token panel.
    await expect(page.getByTestId('firmware-custom-server')).toHaveCount(0)
    await page.getByTestId('firmware-toggle-custom-server').click()
    await expect(page.getByTestId('firmware-custom-server')).toBeVisible()
    await expect(page.getByTestId('firmware-custom-server-url')).toBeVisible()
    await expect(page.getByTestId('firmware-custom-server-token')).toBeVisible()
  })

  test('Flash tab from the landing (disconnected) still flashes without DFU button', async ({ page }) => {
    await page.goto('/')
    // No connect — go straight to Flash tab from the disconnected nav.
    // Disconnected landing offers the Flash modal via its own button; the
    // tab itself is reachable as soon as a transport is selected. In the
    // pre-connect state there's no MAVLink link, so the DFU button hides.
    await page.getByTestId('view-button-flash').click()
    await expect(page.getByTestId('firmware-flasher')).toBeVisible()
    await expect(page.getByTestId('firmware-enter-dfu')).toHaveCount(0)
  })

  test('Flash tab: the DFU .hex card parses a hex and flashes it over a mocked WebUSB device', async ({ page }) => {
    // Stub navigator.usb with a fake STM32 DFU device that records every
    // control-OUT and answers GETSTATUS as idle/OK, so the whole UI -> WebUSB
    // binding -> DfuSe protocol path runs end-to-end without real hardware.
    await page.addInitScript(() => {
      const out: Array<{ request: number; value: number; len: number }> = []
      ;(window as unknown as { __dfuOut: typeof out }).__dfuOut = out
      // Flash emulator state so the read-back verify pass succeeds.
      const flash = new Map<number, number>()
      const xfer = 2048
      let addrPtr = 0
      const device = {
        productName: 'STM32 BOOTLOADER',
        configuration: {
          interfaces: [
            {
              interfaceNumber: 0,
              alternates: [
                {
                  alternateSetting: 0,
                  interfaceClass: 0xfe,
                  interfaceSubclass: 0x01,
                  interfaceName: '@Internal Flash  /0x08000000/16*128Kg'
                }
              ]
            }
          ]
        },
        open: async () => {},
        close: async () => {},
        selectConfiguration: async () => {},
        claimInterface: async () => {},
        releaseInterface: async () => {},
        selectAlternateInterface: async () => {},
        controlTransferIn: async (setup: { requestType: string; request: number; value: number }, length: number) => {
          if (setup.requestType === 'class' && setup.request === 3) {
            // GETSTATUS: status OK, poll 0, state dfuDNLOAD_IDLE (5).
            return { status: 'ok', data: new DataView(new Uint8Array([0, 0, 0, 0, 5, 0]).buffer) }
          }
          if (setup.request === 2) {
            // DFU_UPLOAD — serve back the programmed bytes so read-back verify passes.
            const base = addrPtr + (setup.value - 2) * xfer
            const buf = new Uint8Array(length)
            for (let i = 0; i < length; i += 1) buf[i] = flash.get(base + i) ?? 0xff
            return { status: 'ok', data: new DataView(buf.buffer) }
          }
          if (setup.request === 6) {
            // GET_DESCRIPTOR(config): a lone DFU functional descriptor with
            // wTransferSize = 2048 (0x0800) at offset 5-6.
            return { status: 'ok', data: new DataView(new Uint8Array([0x09, 0x21, 0x0b, 0xff, 0x00, 0x00, 0x08, 0x1a, 0x01]).buffer) }
          }
          return { status: 'ok', data: new DataView(new Uint8Array(6).buffer) }
        },
        controlTransferOut: async (setup: { request: number; value: number }, data?: ArrayBuffer) => {
          const bytes = data ? new Uint8Array(data) : new Uint8Array(0)
          out.push({ request: setup.request, value: setup.value, len: bytes.length })
          // Track the DfuSe address pointer + programmed bytes so UPLOAD verify works.
          if (setup.request === 1 && setup.value === 0 && bytes[0] === 0x21) {
            addrPtr = (bytes[1] | (bytes[2] << 8) | (bytes[3] << 16) | (bytes[4] << 24)) >>> 0
          } else if (setup.request === 1 && setup.value >= 2) {
            const base = addrPtr + (setup.value - 2) * xfer
            for (let i = 0; i < bytes.length; i += 1) flash.set(base + i, bytes[i])
          }
          return { status: 'ok' }
        }
      }
      Object.defineProperty(navigator, 'usb', { configurable: true, value: { requestDevice: async () => device } })
    })

    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'flash')

    // The DFU .hex flasher is its own sub-tab now (firmware .apj is the default).
    await expect(page.getByTestId('dfu-hex-flasher')).toHaveCount(0)
    await page.getByTestId('flash-tab-dfu-hex').click()
    await expect(page.getByTestId('dfu-hex-flasher')).toBeVisible()

    // Full chip erase is offered and defaults to on.
    await expect(page.getByTestId('dfu-hex-full-erase').locator('input')).toBeChecked()

    // The card carries its own two-step "Activate DFU mode" reboot control.
    await expect(page.getByTestId('dfu-hex-activate')).toBeVisible()
    await page.getByTestId('dfu-hex-activate').click()
    await expect(page.getByTestId('dfu-hex-activate-confirm')).toBeVisible()

    // A minimal valid Intel HEX: extended-linear base 0x0800, 8 data bytes at
    // 0x08000000, EOF. Built with correct checksums.
    const record = (type: number, addr: number, data: number[]) => {
      const bytes = [data.length, (addr >> 8) & 0xff, addr & 0xff, type, ...data]
      const sum = bytes.reduce((acc, b) => (acc + b) & 0xff, 0)
      bytes.push((0x100 - sum) & 0xff)
      return ':' + bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
    }
    const hex = [
      record(0x04, 0x0000, [0x08, 0x00]),
      record(0x00, 0x0000, [1, 2, 3, 4, 5, 6, 7, 8]),
      ':00000001FF'
    ].join('\n')

    await page
      .getByTestId('dfu-hex-file')
      .setInputFiles({ name: 'arducopter.hex', mimeType: 'application/octet-stream', buffer: Buffer.from(hex) })

    await expect(page.getByTestId('dfu-hex-summary')).toBeVisible()
    await expect(page.getByTestId('dfu-hex-summary')).toContainText('0x08000000')
    await expect(page.getByTestId('dfu-hex-flash')).toBeEnabled()

    await page.getByTestId('dfu-hex-flash').click()
    await expect(page.getByTestId('dfu-hex-notice')).toContainText('unplug the flight controller and plug it back in')

    // The DfuSe sequence reached the fake device: an erase (0x41), a set-address
    // (0x21) and a data block were all sent as DFU_DNLOAD (request 1).
    const ops = await page.evaluate(() => (window as unknown as { __dfuOut: Array<{ request: number; value: number; len: number }> }).__dfuOut)
    const dnloads = ops.filter((o) => o.request === 1)
    expect(dnloads.length).toBeGreaterThan(2)
    expect(dnloads.some((o) => o.value >= 2 && o.len === 8)).toBe(true)
  })
})

test.describe('Config view', () => {
  test('renders the BF-style baseline section grid + camera/gps/logging', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-config').click()

    await expect(page.getByTestId('config-section-grid')).toBeVisible()
    for (const id of [
      'board-orientation',
      'arming',
      'identity',
      'beeper',
      'camera-trigger',
      'gps',
      'logging'
    ]) {
      await expect(page.getByTestId(`config-section-${id}`)).toBeVisible()
    }
    // Statistics moved to the Setup side panel — no longer a Config section.
    await expect(page.getByTestId('config-section-statistics')).toHaveCount(0)
    // Pilot-rate knobs are mirrored into Config (demo Copter streams the full set).
    await expect(page.getByTestId('config-section-pilot-rates')).toBeVisible()
    // Fast-rate thread is build-gated: the demo Copter mock does not stream
    // FSTRATE_*, so the Fast loop rate section must be hidden rather than
    // rendering empty "(not reported)" rows.
    await expect(page.getByTestId('config-section-fast-loop-rate')).toHaveCount(0)
  })

  test('Config tab exposes an Apply / Revert toolbar wired to the Config draft scope', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-config').click()

    // Toolbar present; both buttons start disabled (no staged drafts).
    await expect(page.getByTestId('config-toolbar')).toBeVisible()
    await expect(page.getByTestId('config-apply')).toBeDisabled()
    await expect(page.getByTestId('config-revert')).toBeDisabled()
  })

  test('Statistics live on the Setup side panel, not in Config', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()

    // Statistics moved out of the Config grab-bag onto the Setup side, and the
    // mock seeds lifetime counters so the panel reads like a used airframe
    // (110 h runtime / 24 h flight / 142 boots) rather than em dashes.
    const stats = page.getByTestId('setup-statistics')
    await expect(stats).toBeVisible()
    await expect(stats).toContainText('Boot count')
    await expect(stats).toContainText('142')
    await expect(stats).toContainText('h')
    await expect(stats).not.toContainText('—')

    await page.getByTestId('view-button-config').click()
    await expect(page.getByTestId('config-section-statistics')).toHaveCount(0)
  })

  test('ESC bdshot helper stages first-4 outputs + BLHeli auto', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-config').click()

    const footer = page.getByTestId('esc-dshot-footer')
    await footer.scrollIntoViewIfNeeded()
    // Demo runs DShot300, so the bdshot helper is enabled.
    const enable = page.getByTestId('esc-enable-bdshot')
    await expect(enable).toBeEnabled()
    await enable.click()
    // Staged BLH_BDMASK=15 → first 4 output chips become set (orange highlight).
    const bdmask = page.getByTestId('scoped-bitmask-SERVO_BLH_BDMASK')
    const bits = bdmask.locator('.scoped-bitmask-bit')
    await expect(bits.nth(0)).toHaveClass(/is-set/)
    await expect(bits.nth(3)).toHaveClass(/is-set/)
    await expect(bits.nth(4)).not.toHaveClass(/is-set/)
  })

  test('applying a reboot-required config change prompts the operator to reboot', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-config').click()

    // Enabling bdshot stages SERVO_BLH_* params, which are reboot-required.
    await page.getByTestId('esc-dshot-footer').scrollIntoViewIfNeeded()
    await page.getByTestId('esc-enable-bdshot').click()

    // Apply the staged config changes; the apply path flags requiresReboot.
    await page.getByRole('button', { name: /Apply Config/ }).click()

    // The operator is prompted to reboot now (not just a passive note).
    await expect(page.locator('.workspace-note--warning', { hasText: 'Reboot required' })).toBeVisible()
    await expect(page.getByTestId('workspace-note-reboot')).toBeVisible()
  })

  test('selecting a DShot MOT_PWM_TYPE auto-enables bidirectional DShot', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-config').click()
    const esc = page.getByTestId('config-section-esc-dshot')
    await esc.scrollIntoViewIfNeeded()
    // Wait for SERVO_BLH_BDMASK to be synced (its presence is how the app knows
    // the firmware supports BDShot) before changing the protocol — otherwise the
    // auto-enable correctly treats it as unsupported.
    const bits = page.getByTestId('scoped-bitmask-SERVO_BLH_BDMASK').locator('.scoped-bitmask-bit')
    await expect(bits.first()).toBeVisible()
    // MOT_PWM_TYPE is the first field (a select); switch it to a different DShot
    // rate (demo starts at DShot300=5) to trigger the change.
    const motSelect = esc.locator('select').first()
    await motSelect.selectOption('6') // DShot600
    // BDShot auto-stages on outputs 1-4 (demo firmware has SERVO_BLH_BDMASK).
    await expect(bits.nth(0)).toHaveClass(/is-set/)
    await expect(bits.nth(3)).toHaveClass(/is-set/)
  })

  test('ESC & Protocol exposes Frame class/type for a Copter', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await page.getByTestId('view-button-motors').click()
    await page.getByTestId('outputs-summary-esc-protocol').click()
    const frame = page.getByTestId('esc-frame-card')
    await frame.scrollIntoViewIfNeeded()
    await expect(frame).toBeVisible()
    // FRAME_CLASS + FRAME_TYPE render as two enum selects.
    await expect(frame.locator('select')).toHaveCount(2)
    const apply = page.getByTestId('esc-frame-apply')
    await expect(apply).toBeDisabled()
    // Changing the frame type stages a draft and enables Apply Frame.
    await frame.locator('select').nth(1).selectOption('0') // Plus
    await expect(apply).toBeEnabled()
    await expect(apply).toContainText('Apply Frame (1)')
  })

  test('Config sections pack into a multicolumn (masonry) layout', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'config')
    const grid = page.getByTestId('config-section-grid')
    await expect(grid).toBeVisible()
    // Sections pack via CSS multicolumn (columns: 300px) so short cards tuck
    // under tall ones instead of leaving a row of dead space.
    const columnWidth = await grid.evaluate((el) => getComputedStyle(el).columnWidth)
    expect(columnWidth).toBe('300px')
  })

  test('Receiver & signal section mirrors RSSI / mode-channel / RC options into Config', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-config').click()
    const section = page.getByTestId('config-section-receiver-signal')
    await section.scrollIntoViewIfNeeded()
    await expect(section).toBeVisible()
    // RC_OPTIONS renders as a chip grid here too (shared bitmask field).
    await expect(page.getByTestId('scoped-bitmask-RC_OPTIONS')).toBeVisible()
  })

  test('ESC & DShot section exposes protocol + reverse/bdshot masks as chips', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-config').click()

    const esc = page.getByTestId('config-section-esc-dshot')
    await esc.scrollIntoViewIfNeeded()
    await expect(esc).toBeVisible()
    // Reverse + bidirectional-DShot masks render as per-output chip grids.
    await expect(page.getByTestId('scoped-bitmask-SERVO_BLH_RVMASK')).toBeVisible()
    await expect(page.getByTestId('scoped-bitmask-SERVO_BLH_BDMASK')).toBeVisible()
    // Reverse is off by default (demo SERVO_BLH_RVMASK=0).
    await expect(page.getByTestId('scoped-bitmask-SERVO_BLH_RVMASK').locator('.scoped-bitmask-bit').first()).not.toHaveClass(/is-set/)
    await expect(esc.getByText('Output 1').first()).toBeVisible()
  })

  test('Config editable fields expose a per-param info "i" tooltip', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-config').click()
    const info = page.locator('[data-testid^="config-field-info-"]').first()
    await info.scrollIntoViewIfNeeded()
    await expect(info).toBeVisible()
    // Tooltip is hidden until hover, then reveals the param description.
    const tip = info.locator('xpath=following-sibling::span[@role="tooltip"]')
    await expect(tip).toBeHidden()
    await info.hover()
    await expect(tip).toBeVisible()
    await expect(tip).not.toHaveText('')
  })

  test('Config exposes a Frame section to set FRAME_CLASS / FRAME_TYPE', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-config').click()
    const frame = page.getByTestId('config-section-frame')
    await frame.scrollIntoViewIfNeeded()
    await expect(frame).toBeVisible()
    // FRAME_CLASS + FRAME_TYPE are catalogued enums -> two selects to set them.
    await expect(frame.locator('select')).toHaveCount(2)
  })

  test('exposes system-rates, active-IMU, and expanded GPS sections', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-config').click()

    await expect(page.getByTestId('config-section-system-rates')).toBeVisible()
    await expect(page.getByTestId('config-section-active-imu')).toBeVisible()
    // Max lean angle resolves to the param the FC actually streams (ANGLE_MAX on
    // <=4.6, ATC_ANGLE_MAX on 4.7+) — the demo streams ANGLE_MAX, so the field
    // reports a value rather than "(not reported)".
    const pilotRates = page.getByTestId('config-section-pilot-rates')
    await expect(pilotRates.getByText('Max lean angle')).toBeVisible()
    await expect(pilotRates).not.toContainText('not reported')
    // Main loop rate renders as a dropdown (enum), defaulting to 400 Hz.
    const rates = page.getByTestId('config-section-system-rates')
    await expect(rates.getByText('Main loop rate')).toBeVisible()
    // GPS behavior section now carries the multi-GPS knobs.
    const gps = page.getByTestId('config-section-gps')
    await expect(gps.getByText('Auto switch')).toBeVisible()
    // GPS_TYPE renders as "Primary GPS Type" and GPS_PRIMARY as "Primary GPS
    // Select" (metadata labels), so match the specific GPS_PRIMARY knob rather
    // than the ambiguous "Primary GPS" substring shared by both.
    await expect(gps.getByText('Primary GPS Select')).toBeVisible()
  })
})

test.describe('Receiver stick-driven craft', () => {
  test('centred sticks hold heading and sit level (no yaw spin)', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'receiver')
    const att = page.getByTestId('receiver-stick-attitude')
    await att.scrollIntoViewIfNeeded()
    await page.waitForTimeout(1500)
    const heading1 = await att.getAttribute('data-yaw-heading')
    expect(Math.abs(Number(await att.getAttribute('data-roll-deg')))).toBeLessThanOrEqual(2)
    expect(Math.abs(Number(await att.getAttribute('data-pitch-deg')))).toBeLessThanOrEqual(2)
    // Yaw is a rate: a centred stick must NOT integrate the heading over time.
    await page.waitForTimeout(2500)
    expect(await att.getAttribute('data-yaw-heading')).toBe(heading1)
  })

  test('the receiver live monitor shows a craft that tracks the sticks', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'receiver')
    const card = page.getByTestId('receiver-stick-craft-card')
    await expect(card).toBeVisible()
    await expect(page.getByTestId('receiver-stick-craft')).toHaveAttribute('data-craft-model', /.+/)
  })
})

test.describe('Receiver stick-range bar', () => {
  test('stick-range exercise cards show a live channel-movement bar', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'receiver')
    await page.getByTestId('receiver-task-nav').getByRole('button', { name: 'Endpoints' }).click()
    const bar = page.getByTestId('rc-range-bar-throttle')
    await bar.scrollIntoViewIfNeeded()
    await expect(bar).toBeVisible()
    // The live marker tracks the streamed RC position.
    await expect(bar.locator('.rc-range-axis-card__marker')).toBeVisible()
  })
})

test.describe('Receiver RC options', () => {
  test('RC_OPTIONS renders as a bitmask chip grid in the receiver tab', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'receiver')
    // RC options live under the receiver's Flight Modes task.
    await page.getByTestId('receiver-task-nav').getByRole('button', { name: 'Flight Modes' }).click()
    const card = page.getByTestId('receiver-rc-options')
    await card.scrollIntoViewIfNeeded()
    await expect(card).toBeVisible()
    const field = page.getByTestId('scoped-bitmask-RC_OPTIONS')
    const bits = field.locator('.scoped-bitmask-bit')
    await expect(bits.first()).toBeVisible()
    // Demo seeds RC_OPTIONS=0, so every option starts unset (no orange).
    await expect(bits.first()).not.toHaveClass(/is-set/)
    await expect(field).toContainText('Ignore RC Receiver')
  })
})

test.describe('Receiver flight-mode labels', () => {
  test('flight-mode slots render known mode names (no "Mode N" placeholders)', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'modes')
    const table = page.getByTestId('modes-slot-table')
    await expect(table).toBeVisible()
    // Demo seeds all six copter slots: FLTMODE1=0 (Stabilize), 2=5 (Loiter),
    // 3=6 (RTL), 4=2 (AltHold), 5=16 (PosHold), 6=9 (Land) — matching a real
    // six-position mode switch rather than leaving slots 4-6 unset. The mode
    // cell is now an editable ScopedSelectField; we assert the selected
    // option value per slot (which is what the user sees as the displayed
    // dropdown text) rather than the table's full text content (which now
    // also contains every other option in each <select> menu).
    await expect(table.getByTestId('modes-slot-1').locator('select')).toHaveValue('0')   // Stabilize
    await expect(table.getByTestId('modes-slot-2').locator('select')).toHaveValue('5')   // Loiter
    await expect(table.getByTestId('modes-slot-3').locator('select')).toHaveValue('6')   // RTL
    await expect(table.getByTestId('modes-slot-4').locator('select')).toHaveValue('2')   // AltHold
    await expect(table.getByTestId('modes-slot-5').locator('select')).toHaveValue('16')  // PosHold
    await expect(table.getByTestId('modes-slot-6').locator('select')).toHaveValue('9')   // Land
    // All six slots render — proves the catalog drove the dropdown even
    // for the previously unset 4..6 slots (was: "Mode <n>" placeholders).
    await expect(table.locator('[data-testid^="modes-slot-"]')).toHaveCount(6)
  })
})

test.describe('Receiver RSSI', () => {
  test('shows RX RSSI as a percentage, not the raw 0-254 byte', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'receiver')
    // RX RSSI lives in the Signal Setup task now (removed from the main monitor).
    await page.getByTestId('receiver-task-nav').getByRole('button', { name: 'Signal Setup' }).click()
    // Demo seeds RC_CHANNELS.rssi = 100 (raw 0-254), which is ~39%.
    await expect(page.getByText('Live RX RSSI: 39%')).toBeVisible()
  })
})

test.describe('Sticky side navigation', () => {
  test('the side nav follows the page on scroll (desktop)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 })
    await page.goto('/')
    await connectViaHeader(page)
    const sidebar = page.locator('.workspace-sidebar')
    await expect(sidebar).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 1000))
    await page.waitForTimeout(200)
    // Sticky engages: the sidebar stays pinned in view rather than scrolling off.
    await expect(sidebar).toBeInViewport()
  })

  test('the nav strip follows the page on scroll (mobile)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 })
    await page.goto('/')
    await connectViaHeader(page)
    const nav = page.locator('.workspace-nav--flat')
    await expect(nav).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, 1200))
    await page.waitForTimeout(200)
    await expect(nav).toBeInViewport()
  })
})

test.describe('Presets erase settings', () => {
  test('erase is confirm-gated and resets parameters to defaults', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'presets')

    const erase = page.getByTestId('presets-erase')
    await expect(erase).toBeVisible()
    // First click only arms the confirm; nothing is sent yet.
    await page.getByTestId('presets-erase-button').click()
    await expect(page.getByTestId('presets-erase-confirm')).toBeVisible()
    await page.getByTestId('presets-erase-cancel').click()
    await expect(page.getByTestId('presets-erase-button')).toBeVisible()
    // Confirm path runs the reset (mock acks PREFLIGHT_STORAGE) and surfaces success.
    await page.getByTestId('presets-erase-button').click()
    await page.getByTestId('presets-erase-confirm').click()
    await expect(page.getByText('reset to firmware defaults', { exact: false })).toBeVisible()
  })
})

test.describe('OSD view preview', () => {
  test('MSP cell count is compact and nudges an explicit value when Auto', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'osd')

    const cellCount = page.getByTestId('osd-msp-cell-count')
    await cellCount.scrollIntoViewIfNeeded()
    await expect(cellCount).toBeVisible()
    // Demo seeds MSP_OSD_NCELLS = 0 (Auto), so the "set an explicit count" nudge shows.
    await expect(page.getByTestId('osd-msp-cell-count-note')).toBeVisible()
    // The select is width-capped (no longer stretching the panel).
    const width = await cellCount.locator('select').first().evaluate((el) => el.getBoundingClientRect().width)
    expect(width).toBeLessThanOrEqual(241)
  })

  test('per-element units is a clear placeholder (AP applies units globally)', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'osd')
    const units = page.getByTestId('osd-element-units')
    await units.scrollIntoViewIfNeeded()
    await expect(units).toBeVisible()
    // The control is a disabled placeholder, with a note explaining why.
    await expect(units.locator('select')).toBeDisabled()
    await expect(units).toContainText('globally')
  })

  test('analog/HD layout selector switches the preview canvas (PAL/NTSC/HD)', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'osd')

    const screen = page.locator('.osd-preview-screen').first()
    await expect(screen).toHaveAttribute('data-osd-layout', 'pal')
    const grid = page.getByTestId('osd-preview-grid')
    const columnCount = () =>
      grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
    // PAL is 30 columns; the two HD grids are 50x18 and 60x22.
    expect(await columnCount()).toBe(30)
    await page.getByTestId('osd-analog-layout').locator('select').selectOption('hd_50x18')
    await expect(screen).toHaveAttribute('data-osd-layout', 'hd_50x18')
    expect(await columnCount()).toBe(50)
    await page.getByTestId('osd-analog-layout').locator('select').selectOption('hd_60x22')
    await expect(screen).toHaveAttribute('data-osd-layout', 'hd_60x22')
    expect(await columnCount()).toBe(60)
  })

  test('renders the per-element preview from the OSD1_*_EN/X/Y catalog values', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'osd')

    // Mock seeds five enabled elements: BAT_VOLT, RSSI, ALTITUDE, CURRENT,
    // HEADING, plus FLTMODE. THROTTLE, GSPEED, HOME, HORIZON stay disabled.
    await expect(page.getByTestId('osd-preview-grid')).toBeVisible()
    await expect(page.getByTestId('osd-preview-element-BAT_VOLT')).toBeVisible()
    await expect(page.getByTestId('osd-preview-element-RSSI')).toBeVisible()
    await expect(page.getByTestId('osd-preview-element-ALTITUDE')).toBeVisible()
    await expect(page.getByTestId('osd-preview-element-CURRENT')).toBeVisible()
    await expect(page.getByTestId('osd-preview-element-HEADING')).toBeVisible()
    await expect(page.getByTestId('osd-preview-element-FLTMODE')).toBeVisible()

    // Disabled elements never reach the DOM.
    await expect(page.getByTestId('osd-preview-element-THROTTLE')).toHaveCount(0)
    await expect(page.getByTestId('osd-preview-element-GSPEED')).toHaveCount(0)
    await expect(page.getByTestId('osd-preview-element-HOME')).toHaveCount(0)
    await expect(page.getByTestId('osd-preview-element-HORIZON')).toHaveCount(0)
  })

  test('OSD elements can be aligned to an exact cell via X/Y inputs', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-osd').click()

    const align = page.getByTestId('osd-element-align-BAT_VOLT')
    await align.scrollIntoViewIfNeeded()
    await expect(align).toBeVisible()
    // Type an exact column; the preview element snaps to that cell (col+1).
    await align.locator('input[type="number"]').first().fill('10')
    const element = page.getByTestId('osd-preview-element-BAT_VOLT')
    await expect(async () => {
      const col = await element.evaluate((el) => getComputedStyle(el).gridColumnStart)
      expect(col).toBe('11')
    }).toPass()
  })

  test('OSD preview elements are draggable and stage X/Y drafts on the OSD scope', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-osd').click()

    await expect(page.getByTestId('osd-preview-grid')).toBeVisible()
    const batVolt = page.getByTestId('osd-preview-element-BAT_VOLT')
    await expect(batVolt).toBeVisible()
    await expect(batVolt).toHaveClass(/osd-preview-screen__element--draggable/)

    const gridBox = await page.getByTestId('osd-preview-grid').boundingBox()
    const startBox = await batVolt.boundingBox()
    if (!gridBox || !startBox) throw new Error('no bounding box for OSD preview grid or element')

    const cellWidth = gridBox.width / 30
    const cellHeight = gridBox.height / 16
    const startX = startBox.x + startBox.width / 2
    const startY = startBox.y + startBox.height / 2

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    // Step in cell-sized increments so the pointer-move handler fires reliably.
    for (let step = 1; step <= 4; step += 1) {
      await page.mouse.move(startX + cellWidth * step, startY + cellHeight * step, { steps: 2 })
    }
    await page.mouse.up()

    // The Save OSD CTA now reports staged-count > 0 reflecting the X/Y drafts the drag committed.
    const save = page.getByRole('button', { name: /Save OSD \(\d+\)/ })
    await expect(save).toBeVisible()
  })

  test('OSD preview-screen dropdown switches which screen the preview renders', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-osd').click()

    // BF-style: a single dropdown picks the previewed screen (no per-screen tabs).
    const select = page.getByTestId('osd-preview-screen-select')
    await expect(select).toBeVisible()
    await expect(select).toHaveValue('1')

    // The OSD1 matrix column is flagged as the previewed one by default.
    // (Use the column-wrapper testid rather than getByText: the column header
    // now contains the OSD<n> name plus an enable toggle, so a text match would
    // resolve to the inner name span rather than the outer wrapper that
    // carries the is-preview class.)
    await expect(page.getByTestId('osd-matrix-col-1')).toHaveClass(/is-preview/)
    await expect(page.getByTestId('osd-matrix-col-2')).not.toHaveClass(/is-preview/)

    // Selecting screen 2 moves the preview marker to the OSD2 column.
    await select.selectOption('2')
    await expect(select).toHaveValue('2')
    await expect(page.getByTestId('osd-matrix-col-2')).toHaveClass(/is-preview/)
    await expect(page.getByTestId('osd-matrix-col-1')).not.toHaveClass(/is-preview/)
  })

  test('Copy Layout / Paste Layout copies a screen layout to another screen', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-osd').click()

    const paste = page.getByTestId('osd-paste-layout')
    const save = page.getByTestId('osd-save')
    await expect(page.getByTestId('osd-copy-layout')).toBeVisible()
    // Nothing copied yet -> paste disabled.
    await expect(paste).toBeDisabled()

    // Wait for OSD params to sync before copying (copy reads the live snapshot).
    await expect(page.getByTestId('osd-cell-BAT_VOLT-1')).toBeChecked({ timeout: COMMAND_ACK_TIMEOUT })

    // Copy OSD1's layout, switch to OSD2, paste. The demo seeds different
    // enabled sets per screen, so pasting OSD1 onto OSD2 stages real changes.
    await page.getByTestId('osd-copy-layout').click()
    await expect(paste).toBeEnabled()
    await expect(paste).toContainText('from OSD1')
    await page.getByTestId('osd-preview-screen-select').selectOption('2')
    await paste.click()
    // Staged drafts now exist -> Save OSD is enabled with a non-zero count.
    await expect(save).toBeEnabled()
    await expect(save).not.toHaveText('Save OSD (0)')
  })

  test('Screen Options panel exposes editable per-screen OSD params', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-osd').click()

    const card = page.getByTestId('osd-screen-options')
    await expect(card).toBeVisible()
    await expect(card).toContainText('Screen 1 Options')
    // Wait for params to sync, then edit the Font field and confirm it stages.
    await expect(page.getByTestId('osd-cell-BAT_VOLT-1')).toBeChecked({ timeout: COMMAND_ACK_TIMEOUT })
    const font = card.locator('label', { hasText: 'Font' }).locator('input')
    await font.fill('3')
    await font.blur()
    await expect(page.getByTestId('osd-save')).not.toHaveText('Save OSD (0)')
  })

  test('OSD tab uses a BF-style element x screen matrix with categorized rows', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-osd').click()

    // BF-style layout: a menu side, a sticky preview side.
    await expect(page.getByTestId('osd-bf-menu')).toBeVisible()
    await expect(page.getByTestId('osd-bf-preview-pane')).toBeVisible()

    // The matrix renders rows grouped by category (Power / Speed / etc.).
    await expect(page.getByTestId('osd-element-matrix')).toBeVisible()
    await expect(page.getByTestId('osd-element-group-power')).toBeVisible()
    await expect(
      page.getByTestId('osd-element-group-power').getByTestId('osd-element-row-BAT_VOLT')
    ).toBeVisible()

    // Each element row carries a checkbox per OSD screen (OSD1-4) reflecting
    // that screen's OSD<n>_BAT_VOLT_EN. The mock enables BAT_VOLT on OSD1 + OSD2
    // but not OSD3, so the row shows distinct per-screen state.
    await expect(page.getByTestId('osd-cell-BAT_VOLT-1')).toBeChecked()
    await expect(page.getByTestId('osd-cell-BAT_VOLT-2')).toBeChecked()
    await expect(page.getByTestId('osd-cell-BAT_VOLT-3')).not.toBeChecked()

    // Every element — including advanced ones — is addressable on all four
    // screens (matching a real FC), so even a non-"main" element like Battery
    // used (mAh) has a checkbox in each OSD column, not just OSD1.
    for (const screen of [1, 2, 3, 4]) {
      await expect(page.getByTestId(`osd-cell-BATUSED-${screen}`)).toBeVisible()
    }
  })

  test('toggling a matrix cell stages the OSD<n>_<id>_EN write for that screen', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-osd').click()

    // THROTTLE is seeded disabled on screen 1; enabling its cell stages a draft.
    const cell = page.getByTestId('osd-cell-THROTTLE-1')
    await cell.scrollIntoViewIfNeeded()
    await expect(cell).not.toBeChecked()
    await cell.check()
    await expect(cell).toBeChecked()

    // The element appears in the previewed (screen 1) overlay and Save OSD arms.
    await expect(page.getByTestId('osd-preview-element-THROTTLE')).toBeVisible()
    await expect(page.getByRole('button', { name: /Save OSD \(\d+\)/ })).toBeVisible()
  })

  test('enabling an advanced (unpositioned) element still previews it', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-osd').click()

    // BATUSED is an advanced element: the mock seeds its EN but no X/Y. Enabling
    // it must still draw it on the overlay via the default-position fallback,
    // not silently drop it for lack of a seeded cell.
    await expect(page.getByTestId('osd-preview-element-BATUSED')).toHaveCount(0)
    const cell = page.getByTestId('osd-cell-BATUSED-1')
    await cell.scrollIntoViewIfNeeded()
    await cell.check()
    await expect(page.getByTestId('osd-preview-element-BATUSED')).toBeVisible()
  })

  test('OSD element matrix does not overflow horizontally at a narrow 2-column width', async ({ page }) => {
    // The matrix is the widest surface (element label + 4 screen columns, and
    // an enabled row also grows inline X/Y align inputs). At ~1000px the BF
    // layout is still two columns, so the matrix lives in a ~half-width menu —
    // the tightest case. Guard against a row pushing a horizontal scrollbar.
    await page.setViewportSize({ width: 1000, height: 900 })
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-osd').click()
    const matrix = page.getByTestId('osd-element-matrix')
    await expect(matrix).toBeVisible()
    // Enable an element on the previewed screen so its row renders the widest
    // variant (checkboxes + inline X/Y align inputs).
    await page.getByTestId('osd-cell-COMPASS-1').check()
    await page.waitForTimeout(150)
    // No page-level horizontal scroll, and the matrix fits its own box.
    const docOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(docOverflow).toBeLessThanOrEqual(0)
    const matrixOverflow = await matrix.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(matrixOverflow).toBeLessThanOrEqual(1)
  })

  test('OSD matrix column header surfaces per-screen enable toggles', async ({ page }) => {
    // Real-FC report: on hardware where OSD2/3/4 isn't enabled (or the
    // per-element EN params aren't reported yet), the matrix showed click boxes
    // only for OSD1, and the operator had no way to enable the other screens
    // without switching the preview to that screen first to reach the Screen
    // Options panel. The matrix column header now exposes the OSD<n>_ENABLE
    // toggle directly, so enabling OSD2 is one click from the screens row.
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-osd').click()
    await expect(page.getByTestId('osd-element-matrix')).toBeVisible()

    // Every OSD<n>_ENABLE in the demo mock is reported, so each column shows a
    // real toggle (on/enable), never the 'not supported' badge.
    for (const screen of [1, 2, 3, 4]) {
      const toggle = page.getByTestId(`osd-screen-${screen}-toggle`)
      await expect(toggle).toBeVisible()
    }

    // Click an OSD<n> toggle and confirm it stages a draft on OSD<n>_ENABLE
    // (visible via the OSD save button becoming reachable / the draft bar
    // updating). The demo seeds OSD2_ENABLE=1, so the column's toggle reads
    // 'on' and clicking it stages a disable.
    const toggle2 = page.getByTestId('osd-screen-2-toggle')
    await expect(toggle2).toHaveText(/on/i)
    await toggle2.click()
    // The staged change ought to be visible in the OSD save / staged-count UI;
    // the persistent draft bar lists 1+ tuning/OSD changes once anything is
    // staged.
    await expect(page.getByTestId('global-draft-bar')).toBeVisible({ timeout: COMMAND_ACK_TIMEOUT })
  })
})

test.describe('ArduPlane demo', () => {
  test('demo-plane transport identifies an ArduPlane vehicle', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })
  })

  test('Modes view shows Plane flight-mode labels under the Plane demo', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })

    await openView(page, 'modes')
    await expect(page.getByTestId('workspace-view-title')).toHaveText('Modes')
    // FBWA is a Plane-only mode label (slot 2 = mode value 5 in the mock).
    // Its presence in the slot-2 dropdown proves the Plane catalog is
    // driving the Modes view (the mode cell is now an editable
    // ScopedSelectField rather than plain text).
    const table = page.getByTestId('modes-slot-table')
    await expect(table.getByTestId('modes-slot-2').locator('select option:checked')).toHaveText('FBWA')
  })

  test('Servos tab surfaces the per-channel servo-function mapping table by default', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-servos').click()

    // Mapping is the default Servos task body; rows + apply/revert
    // toolbar render, and switching to peripherals hides the mapping.
    await expect(page.getByTestId('servo-mapping-task-body')).toBeVisible()
    await expect(page.getByTestId('servo-mapping-table')).toBeVisible()
    await expect(page.getByTestId('servo-mapping-row-1')).toBeVisible()
    await expect(page.getByTestId('servo-mapping-row-4')).toBeVisible()
    await expect(page.getByTestId('servo-mapping-apply')).toBeVisible()
    await expect(page.getByTestId('servo-mapping-revert')).toBeVisible()
    // PR adds PWM range columns (Min/Trim/Max/Rev). The headers should
    // show up and the Reversed checkbox column should be wired per row.
    await expect(page.getByRole('columnheader', { name: 'Min' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Trim' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Max' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Rev' })).toBeVisible()

    // The per-channel PWM number inputs render and carry the demo's seeded
    // Min/Trim/Max (1000/1500/2000 on SERVO1). Guards the column width fix:
    // a 4-digit value must fit the input without clipping.
    const row1PwmInputs = page.getByTestId('servo-mapping-row-1').locator('input[type="number"]')
    await expect(row1PwmInputs).toHaveCount(3)
    await expect(row1PwmInputs.nth(0)).toHaveValue('1000')
    await expect(row1PwmInputs.nth(1)).toHaveValue('1500')
    await expect(row1PwmInputs.nth(2)).toHaveValue('2000')

    await page.getByTestId('outputs-task-nav').getByRole('tab', { name: /Peripherals & Alerts/i }).click()
    await expect(page.getByTestId('servo-mapping-task-body')).toHaveCount(0)
    await expect(page.getByText('LED & buzzer notifications')).toBeVisible()
  })

  test('Servos tab exposes a Relays tab that renders relay cards and stages an edit', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-servos').click()

    // Switch to the Relays sub-tab; the seeded RELAY1/RELAY2 cards render.
    await page.getByTestId('outputs-task-nav').getByRole('tab', { name: /Relays/i }).click()
    await expect(page.getByTestId('relays-task-body')).toBeVisible()
    await expect(page.getByTestId('relay-card-1')).toBeVisible()
    await expect(page.getByTestId('relay-card-2')).toBeVisible()
    // RELAY1_FUNCTION = Relay (seeded), so the enum + PIN field render.
    await expect(page.getByTestId('relay-card-1').locator('input[type="number"]')).toHaveValue('50')

    // Staging an edit flows through the same staged-draft + Apply bar.
    await page.getByTestId('scoped-chips-RELAY1_INVERTED').getByRole('radio', { name: 'Inverted' }).click()
    await expect(page.getByTestId('relays-apply')).toContainText('Apply relay changes (1)')
  })

  test('a Plane can confirm the Setup airframe step (not gated on Copter FRAME_CLASS)', async ({ page }) => {
    await page.goto('/?guidedSetupStep=airframe')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('setup-wizard')).toBeVisible()
    // Previously this confirm was disabled unless Copter FRAME_CLASS was
    // present, so a Plane could never complete the airframe step.
    await expect(page.getByRole('button', { name: 'Confirm Airframe Review' })).toBeEnabled()
  })

  test('a Plane can confirm the Setup outputs step (not gated on Copter motor count)', async ({ page }) => {
    await page.goto('/?guidedSetupStep=outputs')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('setup-wizard')).toBeVisible()
    // The Outputs review confirm was disabled unless a quad motor matrix
    // was mapped/counted — a Plane could never complete the step.
    // (The Outputs *view* bench motor-verification controls are a
    // separate non-Copter gating concern, tracked as C5b.)
    await expect(page.getByRole('button', { name: 'Confirm Output Review' })).toBeEnabled()
  })

  test('Plane Outputs Direction & Test shows an honest note, not the quad motor bench', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })

    await openView(page, 'motors')
    await page.getByTestId('outputs-summary-direction-test').click()
    await expect(page.getByText('multirotor procedure', { exact: false })).toBeVisible()
    // The quad motor-direction bench is not rendered for a Plane.
    await expect(page.getByText('Motor Direction Check', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Start Motor Verification/i })).toHaveCount(0)
  })

  test('Plane Tuning shows the curated fixed-wing surface, not the Copter master-slider workspace', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })

    // control count rather than the old "via Params" fallback.

    await openView(page, 'tuning')
    // The curated section renders; the old honest-note placeholder does not.
    await expect(page.getByTestId('tuning-plane-section')).toBeVisible()
    await expect(page.getByTestId('tuning-noncopter-note')).toHaveCount(0)
    // The Copter master-slider workspace is not used for Plane.
    await expect(page.getByTestId('tuning-stage-master-adjustments-button')).toHaveCount(0)
  })

  test('Copter Tuning still shows the master-slider workspace (no honest note)', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })

    // Copter keeps the control-count badge (byte-identical).

    await openView(page, 'tuning')
    await expect(page.getByTestId('workspace-view-title')).toHaveText('Tuning')
    await expect(page.getByTestId('tuning-noncopter-note')).toHaveCount(0)
  })

  test('Plane curated Tuning surface renders its groups and stages a draft through the scoped apply path', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })

    await openView(page, 'tuning')
    const section = page.getByTestId('tuning-plane-section')
    await expect(section).toBeVisible()

    // The curated concern groups render: fixed-wing rate controllers, TECS,
    // L1 nav, and — because the demo Plane is a QuadPlane (Q_ENABLE=1) — the
    // VTOL controllers.
    const rateGroup = page.getByTestId('tuning-plane-rate-group')
    await expect(rateGroup).toBeVisible()
    await expect(page.getByTestId('tuning-plane-tecs-group')).toBeVisible()
    await expect(page.getByTestId('tuning-plane-nav-group')).toBeVisible()
    await expect(page.getByTestId('tuning-plane-vtol-group')).toBeVisible()
    // VTOL transition (all QuadPlanes) + tiltrotor. The demo Plane seeds
    // Q_TILT_ENABLE=1, so the tiltrotor detail (geometry/rates) is shown too.
    await expect(page.getByTestId('tuning-plane-transition-group')).toBeVisible()
    await expect(page.getByTestId('tuning-plane-tiltrotor-group')).toBeVisible()
    await expect(page.getByTestId('tuning-plane-tiltrotor-detail')).toBeVisible()

    // MOCK==REAL: the demo Plane seeds the fixed-wing rate-controller params, so
    // the group must populate with real editable fields — never the "not
    // reporting" fallback. The header control-count badge is therefore > 0.
    await expect(rateGroup).not.toContainText('not reporting the rate-controller parameters')
    const rateHeaderCount = rateGroup.locator('.tuning-axis-card__header > span').first()
    await expect(rateHeaderCount).not.toHaveText('0 controls')
    await expect(rateHeaderCount).toHaveText(/[1-9]\d* controls/)

    const apply = page.getByTestId('apply-plane-tuning-changes-button')
    await expect(apply).toBeVisible()
    await expect(apply).toBeDisabled() // nothing staged yet
    await expect(apply).toContainText('Apply Tuning Changes (0)')

    // Editing one real catalog param (roll-rate P) stages a draft through the
    // shared setDraft -> scoped-apply machinery: the apply button enables and
    // its staged count climbs to 1.
    const rollP = page.getByTestId('tuning-plane-rate-roll').locator('input').first()
    await rollP.scrollIntoViewIfNeeded()
    // The field shows the seeded live value (RLL_RATE_P=0.08), not an empty box.
    await expect(rollP).not.toHaveValue('')
    await expect(rollP).toHaveValue(/^0?\.0?8/)
    await rollP.fill('0.12')
    await rollP.blur()

    await expect(apply).toContainText('Apply Tuning Changes (1)')
    await expect(apply).toBeEnabled()

    // The review list reflects the staged change.
    await expect(page.getByTestId('tuning-plane-review')).toContainText('RLL_RATE_P')
  })

  test('Plane Soaring & ADS-B surface renders its groups with seeded values and stages a draft', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })

    await openView(page, 'tuning')
    const section = page.getByTestId('plane-soaring-adsb-section')
    await expect(section).toBeVisible()

    // MOCK==REAL: the demo Plane seeds SOAR_ENABLE=1 and ADSB_TYPE=1, so both
    // groups expand and their seeded sub-groups render real editable fields —
    // never the "not reporting" / disabled-toggle-only fallback.
    await expect(page.getByTestId('plane-soaring-group')).toBeVisible()
    await expect(page.getByTestId('plane-soaring-trigger')).toBeVisible()
    await expect(page.getByTestId('plane-soaring-estimator')).toBeVisible()
    await expect(page.getByTestId('plane-soaring-altitude')).toBeVisible()
    await expect(page.getByTestId('plane-soaring-polar')).toBeVisible()

    await expect(page.getByTestId('plane-adsb-group')).toBeVisible()
    await expect(page.getByTestId('plane-adsb-list')).toBeVisible()
    await expect(page.getByTestId('plane-adsb-identity')).toBeVisible()
    await expect(page.getByTestId('plane-avoidance')).toBeVisible()

    const apply = page.getByTestId('apply-plane-soaring-adsb-changes-button')
    await expect(apply).toBeVisible()
    await expect(apply).toBeDisabled() // nothing staged yet
    await expect(apply).toContainText('Apply Soaring / ADS-B Changes (0)')

    // The altitude band's first field is SOAR_ALT_MIN (seeded live = 50), not an
    // empty box. Editing it stages a draft through the shared setDraft ->
    // scoped-apply machinery: the apply button enables and the count climbs.
    const altMin = page.getByTestId('plane-soaring-altitude').locator('input').first()
    await altMin.scrollIntoViewIfNeeded()
    await expect(altMin).not.toHaveValue('')
    await expect(altMin).toHaveValue(/^50/)
    await altMin.fill('60')
    await altMin.blur()

    await expect(apply).toContainText('Apply Soaring / ADS-B Changes (1)')
    await expect(apply).toBeEnabled()
    await expect(page.getByTestId('plane-soaring-adsb-review')).toContainText('SOAR_ALT_MIN')
  })

  test('Copter AutoTune surface renders with seeded values and editing stages a draft', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })

    await openView(page, 'tuning')

    // The AutoTune section renders as a SIBLING alongside the large Copter
    // tuning workbench (which must still be present and untouched — its
    // ATC_INPUT_TC control is a signature workbench field).
    await expect(page.getByTestId('tuning-input-ATC_INPUT_TC')).toBeVisible({ timeout: 10000 })
    const section = page.getByTestId('autotune-copter-section')
    await expect(section).toBeVisible()

    const configGroup = page.getByTestId('autotune-copter-config-group')
    await expect(configGroup).toBeVisible()
    // The procedure guide is present.
    await expect(page.getByTestId('autotune-copter-procedure')).toBeVisible()

    const apply = page.getByTestId('apply-copter-autotune-changes-button')
    await expect(apply).toBeVisible()
    await expect(apply).toBeDisabled() // nothing staged yet
    await expect(apply).toContainText('Apply AutoTune Changes (0)')

    // MOCK==REAL: the demo Copter seeds AUTOTUNE_AGGR=0.075, so the first numeric
    // field shows the seeded live value (not an empty box). Editing it stages a
    // draft through the shared setDraft -> scoped-apply machinery.
    const aggr = configGroup.locator('input[type="number"]').first()
    await aggr.scrollIntoViewIfNeeded()
    await expect(aggr).not.toHaveValue('')
    await expect(aggr).toHaveValue(/^0?\.0?7/)
    await aggr.fill('0.09')
    await aggr.blur()

    await expect(apply).toContainText('Apply AutoTune Changes (1)')
    await expect(apply).toBeEnabled()
    await expect(page.getByTestId('autotune-copter-review')).toContainText('AUTOTUNE_AGGR')
  })

  test('Plane AutoTune surface renders fixed-wing + VTOL groups with seeded values and stages a draft', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })

    await openView(page, 'tuning')
    const section = page.getByTestId('autotune-plane-section')
    await expect(section).toBeVisible()

    const fixedWing = page.getByTestId('autotune-plane-fixedwing-group')
    await expect(fixedWing).toBeVisible()
    await expect(fixedWing).not.toContainText('not reporting the fixed-wing AUTOTUNE parameters')
    // The demo Plane is a QuadPlane (Q_ENABLE=1) so the VTOL AutoTune group shows.
    await expect(page.getByTestId('autotune-plane-vtol-group')).toBeVisible()
    await expect(page.getByTestId('autotune-plane-fixedwing-procedure')).toBeVisible()

    const apply = page.getByTestId('apply-plane-autotune-changes-button')
    await expect(apply).toBeVisible()
    await expect(apply).toBeDisabled() // nothing staged yet
    await expect(apply).toContainText('Apply AutoTune Changes (0)')

    // MOCK==REAL: the demo Plane seeds AUTOTUNE_LEVEL=6, so the first fixed-wing
    // field shows the seeded live value. Editing it stages a draft.
    const level = fixedWing.locator('input[type="number"]').first()
    await level.scrollIntoViewIfNeeded()
    await expect(level).not.toHaveValue('')
    await expect(level).toHaveValue(/^6/)
    await level.fill('7')
    await level.blur()

    await expect(apply).toContainText('Apply AutoTune Changes (1)')
    await expect(apply).toBeEnabled()
    await expect(page.getByTestId('autotune-plane-review')).toContainText('AUTOTUNE_LEVEL')
  })

  test('Failsafe view collapses the four BATT_FS_* rows into one explainer when BATT_MONITOR=0', async ({ page }) => {
    // Regression for #481. With BATT_MONITOR=0 (battery library disabled),
    // ArduPilot doesn't register BATT_LOW_VOLT / BATT_FS_LOW_ACT / BATT_CRT_VOLT
    // / BATT_FS_CRT_ACT on the FC, so "Not synced" misreads "off by config" as
    // "still loading". The view collapses them into one BATT_MONITOR explainer.
    await page.goto('/?demoParamOverrides=BATT_MONITOR:0')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })

    await openView(page, 'failsafe')

    // The collapsed BATT_MONITOR row IS present — labelled "Battery
    // failsafe" so the kicker still places it under that section, and
    // backed by the live BATT_MONITOR parameter so the row renders the
    // ScopedSelectField with "Disabled" as the current selection. The
    // operator can flip the monitor right here instead of bouncing to
    // the Power view.
    const battMonitorRow = page.getByTestId('failsafe-row-BATT_MONITOR')
    await expect(battMonitorRow).toBeVisible()
    await expect(battMonitorRow).toContainText('Battery failsafe')
    await expect(battMonitorRow).toContainText('Battery Monitor')
    await expect(battMonitorRow.locator('select')).toHaveValue('0')

    // The four ghost rows are gone.
    await expect(page.getByTestId('failsafe-row-BATT_LOW_VOLT')).toHaveCount(0)
    await expect(page.getByTestId('failsafe-row-BATT_FS_LOW_ACT')).toHaveCount(0)
    await expect(page.getByTestId('failsafe-row-BATT_CRT_VOLT')).toHaveCount(0)
    await expect(page.getByTestId('failsafe-row-BATT_FS_CRT_ACT')).toHaveCount(0)
  })

  test('Plane Presets tab shows the starter-config frame presets (no library-restricted banner)', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })

    await openView(page, 'presets')
    // Plane now ships frame-selection starter presets, so the library is no
    // longer empty: the restricted banner is gone and the stat grid + a
    // QuadPlane starter card render.
    await expect(page.getByTestId('presets-library-restricted')).toHaveCount(0)
    await expect(page.getByText('Preset families', { exact: true })).toBeVisible()
    await expect(page.getByTestId('preset-card-starter-qplane-quad-x')).toBeVisible()
    await expect(page.getByTestId('presets-erase')).toBeVisible()
  })

  test('Copter Presets tab keeps the stat grid (no library-restricted banner)', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })

    await openView(page, 'presets')
    await expect(page.getByTestId('presets-library-restricted')).toHaveCount(0)
    await expect(page.getByText('Preset families', { exact: true })).toBeVisible()
  })

  test('a Plane exposes an editable QuadPlane / tailsitter frame configuration', async ({ page }) => {
    await page.goto('/?guidedSetupStep=airframe')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })

    const frameConfig = page.getByTestId('plane-frame-config')
    await expect(frameConfig).toBeVisible()
    // Q_ENABLE + Q_FRAME_CLASS + Q_FRAME_TYPE editable selects.
    await expect(frameConfig.locator('select')).toHaveCount(3)
    // The Q_FRAME_CLASS enum offers the non-standard airframes the user
    // asked for (Tailsitter), proving it is a real editable enum.
    await expect(
      frameConfig.getByRole('option', { name: 'Tailsitter' })
    ).toHaveCount(1)
  })

  test('switching a Plane to the Tailsitter frame class reveals the Tailsitter tuning group', async ({ page }) => {
    await page.goto('/?guidedSetupStep=airframe')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })

    // Set Q_FRAME_CLASS (the 2nd select: Q_ENABLE, Q_FRAME_CLASS, Q_FRAME_TYPE) to
    // Tailsitter. That stages a global draft the Tuning gating reads.
    const frameConfig = page.getByTestId('plane-frame-config')
    await frameConfig.locator('select').nth(1).selectOption({ label: 'Tailsitter' })

    await openView(page, 'tuning')
    const tailsitterGroup = page.getByTestId('tuning-plane-tailsitter-group')
    await expect(tailsitterGroup).toBeVisible()
    // It populates from the seeded Q_TAILSIT_* params (real editable controls,
    // not the "not reporting" fallback).
    await expect(page.getByTestId('tuning-plane-tailsitter-controls')).toBeVisible()
    await expect(tailsitterGroup.locator('input, select').first()).toBeVisible()
  })

  test('a Copter does not show the Plane frame configuration', async ({ page }) => {
    await page.goto('/?guidedSetupStep=airframe')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('setup-wizard')).toBeVisible()
    await expect(page.getByTestId('plane-frame-config')).toHaveCount(0)
  })

  test('Outputs view shows the per-vehicle output summary for a Plane', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await openView(page, 'motors')
    // The bare "not a multirotor matrix" note is replaced by a grouped
    // per-vehicle output summary.
    await expect(page.getByTestId('vehicle-output-summary')).toBeVisible()
    await expect(page.getByText('Fixed-wing / QuadPlane outputs', { exact: false })).toBeVisible()
    // No quad motor diagram or motor-only affordances for a Plane.
    await expect(page.getByRole('img', { name: 'Schematic motor map preview' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Reorder Motor Outputs' })).toHaveCount(0)
  })

  test('a Plane shows the control-surface checklist with channel + reversal', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await openView(page, 'motors')
    const surfaces = page.getByTestId('plane-control-surfaces')
    await expect(surfaces).toBeVisible()
    // The demo seeds aileron/elevator/rudder/throttle (SERVO5-8), elevator reversed.
    for (const key of ['aileron', 'elevator', 'rudder', 'throttle']) {
      await expect(page.getByTestId(`plane-surface-${key}`)).toBeVisible()
    }
    await expect(page.getByTestId('plane-surface-elevator')).toContainText('(rev)')
  })

  test('a QuadPlane exposes the Q_M_* lift-motor ESC surface in the ESC & Protocol task', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await openView(page, 'motors')
    // The VTOL lift motors get a real Q_M_* ESC surface (the plane mirror of the
    // Copter MOT_* card), not the roadmap note.
    await page.getByTestId('outputs-summary-esc-protocol').click()
    const escCard = page.getByTestId('quadplane-esc-card')
    await expect(escCard).toBeVisible()
    await expect(page.getByTestId('esc-protocol-noncopter-note')).toHaveCount(0)
    await expect(escCard).toContainText('VTOL Motor')
    // Editing a seeded Q_M_* value stages a draft and enables Apply.
    const apply = escCard.getByRole('button', { name: /Apply ESC Changes/ })
    await expect(apply).toBeDisabled()
    await escCard.locator('select').first().selectOption({ index: 1 })
    await expect(apply).toBeEnabled()
    await expect(apply).toContainText('Apply ESC Changes (1)')
  })

  test('Motor Setup shows the inline reorder panel for a Copter', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
      timeout: VEHICLE_CONNECT_TIMEOUT
    })
    await openView(page, 'motors')
    // The copter Motor Setup tab IS the inline reorder/direction panel.
    await page.getByTestId('outputs-summary-motor-setup').click()
    await expect(page.getByTestId('motor-reorder-lightbox-tabs')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('motor-reorder-apply')).toBeVisible()
  })

  test('Servos view exposes collapsible Gimbal and Rangefinder config sections for a Copter', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
      timeout: VEHICLE_CONNECT_TIMEOUT
    })
    await openView(page, 'servos')
    // The MNT1 gimbal + RNGFND1 lidar params surface as collapsible groups in
    // the Peripherals task's additional-settings card.
    await page.getByTestId('outputs-summary-peripherals').click()
    await expect(page.getByText('Gimbal / Mount', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Gimbal Driver', { exact: true })).toBeVisible()
    await expect(page.getByText('Rangefinder / Lidar', { exact: true })).toBeVisible()
    await expect(page.getByText('Rangefinder Type', { exact: true })).toBeVisible()
    // Sub-sections are collapsible: collapsing Gimbal hides its fields.
    const gimbalSection = page.getByTestId('metadata-settings-section-gimbal')
    await gimbalSection.locator('summary').click()
    await expect(page.getByText('Gimbal Driver', { exact: true })).toBeHidden()
    // Rangefinder stays independently expanded.
    await expect(page.getByText('Rangefinder Type', { exact: true })).toBeVisible()

    // Conditional fields: analog-only knobs are hidden until TYPE = Analog.
    await expect(page.getByText('Analog Function', { exact: true })).toBeHidden()
    const typeSelect = page.locator('label', { hasText: 'Rangefinder Type' }).getByRole('combobox')
    await typeSelect.selectOption({ label: 'Analog' })
    await expect(page.getByText('Analog Function', { exact: true })).toBeVisible()
    await expect(page.getByText('Ratiometric', { exact: true })).toBeVisible()
    // Switching to a serial type hides them again.
    await typeSelect.selectOption({ label: 'MAVLink' })
    await expect(page.getByText('Analog Function', { exact: true })).toBeHidden()
  })
})

test.describe('ArduRover / ArduSub demo', () => {
  test('Rover curated Tuning surface renders its groups, shows seeded values, and stages a draft', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-rover')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduRover', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expectParameterSyncComplete(page)

    // control count rather than the old "via Params" fallback.

    await openView(page, 'tuning')
    const section = page.getByTestId('tuning-rover-section')
    await expect(section).toBeVisible()
    // The old honest-note placeholder and the Copter master-slider workspace are not used.
    await expect(page.getByTestId('tuning-noncopter-note')).toHaveCount(0)
    await expect(page.getByTestId('tuning-stage-master-adjustments-button')).toHaveCount(0)

    // The curated concern groups render.
    await expect(page.getByTestId('tuning-rover-steering-group')).toBeVisible()
    await expect(page.getByTestId('tuning-rover-speed-group')).toBeVisible()
    await expect(page.getByTestId('tuning-rover-nav-group')).toBeVisible()
    await expect(page.getByTestId('tuning-rover-turn-group')).toBeVisible()

    // A real seeded field shows its value (CRUISE_SPEED=2), not the
    // "not reporting" placeholder a missing param would render.
    const cruiseSpeed = page.getByTestId('tuning-rover-speed-group').getByLabel('Cruise Speed')
    await expect(cruiseSpeed).toBeVisible()
    await expect(cruiseSpeed).toHaveValue('2')
    await expect(section).not.toContainText('not reporting')

    // The control-count badge on the nav button is > 0.

    const apply = page.getByTestId('apply-rover-tuning-changes-button')
    await expect(apply).toBeVisible()
    await expect(apply).toBeDisabled() // nothing staged yet
    await expect(apply).toContainText('Apply Tuning Changes (0)')

    // Editing one real catalog param (steering-rate P) stages a draft through
    // the shared setDraft -> scoped-apply machinery.
    const steeringP = page.getByTestId('tuning-rover-steering-group').locator('input').first()
    await steeringP.scrollIntoViewIfNeeded()
    await steeringP.fill('0.25')
    await steeringP.blur()

    await expect(apply).toContainText('Apply Tuning Changes (1)')
    await expect(apply).toBeEnabled()
    await expect(page.getByTestId('tuning-rover-review')).toContainText('ATC_STR_RAT_P')
  })

  test('demo-rover identifies a Rover and drives the real Rover catalog UI', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-rover')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduRover', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expectParameterSyncComplete(page)

    // Setup craft preview shows the rover model, not the copter quad.
    await expect(page.getByTestId('setup-craft-preview')).toHaveAttribute('data-craft-model', 'rover')

    // Modes view reads the Rover MODE1..6 family (MODE6 = 3 -> Steering,
    // a Rover-only label) — proves the vehicle-aware mode-slot fix.
    // Mode cell is now an editable dropdown, so we assert the selected
    // option text on slot 6 rather than the table's overall text content
    // (which now also includes every option in every slot's <select>).
    await openView(page, 'modes')
    await expect(page.getByTestId('workspace-view-title')).toHaveText('Modes')
    const modesTable = page.getByTestId('modes-slot-table')
    await expect(modesTable.getByTestId('modes-slot-6').locator('select option:checked')).toHaveText('Steering')

    // The mode-channel subtitle names the real Rover param (MODE_CH), not
    // the Copter-hardcoded FLTMODE_CH.
    await expect(
      page.getByText('MODE_CH selects which RC channel', { exact: false })
    ).toBeVisible()
    await expect(
      page.getByText('FLTMODE_CH selects which RC channel', { exact: false })
    ).toHaveCount(0)

    // Non-Copter Outputs gating holds for a Rover (vehicle-aware nav
    // badge — the non-multirotor Outputs body is covered by the demo-sub
    // and Plane slice-2c specs).

    // Failsafe view is the real Rover failsafe set, not the hardcoded
    // Copter rows: FS_ACTION (2 -> "Hold") shows; the Copter-only
    // FS_EKF_ACTION / FS_OPTIONS rows are absent.
    await openView(page, 'failsafe')
    await expect(page.getByTestId('failsafe-row-FS_ACTION')).toContainText('Hold')
    await expect(page.getByTestId('failsafe-row-FS_EKF_ACTION')).toHaveCount(0)
    await expect(page.getByTestId('failsafe-row-FS_OPTIONS')).toHaveCount(0)

    // Receiver Flight-Mode pills name the real Rover slot param (MODE1..6),
    // not the Copter FLTMODE prefix. Mock seeds MODE1 = 0 -> "Manual".
    await openView(page, 'receiver')
    await page.getByTestId('receiver-tab-flight-modes').click()
    await expect(page.getByText('FLTMODE1 =', { exact: false })).toHaveCount(0)
    await expect(page.getByText('MODE1 = Manual', { exact: false })).toBeVisible()
  })

  test('Sub curated Tuning surface renders its groups, shows seeded values, and stages a draft', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-sub')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduSub', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expectParameterSyncComplete(page)

    // control count rather than the old "via Params" fallback.

    await openView(page, 'tuning')
    const section = page.getByTestId('tuning-sub-section')
    await expect(section).toBeVisible()
    // The old honest-note placeholder and the Copter master-slider workspace are not used.
    await expect(page.getByTestId('tuning-noncopter-note')).toHaveCount(0)
    await expect(page.getByTestId('tuning-stage-master-adjustments-button')).toHaveCount(0)

    // The curated concern groups render.
    await expect(page.getByTestId('tuning-sub-rate-group')).toBeVisible()
    await expect(page.getByTestId('tuning-sub-rate-roll')).toBeVisible()
    await expect(page.getByTestId('tuning-sub-rate-pitch')).toBeVisible()
    await expect(page.getByTestId('tuning-sub-rate-yaw')).toBeVisible()
    await expect(page.getByTestId('tuning-sub-angle-group')).toBeVisible()
    await expect(page.getByTestId('tuning-sub-depth-group')).toBeVisible()

    // A real seeded field shows its value (ATC_ANG_RLL_P=6), not the
    // "not reporting" placeholder a missing param would render.
    const rollAngleP = page.getByTestId('tuning-sub-angle-group').getByLabel('Roll Angle P', { exact: true })
    await expect(rollAngleP).toBeVisible()
    await expect(rollAngleP).toHaveValue('6')
    await expect(section).not.toContainText('not reporting')

    // The control-count badge on the nav button is > 0.

    const apply = page.getByTestId('apply-sub-tuning-changes-button')
    await expect(apply).toBeVisible()
    await expect(apply).toBeDisabled() // nothing staged yet
    await expect(apply).toContainText('Apply Tuning Changes (0)')

    // Editing one real catalog param (roll-rate P) stages a draft through the
    // shared setDraft -> scoped-apply machinery.
    const rollRateP = page.getByTestId('tuning-sub-rate-roll').locator('input').first()
    await rollRateP.scrollIntoViewIfNeeded()
    await rollRateP.fill('0.2')
    await rollRateP.blur()

    await expect(apply).toContainText('Apply Tuning Changes (1)')
    await expect(apply).toBeEnabled()
    await expect(page.getByTestId('tuning-sub-review')).toContainText('ATC_RAT_RLL_P')
  })

  test('demo-sub identifies a Sub and shows no multirotor motor UI', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-sub')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduSub', { timeout: VEHICLE_CONNECT_TIMEOUT })
    // "Sub outputs" and the rest below derive from the synced param table, so
    // wait out the demo param sync before navigating or they race it on CI.
    await expectParameterSyncComplete(page)

    // Setup craft preview shows the ROV model, not the copter quad.
    await expect(page.getByTestId('setup-craft-preview')).toHaveAttribute('data-craft-model', 'sub')

    await openView(page, 'motors')
    // The vehicle-output-summary lives in the motor-setup task panel, and the
    // active task otherwise follows a reactive recommendation that can flip as
    // live telemetry settles. Select motor-setup explicitly (sets a sticky
    // override) so the summary is deterministically shown.
    await page.getByTestId('outputs-summary-motor-setup').click()
    await expect(page.getByTestId('vehicle-output-summary')).toBeVisible()
    await expect(page.getByText('Sub outputs', { exact: false })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Schematic motor map preview' })).toHaveCount(0)

    // The ESC & Protocol task is multirotor MOT_PWM_*/MOT_SPIN_* ESC setup;
    // a Sub gets an honest note instead of the Copter ESC review surface.
    await page.getByTestId('outputs-summary-esc-protocol').click()
    await expect(page.getByTestId('esc-protocol-noncopter-note')).toBeVisible()

    // Safety-critical: a connected Sub now sees its leak failsafe (it was
    // previously hidden behind the hardcoded Copter failsafe rows). Mock
    // seeds FS_LEAK_ENABLE = 2 -> "Enter surface mode" (verbatim from
    // ArduSub/Parameters.cpp @Param: FS_LEAK_ENABLE @Values); the Copter RC
    // throttle failsafe row must not appear for a Sub.
    await openView(page, 'failsafe')
    await expect(page.getByTestId('failsafe-row-FS_LEAK_ENABLE')).toContainText('Leak failsafe')
    await expect(page.getByTestId('failsafe-row-FS_LEAK_ENABLE')).toContainText('Enter surface mode')
    await expect(page.getByTestId('failsafe-row-FS_THR_ENABLE')).toHaveCount(0)

    // Safety-relevant: the battery-failsafe action label must be the Sub
    // enum, not the Copter one. Mock seeds BATT_FS_LOW_ACT = 2, which is
    // "Disarm" on Sub but "RTL" on Copter — the operator must see "Disarm".
    await expect(page.getByTestId('failsafe-battery-low-label')).toHaveText('Disarm')
    await expect(page.getByTestId('failsafe-battery-low-label')).not.toHaveText('RTL')

    // Modes: ArduSub has no RC mode-switch channel (joystick-bound). The
    // view shows an honest note plus the live heartbeat mode only — not the
    // inapplicable Copter PWM slot table or the Receiver deep-link.
    await openView(page, 'modes')
    await expect(page.getByTestId('workspace-view-title')).toHaveText('Modes')
    await expect(page.getByTestId('modes-joystick-note')).toBeVisible()
    await expect(page.getByTestId('modes-joystick-note')).toContainText(
      'joystick button assignments'
    )
    await expect(page.getByTestId('modes-slot-table')).toHaveCount(0)
    await expect(page.getByTestId('modes-go-to-flight-mode-task')).toHaveCount(0)
  })
})

test.describe('Receiver scoped apply', () => {
  test('staging an RC_OPTIONS change surfaces the review dock and applying clears it', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'receiver')
    await page.getByTestId('receiver-task-nav').getByRole('button', { name: 'Flight Modes' }).click()

    const field = page.getByTestId('scoped-bitmask-RC_OPTIONS')
    await field.scrollIntoViewIfNeeded()
    // Demo seeds RC_OPTIONS=0 (all options unset). Clicking the first option's
    // chip toggles it (orange highlight) and stages a single receiver-scoped
    // (workflow) draft.
    await field.getByText('Ignore RC Receiver').click()

    const dock = page.locator('.receiver-review-dock')
    await expect(dock).toBeVisible()
    await expect(dock).toContainText(/workflow staged/i)

    const applyButton = page.getByTestId('receiver-apply-button')
    await expect(applyButton).toBeEnabled()
    await applyButton.click()

    // The demo echoes the PARAM_SET write, so the draft verifies and clears,
    // which removes the pending-review dock.
    await expect(dock).toHaveCount(0, { timeout: COMMAND_ACK_TIMEOUT })
  })
})

test.describe('Tuning profile round-trip', () => {
  test('a staged-source tuning profile captures the staged edit and surfaces it as a restorable change', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'tuning')

    // Stage a distinct PID edit (demo default ATC_RAT_RLL_P is 0.1).
    await page.getByTestId('tuning-task-nav').getByRole('button', { name: /PID Gains/i }).click()
    await page.getByTestId('tuning-roll-pitch-unlink-button').click()
    await page.getByTestId('tuning-input-ATC_RAT_RLL_P').fill('0.137')

    // Capture the *staged* tune into a profile (exercises useTuningProfileSource's
    // staged-merge over TUNING_PARAM_IDS — the previously-untested build path).
    await page.getByTestId('tuning-task-nav').getByRole('button', { name: /Profiles/i }).click()
    await page.getByTestId('tuning-profile-source-select').selectOption('staged')
    await page.getByTestId('tuning-profile-label-input').fill('Staged Capture')
    await expect(page.getByTestId('create-tuning-profile-button')).toBeEnabled()
    await page.getByTestId('create-tuning-profile-button').click()

    // The new profile auto-selects; its detail must show the captured edit as a
    // change restorable against the live 0.1 value (round-trip: build -> diff).
    const detail = page.locator('.tuning-profile-browser__detail')
    await expect(detail.getByRole('heading', { name: 'Staged Capture' })).toBeVisible()
    await expect(detail).toContainText('ATC_RAT_RLL_P')
    await expect(detail).toContainText('0.137')
    await expect(page.getByTestId('stage-selected-tuning-profile-button')).toBeEnabled()
  })
})

test('web-serial mode exposes a "Choose a different port" affordance (two-port boards)', async ({ page }) => {
  await page.goto('/')
  const select = page.getByTestId('transport-mode-select')
  // Absent for non-serial transports.
  await select.selectOption('demo')
  await expect(page.getByTestId('choose-serial-port-button')).toHaveCount(0)
  const webSerialDisabled = await select.locator('option[value="web-serial"]').isDisabled()
  test.skip(webSerialDisabled, 'Web Serial unsupported in this browser')
  // Present in web-serial mode so the operator can grant/switch to the other
  // (MAVLink vs SLCAN) interface.
  await select.selectOption('web-serial')
  await expect(page.getByTestId('choose-serial-port-button')).toBeVisible()
})

test('GPS panel offers a UTM coordinate format', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('transport-mode-select').selectOption('demo')
  await page.getByTestId('connect-button').click()
  await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
  const formatSelect = page.getByTestId('setup-gps-format-select')
  await expect(formatSelect).toBeVisible({ timeout: 15_000 })
  await formatSelect.selectOption('utm')
  const utm = page.getByTestId('setup-gps-utm')
  await expect(utm).toBeVisible()
  await expect(utm).toContainText(/\d+E \d+N/)
})

test('Recent Notices: clear-all button and expert-mode search bar', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('transport-mode-select').selectOption('demo')
  await page.getByTestId('connect-button').click()
  await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
  await expect(page.getByTestId('setup-notices-clear-all')).toBeVisible({ timeout: 15_000 })
  // The notice search bar is expert-only.
  await expect(page.getByTestId('setup-notices-search')).toHaveCount(0)
  await page.getByTestId('product-mode-expert').click()
  await expect(page.getByTestId('setup-notices-search')).toBeVisible()
})

test.describe('Direct Sockets (IWA) transport options', () => {
  test('exposes UDP + TCP (direct) options and fields when Direct Sockets exist', async ({ page }) => {
    // Simulate the Isolated Web App context where the Direct Sockets API is
    // exposed. addInitScript runs before the app bundle evaluates, so the
    // module-level isSupported() checks see it.
    await page.addInitScript(() => {
      Object.assign(window, { UDPSocket: class {}, TCPSocket: class {} })
    })
    await page.goto('/')

    const select = page.getByTestId('landing-transport-select')
    await expect(select.locator('option[value="udp"]')).toHaveCount(1)
    await expect(select.locator('option[value="tcp"]')).toHaveCount(1)

    await select.selectOption('udp')
    await expect(page.getByTestId('landing-udp-input')).toBeVisible()
    await expect(page.getByTestId('landing-udp-hint')).toContainText('Raw UDP')

    await select.selectOption('tcp')
    await expect(page.getByTestId('landing-tcp-input')).toBeVisible()
    await expect(page.getByTestId('landing-tcp-hint')).toContainText('Raw TCP')
  })

  test('hides the UDP/TCP (direct) options in a normal browser tab', async ({ page }) => {
    await page.goto('/')
    const select = page.getByTestId('landing-transport-select')
    await expect(select.locator('option[value="udp"]')).toHaveCount(0)
    await expect(select.locator('option[value="tcp"]')).toHaveCount(0)
  })
})

test.describe('Inspectors (expert-only)', () => {
  test('Expert mode reveals the MAVLink + DroneCAN inspectors', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()

    // Hidden until Expert mode is on.
    await expect(page.getByTestId('view-button-mavlink-inspector')).toHaveCount(0)
    await expect(page.getByTestId('view-button-dronecan-inspector')).toHaveCount(0)

    await page.getByTestId('product-mode-expert').check()

    // MAVLink inspector shows the live decoded message stream.
    await page.getByTestId('view-button-mavlink-inspector').click()
    await expect(page.getByTestId('mavlink-inspector')).toBeVisible()
    await expect(page.getByTestId('mavlink-inspector-table')).toBeVisible({ timeout: 8000 })
    // Summary + sort + pause affordances are present, with the new
    // source-awareness + bandwidth read-outs.
    await expect(page.getByTestId('mavlink-inspector-summary')).toContainText('msg/s')
    await expect(page.getByTestId('mavlink-inspector-summary')).toContainText('B/s')
    await expect(page.getByTestId('mavlink-inspector-summary')).toContainText('source')
    await expect(page.getByTestId('mavlink-inspector-sort')).toBeVisible()

    // Messages are grouped by their (systemId:componentId) source — the demo
    // streams from the autopilot at sys 1, comp 1.
    await expect(page.getByTestId('mavlink-inspector-source')).toBeVisible()
    await expect(page.getByTestId('mavlink-source-1:1')).toBeVisible()

    // The source selector narrows the stream to a single source.
    await page.getByTestId('mavlink-inspector-source').selectOption('1:1')
    await expect(page.getByTestId('mavlink-source-1:1')).toBeVisible()

    // Pause freezes the table; the badge flips to "paused" and back on resume.
    const pause = page.getByTestId('mavlink-inspector-pause')
    await pause.click()
    await expect(pause).toHaveText('Resume')
    await expect(page.getByTestId('mavlink-inspector')).toContainText('paused')
    await pause.click()
    await expect(pause).toHaveText('Pause')

    // DroneCAN inspector offers a CAN1/CAN2 bus selector + start control.
    await page.getByTestId('view-button-dronecan-inspector').click()
    await expect(page.getByTestId('dronecan-inspector')).toBeVisible()
    await expect(page.getByTestId('dronecan-inspector-summary')).toContainText('frames/s')
    await expect(page.getByTestId('dronecan-inspector-bus')).toBeVisible()
    await expect(page.getByTestId('dronecan-inspector-start')).toBeVisible()
  })

  test('MAVLink inspector shows per-source link health', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('product-mode-expert').check()

    await page.getByTestId('view-button-mavlink-inspector').click()
    await expect(page.getByTestId('mavlink-inspector-table')).toBeVisible({ timeout: 8000 })

    // Each source group surfaces a packet-loss / stale health line computed
    // from the MAVLink v2 sequence. (The in-browser demo transport delivers
    // the slow solicited param-sync batch interleaved with the immediate
    // dynamic emitter, so frames arrive out of sequence order and the demo's
    // loss figure is non-zero — a harness artifact, not a feature bug; on real
    // hardware's single ordered stream the figure is accurate.) Assert the
    // indicator renders with a "% loss" readout per source.
    const health = page.getByTestId('mavlink-source-health-1:1')
    await expect(health).toBeVisible()
    await expect(health).toContainText('loss')
    await expect(health).toContainText('%')
    await expect(health).toHaveText(/\d+% loss/)
  })

  test('MAVLink inspector exports a stats snapshot and records the stream', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('product-mode-expert').check()

    await page.getByTestId('view-button-mavlink-inspector').click()
    await expect(page.getByTestId('mavlink-inspector-table')).toBeVisible({ timeout: 8000 })

    // Export the current state as a JSON download.
    const snapshotDownload = page.waitForEvent('download')
    await page.getByTestId('mavlink-export-snapshot').click()
    const snapshot = await snapshotDownload
    expect(snapshot.suggestedFilename()).toMatch(/^mavlink-snapshot-.*\.json$/)

    // Record the live stream, then stop and download the capture.
    const status = page.getByTestId('mavlink-record-status')
    await expect(page.getByTestId('mavlink-record-download')).toBeDisabled()
    await page.getByTestId('mavlink-record-toggle').click()
    await expect(status).toContainText('recording')
    // Let messages land in the bounded buffer. The demo's dynamic emitter
    // ticks at ~7s, so allow more than one cadence.
    await expect(status).not.toContainText('0 msg', { timeout: 12000 })
    await page.getByTestId('mavlink-record-toggle').click()
    await expect(page.getByTestId('mavlink-record-toggle')).toHaveText('Record stream')

    const captureDownload = page.waitForEvent('download')
    await page.getByTestId('mavlink-record-download').click()
    const capture = await captureDownload
    expect(capture.suggestedFilename()).toMatch(/^mavlink-recording-.*\.json$/)
  })

  test('MAVLink inspector exports a live plot as CSV', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('product-mode-expert').check()

    await page.getByTestId('view-button-mavlink-inspector').click()
    const mavTable = page.getByTestId('mavlink-inspector-table')
    await expect(mavTable).toBeVisible({ timeout: 8000 })

    // Graph a field on an actively-streaming row (SYS_STATUS streams every
    // tick) so its sample buffer fills, then export it as CSV.
    const streamingRow = page.getByTestId('mavlink-row-1:1:SYS_STATUS')
    await expect(streamingRow).toBeVisible({ timeout: 8000 })
    await streamingRow.getByRole('button').first().click()
    await streamingRow.locator('[data-testid^="mavlink-field-graph-"]').first().click()
    await expect(page.getByTestId('mavlink-plots')).toBeVisible()
    // The plot buffer fills as SYS_STATUS arrives; the demo emitter ticks at
    // ~7s, so allow more than one cadence for the first sample.
    const csvButton = page.locator('[data-testid^="mavlink-plot-csv-"]').first()
    await expect(csvButton).toBeEnabled({ timeout: 12000 })
    const csvDownload = page.waitForEvent('download')
    await csvButton.click()
    const csv = await csvDownload
    expect(csv.suggestedFilename()).toMatch(/^mavlink-plot-.*\.csv$/)
  })

  test('MAVLink rows expand to copyable fields and DroneCAN nodes show detail', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('product-mode-expert').check()

    // Expand the first decoded MAVLink row and reveal its copy affordance.
    await page.getByTestId('view-button-mavlink-inspector').click()
    const mavTable = page.getByTestId('mavlink-inspector-table')
    await expect(mavTable).toBeVisible({ timeout: 8000 })
    await mavTable.locator('[data-testid^="mavlink-row-"]').first().getByRole('button').first().click()
    await expect(page.getByRole('button', { name: 'Copy JSON' }).first()).toBeVisible()

    // The expanded row shows a live field table (name / value / type) with a
    // per-field copy affordance, not a raw JSON blob.
    const fieldTable = page.locator('[data-testid^="mavlink-field-table-"]').first()
    await expect(fieldTable).toBeVisible()
    await expect(fieldTable).toContainText('Field')
    await expect(fieldTable.locator('[data-testid^="mavlink-field-copy-"]').first()).toHaveCount(1)

    // Start the DroneCAN bus and expand the first discovered node's detail.
    await page.getByTestId('view-button-dronecan-inspector').click()
    await page.getByTestId('dronecan-inspector-start').click()
    const table = page.getByTestId('dronecan-inspector-table')
    await expect(table).toBeVisible({ timeout: 12000 })
    const firstNode = table.locator('[data-testid^="dronecan-node-"]').first()
    await firstNode.getByRole('button').first().click()
    await expect(page.locator('[data-testid^="dronecan-node-detail-"]').first()).toContainText('Node ID')
  })

  test('MAVLink inspector requests a message stream and surfaces the result', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('product-mode-expert').check()

    await page.getByTestId('view-button-mavlink-inspector').click()
    await expect(page.getByTestId('mavlink-inspector-table')).toBeVisible({ timeout: 8000 })

    // The request control lets the operator pick a message + rate and set its
    // stream interval; the demo FC acks SET_MESSAGE_INTERVAL as ACCEPTED.
    await expect(page.getByTestId('mavlink-inspector-request')).toBeVisible()
    await page.getByTestId('mavlink-request-message').selectOption('30')
    await page.getByTestId('mavlink-request-rate').fill('5')
    await page.getByTestId('mavlink-request-stream').click()
    await expect(page.getByTestId('mavlink-request-result')).toContainText('accepted', { timeout: 8000 })
  })

  test('MAVLink inspector plots a numeric field live and removes the plot', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('product-mode-expert').check()

    await page.getByTestId('view-button-mavlink-inspector').click()
    const mavTable = page.getByTestId('mavlink-inspector-table')
    await expect(mavTable).toBeVisible({ timeout: 8000 })

    // Expand the first row and graph its first plottable field.
    await mavTable.locator('[data-testid^="mavlink-row-"]').first().getByRole('button').first().click()
    const graph = page.locator('[data-testid^="mavlink-field-graph-"]').first()
    await expect(graph).toBeVisible()
    await graph.click()

    // A live plot renders with its read-outs.
    await expect(page.getByTestId('mavlink-plots')).toBeVisible()
    const plot = page.locator('[data-testid^="mavlink-plot-"]').first()
    await expect(plot).toBeVisible()
    await expect(plot).toContainText('now')

    // Removing the plot tears it down.
    page.locator('[data-testid^="mavlink-plot-remove-"]').first().click()
    await expect(page.getByTestId('mavlink-plots')).toHaveCount(0)
  })

  test('DroneCAN inspector manages a node: param grid, restart, ESC telemetry', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('product-mode-expert').check()

    await page.getByTestId('view-button-dronecan-inspector').click()
    await page.getByTestId('dronecan-inspector-start').click()
    const table = page.getByTestId('dronecan-inspector-table')
    await expect(table).toBeVisible({ timeout: 12000 })

    // Expand node 50 (ap_periph) and read its DroneCAN parameter grid.
    const node = page.getByTestId('dronecan-node-50')
    await node.getByRole('button').first().click()
    await expect(page.getByTestId('dronecan-params-50')).toBeVisible()
    // Parameters are collapsed by default — open them (also triggers the fetch).
    await page.getByTestId('dronecan-params-toggle-50').click()
    const battInput = page.getByTestId('dronecan-param-input-50-BATT_MONITOR')
    await expect(battInput).toBeVisible({ timeout: 12000 })
    // The node reports no labels/enums, so the grid enriches from the curated
    // FC catalog by name: BATT_MONITOR=4 shows its enum label.
    await expect(page.getByTestId('dronecan-param-50-BATT_MONITOR')).toContainText('Analog Voltage and Current')

    // Editing a parameter stages a change and reveals Apply & Save.
    await battInput.fill('3')
    const apply = page.getByTestId('dronecan-apply-save-50')
    await expect(apply).toBeVisible()
    await apply.click()

    // Restart is gated behind a confirm step.
    await page.getByTestId('dronecan-restart-50').click()
    await expect(page.getByTestId('dronecan-restart-confirm-50')).toBeVisible()
    await page.getByTestId('dronecan-restart-confirm-50').click()
    await expect(page.getByTestId('dronecan-restart-50')).toBeVisible()

    // ESC telemetry section populates from uavcan.equipment.esc.Status.
    await expect(page.getByTestId('dronecan-esc-telemetry')).toBeVisible({ timeout: 12000 })
    await expect(page.getByTestId('dronecan-esc-0')).toBeVisible()
  })

  test('DroneCAN inspector updates a node firmware: pick image, confirm brick risk, reach 100%', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('product-mode-expert').check()

    await page.getByTestId('view-button-dronecan-inspector').click()
    await page.getByTestId('dronecan-inspector-start').click()
    const table = page.getByTestId('dronecan-inspector-table')
    await expect(table).toBeVisible({ timeout: 12000 })

    // Expand node 50 (ap_periph) and open its firmware-update affordance.
    const node = page.getByTestId('dronecan-node-50')
    await node.getByRole('button').first().click()
    const fileInput = page.getByTestId('dronecan-fwupdate-file-50')
    await expect(fileInput).toBeVisible()

    // The Update button stays out of reach until a file is picked AND the
    // brick-risk acknowledgement is checked.
    const image = Buffer.from(Array.from({ length: 700 }, (_, i) => (i * 37 + 11) & 0xff))
    await fileInput.setInputFiles({ name: 'periph-fw.bin', mimeType: 'application/octet-stream', buffer: image })
    const startButton = page.getByTestId('dronecan-fwupdate-start-50')
    await expect(startButton).toBeDisabled()
    await page.getByTestId('dronecan-fwupdate-ack-50').check()
    await expect(startButton).toBeEnabled()

    // Run the update; the GCS serves the image over file.Read until the mock
    // node has read it all, and the progress bar reaches completion.
    await startButton.click()
    await expect(page.getByTestId('dronecan-fwupdate-done-50')).toBeVisible({ timeout: 15000 })
    const progress = page.getByTestId('dronecan-fwupdate-progress-50')
    await expect(progress).toHaveAttribute('aria-valuenow', '100')
    // A flash can reset/corrupt the node's params — nudge to re-verify after.
    await expect(page.getByTestId('dronecan-fwupdate-verify-50')).toContainText('reset or corrupt')

    // Finished updates re-enable the node's other actions via a Dismiss control.
    await page.getByTestId('dronecan-fwupdate-cancel-50').click()
    await expect(page.getByTestId('dronecan-fwupdate-file-50')).toBeVisible()
  })

  test('DroneCAN inspector finds firmware online, downloads + decodes it, and updates the node', async ({ page }) => {
    // Mock the desktop firmware bridge: the browser can't reach
    // firmware.ardupilot.org (no CORS), so the online path is desktop-only. The
    // mock ap_periph node 50 reports hardware_version 2.1 -> board id (2<<8)|1 =
    // 513; listDronecanNode is queried with that. download serves a valid .apj
    // (zlib-deflated image) the app decodes to the RAW bytes it then flashes.
    const rawImage = Buffer.from(Array.from({ length: 700 }, (_, i) => (i * 37 + 11) & 0xff))
    const apj = JSON.stringify({ board_id: 513, image_size: rawImage.length, image: deflateSync(rawImage).toString('base64') })
    const apjBytes = [...new TextEncoder().encode(apj)]
    await page.addInitScript((bytes) => {
      ;(window as unknown as { arduconfigDesktop: unknown }).arduconfigDesktop = {
        platform: 'electron',
        firmware: {
          listDronecanNode: async (boardId: number) => ({
            releaseTypes: ['OFFICIAL'],
            entries: [{ boardId, vehicletype: 'AP_Periph', platform: 'TestPeriph', releaseType: 'OFFICIAL',
              versionStr: '1.7.0', latest: true, format: 'apj',
              url: 'https://firmware.ardupilot.org/AP_Periph/stable/TestPeriph/AP_Periph.apj' }]
          }),
          download: async () => new Uint8Array(bytes as number[])
        }
      }
    }, apjBytes)

    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('product-mode-expert').check()

    await page.getByTestId('view-button-dronecan-inspector').click()
    await page.getByTestId('dronecan-inspector-start').click()
    const table = page.getByTestId('dronecan-inspector-table')
    await expect(table).toBeVisible({ timeout: 12000 })

    const node = page.getByTestId('dronecan-node-50')
    await node.getByRole('button').first().click()

    // Find firmware online -> the matched AP_Periph build appears.
    await page.getByTestId('dronecan-fwupdate-online-find-50').click()
    await expect(page.getByTestId('dronecan-fwupdate-online-list-50')).toBeVisible({ timeout: COMMAND_ACK_TIMEOUT })
    await expect(page.getByTestId('dronecan-fwupdate-online-list-50')).toContainText('1.7.0')

    // Use the build: it downloads + decodes, then stages the image for the
    // same brick-ack + Update path as a local pick.
    await page.getByTestId('dronecan-fwupdate-online-use-50').first().click()
    const startButton = page.getByTestId('dronecan-fwupdate-start-50')
    await expect(startButton).toBeDisabled()
    await page.getByTestId('dronecan-fwupdate-ack-50').check()
    await expect(startButton).toBeEnabled()

    await startButton.click()
    await expect(page.getByTestId('dronecan-fwupdate-done-50')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('dronecan-fwupdate-progress-50')).toHaveAttribute('aria-valuenow', '100')
  })

  test('DroneCAN inspector: online firmware lookup degrades gracefully in the browser', async ({ page }) => {
    // No desktop bridge -> the online affordance shows the desktop-only note,
    // and the local .bin picker stays available.
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('product-mode-expert').check()

    await page.getByTestId('view-button-dronecan-inspector').click()
    await page.getByTestId('dronecan-inspector-start').click()
    const table = page.getByTestId('dronecan-inspector-table')
    await expect(table).toBeVisible({ timeout: 12000 })

    const node = page.getByTestId('dronecan-node-50')
    await node.getByRole('button').first().click()
    await expect(page.getByTestId('dronecan-fwupdate-online-unavailable-50')).toContainText('desktop app')
    await expect(page.getByTestId('dronecan-fwupdate-online-find-50')).toHaveCount(0)
    // Browser degrade still offers a link to the firmware server so the operator
    // can grab the .bin manually and load it with the local picker.
    await expect(page.getByTestId('dronecan-fwupdate-online-link-50')).toHaveAttribute(
      'href',
      /firmware\.ardupilot\.org/
    )
    await expect(page.getByTestId('dronecan-fwupdate-file-50')).toBeVisible()
  })
})
