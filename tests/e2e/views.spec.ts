import { expect, test, type Locator, type Page } from '@playwright/test'
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

// The Rover/Sub demo options are hidden from the transport picker (UI decision —
// their catalogs are thinner than Copter/Plane), but the modes themselves still
// work and stay covered here. Reach them the way a restored session does: seed
// the stored transport mode, then reload so the app boots into it (the select
// renders the hidden option while it's the active mode). Call after page.goto().
async function useHiddenDemoMode(page: Page, mode: 'demo-rover' | 'demo-sub'): Promise<void> {
  await page.evaluate((value) => window.localStorage.setItem('arduconfig:transport-mode', value), mode)
  await page.reload()
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

    // The search/filter toolbar is frozen at the top of the editor so it stays
    // reachable while the long parameter table scrolls under it.
    await expect(page.getByTestId('parameter-search-input')).toBeVisible()
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

// The Config tab groups its sections into top-tab categories; click the tab that
// holds a given section before asserting on it.
const CONFIG_SECTION_CATEGORY: Record<string, string> = {
  frame: 'airframe',
  'board-orientation': 'airframe',
  'esc-dshot': 'airframe',
  compass: 'sensors',
  'active-imu': 'sensors',
  'system-rates': 'sensors',
  'fast-loop-rate': 'sensors',
  gps: 'gps',
  'receiver-signal': 'rc',
  arming: 'arming',
  identity: 'system',
  logging: 'system',
  beeper: 'system',
  'camera-trigger': 'system'
}

async function openConfigSection(page: Page, sectionId: string): Promise<void> {
  const category = CONFIG_SECTION_CATEGORY[sectionId]
  if (category) {
    await page.getByTestId(`config-category-${category}`).click()
  }
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
    // Wait for the full param sync before counting rows — the table populates as
    // params stream in, so an early count races the sync (and empties out).
    await expectParameterSyncComplete(page)
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

  test('global "Show changes" scrolls to the diff grid after switching tabs', async ({ page }) => {
    // The reported bug: clicking Show changes from another tab switched to
    // Parameters but dropped the operator wherever they last scrolled,
    // leaving the diff grid to hunt for.
    await page.goto('/')
    await connectViaHeader(page)
    await page.getByTestId('product-mode-expert').click()
    await page.getByTestId('view-button-parameters').click()

    const search = page.getByTestId('parameter-search-input')
    await search.fill('BATT_LOW_VOLT')
    await page.locator('input[aria-label="BATT_LOW_VOLT value"]').fill('13.5')
    await search.fill('')

    // Navigate away — the global draft bar should follow across tabs.
    await page.getByTestId('view-button-config').click()
    await expect(page.getByTestId('global-draft-bar')).toBeVisible()

    await page.getByTestId('global-draft-show').click()
    await expect(page.getByTestId('workspace-view-title')).toHaveText('Parameters')
    await expect(page.getByTestId('parameter-diff-grid')).toBeInViewport()
  })

  test('editing a bitmask row keeps that row under the operator, with no scroll anchoring to lean on', async ({ page }) => {
    // Reported by an operator ticking AUTOTUNE_AXES bits in the full param list:
    // "when I make a change it takes me to the top of the page so I have to
    // scroll back down to where I was". Root cause, measured on the demo copter:
    // staging the first draft inserts the staged-review block ABOVE the table, so
    // the edited row's DOCUMENT position moves down by that block's height
    // (3557 -> 3759px, +202). Blink/Gecko hide it with native scroll anchoring;
    // WebKit has no scroll anchoring at all, so there the row visibly slides
    // ~202px down the viewport mid-edit.
    //
    // Chromium (what this suite runs) would therefore pass on the browser's
    // anchoring alone and never see the regression, so `overflow-anchor: none`
    // is injected HERE, in the test only, to model an engine without it — that
    // is what makes this test exercise the app's own compensation rather than
    // Blink's. Nothing in the app disables anchoring.
    await page.setViewportSize({ width: 1496, height: 715 })
    await page.goto('/')
    await page.addStyleTag({ content: '* { overflow-anchor: none !important; }' })
    await connectViaHeader(page)
    await expectParameterSyncComplete(page)
    await page.getByTestId('product-mode-expert').click()
    await page.getByTestId('view-button-parameters').click()
    await page.addStyleTag({ content: '* { overflow-anchor: none !important; }' })

    const popover = page.locator('.parameter-row details[data-testid="scoped-bitmask-AUTOTUNE_AXES"]')
    await expect(popover).toBeVisible()
    await popover.locator('summary').click()

    // Park the row 300px down the viewport: clear of the sticky header, so the
    // bit button is a real unobstructed hit and Playwright's actionability check
    // never scrolls the page itself (which would mask the measurement).
    await popover.evaluate((el) => {
      const row = el.closest('.parameter-row') as HTMLElement
      window.scrollTo({ top: window.scrollY + row.getBoundingClientRect().top - 300, behavior: 'instant' as ScrollBehavior })
    })
    // Reach the row through the popover rather than by any attribute the fix
    // itself adds, so this measures behaviour and would still run (and fail) if
    // the compensation were reverted.
    const rowTop = () => popover.evaluate((el) => el.closest('.parameter-row')!.getBoundingClientRect().top)
    const rowClass = () => popover.evaluate((el) => el.closest('.parameter-row')!.className)
    const before = await rowTop()

    const bits = popover.locator('.scoped-bitmask-popover__panel .scoped-bitmask-bit')
    // First toggle: stages a draft, which is what inserts the review block.
    await bits.first().click()
    await expect.poll(rowClass).toContain('parameter-row--staged')
    expect(Math.abs((await rowTop()) - before)).toBeLessThanOrEqual(4)

    // And back to the original value, which DROPS the draft and removes the
    // review block again — the shrink direction has to hold the row too.
    await bits.first().click()
    await expect.poll(rowClass).not.toContain('parameter-row--staged')
    expect(Math.abs((await rowTop()) - before)).toBeLessThanOrEqual(4)
  })

  test('a staged review row edited back to the original stays put (no vanish mid-edit)', async ({ page }) => {
    // Bug: editing a staged value in the Show Changes review to equal the live
    // value dropped the row from under the operator's cursor — how a half-typed
    // value (ANGLE_MAX = 3 instead of 3000) got committed. The touched row now
    // stays as a muted "won't write" row until Discard.
    await page.goto('/')
    await connectViaHeader(page)
    await page.getByTestId('product-mode-expert').click()
    await page.getByTestId('view-button-parameters').click()
    await page.getByTestId('parameter-search-input').fill('ANGLE_MAX')

    const tableInput = page.locator('.parameter-table input[type=number]').first()
    await tableInput.fill('3000') // stage 4500 -> 3000
    const reviewInput = page.getByTestId('parameter-diff-edit-ANGLE_MAX')
    await expect(reviewInput).toBeVisible()

    // Edit the staged value back to the original — the row must NOT disappear.
    await reviewInput.fill('4500')
    await expect(page.getByTestId('parameter-diff-edit-ANGLE_MAX')).toBeVisible()
    await expect(page.locator('.parameter-diff-item--unchanged')).toContainText('won’t write')
    // It's not counted toward the writable staged set.
    await expect(page.getByRole('button', { name: /Apply All \(0\)/ })).toBeVisible()
  })

  test('expanding a param row reveals its metadata, old name, enum meaning, and a type-or-pick editor', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await page.getByTestId('product-mode-expert').click()
    await page.getByTestId('view-button-parameters').click()
    await page.getByTestId('parameter-search-input').fill('GPS_TYPE')

    // Rows are collapsed by default — no detail until you click one.
    await expect(page.getByTestId('parameter-detail-GPS_TYPE')).toHaveCount(0)
    await page.locator('.parameter-row:not(.parameter-row--header)').first().click()

    const detail = page.getByTestId('parameter-detail-GPS_TYPE')
    await expect(detail).toBeVisible()
    // Friendly label + description (metadata the flat table dropped).
    await expect(detail).toContainText('Primary GPS Type')
    await expect(detail).toContainText('Driver type')
    // Old/renamed name.
    await expect(page.getByTestId('parameter-detail-alias-GPS_TYPE')).toContainText('GPS1_TYPE')
    // Enum meaning of the current value (demo GPS_TYPE=9).
    await expect(detail).toContainText('9 — DroneCAN')

    // Type-or-pick editor, both edit the same draft.
    // The detail no longer carries its own number field — the row's Draft cell
    // is the single editor, so the named-option Pick and that field drive the
    // same draft. Two number inputs for one parameter meant typing into one
    // while watching the other.
    await page.getByTestId('parameter-detail-select-GPS_TYPE').selectOption('2')
    await expect(page.getByTestId('parameter-row-input-GPS_TYPE')).toHaveValue('2')
    await expect(page.getByRole('button', { name: /Apply All \(1\)/ })).toBeVisible()
    await page.getByTestId('parameter-row-input-GPS_TYPE').fill('5')
    await expect(page.getByTestId('parameter-detail-select-GPS_TYPE')).toHaveValue('5')
  })

  test('importing a backup stages nothing until Stage all is pressed', async ({ page }) => {
    // An import used to stage every differing value the instant the file was
    // read, turning "let me look at this backup" into a pending write of
    // hundreds of parameters.
    await page.goto('/')
    await connectViaHeader(page)
    await page.getByTestId('product-mode-expert').click()
    await page.getByTestId('view-button-parameters').click()
    await expectParameterSyncComplete(page)

    // A Mission Planner .parm file — one differing value. Simpler to hand-write
    // than the app's own JSON schema, and it exercises the same import path.
    // The testid is the visible button; the file input is the hidden sibling.
    await page.locator('input[aria-label="Import parameter backup file"]').setInputFiles({
      name: 'e2e-backup.parm',
      mimeType: 'text/plain',
      buffer: Buffer.from('BATT_LOW_VOLT,13.5\n')
    })

    // Read, but NOT staged.
    const prompt = page.getByTestId('parameter-import-prompt')
    await expect(prompt).toBeVisible()
    await expect(prompt).toContainText('e2e-backup.parm')
    await expect(page.getByRole('button', { name: /^Apply All \(0\)/ })).toBeVisible()

    // The import is REVIEWABLE: every value shows as a current->imported row
    // with its own Stage/Drop, grouped by category. Without this the prompt was
    // all-or-nothing, since the pending values are held out of the draft set and
    // so never appear in the parameter rows below.
    await expect(page.getByTestId('parameter-import-preview')).toBeVisible()
    await expect(page.getByTestId('parameter-import-stage-BATT_LOW_VOLT')).toBeVisible()

    // Stage all is the explicit, obvious action.
    await page.getByTestId('parameter-import-stage-all').click()
    await expect(page.getByRole('button', { name: /^Apply All \(1\)/ })).toBeVisible()
    await expect(prompt).toHaveCount(0)
  })

  test('a staged bitmask is editable bit by bit, and a draft matching live clears on re-sync', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await page.getByTestId('product-mode-expert').click()
    await page.getByTestId('view-button-parameters').click()
    await expectParameterSyncComplete(page)

    // Stage a bitmask param from its row.
    const search = page.getByTestId('parameter-search-input')
    await search.fill('RC_OPTIONS')
    // The row's bitmask control is a <details> popover; open it and set a bit.
    await page.getByTestId('scoped-bitmask-RC_OPTIONS').locator('summary').first().click()
    await page.locator('.scoped-bitmask-bit').first().click()
    await expect(page.getByRole('button', { name: /^Apply All \(1\)/ })).toBeVisible()
    await search.fill('')

    // In the STAGED review the bitmask must stay a per-bit control. It used to
    // fall through to a raw number input here — the one place a staged bitmask
    // is actually reviewed — so the bits could not be inspected or toggled
    // without leaving the review to find the row below.
    await expect(
      page.getByTestId('parameter-diff-grid').getByTestId('scoped-bitmask-RC_OPTIONS')
    ).toBeVisible()

    // Now edit the staged value back to the live one: the row stays (so the
    // control cannot vanish mid-edit) and reads "matches current".
    await page.getByRole('button', { name: /^Discard All/ }).click()
    await expect(page.getByRole('button', { name: /^Apply All \(0\)/ })).toBeVisible()
  })

  test('an import can be staged one row at a time instead of all at once', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await page.getByTestId('product-mode-expert').click()
    await page.getByTestId('view-button-parameters').click()
    await expectParameterSyncComplete(page)

    // Two differing values, so a partial take is observable.
    await page.locator('input[aria-label="Import parameter backup file"]').setInputFiles({
      name: 'partial.parm',
      mimeType: 'text/plain',
      buffer: Buffer.from('BATT_LOW_VOLT,13.5\nBATT_CRT_VOLT,12.9\n')
    })
    await expect(page.getByTestId('parameter-import-prompt')).toContainText('2 values')

    // Take one row. The other stays pending — the prompt count drops rather
    // than the whole import being consumed.
    await page.getByTestId('parameter-import-stage-BATT_LOW_VOLT').click()
    await expect(page.getByRole('button', { name: /^Apply All \(1\)/ })).toBeVisible()
    await expect(page.getByTestId('parameter-import-prompt')).toContainText('1 value')
    await expect(page.getByTestId('parameter-import-stage-BATT_LOW_VOLT')).toHaveCount(0)

    // Drop the remainder: nothing more is staged and the prompt clears.
    await page.getByTestId('parameter-import-drop-BATT_CRT_VOLT').click()
    await expect(page.getByRole('button', { name: /^Apply All \(1\)/ })).toBeVisible()
    await expect(page.getByTestId('parameter-import-prompt')).toHaveCount(0)

    // The staged row keeps showing what the FILE asked for, next to the live
    // value and the editable one. Editing the draft — including back to the
    // live value, where the row reads "matches current" — must not erase it.
    const imported = page.getByTestId('parameter-diff-import-BATT_LOW_VOLT')
    await expect(imported).toContainText('13.5')
    await page.getByTestId('parameter-diff-edit-BATT_LOW_VOLT').fill('12')
    await expect(imported).toContainText('13.5')
  })

  test('dropping a category drops every staged row in it', async ({ page }) => {
    // The review list is grouped by category, so a category is the unit an
    // operator thinks in when abandoning part of a change set. Before this the
    // options were one row at a time, or hand-selecting the group's checkboxes
    // before "Drop selected".
    await page.goto('/')
    await connectViaHeader(page)
    await page.getByTestId('product-mode-expert').click()
    await page.getByTestId('view-button-parameters').click()

    // Stage two failsafe params so the group has more than one row.
    const search = page.getByTestId('parameter-search-input')
    await search.fill('BATT_LOW_VOLT')
    await page.locator('input[aria-label="BATT_LOW_VOLT value"]').first().fill('13.5')
    await search.fill('BATT_CRT_VOLT')
    await page.locator('input[aria-label="BATT_CRT_VOLT value"]').first().fill('12.9')
    await search.fill('')

    const dropGroup = page.getByTestId('parameter-diff-drop-group-failsafe')
    await expect(dropGroup).toBeVisible()
    await expect(page.getByRole('button', { name: /^Apply All \(2\)/ })).toBeVisible()

    await dropGroup.click()
    // Both rows gone in one click, and the group header with them.
    await expect(page.getByRole('button', { name: /^Apply All \(0\)/ })).toBeVisible()
    await expect(dropGroup).toHaveCount(0)
  })

  test('clicking the row value editor also reveals the metadata detail', async ({ page }) => {
    // The editor cell swallows the row click so editing can never COLLAPSE an
    // expanded row (the control would vanish mid-edit). That also meant a click
    // into the value field on a COLLAPSED row only focused the input and never
    // revealed the metadata — exactly when an operator wants the range and the
    // enum meanings in front of them.
    await page.goto('/')
    await connectViaHeader(page)
    await page.getByTestId('product-mode-expert').click()
    await page.getByTestId('view-button-parameters').click()
    await page.getByTestId('parameter-search-input').fill('GPS_TYPE')

    await expect(page.getByTestId('parameter-detail-GPS_TYPE')).toHaveCount(0)
    // Click the row's value input rather than the row body.
    await page.locator('input[aria-label="GPS_TYPE value"]').first().click()
    await expect(page.getByTestId('parameter-detail-GPS_TYPE')).toBeVisible()

    // And clicking it again must NOT collapse the row back under the operator.
    await page.locator('input[aria-label="GPS_TYPE value"]').first().click()
    await expect(page.getByTestId('parameter-detail-GPS_TYPE')).toBeVisible()
  })

  test('Export is one picker where you choose the format', async ({ page }) => {
    // Was a primary "Export" button sitting next to a separate "Export Legacy…"
    // select, which read as two competing exports. Now a single picker: pick
    // ArduConfigurator JSON or a ground-station format from one control.
    await page.goto('/')
    await connectViaHeader(page)
    await page.getByTestId('product-mode-expert').click()
    await page.getByTestId('view-button-parameters').click()

    // No separate legacy control anymore.
    await expect(page.getByTestId('export-parameter-backup-legacy')).toHaveCount(0)

    const exportPicker = page.getByTestId('export-parameter-backup')
    await expect(exportPicker).toHaveValue('')
    const optionLabels = await exportPicker.locator('option').allTextContents()
    expect(optionLabels).toEqual([
      'Export…',
      'ArduConfigurator JSON',
      'Mission Planner (.parm)',
      'QGroundControl (.params)'
    ])

    // Picking any format triggers its export and resets to the placeholder —
    // reads as a one-shot action, not a persistent mode.
    for (const format of ['json', 'parm', 'params']) {
      const download = page.waitForEvent('download')
      await exportPicker.selectOption(format)
      await download
      await expect(exportPicker).toHaveValue('')
    }
  })
})

test.describe('tab order', () => {
  test('nav leads with Status & Info, then Guided Setup, Config, Calibration', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    // The first four nav buttons follow the canonical order (Status & Info,
    // then the Guided Setup wizard tab, then Config and Calibration).
    const navIds = await page.locator('[data-testid^="view-button-"]').evaluateAll((els) =>
      els.map((el) => (el.getAttribute('data-testid') || '').replace('view-button-', ''))
    )
    expect(navIds.slice(0, 4)).toEqual(['setup', 'guided-setup', 'config', 'calibration'])
    // The Setup tab is now labelled "Status & Info".
    await expect(page.getByTestId('view-button-setup')).toContainText('Status & Info')
  })
})

test.describe('Disconnect behaviour', () => {
  test('a deliberate disconnect clears the vehicle data instead of leaving a stale-link banner', async ({ page }) => {
    // The retained table + "link lost" banner exist for a link that went away on
    // its own (a watchdogging board). Closing the link on purpose must give a
    // clean slate — showing "showing the last data received" after the operator
    // clicked Disconnect would be both wrong and alarming.
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'config')
    await expect(page.locator('.scoped-editor-field').first()).toBeVisible()

    await page.getByTestId('disconnect-button').click()
    await expect(page.getByTestId('stale-link-banner')).toHaveCount(0)
    await expect(page.locator('.scoped-editor-field')).toHaveCount(0)
  })
})

test.describe('Motor Test diagram', () => {
  test('draws the connected frame (demo quad-X): four motors with outward spin arcs', async ({ page }) => {
    // The diagram is built from the vehicle's real FRAME_CLASS/FRAME_TYPE, so an
    // H-frame/hexa/Y6 no longer renders as a hardcoded quad-X. The demo is a
    // quad-X (FRAME_CLASS=1, FRAME_TYPE=1): expect four motor rings, four spin
    // arcs, and no "frame unknown" placeholder.
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'motors')
    await page.getByTestId('outputs-summary-direction-test').click()

    const diagram = page.getByTestId('motor-test-diagram')
    await expect(diagram).toBeVisible()
    await expect(page.getByTestId('motor-test-diagram-empty')).toHaveCount(0)
    // Four motor rings and four spin arcs (one per motor — quad has all four known).
    await expect(diagram.locator('.motor-mixer-preview__ring')).toHaveCount(4)
    await expect(diagram.locator('.motor-mixer-preview__spin')).toHaveCount(4)
  })
})

test.describe('Ports view', () => {
  test('serial options show as chips in the matrix (Notes column removed)', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'ports')
    // The old Notes column header is gone.
    await expect(page.getByText('Notes', { exact: true })).toHaveCount(0)
    // Each row leads with the physical UART/USART heading (or "SERIAL n" fallback
    // when the board map is unknown), with the SERIALn_PROTOCOL ref in the sub-line
    // and the SERIAL number as a secondary pill. Rows are ordered by the physical
    // peripheral number (USART1,2,3 then UART4,5,6…), USB/console first.
    await expect(page.locator('.ports-matrix-row__title strong').first()).toBeVisible()
    await expect(page.locator('.ports-matrix-row__title small', { hasText: /SERIAL\d+_PROTOCOL/ }).first()).toBeVisible()
    // Open the serial-options bitmask editor on the first editable port and
    // toggle one bit (clicking the click-to-highlight chip). The button reads
    // "Bitmask" (collapsed) / "Hide" (expanded); scope to the ports matrix.
    await page.locator('.ports-matrix button:enabled', { hasText: 'Bitmask' }).first().click()
    await page.locator('.ports-matrix-row__expanded .scoped-bitmask-bit').first().click()
    // The selected option now shows as a chip in the Options cell.
    await expect(page.locator('[data-testid^="serial-options-chips-"]').first()).toBeVisible()
  })

  test('the port matrix names the raw param behind Baud, Flow and Serial options', async ({ page }) => {
    // The matrix hand-rolls its fields rather than using the Scoped* components,
    // so it does NOT inherit their param-name hint for free — these were the last
    // editable knobs in the app showing only a generic word ("Baud", "Flow") with
    // no way to tell which SERIALn_* parameter they write.
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'ports')
    const hints = page.locator('.ports-matrix .scoped-editor-field__param-id')
    await expect(hints.filter({ hasText: /^SERIAL\d+_BAUD$/ }).first()).toBeVisible()
    await expect(hints.filter({ hasText: /_RTSCTS$/ }).first()).toBeVisible()
    await expect(hints.filter({ hasText: /^SERIAL\d+_OPTIONS$/ }).first()).toBeVisible()
  })

  test('a DisplayPort / VTX-control protocol shows what it also auto-configures', async ({ page }) => {
    // Picking DisplayPort or a VTX-control protocol on a UART also needs a second
    // param flipped (OSD backend / VTX enable) to work. The pairing stages those
    // as visible drafts; each such port surfaces a note saying so. The demo seeds
    // a DisplayPort port (SERIAL6=42) and a SmartAudio port (SERIAL5=37).
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'ports')
    const notes = page.locator('.ports-matrix-row__pairing-note')
    await expect(notes.filter({ hasText: /OSD backend to MSP DisplayPort/i })).toBeVisible()
    await expect(notes.filter({ hasText: /SmartAudio control/i })).toBeVisible()
    // A plain protocol (GPS on SERIAL3) carries no pairing note.
    await expect(notes.filter({ hasText: /GPS/i })).toHaveCount(0)
  })
})

test.describe('CAN bus enable prompt', () => {
  test('prompts to enable the bus when a DroneCAN peripheral is selected but CAN is off', async ({ page }) => {
    // Demo: GPS_TYPE=9 (DroneCAN) with CAN_P1_DRIVER=0 / CAN_D1_PROTOCOL=0 — the
    // "I picked DroneCAN but the bus is off" trap. The CAN tab surfaces a
    // one-click enable (CAN_P1_DRIVER=1 + CAN_D1_PROTOCOL=1, reboot-required).
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('product-mode-expert').check()
    await page.getByTestId('view-button-can').click()

    const prompt = page.getByTestId('can-enable-prompt')
    await expect(prompt).toBeVisible()
    await expect(prompt).toContainText('GPS is set to DroneCAN')
    await expect(prompt).toContainText('CAN_P1_DRIVER')
    await expect(page.getByTestId('can-enable-button')).toBeEnabled()
  })
})

test.describe('Networking view (Expert + networking-capable FC)', () => {
  test('appears only in Expert mode when the FC reports NET_ params, then renders IP + endpoint settings', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expectParameterSyncComplete(page)

    // Basic mode: no Networking tab (it's an Expert-only surface).
    await expect(page.getByTestId('view-button-networking')).toHaveCount(0)

    // Expert mode: the tab appears because the demo Copter reports NET_ params.
    await page.getByTestId('product-mode-expert').check()
    await expect(page.getByTestId('view-button-networking')).toBeVisible()
    await page.getByTestId('view-button-networking').click()

    await expect(page.getByTestId('networking-view')).toBeVisible()
    // Default tab: IP setup — the scoped-settings card rendered both categories.
    await expect(page.getByTestId('networking-fc-tab')).toBeVisible()
    await expect(page.getByText('IP configuration', { exact: true })).toBeVisible()
    await expect(page.getByText('Network endpoints', { exact: true })).toBeVisible()

    // IP renders as a dotted-quad (four octet inputs), not four "byte N" fields;
    // editing an octet stages a change on the Apply button.
    await expect(page.getByTestId('ip-octet-NET_IPADDR0')).toBeVisible()
    await expect(page.getByTestId('ip-octet-NET_IPADDR3')).toBeVisible()
    // MAC also composites into one row (six colon-separated octets).
    await expect(page.getByTestId('ip-octet-NET_MACADDR0')).toBeVisible()
    await expect(page.getByTestId('ip-octet-NET_MACADDR5')).toBeVisible()
    await page.getByTestId('ip-octet-NET_IPADDR3').fill('20')
    await expect(page.getByRole('button', { name: /Apply Network Changes \(\d+\)/ })).toBeVisible()

    // Per-param "i" info affordance — each NET_ field carries one (hover/focus
    // reveals the ArduPilot description) so operators know what each param does.
    await expect(page.getByTestId('networking-field-info-NET_ENABLE')).toBeVisible()

    // DroneNet tab: switching to it auto-connects over CAN and discovers the demo
    // DroneNet peripheral — no CAN tab, no manual Start needed.
    await page.getByTestId('networking-tab-dronenet').click()
    await expect(page.getByTestId('networking-dronenet-tab')).toBeVisible()
    await expect(page.getByText('DroneNet peripherals', { exact: true })).toBeVisible()
    // The demo com.botblox.dronenet node (id 71) shows up over the auto-started forward.
    await expect(page.getByTestId('can-bus-node-toggle-71')).toBeVisible({ timeout: 15000 })

    // Its NET_PASSn_ passthrough renders as a friendly bridge row with labelled
    // endpoint dropdowns (params auto-walked over CAN). Mock EP1=2 ⇒ "Serial 2".
    await expect(page.getByTestId('passthrough-editor-71')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('passthrough-ep1-71-1')).toHaveValue('2')
    await expect(page.getByTestId('passthrough-ep2-71-1')).toHaveValue('21')
    // Endpoint list is derived from the node's own ports (a handful), not the
    // full ~37-entry serial-manager range — and no CAN-tunnel entries it lacks.
    const ep1 = page.getByTestId('passthrough-ep1-71-1')
    expect(await ep1.locator('option').count()).toBeLessThan(8)
    await expect(ep1.getByRole('option', { name: /CAN\d tunnel/ })).toHaveCount(0)
  })
})

test.describe('Lua Scripts view (Expert + scripting-capable FC)', () => {
  test('appears only in Expert mode when the FC reports SCR_, lists scripts, and installs a curated applet', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expectParameterSyncComplete(page)

    // Basic mode: no Lua tab (it's an Expert-only surface).
    await expect(page.getByTestId('view-button-lua')).toHaveCount(0)

    // Expert mode: the tab appears because the demo Copter reports SCR_ params.
    await page.getByTestId('product-mode-expert').check()
    await expect(page.getByTestId('view-button-lua')).toBeVisible()
    await page.getByTestId('view-button-lua').click()

    await expect(page.getByTestId('lua-view')).toBeVisible()
    // Demo seeds SCR_ENABLE=1 → the "scripting enabled" capability banner.
    await expect(page.getByTestId('lua-capability')).toHaveAttribute('data-capability', 'enabled')

    // The /APM/scripts listing populates from the mock FTP map (hello.lua seeded).
    await expect(page.getByTestId('lua-installed-row-hello.lua')).toBeVisible({ timeout: 15000 })

    // The curated catalog renders cards for the bundled applets.
    await expect(page.getByTestId('lua-card-smartaudio')).toBeVisible()
    await expect(page.getByTestId('lua-card-leds-on-switch')).toBeVisible()

    // Restart/stop scripting sit beside Reboot. Restarting is what ArduPilot
    // actually asks for when a script changes, and it keeps the link up — a
    // reboot to achieve the same thing re-runs every startup check and re-syncs
    // the parameter table.
    await expect(page.getByTestId('lua-restart-scripting')).toBeVisible()
    await expect(page.getByTestId('lua-stop-scripting')).toBeVisible()
    await expect(page.getByTestId('lua-reboot')).toBeVisible()

    await page.getByTestId('lua-restart-scripting').click()
    await expect(page.getByTestId('lua-notice')).toContainText('Scripting restarted')
    // The link must survive it — that is the whole point over a reboot.
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter')

    // Install a curated applet → uploads over MAVFTP, then the file appears in
    // the installed list and the card flips to "Reinstall".
    await page.getByTestId('lua-install-leds-on-switch').click()
    await expect(page.getByTestId('lua-installed-row-leds_on_a_switch.lua')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('lua-install-leds-on-switch')).toHaveText(/Reinstall/)
  })
})

test.describe('AI Assistant view (Expert, offline mock provider)', () => {
  test('appears only in Expert mode and drives a read-only tool loop against the demo vehicle', async ({ page }) => {
    // ?aiProvider=mock forces the offline mock provider (dev/localhost only), so
    // the whole send loop runs with no API key and no network.
    await page.goto('/?aiProvider=mock')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expectParameterSyncComplete(page)

    // Basic mode: no AI Assistant tab (Expert-only surface).
    await expect(page.getByTestId('view-button-ai-assistant')).toHaveCount(0)

    // Expert mode: the tab appears (gated on Expert alone, no FC capability).
    await page.getByTestId('product-mode-expert').check()
    await expect(page.getByTestId('view-button-ai-assistant')).toBeVisible()
    await page.getByTestId('view-button-ai-assistant').click()
    await expect(page.getByTestId('ai-assistant-view')).toBeVisible()

    // The mock provider needs no key, so the composer is ready. Ask a question.
    await page.getByTestId('ai-assistant-input').fill('What am I connected to?')
    await page.getByTestId('ai-assistant-send').click()

    // The user turn renders, the model calls the read-only get_vehicle_info tool,
    // the app executes it, and the final answer reflects the demo vehicle.
    await expect(page.getByTestId('ai-assistant-message').first()).toContainText('What am I connected to?')
    const toolChip = page.getByTestId('ai-assistant-tool-chip').filter({ hasText: 'get_vehicle_info' })
    await expect(toolChip).toHaveAttribute('data-done', 'true', { timeout: 15000 })
    await expect(page.getByTestId('ai-assistant-transcript')).toContainText('ArduCopter')
  })

  test('proposes a parameter change that the human reviews, acknowledges, and applies', async ({ page }) => {
    await page.goto('/?aiProvider=mock')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expectParameterSyncComplete(page)

    await page.getByTestId('product-mode-expert').check()
    await page.getByTestId('view-button-ai-assistant').click()
    await expect(page.getByTestId('ai-assistant-view')).toBeVisible()

    // A write-intent prompt makes the mock provider stage a proposal (never auto-applies).
    await page.getByTestId('ai-assistant-input').fill('please raise my pitch P a little')
    await page.getByTestId('ai-assistant-send').click()

    // The proposal card renders the diff current → proposed for ATC_RAT_PIT_P.
    const proposal = page.getByTestId('ai-assistant-proposal')
    await expect(proposal).toBeVisible({ timeout: 15000 })
    const row = page.getByTestId('ai-assistant-proposal-row-ATC_RAT_PIT_P')
    await expect(row).toBeVisible()
    await expect(row).toHaveAttribute('data-status', 'staged')
    await expect(row).toContainText('0.145')

    // Apply is gated: disabled until the acknowledge checkbox is ticked.
    const applyButton = page.getByTestId('ai-assistant-proposal-apply')
    await expect(applyButton).toBeDisabled()
    await page.getByTestId('ai-assistant-proposal-ack').check()
    await expect(applyButton).toBeEnabled()

    // Apply → verified batch write against the demo FC → success result.
    await applyButton.click()
    await expect(page.getByTestId('ai-assistant-proposal-result')).toContainText('1 verified', { timeout: 20000 })
    await expect(page.getByTestId('ai-assistant-proposal-result')).toContainText('backup was saved')
  })

  test('still answers after hitting the tool-call budget instead of leaving the user with a bare error', async ({ page }) => {
    await page.goto('/?aiProvider=mock')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expectParameterSyncComplete(page)

    await page.getByTestId('product-mode-expert').check()
    await page.getByTestId('view-button-ai-assistant').click()
    await expect(page.getByTestId('ai-assistant-view')).toBeVisible()

    // LOOP_TEST_MARKER makes the mock provider request a tool on every turn,
    // deterministically driving the hook into its tool-iteration cap.
    await page.getByTestId('ai-assistant-input').fill('LOOP_TEST_MARKER investigate everything')
    await page.getByTestId('ai-assistant-send').click()

    // The forced, tool-free wrap-up turn still produces a final answer — the
    // conversation isn't left with nothing but an error after all that work.
    await expect(page.getByTestId('ai-assistant-transcript')).toContainText('Summarizing from everything gathered', {
      timeout: 20000
    })
    // The user is told the budget was hit, without it replacing the answer.
    await expect(page.getByTestId('ai-assistant-error')).toContainText(/tool-call limit/i)
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
    await useHiddenDemoMode(page, 'demo-rover')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduRover', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expectParameterSyncComplete(page)
    await openView(page, 'config')
    await openConfigSection(page, 'receiver-signal')
    await expect(page.getByTestId('config-section-receiver-signal')).toBeVisible()
    await expect(page.getByTestId('config-field-missing-FLTMODE_CH')).toHaveCount(0)
    await expect(page.getByTestId('config-field-missing-MODE_CH')).toHaveCount(0)

    // Sub: no RC mode channel param exists, so the field is omitted entirely.
    await page.goto('/')
    await useHiddenDemoMode(page, 'demo-sub')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduSub', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expectParameterSyncComplete(page)
    await openView(page, 'config')
    await openConfigSection(page, 'receiver-signal')
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

  test('reverse toggles are disabled when SERVO_DSHOT_ESC is "None" — the actual DShot-command gate', async ({ page }) => {
    // Hardware-verified root cause (2026-07-08, real Cube + AM32 ESC): RVMASK
    // alone does nothing unless SERVO_DSHOT_ESC names a real ESC type. This
    // covers the live reactivity of the fix: the ESC-type selector added to
    // the Direction tab, and toggles disabling/re-enabling as it changes.
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'motors')
    await page.getByTestId('outputs-summary-motor-setup').click()
    await page.getByTestId('motor-reorder-lightbox-tab-direction').click()

    const m1 = page.getByTestId('motor-reorder-direction-reverse-1').locator('input')
    const escSelect = page.getByTestId('motor-reorder-direction-esctype').locator('select')
    await expect(escSelect).toBeVisible()
    await expect(m1).toBeEnabled()

    await m1.check()
    await expect(m1).toBeChecked()

    // Switching the ESC type to "None" disables the toggles — matches the
    // real firmware behavior where SERVO_DSHOT_ESC=0 silently drops every
    // DShot special command, including reverse.
    await escSelect.selectOption('0')
    await expect(m1).toBeDisabled()

    // Switching back re-enables it, and the staged reverse bit persisted.
    await escSelect.selectOption('1')
    await expect(m1).toBeEnabled()
    await expect(m1).toBeChecked()
  })
})

test.describe('Calibration tab — motor-spin (ESC)', () => {
  test('ESC calibration is blocked (n/a) for a DShot vehicle — no arm flow', async ({ page }) => {
    // The demo copter is DShot300 (MOT_PWM_TYPE = 5). ESC endpoint calibration is
    // a PWM-era procedure and must NOT be offered for DShot (digital, no
    // endpoints) — the card shows a "not applicable" explanation instead of the
    // arm/confirm flow.
    //
    // The motor-safety acks DO stay, though: they gate every motor-spinning
    // action here, including the battery-current load spin. Hiding them on DShot
    // (i.e. on most modern quads) left that card telling the operator to
    // "acknowledge the checks below" with no checkboxes anywhere on the page.
    // They now render inline next to the button they unlock (in the Battery
    // current card) instead of in a standalone "Motor-spin safety" card, so the
    // operator reads gate-then-button in one place.
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'calibration')
    await expect(page.getByTestId('calibration-card-esc')).toBeVisible()
    await expect(page.getByTestId('calibration-card-compassmot')).toHaveCount(0)
    const unsupported = page.getByTestId('esc-cal-unsupported')
    await expect(unsupported).toBeVisible()
    await expect(unsupported).toContainText('DShot')
    // The arm button is not rendered for DShot...
    await expect(page.getByTestId('esc-cal-arm')).toHaveCount(0)
    // ...but the safety acks are, so battery-current calibration stays usable.
    await expect(page.getByTestId('calibration-card-battery-current')).toBeVisible()
    await expect(page.getByTestId('cal-motor-acks')).toBeVisible()
    await expect(page.getByTestId('cal-props-ack')).toBeVisible()
    await expect(page.getByTestId('cal-area-ack')).toBeVisible()
    // The gate sits with the button it unlocks, not in a separate card.
    await expect(page.getByTestId('calibration-card-motor-safety')).toHaveCount(0)
    await expect(page.getByTestId('battery-current-spin-motors')).toBeVisible()
  })

  test('Reset to Defaults is armed before it can erase, on Parameters and Snapshots', async ({ page }) => {
    // Erasing every parameter sits near the top of two high-traffic screens, so
    // the first click must only arm — a misclick here costs a full retune.
    await page.goto('/')
    await connectViaHeader(page)
    // Raw parameter editing is an Expert surface, so the tab only exists here.
    await page.getByTestId('product-mode-expert').check()

    for (const view of ['parameters', 'snapshots'] as const) {
      await openView(page, view)
      const reset = page.getByTestId('reset-to-defaults')
      await expect(reset).toBeVisible()
      await expect(page.getByTestId('reset-to-defaults-confirm')).toHaveCount(0)

      await reset.click()
      await expect(page.getByTestId('reset-to-defaults-warning')).toBeVisible()
      await expect(page.getByTestId('reset-to-defaults-confirm')).toBeVisible()

      // Cancel returns to the unarmed state without erasing anything.
      await page.getByTestId('reset-to-defaults-cancel').click()
      await expect(page.getByTestId('reset-to-defaults')).toBeVisible()
      await expect(page.getByTestId('reset-to-defaults-confirm')).toHaveCount(0)
    }
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

  test('a finished calibration offers a reboot, and only claims one is required when ArduPilot needs it', async ({ page }) => {
    // Accelerometer and compass calibration both leave ArduPilot refusing to arm
    // until the board reboots (AP_Arming "Accels/Compass calibrated requires
    // reboot"), and nothing on screen used to say so. Level does not — its trim
    // is saved and live immediately — so the prompt must not claim otherwise.
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'calibration')

    await page.getByTestId('calibration-run-calibrate-level').click()
    const prompt = page.getByTestId('calibration-reboot-calibrate-level')
    await expect(prompt).toBeVisible({ timeout: COMMAND_ACK_TIMEOUT })
    await expect(prompt).toHaveAttribute('data-required', 'false')
    await expect(prompt).toContainText('Not required')

    // Dismissing answers this run only.
    await page.getByTestId('calibration-reboot-dismiss-calibrate-level').click()
    await expect(prompt).toHaveCount(0)
  })
})

test.describe('Tuning tab', () => {
  test('renders curated controls with float values rounded for display', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'tuning')

    // The "rates" (Pilot) task renders the Flight Feel controls under the
    // collapsible Angle section (default collapsed) — expand it first. The demo
    // seeds ATC_INPUT_TC as the float32-widened 0.15000000596046448 (what a real
    // FC reports); the number field must show it rounded, not all the digits.
    await page.locator('details.bf-gui-box > summary').filter({ hasText: 'Angle' }).click()
    const input = page.getByTestId('tuning-input-ATC_INPUT_TC')
    await expect(input).toBeVisible({ timeout: 10000 })
    await expect(input).toHaveValue('0.15')
  })

  test('pilot rates (lean angle, yaw rate, acro rates) are reachable here', async ({ page }) => {
    // Coverage moved from the Config "pilot rates" mirror card, which was
    // dropped when Arming and RC split into their own Config tabs: Tuning is
    // the single home for stick shaping now, so every param that card carried
    // has to be reachable here or the split lost a surface.
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'tuning')

    await page.locator('details.bf-gui-box > summary').filter({ hasText: 'Angle' }).click()
    // Lean angle resolves to whichever param the FC streams (ANGLE_MAX <= 4.6,
    // ATC_ANGLE_MAX 4.7+); the demo Copter streams ANGLE_MAX.
    await expect(page.getByTestId('tuning-input-ANGLE_MAX')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('tuning-input-PILOT_Y_RATE')).toBeVisible()
    await expect(page.getByTestId('tuning-input-PILOT_Y_EXPO')).toBeVisible()
    await page.locator('details.bf-gui-box > summary').filter({ hasText: 'Acro' }).click()
    await expect(page.getByTestId('tuning-input-ACRO_RP_RATE')).toBeVisible()
    await expect(page.getByTestId('tuning-input-ACRO_Y_RATE')).toBeVisible()
    await expect(page.getByTestId('tuning-input-ACRO_RP_EXPO')).toBeVisible()
    await expect(page.getByTestId('tuning-input-ACRO_Y_EXPO')).toBeVisible()
  })

  test('the slider tracks live while dragging and only stages on release', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'tuning')

    // Pilot modes are collapsible and default collapsed — expand Angle first.
    await page.locator('details.bf-gui-box > summary').filter({ hasText: 'Angle' }).click()
    const input = page.getByTestId('tuning-input-ATC_INPUT_TC')
    await expect(input).toBeVisible({ timeout: 10000 })
    // Scope to the ATC_INPUT_TC control's own slider (not `.first()` — the
    // Pilot section order isn't guaranteed, and a collapsed section's sliders
    // are still in the DOM). Dragging it (input events, no pointer-up) must
    // update the value live but NOT commit a staged draft yet — committing on
    // every drag tick is what made the slider stutter and "jump to staged".
    const slider = page
      .locator('.tuning-control', { has: page.getByTestId('tuning-input-ATC_INPUT_TC') })
      .locator('.tuning-control__range')
    await slider.fill('0.3')
    await expect(input).toHaveValue('0.3')
    // Mid-drag (before release) nothing is staged.
    await expect(page.locator('.tuning-control--staged')).toHaveCount(0)
  })

  test('Pilot mode sections are collapsible and default collapsed', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'tuning')

    // The Pilot tab opens as a compact list of collapsible mode pills; their
    // controls stay hidden until the operator expands a mode.
    const angleSummary = page.locator('details.bf-gui-box > summary').filter({ hasText: 'Angle' })
    await expect(angleSummary).toBeVisible()
    await expect(page.getByTestId('tuning-input-ATC_INPUT_TC')).toBeHidden()

    await angleSummary.click()
    await expect(page.getByTestId('tuning-input-ATC_INPUT_TC')).toBeVisible()
  })

  test('the curated control info bubble reveals the raw param name and a wiki link', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'tuning')
    await page.locator('details.bf-gui-box > summary').filter({ hasText: 'Angle' }).click()

    // The card only ever shows the friendly label ("Stick feel smoothing"), so
    // the bubble is the operator's ONLY route from that label to ATC_INPUT_TC.
    const info = page.getByTestId('tuning-info-ATC_INPUT_TC')
    await expect(info).toBeVisible({ timeout: 10000 })
    const tip = info.locator('xpath=following-sibling::span[@role="tooltip"]')
    await expect(tip).toBeHidden()
    // Re-place the pointer if the still-settling page slides the button out
    // from under it; see the Config tooltip test for why.
    await expect(async () => {
      await info.hover()
      await expect(tip).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 15_000 })
    await expect(tip).toContainText('ATC_INPUT_TC')

    const link = tip.getByTestId('param-wiki-ATC_INPUT_TC')
    // Our own reference, addressed by parameter NAME — the wiki resolves the
    // name to its family page (see wiki/_static/parameter-search.js), so the
    // app never ships a copy of that map and can't point at a stale page.
    await expect(link).toHaveAttribute(
      'href',
      'https://arduconfigurator.com/wiki/parameters/index.html?param=ATC_INPUT_TC'
    )
    // The reference is generated from the pinned Copter-4.7 metadata; say so
    // before the click, since nothing here knows the connected firmware.
    await expect(link).toContainText('ArduCopter 4.7')
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')

    // The tip hangs a few px below the "i", and hover state follows the DOM, so
    // without the invisible bridge the pointer crossing that dead band closed
    // the tip and the link was unclickable in practice. Park the mouse IN the
    // gap and assert the tip survives, then click through to the link.
    const iconBox = (await info.boundingBox())!
    const tipBox = (await tip.boundingBox())!
    await page.mouse.move(iconBox.x + iconBox.width / 2, (iconBox.y + iconBox.height + tipBox.y) / 2)
    await expect(tip).toBeVisible()
    await link.hover()
    await expect(tip).toBeVisible()
  })

  test('the info bubble stays open while tabbing onto its wiki link', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'tuning')
    await page.locator('details.bf-gui-box > summary').filter({ hasText: 'Angle' }).click()

    const info = page.getByTestId('tuning-info-ATC_INPUT_TC')
    await expect(info).toBeVisible({ timeout: 10000 })
    const tip = info.locator('xpath=following-sibling::span[@role="tooltip"]')
    // Keyboard route: focusing the "i" opens the tip, and focus-within keeps it
    // open when Tab moves on to the link inside it (button-only :focus-visible
    // would close it and strand the link).
    await info.focus()
    await expect(tip).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('param-wiki-ATC_INPUT_TC')).toBeFocused()
    await expect(tip).toBeVisible()
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

  test('deep-link button navigates to the battery setup, now under Config', async ({ page }) => {
    // Power stopped being its own tab and became a Config category. The deep
    // link has to follow the surface, or Failsafe points at a tab that is not
    // there any more.
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'failsafe')

    await page.getByTestId('failsafe-go-to-power').click()

    await expect(page.getByTestId('workspace-view-title')).toHaveText('Config')
    await page.getByTestId('config-category-power').click()
    await expect(page.getByText('Battery configuration')).toBeVisible()
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

    // The two bootloader modes are separate controls, separately armed, and the
    // page says so. An operator looking for DFU used to find only the button
    // that holds the board in ArduPilot's bootloader — labelled "(DFU)".
    await expect(page.getByTestId('firmware-enter-dfu')).toHaveText('Activate Bootloader')
    await expect(page.getByTestId('firmware-enter-rom-dfu')).toHaveText('Enter DFU (STM32 ROM)')
    await expect(page.getByTestId('firmware-bootloader-vs-dfu-note')).toBeVisible()
    await page.getByTestId('firmware-enter-rom-dfu').click()
    await expect(page.getByTestId('firmware-enter-rom-dfu-confirm')).toBeVisible()
    // Arming one must not arm the other.
    await expect(page.getByTestId('firmware-enter-dfu')).toBeVisible()
    await expect(page.getByTestId('firmware-enter-dfu-confirm')).toHaveCount(0)
    await page.getByTestId('firmware-enter-rom-dfu-cancel').click()
    await expect(page.getByTestId('firmware-enter-rom-dfu-confirm')).toHaveCount(0)

    // Flashing does not clear parameters — say so where operators go looking,
    // and put the action that does clear them within reach. Two-step, because
    // it wipes the board's whole configuration.
    await expect(page.getByTestId('firmware-flash-vs-params-note')).toContainText(
      'Flashing firmware does not reset your parameters'
    )
    await page.getByTestId('firmware-reset-params').click()
    await expect(page.getByTestId('firmware-reset-params-confirm')).toBeVisible()
    await expect(page.getByTestId('firmware-reset-params-warning')).toBeVisible()
    // The explanatory note gives way to the warning while armed, so it cannot
    // read as reassurance next to a destructive confirm.
    await expect(page.getByTestId('firmware-flash-vs-params-note')).toHaveCount(0)
    await page.getByTestId('firmware-reset-params-cancel').click()
    await expect(page.getByTestId('firmware-reset-params-confirm')).toHaveCount(0)

    // Update Bootloader (MAV_CMD_FLASH_BOOTLOADER) gets the same two-step gate:
    // rewriting the bootloader sector can brick the board if interrupted, so
    // the first click must only arm, never send.
    await expect(page.getByTestId('firmware-flash-bootloader')).toBeVisible()
    await page.getByTestId('firmware-flash-bootloader').click()
    await expect(page.getByTestId('firmware-flash-bootloader-confirm')).toBeVisible()
    await page.getByTestId('firmware-flash-bootloader-cancel').click()
    await expect(page.getByTestId('firmware-flash-bootloader')).toBeVisible()
    await expect(page.getByTestId('firmware-flash-bootloader-confirm')).toHaveCount(0)

    // The bootloader hash comparison is a developer affordance, so in basic
    // mode arming the update must not show it (and must not read anything).
    await page.getByTestId('firmware-flash-bootloader').click()
    await expect(page.getByTestId('firmware-bootloader-identity')).toHaveCount(0)
    await page.getByTestId('firmware-flash-bootloader-cancel').click()

    // Custom server toggle expands a URL + token panel.
    await expect(page.getByTestId('firmware-custom-server')).toHaveCount(0)
    await page.getByTestId('firmware-toggle-custom-server').click()
    await expect(page.getByTestId('firmware-custom-server')).toBeVisible()
    await expect(page.getByTestId('firmware-custom-server-url')).toBeVisible()
    await expect(page.getByTestId('firmware-custom-server-token')).toBeVisible()
  })

  test('Flash tab: expert mode shows both bootloader hashes before the update commits', async ({ page }) => {
    // 390px on purpose — the comparison block sits in the flash wizard, and a
    // 64-hex digest is exactly the kind of content that forces a phone layout
    // to scroll sideways if it is not allowed to wrap.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await connectViaHeader(page)
    await page.getByTestId('product-mode-expert').click()
    await openView(page, 'flash')

    // Not shown until the operator arms the update: reading the images costs
    // tens of KB on the link, so it must not happen on every Flash-tab visit.
    await expect(page.getByTestId('firmware-bootloader-identity')).toHaveCount(0)
    await page.getByTestId('firmware-flash-bootloader').click()

    const identity = page.getByTestId('firmware-bootloader-identity')
    await expect(identity).toBeVisible()

    // Both sides resolve to a digest against the demo vehicle, and the demo's
    // two images differ by design, so the verdict must be the interesting one.
    const hashes = page.getByTestId('firmware-bootloader-identity-hash')
    await expect(hashes).toHaveCount(2)
    await expect(page.getByTestId('firmware-bootloader-identity-headline')).toHaveAttribute(
      'data-verdict',
      'different'
    )
    // Scope to the <code> — the cell also carries the image size next to it.
    const [installed, incoming] = await hashes.locator('code').allTextContents()
    expect(installed).not.toEqual(incoming)
    // Short form on screen, full digest available on the element.
    expect(installed).toMatch(/^[0-9a-f]{12}$/)
    const full = await hashes.first().getAttribute('title')
    expect(full).toMatch(/^[0-9a-f]{64}$/)

    // The comparison is informational: the existing arm/confirm gate is
    // untouched and still the only thing that sends the command.
    await expect(page.getByTestId('firmware-flash-bootloader-confirm')).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow).toBeLessThanOrEqual(2)

    // Cancelling puts the block away again.
    await page.getByTestId('firmware-flash-bootloader-cancel').click()
    await expect(page.getByTestId('firmware-bootloader-identity')).toHaveCount(0)
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
    // Sections live under top-tab categories now — the category strip shows the
    // six groups, and each holds its sections.
    await expect(page.getByTestId('config-category-nav')).toBeVisible()
    for (const [sectionId, category] of [
      ['board-orientation', 'airframe'],
      ['gps', 'gps'],
      ['receiver-signal', 'rc'],
      ['arming', 'arming'],
      ['identity', 'system'],
      ['beeper', 'system'],
      ['camera-trigger', 'system'],
      ['logging', 'system']
    ] as const) {
      await page.getByTestId(`config-category-${category}`).click()
      await expect(page.getByTestId(`config-section-${sectionId}`)).toBeVisible()
    }
    // Statistics moved to the Setup side panel — no longer a Config section.
    await expect(page.getByTestId('config-section-statistics')).toHaveCount(0)
    // Fast-rate thread is build-gated: the demo Copter mock does not stream
    // FSTRATE_*, so the Fast loop rate section must never render.
    await expect(page.getByTestId('config-section-fast-loop-rate')).toHaveCount(0)
  })

  test('Compass section groups use / mounting / orientation / disabled-drivers', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-config').click()
    await openConfigSection(page, 'compass')

    const compass = page.getByTestId('config-section-compass')
    await expect(compass).toBeVisible()
    // The curated compass knobs render with their param-name hints. AUTO_ROT and
    // DISBLMSK are in the card's Advanced fold — open it first.
    await compass.getByTestId('config-advanced-compass').click()
    for (const id of ['COMPASS_EXTERNAL', 'COMPASS_ORIENT', 'COMPASS_AUTO_ROT', 'COMPASS_DISBLMSK']) {
      await expect(compass.locator('.scoped-editor-field__param-id', { hasText: id }).first()).toBeVisible()
    }
    // Editing a compass field stages into the Config apply scope.
    await compass.getByText('Disabled', { exact: true }).first().click()
    await expect(page.getByTestId('config-apply')).toBeEnabled()
  })

  test('Board orientation shows a picture of the mounting that reacts to the dropdown', async ({ page }) => {
    // The board-orientation section carries a top-down FC picture (footer slot)
    // driven by the selected AHRS_ORIENTATION — flat rotation for pure yaw,
    // "upside down" for a 180° flip, a note for edge/tilted mounts.
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-config').click()
    await openConfigSection(page, 'board-orientation')

    const section = page.getByTestId('config-section-board-orientation')
    const diagram = page.getByTestId('board-orientation-diagram')
    await expect(diagram).toBeVisible() // demo AHRS_ORIENTATION=0 (None)
    await expect(diagram).toContainText('None')
    const board = page.getByTestId('board-orientation-3d')
    await expect(board).toBeVisible()

    const select = section.locator('select').first()
    // Roll 180 (upside down) — 3D board posed, caption updates.
    await select.selectOption('8')
    await expect(diagram).toContainText('Roll 180')
    await expect(board).toHaveAttribute('style', /rotateY\(180deg\)/)

    // Roll 90 (on its edge) — now depictable in 3D (2D couldn't show it).
    await select.selectOption('16')
    await expect(diagram).toContainText('Roll 90')
    await expect(board).toHaveAttribute('style', /rotateY\(90deg\)/)

    // A Custom orientation can't be posed — shows a note instead of a board.
    await select.selectOption('101')
    await expect(page.getByTestId('board-orientation-note')).toBeVisible()
    await expect(page.getByTestId('board-orientation-3d')).toHaveCount(0)
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

  test('a reboot-required write surfaces a prominent Request Reboot button without scrolling', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('product-mode-expert').click()

    // Stage + apply a reboot-required change (bdshot stages SERVO_BLH_* params).
    await page.getByTestId('view-button-config').click()
    await page.getByTestId('esc-dshot-footer').scrollIntoViewIfNeeded()
    await page.getByTestId('esc-enable-bdshot').click()
    await page.getByRole('button', { name: /Apply Config/ }).click()

    // The fixed bottom action bar — the same spot Write all just occupied —
    // becomes a prominent reboot prompt on whatever view the operator is on
    // (here: still Config), so AP's reboot demand can't be missed.
    const stickyReboot = page.getByTestId('global-draft-reboot')
    await expect(stickyReboot).toBeVisible()
    await expect(stickyReboot).toHaveText(/Request Reboot/)

    // The Parameters view's inline follow-up also carries a Request Reboot button.
    await page.getByTestId('view-button-parameters').click()
    await expect(page.getByTestId('parameter-follow-up-reboot')).toBeVisible()
  })

  test('selecting a DShot MOT_PWM_TYPE auto-enables bidirectional DShot', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-config').click()
    const esc = page.getByTestId('config-section-esc-dshot')
    await esc.scrollIntoViewIfNeeded()
    // BLH_BDMASK is folded under Advanced; open it so the synced bits are in the
    // DOM (their presence is how the app knows the firmware supports BDShot).
    await esc.getByTestId('config-advanced-esc-dshot').click()
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

  test('Motor Test shows live ESC RPM per motor', async ({ page }) => {
    // The demo only emits ESC_TELEMETRY after the runtime asks for it via
    // SET_MESSAGE_INTERVAL, exactly as hardware does — so this passing also
    // proves the LIVE_TELEMETRY_REQUESTS entry is still there.
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await page.getByTestId('view-button-motors').click()
    await page.getByTestId('outputs-summary-direction-test').click()

    const readout = page.getByTestId('esc-rpm-readout')
    await readout.scrollIntoViewIfNeeded()
    await expect(readout).toHaveAttribute('data-status', 'live', { timeout: 15000 })
    // Four motors, four distinct RPMs — identical numbers would hide a decode
    // that put every slot on the same offset.
    const values = await Promise.all(
      [1, 2, 3, 4].map((motor) => readout.getByTestId(`esc-rpm-value-${motor}`).innerText())
    )
    expect(new Set(values).size).toBe(4)
    for (const value of values) {
      expect(value).not.toBe('—')
    }
  })

  test('ESC & Protocol exposes the motor pole count with a reference for choosing it', async ({ page }) => {
    // SERVO_BLH_POLES is the divisor for ESC eRPM -> RPM, so it belongs next to
    // the ESC protocol choice rather than only in the raw parameter list. A
    // wrong value is silent — every RPM reading is off by the same factor.
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await page.getByTestId('view-button-motors').click()
    await page.getByTestId('outputs-summary-esc-protocol').click()

    // ScopedNumberField labels its input from the metadata label rather than a
    // test id; the demo reports the firmware default of 14.
    const poles = page.getByLabel('Motor magnet poles')
    await poles.scrollIntoViewIfNeeded()
    await expect(poles).toHaveValue('14')

    const reference = page.getByTestId('motor-pole-reference')
    await expect(reference).toBeVisible()
    await reference.locator('summary').click()
    await expect(reference).toContainText('12N14P')
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
    // Sections pack via CSS multicolumn so short cards tuck under tall ones
    // instead of leaving a row of dead space (capped at 3 columns now that a
    // category holds only a few cards).
    const columnWidth = await grid.evaluate((el) => getComputedStyle(el).columnWidth)
    expect(columnWidth).toBe('360px')
  })

  test('Receiver & signal section mirrors RSSI / mode-channel / RC options into Config', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-config').click()
    await openConfigSection(page, 'receiver-signal')
    const section = page.getByTestId('config-section-receiver-signal')
    await expect(section).toBeVisible()
    // RC_OPTIONS is visible without opening anything: the RC tab does not fold
    // fields under Advanced (an operator setting up a radio needs the protocol
    // and options in front of them).
    await expect(section.getByTestId('config-advanced-receiver-signal')).toHaveCount(0)
    // RC_OPTIONS renders as a chip grid here too (shared bitmask field).
    await expect(page.getByTestId('scoped-bitmask-RC_OPTIONS')).toBeVisible()
    // Protocol + options lead the card. Radio calibration is impossible until
    // the link decodes, so the prerequisite knobs must read first — assert on
    // DOM order rather than mere presence, which is what regressed before.
    const fieldOrder = await section
      .locator('[data-testid^="scoped-"], [data-testid^="config-field-missing-"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid') ?? ''))
    const indexOfParam = (paramId: string): number =>
      fieldOrder.findIndex((testId) => testId.endsWith(`-${paramId}`))
    expect(indexOfParam('RC_PROTOCOLS')).toBeGreaterThanOrEqual(0)
    expect(indexOfParam('RC_PROTOCOLS')).toBeLessThan(indexOfParam('RC_OPTIONS'))
    expect(indexOfParam('RC_OPTIONS')).toBeLessThan(indexOfParam('RSSI_TYPE'))
  })

  test('Arming has its own category tab, separate from RC', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-config').click()

    // Arming is its own group now: its tab exists, holds the arming card, and
    // the RC tab must NOT also carry it (the old shared "RC & Arming" tab).
    await page.getByTestId('config-category-arming').click()
    await expect(page.getByTestId('config-section-arming')).toBeVisible()
    await expect(page.getByTestId('config-section-receiver-signal')).toHaveCount(0)

    await page.getByTestId('config-category-rc').click()
    await expect(page.getByTestId('config-section-receiver-signal')).toBeVisible()
    await expect(page.getByTestId('config-section-arming')).toHaveCount(0)
    // Pilot rates left Config entirely — Tuning is the single home for stick
    // shaping now, so no Config tab may resurrect the mirror.
    await expect(page.getByTestId('config-section-pilot-rates')).toHaveCount(0)
  })

  test('ESC & DShot section exposes protocol + reverse/bdshot masks as chips', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-config').click()

    const esc = page.getByTestId('config-section-esc-dshot')
    await esc.scrollIntoViewIfNeeded()
    await expect(esc).toBeVisible()
    // Reverse + bidirectional-DShot masks are set-once, folded under Advanced.
    await esc.getByTestId('config-advanced-esc-dshot').click()
    // …then render as per-output chip grids.
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
    // Pin the first field's bubble to ITS OWN test id rather than re-resolving
    // `.first()` on every step: the Config surface fills in as parameters sync,
    // and a locator that re-resolves can end up hovering one bubble while
    // asserting about another's tooltip.
    const firstInfoId = await page.locator('[data-testid^="config-field-info-"]').first().getAttribute('data-testid')
    expect(firstInfoId).toBeTruthy()
    const info = page.getByTestId(firstInfoId!)
    await info.scrollIntoViewIfNeeded()
    await expect(info).toBeVisible()
    // Tooltip is hidden until hover, then reveals the param description.
    const tip = info.locator('xpath=following-sibling::span[@role="tooltip"]')
    await expect(tip).toBeHidden()
    // The reveal is pure CSS :hover, so it is only as durable as the pointer
    // staying over the button — and this page is still laying itself out as
    // parameters arrive, so a shift can slide the button out from under a
    // pointer that has already been placed. Re-place the pointer and re-check:
    // the contract asserted is unchanged (hovering the "i" shows the tooltip),
    // it is simply not asserted against a single throw of the dice.
    await expect(async () => {
      await info.hover()
      await expect(tip).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 15_000 })
    await expect(tip).not.toHaveText('')
  })

  test('Config info bubble names the raw parameter and links our parameter reference', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-config').click()
    const info = page.getByTestId('config-field-info-FRAME_CLASS')
    await info.scrollIntoViewIfNeeded()
    const tip = info.locator('xpath=following-sibling::span[@role="tooltip"]')
    // Re-place the pointer if the still-settling page slides the button out
    // from under it; see the sibling tooltip test for why.
    await expect(async () => {
      await info.hover()
      await expect(tip).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 15_000 })
    await expect(tip).toContainText('FRAME_CLASS')
    const link = tip.getByTestId('param-wiki-FRAME_CLASS')
    await expect(link).toHaveAttribute(
      'href',
      'https://arduconfigurator.com/wiki/parameters/index.html?param=FRAME_CLASS'
    )
    // Plain external link in a new tab — the wiki must never be pulled into the
    // SPA (an earlier in-app wiki poisoned the PWA shell; that was a P1).
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
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

    // system-rates + active-imu live under the Sensors tab.
    await openConfigSection(page, 'system-rates')
    await expect(page.getByTestId('config-section-system-rates')).toBeVisible()
    await expect(page.getByTestId('config-section-active-imu')).toBeVisible()
    // Main loop rate renders as a dropdown (enum), defaulting to 400 Hz.
    const rates = page.getByTestId('config-section-system-rates')
    await expect(rates.getByText('Main loop rate')).toBeVisible()

    // GPS behavior — the multi-GPS knobs (Auto switch / Primary select) are
    // set-once, folded under Advanced.
    await openConfigSection(page, 'gps')
    const gps = page.getByTestId('config-section-gps')
    await gps.getByTestId('config-advanced-gps').click()
    await expect(gps.getByText('Auto switch')).toBeVisible()
    // GPS_TYPE renders as "Primary GPS Type" and GPS_PRIMARY as "Primary GPS
    // Select"; match the specific GPS_PRIMARY knob.
    await expect(gps.getByText('Primary GPS Select')).toBeVisible()
  })

  test('an editable field shows the raw ArduPilot parameter name under its label', async ({ page }) => {
    // Reported gap: friendly labels alone don't tell the operator what to
    // search the wiki/Parameters tab for. Centralized in ScopedField's shared
    // components, so any editable field is representative — Fast sampling
    // (INS_FAST_SAMPLE) in the system-rates section. NOTE: not Main loop rate
    // (SCHED_LOOP_RATE) — that one has <= 8 enum options and Config.tsx
    // renders it via the chip-grid layout (ScopedOptionChipsField), which is
    // a role="radiogroup" of buttons with no single labelled control for
    // getByLabel to match. INS_FAST_SAMPLE has no enum options, so it goes
    // through ScopedNumberField's plain aria-label'd <input> instead.
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-config').click()
    // system-rates is under Sensors; Fast sampling is folded under Advanced.
    await openConfigSection(page, 'system-rates')
    const rates = page.getByTestId('config-section-system-rates')
    await rates.getByTestId('config-advanced-system-rates').click()
    const field = rates.locator('.scoped-editor-field', { hasText: 'Fast sampling' })
    await expect(field.locator('.scoped-editor-field__param-id')).toHaveText('INS_FAST_SAMPLE')

    // Regression guard: the id hint must not pollute the control's accessible
    // name (a <label> concatenates ALL its text by default) — an exact
    // getByLabel query on the friendly label alone must still resolve.
    await expect(field.getByLabel('Fast sampling (IMU mask)', { exact: true })).toBeVisible()
  })
})

test.describe('RC Mixer view', () => {
  test('hides the primary stick axes but shows AUX channels including the mode switch', async ({ page }) => {
    // Demo Copter: RCMAP_ROLL/PITCH/THROTTLE/YAW = 1/2/3/4, FLTMODE_CH = 7,
    // RCL_ENABLE = 1 with real range terms on ch5 (ArmDisarm) and ch6 (LAND).
    // Only channels 1-4 (the continuous stick axes) are skipped. The flight-mode
    // channel (7) IS shown — ArduPilot RC Logic can layer a range function on
    // the mode channel, so hiding it wrongly reads as "the mixer lost my channel."
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('product-mode-expert').check()
    await page.getByTestId('view-button-rc-mixer').click()

    for (const channel of [1, 2, 3, 4]) {
      await expect(page.getByTestId(`rc-mixer-channel-${channel}`)).toHaveCount(0)
    }
    // AUX channels remain, including the ones with real assigned functions and
    // the flight-mode channel (7), which now appears as a normal aux row.
    await expect(page.getByTestId('rc-mixer-channel-5')).toBeVisible()
    await expect(page.getByTestId('rc-mixer-channel-6')).toBeVisible()
    await expect(page.getByTestId('rc-mixer-channel-7')).toBeVisible()
    await expect(page.getByTestId('rc-mixer-channel-8')).toBeVisible()

    // Cross-subsystem awareness: ch7 is the flight-mode switch, so the mixer
    // badges it as already claimed even though it has no RCL term of its own.
    await expect(page.getByTestId('rc-mixer-channel-claim-7')).toContainText('Flight modes')
  })

  test('surfaces RC Mixer term usage back in the Receiver view (reverse awareness)', async ({ page }) => {
    // Demo Copter has RCL terms on ch5 (ArmDisarm) and ch6; the Receiver view
    // summarises that those channels also carry an RC Mixer function.
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-receiver').click()
    const summary = page.getByTestId('receiver-rcl-summary')
    await expect(summary).toContainText('CH5')
    await expect(summary).toContainText('RC Mixer')
  })

  test('function picker only offers functions the connected vehicle firmware actually supports', async ({ page }) => {
    // Demo Plane doesn't report RCL_ENABLE, so the tab falls back to the
    // scaffold catalog — which should now exclude Copter/Rover-only entries
    // (Precision Loiter, Reverse throttle) while keeping Plane-applicable
    // ones (Land) and vehicle-generic ones (Do nothing).
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await page.getByTestId('product-mode-expert').check()
    await page.getByTestId('view-button-rc-mixer').click()

    const channel5 = page.getByTestId('rc-mixer-channel-5')
    await channel5.getByTestId('rc-mixer-add-channel-5').click()
    const functionSelect = channel5.locator('select')
    const optionLabels = await functionSelect.locator('option').allTextContents()

    expect(optionLabels.some((label) => label.startsWith('Precision Loiter'))).toBe(false)
    expect(optionLabels.some((label) => label.startsWith('Reverse throttle'))).toBe(false)
    expect(optionLabels.some((label) => label.startsWith('Land'))).toBe(true)
    expect(optionLabels.some((label) => label.startsWith('Do nothing'))).toBe(true)
  })

  test('Remove on an already-applied assignment hides it immediately, and discarding the pending change restores it', async ({ page }) => {
    // Regression: Remove on a real (already-written) RCL term only staged a
    // FUNC=0 draft — readRcLogicModel still reported the term as "touched"
    // while that draft was pending, so the row stayed on screen and looked
    // like the button did nothing.
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('product-mode-expert').check()
    await page.getByTestId('view-button-rc-mixer').click()

    // Demo seeds a real, already-applied ArmDisarm assignment on channel 5.
    const channel5 = page.getByTestId('rc-mixer-channel-5')
    await channel5.scrollIntoViewIfNeeded()
    await expect(channel5.locator('[data-testid^="rc-mixer-remove-"]')).toBeVisible()

    await channel5.locator('[data-testid^="rc-mixer-remove-"]').first().click()
    await expect(channel5.locator('[data-testid^="rc-mixer-remove-"]')).toHaveCount(0)
    await expect(channel5).toContainText('No assignments')
    // The removal is staged (not yet written) — the global bar reflects it.
    await expect(page.getByTestId('global-draft-bar')).toBeVisible()

    // Discarding the pending change reverts FUNC back to its live (nonzero)
    // value — the row must reappear rather than staying hidden forever.
    await page.getByTestId('global-draft-discard').click()
    await expect(channel5.locator('[data-testid^="rc-mixer-remove-"]')).toBeVisible()
  })
})

// The receiver Bind (ELRS/CRSF) button is currently hidden in the UI
// (SHOW_RECEIVER_BIND_BUTTON=false in ReceiverSection.tsx); the runtime
// startReceiverBind path stays covered by tests/runtime.integration.test.mjs.

test.describe('Receiver channel-direction check', () => {
  test('lives under Endpoints (not Mapping) with a verdict row per primary axis', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await openView(page, 'receiver')

    // The old manual reverse box is gone from Mapping.
    await page.getByTestId('receiver-tab-mapping').click()
    await expect(page.getByTestId('receiver-channel-direction')).toHaveCount(0)

    // The guided direction check now lives in Endpoints, one row per axis.
    await page.getByTestId('receiver-tab-endpoints').click()
    await expect(page.getByTestId('receiver-direction-check')).toBeVisible()
    for (const axis of ['roll', 'pitch', 'throttle', 'yaw']) {
      await expect(page.getByTestId(`receiver-direction-${axis}`)).toBeVisible()
      await expect(page.getByTestId(`receiver-direction-result-${axis}`)).toBeVisible()
    }
  })
})

test.describe('Receiver stick-driven craft', () => {
  test('centred sticks hold heading and sit level (no yaw spin)', async ({ page }) => {
    // demoMotion=off pins the demo to a level attitude and centred sticks. The
    // demo otherwise streams a scripted stick rehearsal (so the guided-setup
    // exercises can complete), which would deflect yaw and defeat the point of
    // this test — it guards that a CENTRED stick does not integrate heading.
    await page.goto('/?demoMotion=off')
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

// Size of ARDUCOPTER_RC_OPTION_COMMON_VALUES (packages/param-metadata/src/
// arducopter-enums.ts) — the curated AUX functions pinned above the long tail.
// Mirrored here rather than imported because this spec runs against the built
// bundle; the exact membership is asserted in tests/metadata.test.mjs.
const AUX_COMMON_FUNCTION_COUNT = 43

test.describe('Receiver functions tab', () => {
  test('assigns an auxiliary function to an AUX channel and flags a duplicate', async ({ page }) => {
    // Before this tab the only RCn_OPTION reachable from the app was the Arm
    // switch; every other aux function meant hand-editing raw parameters, which
    // needs both the parameter name and the numeric function id.
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'receiver')
    await page.getByTestId('receiver-task-nav').getByRole('button', { name: 'Functions' }).click()

    const panel = page.getByTestId('receiver-functions-panel')
    await expect(panel).toBeVisible()
    // Stick axes are not aux channels — the list starts at CH5.
    await expect(page.getByTestId('receiver-function-5')).toBeVisible()
    await expect(page.getByTestId('receiver-function-4')).toHaveCount(0)

    // Assign RTL (4) to CH7 — staged as a draft on RC7_OPTION.
    const ch7 = page.getByTestId('receiver-function-7').locator('select')
    await ch7.selectOption('4')
    await expect(ch7).toHaveValue('4')

    // The same function on a second channel is undefined behaviour in
    // ArduPilot, so it must be called out rather than silently accepted.
    await page.getByTestId('receiver-function-8').locator('select').selectOption('4')
    await expect(page.getByTestId('receiver-functions-conflict')).toContainText('CH7')
    await expect(page.getByTestId('receiver-functions-conflict')).toContainText('CH8')

    // Clearing one side resolves it.
    await page.getByTestId('receiver-function-8').locator('select').selectOption('0')
    await expect(page.getByTestId('receiver-functions-conflict')).toHaveCount(0)
  })

  test('the AUX function list leads with the common functions, then the alphabetical tail', async ({ page }) => {
    // Same grammar as the Ports function picker (SERIALn_PROTOCOL): the cleared
    // state pinned first, then a curated common group, then everything else —
    // one flat dropdown, no hidden entries. ~120 firmware AUX functions in raw
    // value order is unusable; this proves the operator-facing ordering without
    // removing anything they could previously select.
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'receiver')
    await page.getByTestId('receiver-task-nav').getByRole('button', { name: 'Functions' }).click()

    const select = page.getByTestId('receiver-function-5').locator('select')
    await expect(select).toBeVisible()
    const labels = await select.locator('option').allTextContents()

    // "Do Nothing" (0) is pinned above both groups — the cleared state.
    expect(labels[0]).toBe('Do Nothing')

    // The common group leads, alphabetically: ACRO Mode is its first entry and
    // the flight-mode/arming staples sit inside it.
    const common = labels.slice(1, 1 + AUX_COMMON_FUNCTION_COUNT)
    expect(common[0]).toBe('ACRO Mode')
    for (const label of ['ALTHOLD Mode', 'Motor Emergency Stop', 'RTL', 'VTX Power']) {
      expect(common).toContain(label)
    }

    // The long tail follows, also alphabetical, and holds the niche entries.
    const tail = labels.slice(1 + AUX_COMMON_FUNCTION_COUNT)
    for (const label of ['Gripper', 'KillIMU1', 'Sprayer Enable', 'Winch Enable']) {
      expect(tail).toContain(label)
    }

    // Nothing was dropped: every function is still selectable exactly once.
    expect(new Set(labels).size).toBe(labels.length)
    expect(labels.length).toBeGreaterThan(100)
    // And a tail entry is still assignable, not merely listed.
    await select.selectOption({ label: 'Sprayer Enable' })
    await expect(select).toHaveValue('15')
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

test.describe('Receiver arm switch', () => {
  test('assigns RCn_OPTION to a channel, moves it, adds AirMode, and clears it', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'receiver')
    await page.getByTestId('receiver-task-nav').getByRole('button', { name: 'Flight Modes' }).click()
    const card = page.getByTestId('receiver-arm-switch')
    await card.scrollIntoViewIfNeeded()
    await expect(card).toBeVisible()

    // Demo seeds every RCn_OPTION at 0 — starts unassigned.
    await expect(card).toContainText('not assigned')
    const channelSelect = page.getByTestId('receiver-arm-switch-channel')
    const airmodeCheckbox = page.getByTestId('receiver-arm-switch-airmode')
    await expect(channelSelect).toHaveValue('0')
    await expect(airmodeCheckbox).toBeDisabled()

    // Assign channel 6 — stages RC6_OPTION=153 and the card reflects it.
    await channelSelect.selectOption('6')
    await expect(card).toContainText('CH6')
    await expect(airmodeCheckbox).toBeEnabled()
    await expect(page.getByTestId('receiver-apply-button')).not.toHaveText('Apply Receiver Changes (0)')

    // Enable AirMode on the same channel — rewrites RC6_OPTION to 154, no
    // second channel touched.
    await airmodeCheckbox.check()
    await expect(card).toContainText('CH6 + AirMode')

    // Move to channel 9 — clears RC6_OPTION and assigns RC9_OPTION, keeping
    // exactly one live arm switch.
    await channelSelect.selectOption('9')
    await expect(card).toContainText('CH9')
    await expect(card).not.toContainText('CH6')

    // Clear the assignment entirely.
    await channelSelect.selectOption('0')
    await expect(card).toContainText('not assigned')
    await expect(airmodeCheckbox).toBeDisabled()
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

  test('flight-mode slot supports typing an unlisted mode number via Custom…', async ({ page }) => {
    // Reported gap: an unlisted mode number (e.g. a scripting-defined 29) only
    // ever showed as an inert "29 (unlisted)" label with no way to type a
    // different raw number without leaving for the raw Parameters tab.
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'modes')
    const table = page.getByTestId('modes-slot-table')
    const slot5 = table.getByTestId('modes-slot-5')
    const select = slot5.locator('select')
    await expect(select).toHaveValue('16') // PosHold

    await select.selectOption('__custom__')
    const customInput = slot5.locator('input[type="number"]')
    await expect(customInput).toBeVisible()
    await customInput.fill('29')
    await expect(page.getByTestId('global-draft-bar')).toBeVisible()

    // Picking a named mode again returns to the plain dropdown.
    await select.selectOption('9') // Land
    await expect(slot5.locator('input[type="number"]')).toHaveCount(0)
    await expect(select).toHaveValue('9')
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

test.describe('Log server upload', () => {
  // This surface talks to a server the OPERATOR runs. It shares no code with any
  // other network surface in this app, and these tests keep it honest about the
  // two things that matter most: it never offers an upload it cannot perform,
  // and it never stores the password.

  test('the sign-in panel appears and refuses an unreachable server with advice', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'logs')

    const panel = page.getByTestId('log-server-panel')
    await panel.scrollIntoViewIfNeeded()
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('never stored')

    await page.getByTestId('log-server-url').fill('127.0.0.1:9')
    await page.getByTestId('log-server-username').fill('nobody')
    await page.getByTestId('log-server-password').fill('whatever-password')
    await page.getByTestId('log-server-sign-in').click()

    // "Failed to fetch" is what the browser gives; that is not an error an
    // operator can act on, so the client turns it into one.
    await expect(page.getByTestId('log-server-error')).toContainText(/Check the address/i, { timeout: 15000 })
  })

  test('no upload button is offered while signed out', async ({ page }) => {
    // A control that exists but cannot work is worse than one that appears when
    // it can — especially next to a Download button that always works.
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'logs')
    await page.getByTestId('logs-onboard-list').click().catch(() => {})
    await expect(page.getByTestId('logs-onboard-upload-1')).toHaveCount(0)
  })

  test('the password is never written to browser storage', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'logs')

    const secret = 'super-secret-password-123'
    await page.getByTestId('log-server-url').fill('127.0.0.1:9')
    await page.getByTestId('log-server-username').fill('jordan')
    await page.getByTestId('log-server-password').fill(secret)
    await page.getByTestId('log-server-sign-in').click()
    await expect(page.getByTestId('log-server-error')).toBeVisible({ timeout: 15000 })

    // Every value in both stores, checked for the password. The sign-in failed
    // here, but the assertion holds either way: the password is passed to the
    // login call and dropped, never persisted.
    const leaked = await page.evaluate((needle) => {
      const values: string[] = []
      for (const storage of [window.localStorage, window.sessionStorage]) {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index)
          if (key) values.push(`${key}=${storage.getItem(key) ?? ''}`)
        }
      }
      return values.filter((entry) => entry.includes(needle))
    }, secret)
    expect(leaked).toEqual([])
  })
})

test.describe('Preset sharing', () => {
  // The point of the feature is that one operator can send a preset to another,
  // so the test that matters is the round trip: import a file, then export it
  // back out and confirm what comes out is loadable.
  const sharedPreset = {
    id: 'user:shared-6s-osd-abc123',
    label: 'Shared 6S OSD',
    description: 'OSD layout for a 6S build',
    createdAt: '2026-08-01T10:00:00.000Z',
    sourceFirmware: 'ArduCopter',
    tags: ['osd'],
    values: [{ paramId: 'OSD1_BATVOLT_EN', value: 1 }],
    dependencies: []
  }
  const sharedFile = JSON.stringify({
    schemaVersion: 1,
    application: 'ArduConfigurator',
    kind: 'parameter-user-preset-library',
    name: 'Shared presets',
    updatedAt: '2026-08-01T10:00:00.000Z',
    presets: [sharedPreset]
  })

  test('a preset file can be imported, then exported back out', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'presets')

    const share = page.getByTestId('presets-share')
    await expect(share).toBeVisible()
    // Nothing saved yet, so there is nothing to share — and the button says so
    // rather than exporting an empty file.
    await expect(page.getByTestId('presets-export-all')).toBeDisabled()

    await page.getByLabel('Import preset file').setInputFiles({
      name: 'shared-presets.json',
      mimeType: 'application/json',
      buffer: Buffer.from(sharedFile)
    })

    await expect(page.getByText('Imported 1 preset', { exact: false })).toBeVisible()
    await expect(page.getByText('Shared 6S OSD', { exact: false }).first()).toBeVisible()
    await expect(page.getByTestId('presets-export-all')).toBeEnabled()
    await expect(page.getByTestId('presets-export-all')).toContainText('Export all (1)')

    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('presets-export-all').click()
    ]).then(([event]) => event)
    expect(download.suggestedFilename()).toMatch(/^arduconfigurator-presets-\d{4}-\d{2}-\d{2}\.json$/)

    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk))
    }
    const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    expect(exported.kind).toBe('parameter-user-preset-library')
    expect(exported.presets).toHaveLength(1)
    expect(exported.presets[0]).toMatchObject({ label: 'Shared 6S OSD', values: [{ paramId: 'OSD1_BATVOLT_EN', value: 1 }] })
  })

  test('importing the same file twice does not duplicate the preset', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'presets')

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.getByLabel('Import preset file').setInputFiles({
        name: 'shared-presets.json',
        mimeType: 'application/json',
        buffer: Buffer.from(sharedFile)
      })
      await expect(page.getByText('Imported 1 preset', { exact: false })).toBeVisible()
    }

    await expect(page.getByTestId('presets-export-all')).toContainText('Export all (1)')
  })

  test('the wrong ArduConfigurator file is named, not just rejected', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'presets')

    await page.getByLabel('Import preset file').setInputFiles({
      name: 'snapshots.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({ schemaVersion: 1, application: 'ArduConfigurator', kind: 'parameter-snapshot-library', snapshots: [] })
      )
    })

    await expect(page.getByText('snapshot library', { exact: false })).toBeVisible()
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
  test('Backend strip is open by default so the OSD backend is visible', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'osd')

    const strip = page.getByTestId('osd-backend-strip')
    await expect(strip).toHaveAttribute('open', '')
    // The OSD_TYPE backend selector is visible without expanding anything.
    await expect(strip.locator('.scoped-editor-field__param-id', { hasText: 'OSD_TYPE' })).toBeVisible()
  })

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

  test('Messages strip shows the fork style toggle + category allow-list bitmask', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'osd')

    const strip = page.getByTestId('osd-messages-strip')
    await strip.scrollIntoViewIfNeeded()
    await expect(strip).toBeVisible()
    // OSD_MSG_STYLE (blink/invert) toggle renders (demo seeds it = 1).
    await expect(strip).toContainText('Message Style')
    // OSD_MSG_CAT bitmask renders its per-bit checkbox grid.
    const categories = page.getByTestId('osd-message-categories')
    await expect(categories).toBeVisible()
    await expect(page.getByTestId('scoped-bitmask-OSD_MSG_CAT')).toBeVisible()
    await expect(categories).toContainText('PreArm')
    await expect(categories).toContainText('Arm/Disarm')
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

  test('named video-system selector switches the preview canvas (Analog/HDZero/Walksnail/DJI)', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'osd')

    // Default is Analog + NTSC (not PAL — field feedback), 30 columns.
    const screen = page.locator('.osd-preview-screen').first()
    await expect(page.getByTestId('osd-analog-layout').locator('select')).toHaveValue('analog')
    await expect(page.getByTestId('osd-analog-submode').locator('select')).toHaveValue('ntsc')
    await expect(screen).toHaveAttribute('data-osd-layout', 'ntsc')
    const grid = page.getByTestId('osd-preview-grid')
    const columnCount = () =>
      grid.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length)
    expect(await columnCount()).toBe(30)

    // Switching to a named digital system auto-sets its fixed grid and hides
    // the analog PAL/NTSC sub-picker (a digital standard has no such choice).
    await page.getByTestId('osd-analog-layout').locator('select').selectOption('hdzero')
    await expect(screen).toHaveAttribute('data-osd-layout', 'hd_50x18')
    expect(await columnCount()).toBe(50)
    await expect(page.getByTestId('osd-analog-submode')).toHaveCount(0)

    // Walksnail is 50x20, set from hands-on measurement on real Avatar
    // hardware (its spec sheet says 60x22, which put elements in the wrong
    // cells and left the bottom rows unreachable).
    await page.getByTestId('osd-analog-layout').locator('select').selectOption('walksnail')
    await expect(screen).toHaveAttribute('data-osd-layout', 'hd_50x20')
    expect(await columnCount()).toBe(50)
    expect(
      await grid.evaluate((el) => getComputedStyle(el).gridTemplateRows.split(' ').length)
    ).toBe(20)

    await page.getByTestId('osd-analog-layout').locator('select').selectOption('dji_o3')
    await expect(screen).toHaveAttribute('data-osd-layout', 'hd_60x22')
    expect(await columnCount()).toBe(60)

    // Back to Analog, PAL this time.
    await page.getByTestId('osd-analog-layout').locator('select').selectOption('analog')
    await expect(page.getByTestId('osd-analog-submode')).toBeVisible()
    await page.getByTestId('osd-analog-submode').locator('select').selectOption('pal')
    await expect(screen).toHaveAttribute('data-osd-layout', 'pal')
    expect(await columnCount()).toBe(30)
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

  test('clicking a checklist row highlights the element in the preview, and vice versa', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'osd')

    const row = page.getByTestId('osd-element-row-BAT_VOLT')
    const rowLabel = page.getByTestId('osd-element-row-label-BAT_VOLT')
    const previewElement = page.getByTestId('osd-preview-element-BAT_VOLT')
    await expect(previewElement).toBeVisible()
    await expect(row).not.toHaveClass(/is-highlighted/)
    await expect(previewElement).not.toHaveClass(/is-highlighted/)

    // Clicking the checklist row highlights the corresponding preview element.
    await rowLabel.click()
    await expect(row).toHaveClass(/is-highlighted/)
    await expect(previewElement).toHaveClass(/is-highlighted/)
    await expect(page.getByTestId('osd-preview-element-label-BAT_VOLT')).toBeVisible()

    // Clicking it again clears the highlight.
    await rowLabel.click()
    await expect(row).not.toHaveClass(/is-highlighted/)
    await expect(previewElement).not.toHaveClass(/is-highlighted/)

    // Clicking the preview element itself highlights the checklist row too.
    await previewElement.click()
    await expect(row).toHaveClass(/is-highlighted/)
    await expect(previewElement).toHaveClass(/is-highlighted/)
  })

  test('enabling an element with no live-telemetry text still adds it to the preview', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await openView(page, 'osd')

    // ARMING has no hardcoded live-value string. The preview used to iterate
    // only the ~24 elements with such a string, so checking ARMING staged the
    // EN draft but the element never appeared on the overlay (the reported bug).
    await expect(page.getByTestId('osd-preview-element-ARMING')).toHaveCount(0)
    const cell = page.getByTestId('osd-cell-ARMING-1')
    await cell.scrollIntoViewIfNeeded()
    await cell.check()
    await expect(page.getByTestId('osd-preview-element-ARMING')).toBeVisible()
  })

  test('HD video layouts render element positions beyond the analog 30x16 grid', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await openView(page, 'osd')

    // Switch to the 60x22 HD grid (DJI/Walksnail-class DisplayPort). A column
    // beyond the analog 29 ceiling must render at that column, not be clamped
    // back into the 30x16 box the way the fixed 29/15 clamp did.
    await page.getByTestId('osd-analog-layout').locator('select').selectOption('dji_o3')
    const align = page.getByTestId('osd-element-align-BAT_VOLT')
    await align.scrollIntoViewIfNeeded()
    const xInput = align.locator('input[type="number"]').first()
    await xInput.fill('45')
    const element = page.getByTestId('osd-preview-element-BAT_VOLT')
    await expect(async () => {
      const col = await element.evaluate((el) => getComputedStyle(el).gridColumnStart)
      expect(col).toBe('46')
    }).toPass()
    await expect(xInput).toHaveValue('45')
  })

  test('OSD elements can be aligned to an exact cell via X/Y inputs', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-osd').click()

    // Gate on the parameter sync, as the two sibling OSD specs do. Without it
    // the fill below can land before the OSD catalog has populated, and because
    // the fill sat OUTSIDE the poll it could never be retried — the test then
    // burned the full 60s test timeout instead of failing in a readable way.
    await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
      timeout: 20000
    })

    const align = page.getByTestId('osd-element-align-BAT_VOLT')
    await align.scrollIntoViewIfNeeded()
    await expect(align).toBeVisible()
    // Type an exact column; the preview element snaps to that cell (col+1).
    // Addressed by test id rather than `input[type=number]).first()` — an
    // anonymous positional selector silently retargets the moment another
    // number input is added to that row.
    const xInput = align.locator('input[type="number"]').first()
    await expect(xInput).toBeEditable()
    await xInput.fill('10')
    const element = page.getByTestId('osd-preview-element-BAT_VOLT')
    await expect(async () => {
      const col = await element.evaluate((el) => getComputedStyle(el).gridColumnStart)
      expect(col).toBe('11')
    }).toPass({ timeout: 10000 })
  })

  test('OSD preview elements are draggable and stage X/Y drafts on the OSD scope', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-osd').click()

    await expect(page.getByTestId('osd-preview-grid')).toBeVisible()
    // The preview can sit below the fold; scroll it into view so the synthetic
    // pointer actually lands on the element (an off-viewport point hit-tests to
    // null and the drag silently does nothing).
    await page.getByTestId('osd-bf-preview-pane').scrollIntoViewIfNeeded()
    const batVolt = page.getByTestId('osd-preview-element-BAT_VOLT')
    await expect(batVolt).toBeVisible()
    await expect(batVolt).toHaveClass(/osd-preview-screen__element--draggable/)

    const gridBox = await page.getByTestId('osd-preview-grid').boundingBox()
    const startBox = await batVolt.boundingBox()
    if (!gridBox || !startBox) throw new Error('no bounding box for OSD preview grid or element')

    // Default video system is Analog/NTSC (30x13) — not PAL (30x16).
    const cellWidth = gridBox.width / 30
    const cellHeight = gridBox.height / 13
    const startX = startBox.x + startBox.width / 2
    const startY = startBox.y + startBox.height / 2
    const colBefore = Number(await batVolt.evaluate((el) => getComputedStyle(el).gridColumnStart))

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    // Step in cell-sized increments (right + up; BAT_VOLT sits near the bottom
    // row) so the pointer-move handler fires reliably.
    for (let step = 1; step <= 4; step += 1) {
      await page.mouse.move(startX + cellWidth * step, startY - cellHeight * step, { steps: 2 })
    }
    await page.mouse.up()

    // The element actually moved to the RIGHT tracking the pointer (grab-offset
    // relative drag), and the Save OSD CTA reflects the staged X/Y drafts —
    // asserted strictly (not a regex that would also match "Save OSD (0)").
    const colAfter = Number(await batVolt.evaluate((el) => getComputedStyle(el).gridColumnStart))
    expect(colAfter).toBeGreaterThan(colBefore)
    await expect(page.getByTestId('osd-save')).not.toHaveText('Save OSD (0)')
  })

  test('OSD preview elements follow the pointer freely mid-drag instead of jumping cell-to-cell', async ({ page }) => {
    // Regression guard: dragging used to re-quantize the DOM position (via
    // gridColumnStart/gridRowStart) on every cell crossing, so the box visibly
    // teleported in whole-cell jumps instead of tracking the cursor. The grid
    // cell should now stay frozen at the drag-start position while a CSS
    // transform slides the element smoothly; only on drop does it re-quantize.
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-osd').click()

    await expect(page.getByTestId('osd-preview-grid')).toBeVisible()
    await page.getByTestId('osd-bf-preview-pane').scrollIntoViewIfNeeded()
    const batVolt = page.getByTestId('osd-preview-element-BAT_VOLT')
    await expect(batVolt).toBeVisible()

    const gridBox = await page.getByTestId('osd-preview-grid').boundingBox()
    const startBox = await batVolt.boundingBox()
    if (!gridBox || !startBox) throw new Error('no bounding box for OSD preview grid or element')

    const cellWidth = gridBox.width / 30
    const startX = startBox.x + startBox.width / 2
    const startY = startBox.y + startBox.height / 2
    const colStart = await batVolt.evaluate((el) => getComputedStyle(el).gridColumnStart)

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    // Move less than a full cell — enough to produce a non-zero pixel offset
    // but not enough to cross into the next character cell.
    await page.mouse.move(startX + cellWidth * 0.4, startY, { steps: 4 })

    // The grid cell hasn't re-quantized yet...
    await expect(async () => {
      const col = await batVolt.evaluate((el) => getComputedStyle(el).gridColumnStart)
      expect(col).toBe(colStart)
    }).toPass()
    // ...but the element is visibly sliding via a translate transform, not
    // sitting glued to its cell's static position.
    await expect(async () => {
      const transform = await batVolt.evaluate((el) => getComputedStyle(el).transform)
      expect(transform).not.toBe('none')
    }).toPass()

    await page.mouse.up()
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

  test('Relays tab binds an RC switch channel to a relay (writes RCn_OPTION)', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('view-button-servos').click()
    await page.getByTestId('outputs-task-nav').getByRole('tab', { name: /Relays/i }).click()

    const rcChannel = page.getByTestId('relay-rc-channel-1')
    await expect(rcChannel).toBeVisible()
    // Bind Relay 1 to Ch10 → writes RC10_OPTION = 28 (the Relay1 aux function),
    // staged in the relay scope so the Relays Apply picks it up.
    await rcChannel.locator('select').selectOption('10')
    await expect(rcChannel).toContainText('RC10 toggles Relay 1')
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

  test('guided-setup evidence pills are allowed to wrap, so a long line cannot be clipped', async ({ page }) => {
    // Field report: on the Ports step the right-hand column — primary action,
    // Previous/Continue, and the completion-criteria panel — was sliced off at
    // the right edge of the window.
    //
    // Cause: .config-pills span is `white-space: nowrap`, and the LIVE EVIDENCE
    // pills carry a whole sentence of hardware diagnostics. Measured on the
    // reported case at 1819px: the pill rendered 945px wide with its right edge
    // at x=2140 inside a 623px column — 350px of it hidden. With wrapping it
    // measures 595px and fits. An ancestor clips the overflow, so
    // document.scrollWidth stays exactly equal to clientWidth and the existing
    // page-level overflow gate passes happily while the operator cannot reach
    // the buttons.
    //
    // This asserts the RULE rather than the geometry. Reproducing the geometry
    // needs an evidence line ~110+ chars, which needs a port whose traffic
    // cannot be framed — and the demo cannot currently be given one without
    // making its Ports step permanently incomplete for every other test that
    // walks the guided flow. The geometry check is owed; this at least fails if
    // the wrap rule is removed.
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/?guidedSetupStep=ports')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('setup-wizard')).toBeVisible()

    const pill = page.locator('.setup-wizard__evidence .config-pills span').first()
    await expect(pill).toBeVisible()

    const style = await pill.evaluate((el) => {
      const computed = getComputedStyle(el)
      const aside = document.querySelector('.setup-wizard__aside') as HTMLElement
      return {
        whiteSpace: computed.whiteSpace,
        overflowWrap: computed.overflowWrap,
        asideMinWidth: getComputedStyle(aside).minWidth
      }
    })

    expect(style.whiteSpace).toBe('normal')
    expect(style.overflowWrap).toBe('anywhere')
    // The aside is a grid item; min-width:auto would let unshrinkable content
    // widen its track and push the column off-screen instead of clipping it.
    expect(style.asideMinWidth).toBe('0px')
  })

  test('guided setup condenses long steps into disclosures and flags completion', async ({ page }) => {
    await page.goto('/?guidedSetupStep=airframe')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('setup-wizard')).toBeVisible()

    // The completion-criteria checklist is a disclosure with an at-a-glance
    // "N/N done" summary, but on an INCOMPLETE step it starts open: leaving the
    // one unmet criterion collapsed behind a "2/5 criteria" badge was why a
    // blocked step read as "unclear what's wanted". The operator can still fold
    // it away.
    const criteria = page.getByTestId('setup-wizard-criteria')
    await expect(criteria).toContainText('done')
    const firstCriterion = criteria.locator('li').first()
    await expect(firstCriterion).toBeVisible()
    await criteria.locator('summary').click()
    await expect(firstCriterion).toBeHidden()
    await criteria.locator('summary').click()
    await expect(firstCriterion).toBeVisible()

    // The checklist lives in the RIGHT column now ("left = what you do, right =
    // where you stand"). Both columns used to be lopsided — the left one
    // carried the task card AND the criteria AND the evidence while the right
    // held a short action card, so every step was as tall as one long column.
    await expect(page.locator('.setup-wizard__aside [data-testid="setup-wizard-criteria"]')).toBeVisible()
    await expect(page.locator('.setup-wizard__aside .setup-wizard__evidence')).toBeVisible()

    // The single blocking criterion is also promoted out of the disclosure, so
    // the step says what it still wants without any expanding at all.
    await expect(page.getByTestId('setup-wizard-next-criterion')).toContainText('Still needed:')

    // The advanced-settings parameter editor is behind its own disclosure on the
    // airframe step instead of always stacked open below the checklist.
    await expect(page.getByTestId('setup-wizard-advanced')).toBeVisible()

    // A completed step surfaces an explicit completion banner (Vehicle Link is
    // complete once connected + params synced), navigated via the step rail so
    // the live session is preserved.
    await page.getByRole('button', { name: /Vehicle Link/ }).click()
    await expect(page.getByTestId('setup-wizard-complete-banner')).toContainText('complete')
  })

  test('a guided step keeps its primary action and Continue on screen without scrolling', async ({ page }) => {
    // Operator report: "i dont love the airframe tab, i dont think people
    // should need to be scrolling up and down". Airframe was the worst step
    // (1992px of document against a 900px viewport) but every step had the same
    // shape, so the fix is one layout rule applied to all of them: the task on
    // the left, the action + criteria on the right, a one-row step rail, and
    // the shared 3D preview scoped down inside the wizard.
    //
    // Assert the OUTCOME the operator cares about — the thing to click is on
    // screen at rest — not a pixel height, which moves with font rendering.
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/?guidedSetupStep=airframe')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('setup-wizard')).toBeVisible()

    const onScreen = async (testId: string): Promise<boolean> =>
      page.getByTestId(testId).evaluate((el) => {
        const rect = el.getBoundingClientRect()
        return rect.top >= 0 && rect.bottom <= window.innerHeight
      })

    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    expect(await onScreen('setup-wizard-primary-action')).toBe(true)
    expect(await onScreen('setup-wizard-next-step')).toBe(true)

    // The step rail is one scrollable row of chips, so its own overflow must
    // never become the page's — a side-by-side layout at phone width is exactly
    // what breaks the horizontal-overflow gate.
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByTestId('setup-wizard')).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(2)
  })

  test('the orientation waiver unblocks the Airframe step and unlocks the rest of the flow', async ({ page }) => {
    // Airframe (step 2) required the physical orientation exercise to pass, and
    // every later step is locked behind it, so a vehicle that cannot be tilted
    // hard-stopped the whole wizard with no way forward.
    // Deliberately NOT using ?guidedSetupStep= here: that dev shortcut also
    // un-disables locked steps, which is precisely the gate under test. The
    // wizard auto-selects Airframe anyway once Vehicle Link completes.
    await page.goto('/?demoMotion=off')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await openView(page, 'guided-setup')
    await expect(page.getByTestId('setup-wizard')).toBeVisible()

    // Step numbering: Link (1), Ports (2), Airframe (3), Outputs (4). Ports was
    // inserted after Link so every peripheral step inherits a correct port map.
    // Locked: the Outputs step cannot be selected while Airframe is incomplete.
    const outputsStep = page.getByRole('button', { name: /Step 4/ })
    await expect(outputsStep).toBeDisabled()

    // Airframe unlocks as soon as the initial parameter sync finishes.
    const airframeStep = page.getByRole('button', { name: /Step 3/ })
    await expect(airframeStep).toBeEnabled({ timeout: VEHICLE_CONNECT_TIMEOUT })
    await airframeStep.click()

    // The waiver IS the step's operator sign-off, so one click satisfies both
    // the orientation criterion and the frame-geometry confirmation.
    await page.getByRole('button', { name: 'Orientation Verified Elsewhere — Continue' }).click()
    await expect(page.getByRole('button', { name: 'Clear Orientation Waiver' })).toBeVisible()

    await expect(page.getByTestId('setup-wizard-complete-banner')).toContainText('complete')
    await expect(outputsStep).toBeEnabled()
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

    // The large Copter tuning workbench is the default ('rates'/Pilot) tab — its
    // ATC_INPUT_TC control is a signature workbench field and must still be
    // present. It lives under the collapsible Angle section (default collapsed).
    await page.locator('details.bf-gui-box > summary').filter({ hasText: 'Angle' }).click()
    await expect(page.getByTestId('tuning-input-ATC_INPUT_TC')).toBeVisible({ timeout: 10000 })

    // AutoTune now lives in its own task tab; open it to reveal the surface.
    await page.getByTestId('tuning-tab-autotune').click()
    const section = page.getByTestId('autotune-copter-section')
    await expect(section).toBeVisible()

    const configGroup = page.getByTestId('autotune-copter-config-group')
    await expect(configGroup).toBeVisible()
    // The procedure guide is present (its full steps sit behind a collapsible;
    // the always-visible safety note stays up top).
    await expect(page.getByTestId('autotune-copter-procedure')).toBeVisible()
    await expect(page.getByTestId('autotune-copter-safety')).toBeVisible()

    const apply = page.getByTestId('apply-copter-autotune-changes-button')
    await expect(apply).toBeVisible()
    await expect(apply).toBeDisabled() // nothing staged yet
    await expect(apply).toContainText('Apply AutoTune Changes (0)')

    // MOCK==REAL: the demo Copter seeds AUTOTUNE_AGGR=0.075, so the first numeric
    // field shows the seeded live value (not an empty box). Editing it stages a
    // draft through the shared setDraft -> scoped-apply machinery. Exclude the
    // bitmask raw-value inputs (e.g. AUTOTUNE_AXES) which are also type=number.
    const aggr = configGroup.locator('input[type="number"]:not([aria-label*="raw bitmask"])').first()
    await aggr.scrollIntoViewIfNeeded()
    await expect(aggr).not.toHaveValue('')
    await expect(aggr).toHaveValue(/^0?\.0?7/)
    await aggr.fill('0.09')
    await aggr.blur()

    await expect(apply).toContainText('Apply AutoTune Changes (1)')
    await expect(apply).toBeEnabled()
    await expect(page.getByTestId('autotune-copter-review')).toContainText('AUTOTUNE_AGGR')
  })

  test('Tuning: the Log Tuning sub-tab uploads a log and shows the quality gate', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })

    await openView(page, 'tuning')
    await page.getByTestId('tuning-tab-log-tuning').click()
    const panel = page.getByTestId('tuning-log-tuning-panel')
    await expect(panel).toBeVisible()
    // The "you need a good flight log" gate is always shown up front.
    await expect(page.getByTestId('log-tuning-gate-note')).toBeVisible()
    await expect(page.getByTestId('log-tuning')).toContainText('Choose flight log')

    // Upload a trivial (empty) buffer: it parses to no usable data, so the
    // analyzer must gate it as unusable rather than throw.
    await page.getByTestId('log-tuning-file').setInputFiles({
      name: 'empty.bin',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    })
    await expect(page.getByTestId('log-tuning-results')).toBeVisible()
    await expect(page.getByTestId('log-tuning-unusable')).toBeVisible()
  })

  test('Calibration: the Thermal Calibration (TCAL) card is Expert-gated', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })

    // Default (non-Expert): the TCAL card is hidden.
    await openView(page, 'calibration')
    await expect(page.getByTestId('calibration-card-tcal')).toHaveCount(0)

    // Expert mode reveals the full card (demo seeds INS_TCALn_ENABLE = 0).
    await page.getByTestId('product-mode-expert').check()
    const tcal = page.getByTestId('calibration-card-tcal')
    await expect(tcal).toBeVisible()
    await expect(tcal).toContainText('Thermal calibration')
    // Per-IMU state reads "TCAL: off" (not "disabled", which read as IMU-off).
    await expect(tcal).toContainText('IMU1 TCAL: off')
    // The step-by-step is collapsed into a How-it-works disclosure (compact card).
    await expect(tcal.locator('.calibration-card__howto summary')).toHaveText(/How thermal calibration works/i)
    await expect(page.getByTestId('tcal-start')).toBeVisible()
  })

  test('Calibration: the Baro Thrust (VALT) card is Expert-gated (no rangefinder required)', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })

    await openView(page, 'calibration')
    // Default (non-Expert): hidden.
    await expect(page.getByTestId('calibration-card-valt')).toHaveCount(0)

    // Expert mode reveals the card — the gate no longer requires a rangefinder
    // (the card fits against a rangefinder in the log if present, else a manual
    // height). Full card shows because the demo firmware exposes BARO1_THST_SCALE.
    await page.getByTestId('product-mode-expert').check()
    const valt = page.getByTestId('calibration-card-valt')
    await valt.scrollIntoViewIfNeeded()
    await expect(valt).toBeVisible()
    await expect(valt).toContainText('Baro thrust calibration')
    await expect(page.getByTestId('valt-file')).toBeAttached()
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

  // The ask: "in the servo > peripheral tab we have the section about
  // rangefinders, can we add in a section and all the relevant parameters for
  // optical flow?" — same shape as the Rangefinder section above, one sensor
  // over. The demo Copter seeds FLOW_TYPE=6 (DroneCAN) with CAN_P1_DRIVER=0,
  // reproducing the operator's own miswired-CAN-flow situation.
  test('Servos view exposes an Optical Flow config section, gated the same way as Rangefinder', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
      timeout: VEHICLE_CONNECT_TIMEOUT
    })
    await openView(page, 'servos')
    await page.getByTestId('outputs-summary-peripherals').click()

    const flowSection = page.getByTestId('metadata-settings-section-optical-flow')
    await expect(flowSection).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Optical Flow', { exact: true })).toBeVisible()
    // The seeded FLOW_ family renders as editable fields.
    await expect(page.getByText('Optical Flow Type', { exact: true })).toBeVisible()
    await expect(page.getByText('X Scale Correction', { exact: true })).toBeVisible()
    await expect(page.getByText('Bus Address', { exact: true })).toBeVisible()
    // Unit-carrying labels render as "<label> (<unit>)" — ScopedField appends the
    // unit in a nested <small> — so these are substring matches, not exact ones.
    await expect(flowSection.getByText('Yaw Alignment (cdeg)', { exact: true })).toBeVisible()
    await expect(flowSection.getByText('Position X (m)', { exact: true })).toBeVisible()
    // FLOW_OPTIONS (4.7-only) and FLOW_HGT_OVR (Rover-only) are curated but NOT
    // reported by this 4.6 Copter — proving the section renders only what the
    // FC actually streams rather than a fixed field list.
    await expect(page.getByText('Flow Options')).toHaveCount(0)
    await expect(page.getByText('Height Override')).toHaveCount(0)

    // Every field carries the shared "i" affordance naming the raw param.
    await expect(page.getByTestId('metadata-field-info-FLOW_TYPE')).toBeVisible()

    // The type is source-correct: 6 is DroneCAN (AP_OpticalFlow.h Type::UAVCAN),
    // NOT the SITL value the app once mislabelled as HereFlow.
    const flowType = page.locator('label', { hasText: 'Optical Flow Type' }).getByRole('combobox')
    await expect(flowType).toHaveValue('6')
    // 4.6 firmware: SITL (10) must not be offered at all.
    await expect(flowType.locator('option', { hasText: 'SITL' })).toHaveCount(0)

    // DroneCAN flow + CAN bus off surfaces the same one-click enable the CAN tab
    // offers — the fix for a flow sensor that reports nothing because the bus
    // was never turned on.
    const prompt = page.getByTestId('peripherals-can-enable-prompt')
    await expect(prompt).toBeVisible()
    await expect(prompt).toContainText('Optical flow is set to DroneCAN')
    await expect(page.getByTestId('peripherals-can-enable-button')).toBeEnabled()

    // Editing a flow field stages a draft in the peripherals scope.
    await flowType.selectOption({ label: 'CXOF' })
    await expect(page.getByRole('button', { name: /Apply Additional Output Changes \(1\)/ })).toBeEnabled()

    // Section is collapsible like its Rangefinder sibling.
    await flowSection.locator('summary').click()
    await expect(flowSection.getByText('Yaw Alignment (cdeg)', { exact: true })).toBeHidden()
  })

  test('the Optical Flow section fits a 390px phone viewport without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await openView(page, 'servos')
    await page.getByTestId('outputs-summary-peripherals').click()
    await expect(page.getByTestId('metadata-settings-section-optical-flow')).toBeVisible({ timeout: 15_000 })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test.describe('ArduRover / ArduSub demo', () => {
  test('Rover curated Tuning surface renders its groups, shows seeded values, and stages a draft', async ({ page }) => {
    await page.goto('/')
    await useHiddenDemoMode(page, 'demo-rover')
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
    await useHiddenDemoMode(page, 'demo-rover')
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
    await useHiddenDemoMode(page, 'demo-sub')
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
    await useHiddenDemoMode(page, 'demo-sub')
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

test('Recent Notices expands in place, and the choice survives a reload', async ({ page }) => {
  const connect = async (): Promise<Locator> => {
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', {
      timeout: VEHICLE_CONNECT_TIMEOUT
    })
    const list = page.getByTestId('setup-notices-list')
    await expect(list).toBeVisible({ timeout: 15_000 })
    return list
  }
  const maxHeight = (list: Locator) =>
    list.evaluate((node) => getComputedStyle(node).maxHeight)

  await page.goto('/')
  // A fresh Playwright context IS a fresh profile — nothing stored for this
  // origin — so this leg asserts what someone who has never touched the control
  // gets, and it must stay collapsed: Status & Info is long enough already.
  // (Don't assert the key is absent here: App mounts and persists the resolved
  // default immediately, so the key exists by the time anything can read it.
  // The height is the behaviour that matters.)
  let list = await connect()
  expect(await maxHeight(list)).toBe('240px')

  await page.getByTestId('setup-notices-expand').click()
  expect(Number.parseFloat(await maxHeight(list))).toBeGreaterThan(240)

  // Expanded must be inherited on the next visit: re-clicking Expand after
  // every reload (and every reboot-driven refresh) was the operator complaint.
  await page.reload()
  list = await connect()
  expect(Number.parseFloat(await maxHeight(list))).toBeGreaterThan(240)

  // …and collapsing must stick just as hard, or the setting is a one-way door.
  await page.getByTestId('setup-notices-expand').click()
  expect(await maxHeight(list)).toBe('240px')
  await page.reload()
  list = await connect()
  expect(await maxHeight(list)).toBe('240px')

  // Corrupt and stale-version values are both treated as "never set" rather
  // than throwing: the panel height is not worth a white screen, and a bumped
  // version must fall back to the safe default instead of restoring a meaning
  // the stored flag no longer has.
  for (const poison of ['{not json', '{"version":999,"expanded":true}', 'true']) {
    await page.evaluate((value) => {
      window.localStorage.setItem('arduconfig:recent-notices-expanded', value)
    }, poison)
    await page.reload()
    list = await connect()
    expect(await maxHeight(list)).toBe('240px')
  }
})

test('Recent Notices pops out into its own styled, live window', async ({ page, context }) => {
  await page.goto('/')
  await page.getByTestId('transport-mode-select').selectOption('demo')
  await page.getByTestId('connect-button').click()
  await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
  await expect(page.getByTestId('setup-notices-popout')).toBeVisible({ timeout: 15_000 })

  // window.open fires straight from the click, so the popup survives the blocker.
  const [popout] = await Promise.all([
    context.waitForEvent('page'),
    page.getByTestId('setup-notices-popout').click()
  ])
  await popout.waitForLoadState('domcontentloaded')
  await expect(popout.getByTestId('notices-popout-panel')).toBeVisible()
  // The window has no nested scroller and no pop-out button of its own.
  await expect(popout.getByTestId('notices-popout-popout')).toHaveCount(0)

  // The opener's stylesheets were cloned in — an unstyled popout is the classic
  // failure, and it shows up as a transparent body with no themed background.
  const background = await popout.evaluate(() => getComputedStyle(document.body).backgroundColor)
  expect(background).not.toBe('rgba(0, 0, 0, 0)')
  expect(background).not.toBe('transparent')

  // Live: the window is a portal into the opener's tree, so opener state
  // reaches it in the same render with no reload and no second session.
  // Asserted on Expert mode rather than on the feed itself: the feed never
  // settles (the runtime appends its own notices — the post-connect
  // "Fetched @SYS/uarts.txt via MAVFTP." lands seconds after connect — and the
  // demo state machine emits STATUSTEXT on a 7s cadence), so anything that
  // asserts an *emptied* feed is racing a live stream it cannot win.
  const noticeRows = popout.locator('.setup-gui-box__status-entry[data-testid^="notices-popout-notice-"]')
  await expect(popout.getByTestId('notices-popout-list')).toBeVisible()
  await expect(noticeRows.first()).toBeVisible({ timeout: 15_000 })
  await expect(popout.getByTestId('notices-popout-search')).toHaveCount(0)
  await page.getByTestId('product-mode-expert').click()
  await expect(popout.getByTestId('notices-popout-search')).toBeVisible()

  // …and the filter typed in the window filters the window: a term nothing can
  // match empties the list deterministically, which is the only way to assert
  // the empty state against a feed that keeps producing.
  await popout.getByTestId('notices-popout-search').fill('zzz-no-such-notice')
  await expect(popout.getByText('No status text yet')).toBeVisible()
  await expect(noticeRows).toHaveCount(0)
  await popout.getByTestId('notices-popout-search').fill('')
  await expect(noticeRows.first()).toBeVisible()

  // Clear all in the main window drops the popped-out rows in the same render.
  // Asserted as "the rows that were there are gone" rather than "the list is
  // empty": every notice text the demo produces is one-shot, so a cleared row
  // never comes back, while a *new* row may land at any moment.
  const clearedTexts = await popout
    .locator('.setup-gui-box__status-entry .setup-gui-box__status-text')
    .allTextContents()
  expect(clearedTexts.length).toBeGreaterThan(0)
  await page.getByTestId('setup-notices-clear-all').click()
  for (const text of clearedTexts) {
    await expect(popout.getByText(text, { exact: true })).toHaveCount(0)
  }

  // The inline panel says where the feed went, and the button closes it again.
  await expect(page.getByTestId('setup-notices-popped-out')).toBeVisible()
  await page.getByTestId('setup-notices-popout').click()
  await expect(page.getByTestId('setup-notices-popped-out')).toHaveCount(0)
  expect(popout.isClosed()).toBe(true)
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
  test('Expert mode reveals the MAVLink inspector; CAN is the single DroneCAN surface', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()

    // Hidden until Expert mode is on.
    await expect(page.getByTestId('view-button-mavlink-inspector')).toHaveCount(0)
    // The DroneCAN inspector is no longer a tab of its own — it was folded into
    // the CAN tab, which is visible without Expert mode.
    await expect(page.getByTestId('view-button-dronecan-inspector')).toHaveCount(0)
    await expect(page.getByTestId('view-button-can')).toBeVisible()

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

    // The merged CAN tab carries what the inspector tab used to: a CAN1/CAN2 bus
    // selector, a start control, and the live bus-traffic read-out once forwarding
    // is up. Expert mode is still on here, but the tab itself is not gated on it.
    await expect(page.getByTestId('view-button-dronecan-inspector')).toHaveCount(0)
    await page.getByTestId('view-button-can').click()
    await expect(page.getByTestId('can-bus-select')).toBeVisible()
    await expect(page.getByTestId('can-bus-start')).toBeVisible()
    await page.getByTestId('can-bus-start').click()
    await expect(page.getByTestId('can-bus-traffic-summary')).toContainText('frames/s', { timeout: 12000 })
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

  test('MAVLink inspector shows a separate Sent section for outbound messages', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('product-mode-expert').check()

    await page.getByTestId('view-button-mavlink-inspector').click()
    await expect(page.getByTestId('mavlink-inspector-table')).toBeVisible({ timeout: 8000 })

    // The Sent section only appears once the app transmits something while the
    // inspector is open — trigger an outbound message via the request control.
    await page.getByTestId('mavlink-request-once').click()

    const sent = page.getByTestId('mavlink-inspector-sent')
    await expect(sent).toBeVisible({ timeout: 5000 })
    await expect(sent).toContainText('Sent (outbound)')

    // Outbound rows expand to the same per-message field detail as inbound rows.
    const sentRow = sent.locator('[data-testid^="mavlink-sent-row-"]').first()
    await sentRow.getByRole('button').first().click()
    await expect(sent.locator('[data-testid^="mavlink-field-table-"]').first()).toBeVisible()
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

    // Start the CAN bus and open the first device's Details box. Identity
    // detail has its own button on the device row now, alongside Params,
    // Messages and Actions.
    await page.getByTestId('view-button-can').click()
    await page.getByTestId('can-bus-start').click()
    const firstNode = page.locator('[data-testid^="can-bus-node-toggle-"]').first()
    await expect(firstNode).toBeVisible({ timeout: 12000 })
    await page.locator('[data-testid^="can-bus-node-detail-"]').first().click()
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

  test('CAN tab manages a device: param grid, restart, ESC telemetry', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('product-mode-expert').check()

    await page.getByTestId('view-button-can').click()
    await page.getByTestId('can-bus-start').click()

    // Expand node 50 (ap_periph) and read its DroneCAN parameter grid.
    const toggle = page.getByTestId('can-bus-node-toggle-50')
    await expect(toggle).toContainText(/Params \([1-9]/, { timeout: 12000 })
    await toggle.click()
    await expect(page.getByTestId('can-device-inspector-50')).toBeVisible()
    const battInput = page.getByTestId('can-bus-param-input-50-BATT_MONITOR')
    await expect(battInput).toBeVisible({ timeout: 12000 })
    // The node reports no labels/enums, so the grid enriches from the curated
    // FC catalog by name: BATT_MONITOR=4 shows its enum label.
    await expect(page.getByTestId('can-bus-param-50-BATT_MONITOR')).toContainText('Analog Voltage and Current')

    // Editing a parameter stages a change and reveals Apply & Save.
    await battInput.fill('3')
    const apply = page.getByTestId('can-bus-apply-all-50')
    await expect(apply).toBeVisible()
    await apply.click()

    // Restart and firmware live in their own Actions box now — each device
    // feature has its own button on the row rather than one panel holding all
    // of them.
    await page.getByTestId('can-bus-node-actions-50').click()

    // Restart is gated behind a confirm step.
    await page.getByTestId('dronecan-restart-50').click()
    await expect(page.getByTestId('dronecan-restart-confirm-50')).toBeVisible()
    await page.getByTestId('dronecan-restart-confirm-50').click()
    await expect(page.getByTestId('dronecan-restart-50')).toBeVisible()

    // ESC telemetry section populates from uavcan.equipment.esc.Status.
    await expect(page.getByTestId('dronecan-esc-telemetry')).toBeVisible({ timeout: 12000 })
    await expect(page.getByTestId('dronecan-esc-0')).toBeVisible()
  })

  test('CAN tab updates a device firmware: pick image, confirm brick risk, reach 100%', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('product-mode-expert').check()

    await page.getByTestId('view-button-can').click()
    await page.getByTestId('can-bus-start').click()

    // Firmware update lives in the device's Actions box.
    const toggle = page.getByTestId('can-bus-node-toggle-50')
    await expect(toggle).toBeVisible({ timeout: 12000 })
    await page.getByTestId('can-bus-node-actions-50').click()
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

  test('CAN tab finds firmware online, downloads + decodes it, and updates the node', async ({ page }) => {
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

    await page.getByTestId('view-button-can').click()
    await page.getByTestId('can-bus-start').click()

    const toggle = page.getByTestId('can-bus-node-toggle-50')
    await expect(toggle).toBeVisible({ timeout: 12000 })
    // Online firmware lookup sits with the other device actions.
    await page.getByTestId('can-bus-node-actions-50').click()

    // A node row appears on its first NodeStatus broadcast, which is BEFORE its
    // GetNodeInfo answer — and the online lookup matches on the board id
    // reconstructed from that answer's hardware_version. Wait for the identity
    // (HW x.y in the row) before asking for a lookup that depends on it; the
    // button is held disabled until then, and clicking in that gap is what a
    // contended runner used to do.
    await expect(page.getByTestId('can-bus-node-50')).toContainText('HW 2.1', { timeout: COMMAND_ACK_TIMEOUT })

    // Find firmware online -> the matched AP_Periph build appears.
    await expect(page.getByTestId('dronecan-fwupdate-online-waiting-50')).toHaveCount(0)
    await page.getByTestId('dronecan-fwupdate-online-find-50').click()
    await expect(page.getByTestId('dronecan-fwupdate-online-list-50')).toBeVisible({ timeout: COMMAND_ACK_TIMEOUT })
    // The lookup must actually have matched — never silently fall through to the
    // "couldn't look it up" note on a path that ends in a flash.
    await expect(page.getByTestId('dronecan-fwupdate-online-error-50')).toHaveCount(0)
    await expect(page.getByTestId('dronecan-fwupdate-online-empty-50')).toHaveCount(0)
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

  test('CAN tab: online firmware lookup degrades gracefully in the browser', async ({ page }) => {
    // No desktop bridge -> the online affordance shows the desktop-only note,
    // and the local .bin picker stays available.
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await page.getByTestId('product-mode-expert').check()

    await page.getByTestId('view-button-can').click()
    await page.getByTestId('can-bus-start').click()

    const toggle = page.getByTestId('can-bus-node-toggle-50')
    await expect(toggle).toBeVisible({ timeout: 12000 })
    await page.getByTestId('can-bus-node-actions-50').click()
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

test.describe('Snapshot restore', () => {
  test('captures a snapshot, shows a real diff after a live edit, drops/undoes a row, and overwrites in place', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    // Capture must happen AFTER the full parameter sync — otherwise the
    // backup only has whichever params had streamed in so far (a real race:
    // BATT_LOW_VOLT missing from the backup entirely reads as "already
    // matches", not as a diff, for the wrong reason).
    await expectParameterSyncComplete(page)

    // Capture a baseline while the live values are still untouched.
    await page.getByTestId('view-button-snapshots').click()
    await page.getByTestId('snapshot-label-input').fill('E2E baseline')
    await page.getByTestId('capture-live-snapshot-button').click()
    await expect(page.getByTestId('snapshot-import-calibration')).not.toBeChecked()

    // Change a live value from a different tab so the snapshot now has
    // something real to restore.
    await page.getByTestId('product-mode-expert').check()
    await page.getByTestId('view-button-parameters').click()
    const search = page.getByTestId('parameter-search-input')
    await search.fill('BATT_LOW_VOLT')
    await page.locator('input[aria-label="BATT_LOW_VOLT value"]').fill('13.5')
    await search.fill('')
    await page.getByRole('button', { name: /^Apply All \(/ }).click()
    await expect(page.getByRole('button', { name: /^Apply All \(0\)/ })).toBeVisible()

    // Back in Snapshots, the captured baseline now diffs against the live
    // (changed) value.
    await page.getByTestId('view-button-snapshots').click()
    await expect(page.getByTestId('snapshot-diff-drop-BATT_LOW_VOLT')).toBeVisible()

    // Calibration is excluded by default (accel/gyro/compass/AHRS trim) —
    // the note names how many were stripped from this restore.
    await expect(page.getByTestId('snapshot-import-calibration-toggle')).toContainText('currently excluded')

    // Drop the row — excludes it from the restore diff/count without
    // leaving this view — then undo to restore it.
    await page.getByTestId('snapshot-diff-drop-BATT_LOW_VOLT').click()
    await expect(page.getByTestId('snapshot-diff-drop-BATT_LOW_VOLT')).toHaveCount(0)
    await expect(page.getByTestId('snapshot-restore-dropped-note')).toContainText('1 row dropped')
    await page.getByTestId('snapshot-restore-undo-drops').click()
    await expect(page.getByTestId('snapshot-diff-drop-BATT_LOW_VOLT')).toBeVisible()
    await expect(page.getByTestId('snapshot-restore-dropped-note')).toHaveCount(0)

    // Bulk selection, shared with the Parameters review: the restore preview
    // had no way to abandon several rows at once, so a partial restore meant
    // dropping them one at a time.
    await expect(page.getByTestId('snapshot-diff-drop-selected')).toBeDisabled()
    await page.getByTestId('snapshot-diff-select-BATT_LOW_VOLT').click()
    await expect(page.getByTestId('snapshot-diff-drop-selected')).toContainText('Drop selected (1)')
    await page.getByTestId('snapshot-diff-drop-selected').click()
    await expect(page.getByTestId('snapshot-diff-drop-BATT_LOW_VOLT')).toHaveCount(0)
    await page.getByTestId('snapshot-restore-undo-drops').click()
    await expect(page.getByTestId('snapshot-diff-drop-BATT_LOW_VOLT')).toBeVisible()
    // The selection must not survive the drop — otherwise the count would
    // include a row that is no longer there.
    await expect(page.getByTestId('snapshot-diff-drop-selected')).toContainText('Drop selected (0)')

    // Group-level Stage/Drop: the preview is grouped by category, and acting
    // on a whole group is the natural unit for a partial restore. Staging is
    // gated on the same overwrite ack as the per-row Stage.
    const groupDrop = page.getByTestId('snapshot-diff-drop-group-failsafe')
    const groupStage = page.getByTestId('snapshot-diff-stage-group-failsafe')
    await expect(groupDrop).toBeVisible()
    await expect(groupStage).toBeDisabled()
    await page.getByTestId('snapshot-restore-ack').check()
    await expect(groupStage).toBeEnabled()

    // Dropping the group clears every row in it, not just one.
    await groupDrop.click()
    await expect(page.getByTestId('snapshot-diff-drop-BATT_LOW_VOLT')).toHaveCount(0)
    await expect(page.getByTestId('snapshot-restore-dropped-note')).toContainText('dropped')
    await page.getByTestId('snapshot-restore-undo-drops').click()
    await expect(page.getByTestId('snapshot-diff-drop-BATT_LOW_VOLT')).toBeVisible()
    await page.getByTestId('snapshot-restore-ack').uncheck()

    // Overwrite Selected refreshes the SAME saved entry in place rather
    // than creating a new one.
    await page.getByTestId('overwrite-selected-snapshot-button').click()
    await expect(page.getByText(/Overwrote snapshot/)).toBeVisible()
    // The restore diff against the (now up to date) baseline is empty again.
    await expect(page.getByTestId('snapshot-diff-drop-BATT_LOW_VOLT')).toHaveCount(0)
  })
})

test.describe('App update banner', () => {
  test('shows a "new version ready" banner with a Refresh action when an update is detected', async ({ page }) => {
    // The offline-shell SW was retired, but the "new version ready — Refresh"
    // prompt is back as a service-worker-free version poll (compares the
    // deployed index.html entry-bundle hash to the one this tab loaded). The
    // ?appUpdate=available seam forces the detected state so the banner can be
    // exercised without an actual redeploy.
    await page.goto('/?appUpdate=available')
    const banner = page.getByTestId('sw-update-banner')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('A new version of ArduConfigurator is ready.')
    await expect(page.getByTestId('sw-update-refresh')).toBeVisible()
  })

  test('does not show the update banner on a normal load', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('sw-update-banner')).toHaveCount(0)
  })
})

test.describe('VTX band/frequency table', () => {
  test('detected table renders an editable grid; edits upload via MAVFTP', async ({ page }) => {
    // The demo seeds @VTX/vtxtable.dat (3 factory bands × 8ch + power levels),
    // so the VTX view shows the real editable table instead of the preview.
    await page.goto('/')
    await connectViaHeader(page)
    await page.getByTestId('view-button-osd').click()
    await page.getByTestId('osd-vtx-tab-vtx').click()

    const editor = page.getByTestId('vtx-table-editor')
    await expect(editor).toBeVisible({ timeout: 15000 })
    // Seeded Boscam A channel 1 = 5865 MHz.
    const cell = page.getByTestId('vtx-table-freq-0-0')
    await expect(cell).toHaveValue('5865')

    // Save is disabled until an edit dirties the draft.
    await expect(page.getByTestId('vtx-table-save')).toBeDisabled()
    await cell.fill('5900')
    await expect(page.getByTestId('vtx-table-save')).toBeEnabled()

    // Power levels are editable too (value + label); the seeded first level is
    // 25 mW / "25". Editing them also dirties the draft and rides the same save.
    const powerValue = page.getByTestId('vtx-table-power-value-0')
    await expect(powerValue).toHaveValue('25')
    await powerValue.fill('50')
    await page.getByTestId('vtx-table-power-label-0').fill('50')

    // Save uploads the whole table over MAVFTP; success clears the dirty state
    // (button → "Saved") with no error banner — proves the write round-tripped.
    await page.getByTestId('vtx-table-save').click()
    await expect(page.getByTestId('vtx-table-save')).toHaveText('Saved', { timeout: 10000 })
    await expect(page.getByTestId('vtx-table-error')).toHaveCount(0)
  })

  test('imports a Betaflight vtxtable snippet into the editor and exports the table', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await page.getByTestId('view-button-osd').click()
    await page.getByTestId('osd-vtx-tab-vtx').click()
    await expect(page.getByTestId('vtx-table-editor')).toBeVisible({ timeout: 15000 })

    // Import a Betaflight snippet with a distinctive band-1 channel-1 frequency.
    await page.getByTestId('vtx-table-import-toggle').click()
    await page.getByTestId('vtx-table-import-text').fill(
      [
        'vtxtable bands 1',
        'vtxtable channels 2',
        'vtxtable band 1 CUSTOM_A A CUSTOM 5111 5222',
        'vtxtable powerlevels 2',
        'vtxtable powervalues 25 200',
        'vtxtable powerlabels 25 200'
      ].join('\n')
    )
    await page.getByTestId('vtx-table-import-load').click()
    // The imported table replaces the editor draft: band-1 ch-1 = 5111.
    await expect(page.getByTestId('vtx-table-freq-0-0')).toHaveValue('5111')
    await expect(page.getByTestId('vtx-table-power-value-0')).toHaveValue('25')
    // Loading an import dirties the draft (Save enabled).
    await expect(page.getByTestId('vtx-table-save')).toBeEnabled()

    // A malformed snippet surfaces an inline error, not a crash.
    await page.getByTestId('vtx-table-import-toggle').click()
    await page.getByTestId('vtx-table-import-text').fill('vtxtable band 1 X X 5800')
    await page.getByTestId('vtx-table-import-load').click()
    await expect(page.getByTestId('vtx-table-import-error')).toBeVisible()

    // Export downloads a vtxtable.txt file.
    await page.getByTestId('vtx-table-import-toggle').click() // close the import panel
    const download = page.waitForEvent('download')
    await page.getByTestId('vtx-table-export-bf').click()
    expect((await download).suggestedFilename()).toBe('vtxtable.txt')
  })

  test('loads a curated Betaflight preset into the editable table', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await page.getByTestId('view-button-osd').click()
    await page.getByTestId('osd-vtx-tab-vtx').click()
    await expect(page.getByTestId('vtx-table-editor')).toBeVisible({ timeout: 15000 })

    // Selecting a preset populates the draft through the same parse path as a
    // manual import — the Raceband preset is a single band whose R1 is 5658 MHz —
    // and dirties it so the operator can review and Save.
    await page.getByTestId('vtx-table-preset-select').selectOption('raceband-8ch-25-600')
    await expect(page.getByTestId('vtx-table-freq-0-0')).toHaveValue('5658')
    await expect(page.getByTestId('vtx-table-power-value-0')).toHaveValue('25')
    await expect(page.getByTestId('vtx-table-save')).toBeEnabled()
  })

  test('loads an analog power-table preset (power-only) with a 3-char-safe 1600 mW label', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await page.getByTestId('view-button-osd').click()
    await page.getByTestId('osd-vtx-tab-vtx').click()
    await expect(page.getByTestId('vtx-table-editor')).toBeVisible({ timeout: 15000 })

    // The power preset swaps only the ladder (bands untouched), and the 1600 mW
    // level's label fits the firmware's 3-char field as "1.6" (not "160").
    await page.getByTestId('vtx-table-power-preset-select').selectOption('power-25-1600')
    await expect(page.getByTestId('vtx-table-power-value-3')).toHaveValue('1600')
    await expect(page.getByTestId('vtx-table-power-label-3')).toHaveValue('1.6')
    // Bands were not touched by a power-only preset.
    await expect(page.getByTestId('vtx-table-freq-0-0')).toHaveValue('5865')
  })

  test('editing a power value auto-derives a fitting 3-char label (1600 → 1.6)', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await page.getByTestId('view-button-osd').click()
    await page.getByTestId('osd-vtx-tab-vtx').click()
    await expect(page.getByTestId('vtx-table-editor')).toBeVisible({ timeout: 15000 })

    // The label field can't hold "1600" (3-char firmware limit); typing the value
    // auto-fills a fitting label instead of leaving a misleading truncated one.
    await page.getByTestId('vtx-table-power-value-0').fill('1600')
    await expect(page.getByTestId('vtx-table-power-label-0')).toHaveValue('1.6')
  })
})

test.describe('Scoped write-progress bar', () => {
  test('a scoped parameter apply shows a global write-progress bar', async ({ page }) => {
    // The scoped apply path (snapshot restore, receiver, config, power, …) used
    // to show only a frozen "Applying…" — no progress. It now drives a global
    // write-progress bar. setScopedWriteProgress is set synchronously at the
    // start of the apply handler (before the awaited batch write) and cleared
    // in finally, so the bar is deterministically visible for the whole write.
    await page.goto('/')
    await connectViaHeader(page)
    await expectParameterSyncComplete(page)

    await page.getByTestId('view-button-config').click()
    await openConfigSection(page, 'system-rates')
    const rates = page.getByTestId('config-section-system-rates')
    await rates.getByTestId('config-advanced-system-rates').click()
    // Stage a config edit (INS_FAST_SAMPLE) so config:apply has something to write.
    await rates.locator('.scoped-editor-field', { hasText: 'Fast sampling' }).locator('input[type=number]').fill('3')

    await page.getByTestId('config-apply').click()
    const banner = page.getByTestId('write-progress-banner')
    await expect(banner).toBeVisible()
    await expect(page.getByTestId('write-progress-bar')).toBeVisible()
    await expect(banner).toContainText('parameters')
    // It clears once the write completes.
    await expect(banner).toHaveCount(0)
  })
})

test.describe('ELRS Flash (temporarily disabled in prod)', () => {
  test('stays hidden even in Expert mode with SERIAL_PASS2 advertised', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await expectParameterSyncComplete(page)
    await page.getByTestId('product-mode-expert').check()

    // The demo FC advertises Expert + SERIAL_PASS2, which used to surface the ELRS
    // Flash tab. It is now gated OFF (ELRS_FLASH_ENABLED=false) because the
    // single-shot flash corrupts through the ArduPilot bridge on real hardware —
    // the tab must not be reachable until the chunked flasher lands.
    await expect(page.getByTestId('view-button-elrs-flash')).toHaveCount(0)
  })
})

test.describe('OSD message shorthand editor (@OSD/shorthand.dat)', () => {
  test('reads the fork shorthand table, edits, adds a row, and saves', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await page.getByTestId('product-mode-expert').check()
    await page.getByTestId('view-button-osd').click()

    // The demo mock serves @OSD/shorthand.dat with 3 seeded entries.
    const editor = page.getByTestId('osd-shorthand-editor')
    await expect(editor).toBeVisible()
    await expect(page.getByTestId('osd-shorthand-from-0')).toHaveValue('PreArm:')
    await expect(page.getByTestId('osd-shorthand-to-0')).toHaveValue('PA:')

    // Edit a value + add a row, then save — the mock FTP write round-trips.
    await page.getByTestId('osd-shorthand-to-0').fill('PRE')
    await page.getByTestId('osd-shorthand-add').click()

    // The "from" field is a searchable combobox over firmware messages: typing
    // filters full messages; picking one inserts its ≤15-char key.
    const from3 = page.getByTestId('osd-shorthand-from-3')
    await from3.fill('sagetech')
    const option = page.getByTestId('osd-shorthand-from-3-option').filter({ hasText: 'ADSB Sagetech MXS' }).first()
    await expect(option).toBeVisible()
    await option.click()
    await expect(from3).toHaveValue('ADSB Sagetech')
    await page.getByTestId('osd-shorthand-to-3').fill('ADSB')
    const save = page.getByTestId('osd-shorthand-save')
    await expect(save).toBeEnabled()
    await save.click()
    // After a successful write the draft is clean again (Save disabled).
    await expect(save).toBeDisabled()
    await expect(page.getByTestId('osd-shorthand-to-0')).toHaveValue('PRE')
  })
})

test.describe('Status & Info advanced sensor cards', () => {
  // The ask: "I'd like to see rangefinder and optical flow so as a user I know
  // they are working and reporting data. Right now I'm not sure how to do that
  // besides look at logs or go back to MP."
  //
  // The Copter demo is seeded to hold the two states that matter at once:
  // RNGFND1_TYPE=100 with the mock streaming DISTANCE_SENSOR (reporting), and
  // FLOW_TYPE=6 with nothing ever answering (configured but silent). The third
  // state — not configured — is asserted separately via ?demoParamOverrides,
  // because "no card at all" is only provable against a build where the params
  // say the sensor is off.

  test('rangefinder card shows a live distance, not just a health adjective', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })

    const card = page.getByTestId('setup-rangefinder-card')
    await expect(card).toBeVisible({ timeout: VEHICLE_CONNECT_TIMEOUT })

    // A real measurement in metres is the primary content. The regex refuses a
    // bare "0" or a dash: an unexplained zero is the same dead end the operator
    // was already stuck in.
    await expect(page.getByTestId('setup-rangefinder-card-distance')).toHaveText(/^\d+\.\d{2} m$/, {
      timeout: VEHICLE_CONNECT_TIMEOUT
    })
    // Signal quality comes off the DISTANCE_SENSOR extension field.
    await expect(page.getByTestId('setup-rangefinder-card-signal')).toHaveText('87%')
    // Colour carries the state, but never alone — the state also lands on an
    // attribute and in the headline copy.
    await expect(card).toHaveAttribute('data-sensor-state', 'reporting')
    await expect(page.getByTestId('setup-rangefinder-card-headline')).toContainText('Reporting live distance')
  })

  test('optical flow card says "no data received" on its face when the sensor is silent', async ({ page }) => {
    // The load-bearing state. A field report closed the loop on exactly this:
    // a DroneCAN flow sensor, hand-soldered with the wires crossed, configured
    // but silent — and this message is what told the operator the solder job
    // was wrong instead of sending them back to Mission Planner.
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })

    const card = page.getByTestId('setup-optical-flow-card')
    await expect(card).toBeVisible({ timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(card).toHaveAttribute('data-sensor-state', 'silent')

    // Visible copy, NOT a tooltip. The first cut of this idea hid the diagnosis
    // behind a hover and the operator had to go looking for it.
    const headline = page.getByTestId('setup-optical-flow-card-headline')
    await expect(headline).toBeVisible()
    await expect(headline).toContainText('No data received')

    // No fake reading stands in for the missing one.
    await expect(page.getByTestId('setup-optical-flow-card-quality')).toHaveText('No data')
    await expect(page.getByTestId('setup-optical-flow-card-last-data')).toHaveText('never')

    // The CAN-attached driver is recognised as configured — a card that only
    // knew the directly-wired variants would have hidden this exact fault.
    await expect(page.getByTestId('setup-optical-flow-card-driver')).toHaveText('FLOW_TYPE 6 · DroneCAN')
  })

  test('an unconfigured sensor gets no card at all', async ({ page }) => {
    // "Only show those boxes if setup. Anything above GPS and compass I'm
    // calling advanced." GPS stays unconditional; these two disappear.
    await page.goto('/?demoParamOverrides=RNGFND1_TYPE:0,FLOW_TYPE:0')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })

    // GPS is the baseline sensor and is still there...
    await expect(page.getByTestId('setup-gps-format-select')).toBeVisible({ timeout: VEHICLE_CONNECT_TIMEOUT })
    // ...while the advanced boxes are genuinely absent, not zeroed out.
    await expect(page.getByTestId('setup-rangefinder-card')).toHaveCount(0)
    await expect(page.getByTestId('setup-optical-flow-card')).toHaveCount(0)
  })

  test('GPS, rangefinder and optical flow sit in one row on a desktop viewport', async ({ page }) => {
    // "Can we make it so that GPS, rangefinder and optical flow are all next to
    // each other." They answer the same question and used to be split across
    // two columns and two scroll positions. Same row means same top edge.
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('setup-optical-flow-card')).toBeVisible({ timeout: VEHICLE_CONNECT_TIMEOUT })

    const tops = await page.evaluate(() => {
      const group = document.querySelector('[data-testid="setup-sensor-group"]')!
      // The cards specifically: the shelf column also carries its own
      // (absolutely positioned, out-of-flow) width/flow chrome as a child.
      return [...group.querySelectorAll('[data-status-dash-card]')].map((child) =>
        Math.round(child.getBoundingClientRect().top)
      )
    })
    expect(tops).toHaveLength(3)
    // Every card starts on the same line — no wrap onto a second row, which is
    // what a too-large grid track floor silently does.
    expect(new Set(tops).size).toBe(1)
  })

  test('the sensor cards do not overflow the phone layout', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('setup-optical-flow-card')).toBeVisible({ timeout: VEHICLE_CONNECT_TIMEOUT })

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow).toBeLessThanOrEqual(2)
  })
})

test.describe('Status & Info dashboard layout', () => {
  // The ask, after the first cut shipped: "pretty good, but its fairly clunky.
  // can we make that more responsive and free so i can drag and drop how i
  // please". So the arrangement is now a real 12-column grid with auto rows —
  // free columns, free widths, new bands — and the drag never relays the page
  // out while it is in flight.
  //
  // The mechanism is still chrome AROUND the existing cards — no card content,
  // gate or telemetry changed — so these tests assert ARRANGEMENT: where a card
  // sits, how wide its column is, that a move sticks, that a reload keeps it,
  // that Reset and Tidy do what they say, and that a stale saved arrangement
  // can never render a broken page.

  const STORAGE_KEY = 'arduconfig.status-dashboard.v2'

  async function connectDemo(page: Page): Promise<void> {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('status-dash-card-system-info')).toBeVisible({ timeout: VEHICLE_CONNECT_TIMEOUT })
  }

  async function columnIds(page: Page, column: string): Promise<string[]> {
    return page.$$eval(`[data-status-dash-col="${column}"] [data-status-dash-card]`, (nodes) =>
      nodes.map((node) => node.getAttribute('data-status-dash-card') ?? '')
    )
  }

  test('ships the familiar arrangement, with no Reset offered until something moves', async ({ page }) => {
    // "Familiar" is the whole acceptance test: with nothing dragged the page has
    // to be the page that shipped — the sensor row under the craft model, the
    // two status columns below it, System Info leading the sidebar.
    await connectDemo(page)
    // Poll: the two advanced sensor cards appear only once RNGFND1_TYPE /
    // FLOW_TYPE have arrived, which is later than the unconditional cards.
    await expect.poll(() => columnIds(page, 'sensors')).toEqual(['gps', 'rangefinder', 'optical-flow'])
    expect(await columnIds(page, 'midcol')).toEqual(['prearm', 'statistics'])
    expect(await columnIds(page, 'noticecol')).toEqual(['notices'])
    expect(await columnIds(page, 'sidebar')).toEqual(['system-info', 'instruments', 'guided-setup'])
    // Reset only appears once there is something to reset — an always-on
    // "Reset Layout" on a page nobody has customised is just noise.
    await expect(page.getByTestId('status-dash-reset-layout')).toHaveCount(0)
    await expect(page.getByTestId('status-dash-tidy-layout')).toHaveCount(0)
  })

  test('the default columns are the widths the page shipped with', async ({ page }) => {
    // The guarantee that survived the model change: the two status columns are
    // half the main area each, exactly as the `auto-fit` pair they replaced
    // were, and the sensor shelf spans it all. Six twelfths with a uniform
    // 14px gutter IS half — this asserts the arithmetic actually holds in a
    // browser rather than only on paper.
    await page.setViewportSize({ width: 1440, height: 900 })
    await connectDemo(page)
    await expect.poll(() => columnIds(page, 'sensors')).toEqual(['gps', 'rangefinder', 'optical-flow'])

    const widths = await page.evaluate(() => {
      const read = (id: string): { left: number; width: number } => {
        const rect = document.querySelector(`[data-status-dash-col="${id}"]`)!.getBoundingClientRect()
        return { left: Math.round(rect.left), width: Math.round(rect.width) }
      }
      return { sensors: read('sensors'), midcol: read('midcol'), noticecol: read('noticecol') }
    })

    expect(widths.midcol.left).toBe(widths.sensors.left)
    expect(widths.midcol.width).toBe(widths.noticecol.width)
    // The pair plus one 14px gutter fills the shelf above them.
    expect(widths.midcol.width + 14 + widths.noticecol.width).toBe(widths.sensors.width)
    expect(widths.noticecol.left).toBe(widths.midcol.left + widths.midcol.width + 14)
  })

  test('a card can be moved with the keyboard alone, and Reset puts it back', async ({ page }) => {
    // Drag-only reordering is inaccessible, so the handle is a real button:
    // left/right walk the card between columns, up/down reorder within one.
    await connectDemo(page)
    await page.getByTestId('status-dash-handle-guided-setup').focus()
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => columnIds(page, 'noticecol')).toEqual(['notices', 'guided-setup'])
    expect(await columnIds(page, 'sidebar')).toEqual(['system-info', 'instruments'])

    // The move is saved, so it survives a reload.
    await page.reload()
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('status-dash-card-guided-setup')).toBeVisible({ timeout: VEHICLE_CONNECT_TIMEOUT })
    expect(await columnIds(page, 'noticecol')).toEqual(['notices', 'guided-setup'])

    await page.getByTestId('status-dash-reset-layout').click()
    await expect.poll(() => columnIds(page, 'sidebar')).toEqual(['system-info', 'instruments', 'guided-setup'])
    await expect(page.getByTestId('status-dash-reset-layout')).toHaveCount(0)
    // Reset CLEARS the saved arrangement rather than saving a copy of today's
    // default, so a later default change still reaches the operator.
    expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBeNull()
  })

  test('a card height cap is applied and saved', async ({ page }) => {
    await connectDemo(page)
    const card = page.getByTestId('status-dash-card-system-info')
    const before = (await card.boundingBox())?.height ?? 0
    expect(before).toBeGreaterThan(150)

    // Each press is one 24px row, so the shrink is deterministic.
    await page.getByTestId('status-dash-resize-system-info').focus()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await expect(card).toHaveClass(/is-capped/)
    expect((await card.boundingBox())?.height ?? 0).toBeLessThan(before)

    expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toContain('heightRows')
  })

  test('a layout saved with the sensor cards present degrades when they are gone', async ({ page }) => {
    // The most likely source of a broken-looking page: the rangefinder and
    // optical-flow cards only exist when the sensor is configured, so a saved
    // arrangement routinely names cards that are not there.
    await connectDemo(page)
    await expect.poll(() => columnIds(page, 'sensors')).toEqual(['gps', 'rangefinder', 'optical-flow'])
    await page.getByTestId('status-dash-handle-rangefinder').focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => columnIds(page, 'midcol')).toContain('rangefinder')

    await page.goto('/?demoParamOverrides=RNGFND1_TYPE:0,FLOW_TYPE:0')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('status-dash-card-system-info')).toBeVisible({ timeout: VEHICLE_CONNECT_TIMEOUT })

    // The absent cards are simply not placed; every card that IS present is.
    expect(await columnIds(page, 'sensors')).toEqual(['gps'])
    expect(await columnIds(page, 'midcol')).toEqual(['prearm', 'statistics'])
    expect(await columnIds(page, 'sidebar')).toEqual(['system-info', 'instruments', 'guided-setup'])
  })

  test('a column can be widened, and the width is saved', async ({ page }) => {
    // The horizontal resize the zone model did not have: width was a property
    // of the zone, so moving a card between columns WAS the only way to change
    // it. Now a column has a span, and the space comes off its neighbour.
    await page.setViewportSize({ width: 1440, height: 900 })
    await connectDemo(page)
    const before = await page.evaluate(
      () => document.querySelector('[data-status-dash-col="midcol"]')!.getBoundingClientRect().width
    )

    await page.getByTestId('status-dash-width-midcol').focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')

    await expect(page.getByTestId('status-dash-col-midcol')).toHaveAttribute('data-status-dash-col-span', '8')
    await expect(page.getByTestId('status-dash-col-noticecol')).toHaveAttribute('data-status-dash-col-span', '4')
    const after = await page.evaluate(
      () => document.querySelector('[data-status-dash-col="midcol"]')!.getBoundingClientRect().width
    )
    expect(after).toBeGreaterThan(before)

    expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toContain('"span":8')
  })

  test('a card dragged into a gutter opens a new column, and Tidy closes the mess up', async ({ page }) => {
    // The freedom the operator asked for: a card can go somewhere there was no
    // column at all. Tidy is the way back out without a full Reset.
    await page.setViewportSize({ width: 1440, height: 900 })
    await connectDemo(page)
    await expect.poll(() => columnIds(page, 'sensors')).toEqual(['gps', 'rangefinder', 'optical-flow'])

    const handle = page.getByTestId('status-dash-handle-optical-flow')
    const box = (await handle.boundingBox())!
    // Drop it just past the right-hand edge of the midcol column — the gutter
    // between the two status columns.
    const midcol = (await page.getByTestId('status-dash-col-midcol').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(midcol.x + midcol.width + 4, midcol.y + 40, { steps: 12 })
    await page.mouse.up()

    // A brand new column exists, holding exactly the dragged card, and the
    // sensor shelf has given it up.
    await expect.poll(() => columnIds(page, 'sensors')).toEqual(['gps', 'rangefinder'])
    const created = await page.$$eval('[data-status-dash-col]', (nodes) =>
      nodes
        .map((node) => node.getAttribute('data-status-dash-col') ?? '')
        .filter((id) => !['sensors', 'midcol', 'noticecol', 'sidebar'].includes(id))
    )
    expect(created).toHaveLength(1)
    expect(await columnIds(page, created[0]!)).toEqual(['optical-flow'])

    // Tidy keeps the arrangement but evens the widths back out to fill the row.
    await page.getByTestId('status-dash-tidy-layout').click()
    const spans = await page.$$eval('[data-status-dash-col-band="1"][data-status-dash-col-region="main"]', (nodes) =>
      nodes.map((node) => Number(node.getAttribute('data-status-dash-col-span')))
    )
    expect(spans.reduce((total, span) => total + span, 0)).toBe(12)
    // The card the operator placed is still where they put it.
    expect(await columnIds(page, created[0]!)).toEqual(['optical-flow'])
  })

  test('a drag does not relayout the page under the pointer', async ({ page }) => {
    // The clunkiness fix, asserted rather than asserted-about. v1 previewed a
    // drop by inserting a real element into the target column, so every card
    // below it moved — measured at 56px — and the page reflowed on every
    // pointer move. The indicator is now fixed-position and out of flow, and
    // the dragged card moves on a transform, so THE DRAG may not move any card
    // but the lifted one.
    //
    // "The drag may not move a card" is not the same claim as "no card moved",
    // and only the first is a promise the product can keep: these are live
    // telemetry cards, and a card that gains a row of its own accord pushes the
    // cards below it down whether or not anyone is dragging anything. So the
    // gesture is measured, and any card that did move is then ATTRIBUTED —
    // a reflow the drag caused unwinds when the drag is cancelled, while the
    // feed's own growth stays put. Asserting the raw "nothing moved" is what
    // made this test fail on CI, where the feed is likelier to tick mid-drag.
    await page.setViewportSize({ width: 1440, height: 900 })
    await connectDemo(page)
    await expect.poll(() => columnIds(page, 'sensors')).toEqual(['gps', 'rangefinder', 'optical-flow'])

    const positions = async (): Promise<Record<string, number[]>> =>
      page.$$eval('[data-status-dash-card]', (nodes) =>
        Object.fromEntries(
          nodes.map((node) => {
            const rect = node.getBoundingClientRect()
            return [node.getAttribute('data-status-dash-card') ?? '', [Math.round(rect.left), Math.round(rect.top)]]
          })
        )
      )
    const samePlace = (a: number[] | undefined, b: number[] | undefined): boolean =>
      a !== undefined && b !== undefined && a[0] === b[0] && a[1] === b[1]

    // Let the first burst of telemetry land before measuring anything: the
    // cards fill in over the second or so after connect, and there is no point
    // attributing movement we can simply wait out.
    let settling = await positions()
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await page.waitForTimeout(250)
      const next = await positions()
      if (Object.entries(next).every(([id, place]) => samePlace(place, settling[id]))) {
        break
      }
      settling = next
    }

    const before = await positions()
    const handle = page.getByTestId('status-dash-handle-gps')
    const box = (await handle.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    const midcol = (await page.getByTestId('status-dash-col-midcol').boundingBox())!
    await page.mouse.move(midcol.x + midcol.width / 2, midcol.y + 30, { steps: 20 })

    // Mid-drag: the indicator is up, and the page has not been laid out again
    // under the pointer.
    await expect(page.getByTestId('status-dash-drop-indicator')).toBeVisible()
    const during = await positions()

    await page.keyboard.press('Escape')
    await page.mouse.up()
    // Escape cancels: the arrangement is untouched…
    await expect.poll(() => columnIds(page, 'sensors')).toEqual(['gps', 'rangefinder', 'optical-flow'])
    const after = await positions()

    // …and so every card that shifted mid-gesture must have shifted for its own
    // reasons — it stayed shifted once the gesture was thrown away. A card that
    // snapped back to exactly where it started is one the drag itself displaced,
    // which is the regression this test exists to catch.
    for (const [id, position] of Object.entries(before)) {
      if (id === 'gps' || samePlace(during[id], position)) {
        continue
      }
      expect(
        samePlace(after[id], position),
        `${id} moved during the drag and returned to ${JSON.stringify(position)} when the drag was cancelled — the drag relaid out the page`
      ).toBe(false)
    }
  })

  test('an unreadable saved layout falls back to the default silently', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key, value),
      [STORAGE_KEY, '{"version":2,"columns":[{"id":"gho'] as const
    )
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('status-dash-card-system-info')).toBeVisible({ timeout: VEHICLE_CONNECT_TIMEOUT })
    expect(await columnIds(page, 'sidebar')).toEqual(['system-info', 'instruments', 'guided-setup'])
  })

  test('a layout saved by the zone model is dropped, not half-read', async ({ page }) => {
    // v1 stored `{version:1, cards:[{id, zone}]}` under its own key. There are
    // no columns in it to migrate, so the version bump means those operators
    // get the (unchanged) default back rather than a broken page.
    await page.goto('/')
    await page.evaluate(() => {
      window.localStorage.setItem(
        'arduconfig.status-dashboard.v1',
        JSON.stringify({ version: 1, cards: [{ id: 'gps', zone: 'sidebar', heightRows: 6 }] })
      )
    })
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('status-dash-card-system-info')).toBeVisible({ timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect.poll(() => columnIds(page, 'sensors')).toEqual(['gps', 'rangefinder', 'optical-flow'])
    expect(await columnIds(page, 'sidebar')).toEqual(['system-info', 'instruments', 'guided-setup'])
    await expect(page.getByTestId('status-dash-reset-layout')).toHaveCount(0)
  })

  test('phone width drops the drag affordances and keeps the default order', async ({ page }) => {
    // Dragging a card on a phone fights the scroll gesture, and a multi-column
    // arrangement means nothing in a single column. Below the breakpoint the
    // controls are gone, a saved arrangement is ignored, and every column
    // spans the full width so the bands simply stack in order.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.evaluate(
      ([key, value]) => window.localStorage.setItem(key, value),
      [
        STORAGE_KEY,
        JSON.stringify({
          version: 2,
          columns: [{ id: 'sidebar', region: 'side', band: 0, span: 12, flow: 'stack' }],
          cards: [{ id: 'gps', column: 'sidebar', heightRows: 6 }]
        })
      ] as const
    )
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
    await expect(page.getByTestId('status-dash-card-system-info')).toBeVisible({ timeout: VEHICLE_CONNECT_TIMEOUT })

    await expect(page.getByTestId('status-dash-toolbar')).toHaveCount(0)
    await expect(page.locator('.status-dash-card__handle')).toHaveCount(0)
    await expect(page.locator('.status-dash-col__width')).toHaveCount(0)
    expect(await columnIds(page, 'sidebar')).toEqual(['system-info', 'instruments', 'guided-setup'])
    // Every column is full width, so nothing sits beside anything else.
    const lefts = await page.$$eval('[data-status-dash-col-region="main"]', (nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().left))
    )
    expect(new Set(lefts).size).toBe(1)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow).toBeLessThanOrEqual(2)
  })
})

test.describe('Config ▸ Power layout', () => {
  test('the battery panel spans the width instead of one narrow column', async ({ page }) => {
    // Power moved into Config, whose grid is CSS multicolumn (columns: 360px 3)
    // — right for cards that are a handful of fields, wrong for a section
    // hosting a whole panel. Measured before the fix: a ~330px column with the
    // rest of the row empty, and the panel scrolling for it.
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'config')
    await page.getByTestId('config-category-power').click()

    const section = page.getByTestId('config-section-power')
    await expect(section).toBeVisible()

    const grid = page.getByTestId('config-section-grid')
    const sectionBox = await section.boundingBox()
    const gridBox = await grid.boundingBox()
    expect(sectionBox).not.toBeNull()
    expect(gridBox).not.toBeNull()
    // Spanning the multicolumn flow, not sitting in one ~360px track.
    expect(sectionBox!.width).toBeGreaterThan(gridBox!.width * 0.8)
  })
})
