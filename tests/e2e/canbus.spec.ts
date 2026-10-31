import { expect, test, type Page } from '@playwright/test'
import { worstViewportOverflow } from './support/overflow'

// The CAN tab is for everyone (devices and their parameters); its bus tools
// (Messages, Frames, Plot, Send) are Expert-only.
async function openCanTab(page: import('@playwright/test').Page): Promise<void> {
  // On a phone the mode switch sits in the header's More sheet.
  const sheet = page.getByTestId('header-more-toggle')
  const sheetShown = await sheet.isVisible()
  if (sheetShown && (await sheet.getAttribute('aria-expanded')) !== 'true') await sheet.click()
  const expert = page.getByTestId('product-mode-expert')
  if (!(await expert.isChecked())) await expert.check()
  if (sheetShown && (await sheet.getAttribute('aria-expanded')) === 'true') await sheet.click()
  await page.getByTestId('view-button-can').click()
}

// The DroneCAN inspector was the only main nav view without an e2e smoke test
// (its decode + node-discovery logic is unit-covered by
// runtime.dronecan-nodes.test.mjs / dronecan-decoders.test.mjs, but the view
// itself was never opened in a browser test). These pin:
//   - the tab is reachable after connect and shows its bus controls,
//   - starting CAN forwarding transitions to the active scanning state.
// The demo emits no CAN nodes, so the active state shows the "no NodeStatus
// broadcasts yet" empty message rather than a populated node list.

async function connectDemo(page: Page): Promise<void> {
  await page.getByTestId('transport-mode-select').selectOption('demo')
  await page.getByTestId('connect-button').click()
  await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter')
}

test.describe('DroneCAN inspector', () => {
  test('CAN tab is reachable and shows its bus controls, no intro text', async ({ page }) => {
    await page.goto('/')
    await connectDemo(page)
    await openCanTab(page)

    // The inspector panel renders with its bus picker + start control.
    await expect(page.getByRole('heading', { name: 'DroneCAN Bus' })).toBeVisible()
    await expect(page.getByTestId('can-bus-select')).toBeVisible()
    await expect(page.getByTestId('can-bus-start')).toBeEnabled()
    // No protocol walk-through before connecting: just the controls.
    await expect(page.getByText('How it works')).toHaveCount(0)
  })

  test('outside Expert the CAN tab shows devices only; Expert adds the bus tools', async ({ page }) => {
    await page.goto('/')
    await connectDemo(page)
    await page.getByTestId('view-button-can').click()
    await expect(page.getByTestId('can-bus-select')).toBeVisible()
    await expect(page.getByTestId('can-subtabs')).toHaveCount(0)
    await page.getByTestId('product-mode-expert').click()
    await expect(page.getByTestId('can-subtab-frames')).toBeVisible()
    await expect(page.getByTestId('can-subtab-send')).toBeVisible()
  })

  test('starting forwarding discovers the simulated DroneCAN nodes + params', async ({ page }) => {
    await page.goto('/')
    await connectDemo(page)
    await openCanTab(page)

    await page.getByTestId('can-bus-start').click()
    // Forwarding starts (fire-and-forget CAN_FORWARD), so the control flips to Disconnect.
    await expect(page.getByTestId('can-bus-stop')).toBeVisible()

    // The demo bus simulator advertises two nodes (a GPS/compass and a power
    // monitor); they discover with identity + a parameter table.
    const gps = page.getByTestId('can-bus-node-124')
    await expect(gps).toBeVisible()
    await expect(gps).toContainText('Node 124')
    // Node detail surfaces the firmware git hash (VCS commit) + hardware UID.
    await expect(gps).toContainText('git 4a7c3f01')
    await expect(page.getByTestId('can-bus-node-uid-124')).toBeVisible()
    await expect(page.getByTestId('can-bus-node-50')).toBeVisible()

    // The parameter walk fills the table; expanding shows the named params.
    const gpsParams = page.getByTestId('can-bus-node-toggle-124')
    await expect(gpsParams).toContainText(/Params \([1-9]/)
    await gpsParams.click()
    await expect(gps).toContainText('GPS_TYPE')
  })

  test('edits stage into a comparison panel and Apply all writes them', async ({ page }) => {
    await page.goto('/')
    await connectDemo(page)
    await openCanTab(page)
    await page.getByTestId('can-bus-start').click()

    const toggle = page.getByTestId('can-bus-node-toggle-124')
    await expect(toggle).toContainText(/Params \([1-9]/)
    await toggle.click()

    // Editing a value stages it — nothing is written yet; the staged
    // panel shows the current → new comparison.
    // GPS_TYPE has named values (AP_Periph metadata): a dropdown, as on the Parameters page.
    // The dropdown is the app's own picker (it stays inside the window, with a
    // search box), not a native select.
    const input = page.getByTestId('can-bus-param-select-124-GPS_TYPE')
    const before = await input.getAttribute('data-value')
    await input.click()
    await page.getByTestId('can-bus-param-select-124-GPS_TYPE-search').fill('dronecan')
    await page.getByTestId('can-bus-param-select-124-GPS_TYPE-option-9').click()
    const staged = page.getByTestId('can-bus-staged-124')
    await expect(staged).toBeVisible()
    await expect(page.getByTestId('can-bus-staged-row-124-GPS_TYPE')).toContainText(`${before} → 9`)

    // Apply all writes the set; the GetSet read-back lands in the table
    // and the staged panel clears.
    await page.getByTestId('can-bus-apply-all-124').click()
    await expect(staged).toHaveCount(0)
    await expect(input).toHaveAttribute('data-value', '9')

    // Dropping a staged edit un-stages without writing.
    await input.click()
    await page.getByTestId('can-bus-param-select-124-GPS_TYPE-option-1').click()
    await expect(page.getByTestId('can-bus-staged-124')).toBeVisible()
    await page.getByTestId('can-bus-staged-drop-124-GPS_TYPE').click()
    await expect(page.getByTestId('can-bus-staged-124')).toHaveCount(0)
    await expect(input).toHaveAttribute('data-value', '9')
  })

  test('a PX4 cannode reads its params from the PX4 catalog; the param table searches', async ({ page }) => {
    await page.goto('/')
    await connectDemo(page)
    await openCanTab(page)
    await page.getByTestId('can-bus-start').click()

    // The ARK CAN RTK GPS runs PX4, not AP_Periph: its CANNODE_*/GPS_UBX_*
    // params get PX4's labels and named values.
    const toggle = page.getByTestId('can-bus-node-toggle-88')
    await expect(toggle).toContainText(/Params \([1-9]/, { timeout: 15_000 })
    await toggle.click()
    const dynModel = page.getByTestId('can-bus-param-select-88-GPS_UBX_DYNMODEL')
    await expect(dynModel).toContainText('airborne with <2g acceleration', { timeout: 15_000 })
    await expect(page.getByTestId('can-bus-param-88-CANNODE_TERM')).toContainText(/termination/i)

    // Search narrows the table by name, label or description.
    await page.getByTestId('can-bus-param-search-88').fill('ubx')
    await expect(page.getByTestId('can-bus-param-search-count-88')).toHaveText('2 of 6')
    await expect(page.getByTestId('can-bus-param-88-CANNODE_TERM')).toHaveCount(0)
    await page.getByTestId('can-bus-param-search-88').fill('')
    await expect(page.getByTestId('can-bus-param-88-CANNODE_TERM')).toBeVisible()

    // The picker opens inside the window and searches its values.
    await dynModel.click()
    const panel = page.getByTestId('can-bus-param-select-88-GPS_UBX_DYNMODEL-panel')
    await expect(panel).toBeVisible()
    const box = await panel.boundingBox()
    const viewport = page.viewportSize()
    expect(box && viewport && box.y >= 0 && box.y + box.height <= viewport.height).toBeTruthy()
    // Live panels elsewhere on the tab scroll themselves; the picker stays open.
    await page.waitForTimeout(1500)
    await expect(panel).toBeVisible()
    await page.getByTestId('can-bus-param-select-88-GPS_UBX_DYNMODEL-search').fill('stationary')
    await page.getByTestId('can-bus-param-select-88-GPS_UBX_DYNMODEL-option-2').click()
    await expect(page.getByTestId('can-bus-staged-row-88-GPS_UBX_DYNMODEL')).toContainText('7 → 2')
  })

  test('a custom node name persists across reload (keyed by hardware UID)', async ({ page }) => {
    await page.goto('/')
    await connectDemo(page)
    await openCanTab(page)
    await page.getByTestId('can-bus-start').click()

    const node = page.getByTestId('can-bus-node-124')
    await expect(node).toBeVisible()
    // The UID is known, so the node is nameable.
    await expect(page.getByTestId('can-bus-node-uid-124')).toBeVisible()

    await page.getByTestId('can-bus-node-rename-124').click()
    await page.getByTestId('can-bus-node-name-input-124').fill('Front GPS')
    await page.getByTestId('can-bus-node-name-save-124').click()
    await expect(node.getByText('Front GPS')).toBeVisible()

    // Reload + reconnect + re-discover: the name sticks (localStorage, by UID).
    await page.reload()
    await connectDemo(page)
    await openCanTab(page)
    await page.getByTestId('can-bus-start').click()
    await expect(page.getByTestId('can-bus-node-124').getByText('Front GPS')).toBeVisible()
  })

  test('a device pops out into its own styled window, scoped to that node', async ({ page, context }) => {
    await page.goto('/')
    await connectDemo(page)
    // Expert mode so the popout carries the device actions that used to live in
    // the separate DroneCAN Inspector tab (restart / firmware update).
    await page.getByTestId('product-mode-expert').check()
    await openCanTab(page)
    await page.getByTestId('can-bus-start').click()
    await expect(page.getByTestId('can-bus-node-124')).toBeVisible()

    // window.open fires straight from the click, so the popup survives.
    const [popout] = await Promise.all([
      context.waitForEvent('page'),
      page.getByTestId('can-bus-node-popout-124').click()
    ])
    await popout.waitForLoadState('domcontentloaded')

    // The window is scoped to node 124 and to nothing else on the bus.
    await expect(popout.getByTestId('can-device-inspector-124')).toBeVisible()
    await expect(popout.getByTestId('can-device-inspector-50')).toHaveCount(0)
    await expect(popout.getByTestId('can-bus-param-select-124-GPS_TYPE')).toBeVisible({ timeout: 12000 })
    // Expert device actions came along with it.
    await expect(popout.getByTestId('dronecan-restart-124')).toBeVisible()

    // The opener's stylesheets were cloned in — an unstyled popout is the classic
    // failure, and it shows up as a transparent body with no themed background.
    const background = await popout.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(background).not.toBe('rgba(0, 0, 0, 0)')
    expect(background).not.toBe('transparent')

    // The window keeps updating from the same session: forwarding is owned by the
    // runtime (and re-armed by it), so the popout is still live well past
    // ArduPilot's 5s CAN_FORWARD timeout.
    await page.waitForTimeout(7000)
    await expect(popout.getByTestId('can-bus-param-select-124-GPS_TYPE')).toBeVisible()
    await expect(page.getByTestId('can-bus-stop')).toBeVisible()

    // The row says where the device went, and closing the window brings it back.
    await expect(page.getByTestId('can-bus-node-popped-out-124')).toBeVisible()
    await page.getByTestId('can-bus-node-popout-124').click()
    await expect(page.getByTestId('can-bus-node-popped-out-124')).toHaveCount(0)
    expect(popout.isClosed()).toBe(true)
  })
})

test.describe('CAN bus monitor', () => {
  async function openMonitor(page: Page): Promise<void> {
    await page.goto('/')
    await connectDemo(page)
    await openCanTab(page)
    await page.getByTestId('can-bus-start').click()
    await expect(page.getByTestId('can-bus-stop')).toBeVisible()
    // The bus monitor is the Frames sub-tab.
    await page.getByTestId('can-subtab-frames').click()
  }

  test('shows every frame on the bus: plain CAN beside DroneCAN, with live stats', async ({ page }) => {
    await openMonitor(page)
    const monitor = page.getByTestId('can-monitor')
    await expect(monitor).toBeVisible()
    // The demo bus carries standard-id plain CAN (0x123, 0x2A0), a CAN FD
    // frame (0x321) and DroneCAN NodeStatus broadcasts.
    await expect(page.getByTestId('can-monitor-row').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('can-monitor-stats')).toContainText('f/s')

    await page.getByTestId('can-monitor-view-by-id').click()
    const byId = page.getByTestId('can-monitor-by-id')
    await expect(byId.getByTestId('can-monitor-id-123')).toBeVisible()
    await expect(byId.getByTestId('can-monitor-id-321')).toContainText('FD')
    // NodeStatus from node 124, read off its 29-bit id.
    await expect(byId).toContainText('NodeStatus ← 124', { timeout: 15_000 })
  })

  test('filters by id expression, says what is wrong with a bad one, and counts', async ({ page }) => {
    await openMonitor(page)
    await page.getByTestId('can-monitor-view-by-id').click()
    await expect(page.getByTestId('can-monitor-id-2A0')).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('can-monitor-filter-ids').fill('123')
    await expect(page.getByTestId('can-monitor-id-123')).toBeVisible()
    await expect(page.getByTestId('can-monitor-id-2A0')).toHaveCount(0)
    await expect(page.getByTestId('can-monitor-count')).toContainText('1 of')

    // A half-typed expression is reported and ignored, never blanking the table.
    await page.getByTestId('can-monitor-filter-ids').fill('12z')
    await expect(page.getByTestId('can-monitor-filter-error')).toContainText('not a hex CAN id')
    await expect(page.getByTestId('can-monitor-id-2A0')).toBeVisible()

    // Kind chips: dropping STD leaves only the extended (DroneCAN) ids.
    await page.getByTestId('can-monitor-filter-ids').fill('')
    await page.getByTestId('can-monitor-kind-standard').click()
    await expect(page.getByTestId('can-monitor-id-123')).toHaveCount(0)
  })

  test('pausing freezes the view but keeps capturing', async ({ page }) => {
    await openMonitor(page)
    await expect(page.getByTestId('can-monitor-row').first()).toBeVisible({ timeout: 15_000 })
    const pause = page.getByTestId('can-monitor-pause')
    await expect(pause).toHaveClass(/can-monitor__tool--pause/)
    await pause.click()
    // Red Pause, green Resume; no frame count in the button.
    await expect(pause).toHaveText('Resume')
    await expect(pause).toHaveClass(/can-monitor__tool--resume/)
    // Still capturing underneath: the held count keeps climbing.
    const held = async () => Number((await page.getByTestId('can-monitor-stats').textContent())?.match(/([\d,]+) held/)?.[1].replace(/,/g, '') ?? 0)
    const before = await held()
    await expect.poll(held, { timeout: 10_000 }).toBeGreaterThan(before)
    await pause.click()
    await expect(pause).toHaveText('Pause')
  })

  test('a selected DroneCAN frame shows its header reading and its bytes', async ({ page }) => {
    await openMonitor(page)
    await page.getByTestId('can-monitor-view-by-id').click()
    const status = page.getByTestId('can-monitor-by-id').locator('[data-testid^="can-monitor-id-"]', { hasText: 'NodeStatus ← 124' })
    await status.first().click({ timeout: 15_000 })
    const details = page.getByTestId('can-monitor-details')
    await expect(details).toBeVisible()
    await expect(page.getByTestId('can-monitor-dronecan')).toContainText('NodeStatus · 341')
    await expect(page.getByTestId('can-monitor-dronecan')).toContainText('Node 124')
    await expect(details.locator('table.can-monitor__bytes tbody tr')).toHaveCount(8)
    // Decoded through the bundled DSDL: every field, enum-like values named
    // from the type's own constants.
    const decoded = page.getByTestId('can-monitor-decoded')
    await expect(decoded).toContainText('uavcan.protocol.NodeStatus')
    await expect(decoded).toContainText('uptime_sec')
    await expect(decoded).toContainText('health')
    await expect(decoded).toContainText('OK')
    await expect(decoded).toContainText('OPERATIONAL')
  })

  test('a multi-frame DroneCAN transfer decodes from all of its frames', async ({ page }) => {
    await openMonitor(page)
    await page.getByTestId('can-monitor-filter-ids').fill('1E0A3C00/00FFFF80, 0/0')
    // esc.Status (type 1034) from node 50 is a multi-frame broadcast in the demo.
    await page.getByTestId('can-monitor-filter-ids').fill('')
    const row = page.getByTestId('can-monitor-row').filter({ hasText: 'esc.Status' }).or(
      page.getByTestId('can-monitor-row').filter({ hasText: /Status ← 50 · error_count/ })
    )
    await row.first().click({ timeout: 20_000 })
    const decoded = page.getByTestId('can-monitor-decoded')
    await expect(decoded).toContainText('uavcan.equipment.esc.Status')
    await expect(decoded).toContainText(/\d frames/)
    await expect(decoded).toContainText('rpm')
    await expect(page.getByTestId('can-monitor-decode-problem')).toHaveCount(0)
  })

  test('records to a candump log and opens one back', async ({ page }) => {
    await openMonitor(page)
    await expect(page.getByTestId('can-monitor-row').first()).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('can-monitor-record').click()
    await expect(page.getByTestId('can-monitor-record')).toContainText('Stop', { timeout: 5_000 })
    await page.waitForTimeout(1500)
    await page.getByTestId('can-monitor-record').click()
    await expect(page.getByTestId('can-monitor-save')).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('can-monitor-save-candump').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^can-capture-.*\.log$/)
    const path = await download.path()
    const { readFile } = await import('node:fs/promises')
    const text = await readFile(path!, 'utf8')
    // candump -L lines: "(seconds) can0 ID#DATA", bus 1 is can0.
    expect(text).toMatch(/^\(\d+\.\d{6}\) can0 123#[0-9A-F]{16}$/m)

    // Opening it again shows the log in place of the live stream.
    await page.getByTestId('can-monitor-log-input').setInputFiles({
      name: 'capture.log',
      mimeType: 'text/plain',
      buffer: Buffer.from(text)
    })
    await expect(page.getByTestId('can-monitor-log-banner')).toContainText('capture.log')
    await page.getByTestId('can-monitor-view-by-id').click()
    await expect(page.getByTestId('can-monitor-id-123')).toBeVisible()
    await page.getByTestId('can-monitor-close-log').click()
    await expect(page.getByTestId('can-monitor-log-banner')).toHaveCount(0)
  })
})

test.describe('CAN tab on a phone', () => {
  test('Plot fits a 390px screen: charts, rows, toolbar and the side panel', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.goto('/')
    await connectDemo(page)
    await openCanTab(page)
    await page.getByTestId('can-bus-start').click()
    await page.getByTestId('can-subtab-plot').click()
    await page.getByTestId('can-plot-side-expression').click()
    await expect(page.getByTestId('can-plot-expression').locator('summary', { hasText: 'esc_Status[0]' })).toHaveCount(1, { timeout: 15_000 })
    await page.getByTestId('can-plot-expression-input').fill('esc_Status[0].current*esc_Status[0].voltage')
    await page.getByTestId('can-plot-expression-add').click()
    await page.getByTestId('can-plot-expression-input').fill('esc_Status[1].rpm')
    await page.getByTestId('can-plot-expression-add').click()
    await expect(page.getByTestId('can-plot-pane')).toHaveCount(2)
    await page.getByTestId('can-plot-stats').click()
    expect((await worstViewportOverflow(page)).worst, 'plot').toBeLessThanOrEqual(2)
    await page.getByTestId('can-plot-pane').nth(0).getByTestId('can-plot-chart-menu').selectOption({ index: 1 })
    expect((await worstViewportOverflow(page)).worst, 'plot, overlaid').toBeLessThanOrEqual(2)
  })

  test('the bus monitor, node cards and ESC table fit a 390px screen', async ({ page }) => {
    // A content-sized app shell takes its width from the widest thing on the
    // page: the ESC table and the node buttons pushed it to ~790px once the
    // bus came up. Both tables now scroll in their own box.
    await page.setViewportSize({ width: 390, height: 900 })
    await page.goto('/')
    await connectDemo(page)
    await openCanTab(page)
    await page.getByTestId('can-bus-start').click()
    await expect(page.getByTestId('dronecan-esc-table')).toBeVisible({ timeout: 15_000 })
    expect((await worstViewportOverflow(page)).worst, 'devices').toBeLessThanOrEqual(2)
    await page.getByTestId('can-subtab-frames').click()
    await expect(page.getByTestId('can-monitor-row').first()).toBeVisible({ timeout: 15_000 })
    for (const mode of ['stream', 'by-id'] as const) {
      await page.getByTestId(`can-monitor-view-${mode}`).click()
      expect((await worstViewportOverflow(page)).worst, `${mode} view`).toBeLessThanOrEqual(2)
    }
  })
})

test.describe('CAN bus monitor: logs and saving', () => {
  // Two ids, ten seconds: 0x100 every second, 0x200 once at the end.
  const LOG = Array.from({ length: 10 }, (_unused, index) => `(${1000 + index}.000000) can0 100#${String(index).padStart(2, '0')}`)
    .concat(['(1009.500000) can0 200#FF'])
    .join('\n')

  async function openLogFile(page: Page, name: string, text: string): Promise<void> {
    await page.goto('/')
    await connectDemo(page)
    await openCanTab(page)
    await page.getByTestId('can-subtab-frames').click()
    await page.getByTestId('can-monitor-log-input').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) })
    await expect(page.getByTestId('can-monitor-log-banner')).toContainText(name)
  }

  test('a log opens whole, then plays back against a clock and seeks', async ({ page }) => {
    await openLogFile(page, 'bench.log', LOG)
    await expect(page.getByTestId('can-monitor-log-banner')).toContainText('11 frames')
    await expect(page.getByTestId('can-monitor-position')).toHaveText('whole log')
    await page.getByTestId('can-monitor-view-by-id').click()
    await expect(page.getByTestId('can-monitor-id-200')).toBeVisible()

    // Play at 20x: the trace builds up from nothing, 0x200 only near the end.
    await page.getByTestId('can-monitor-speed').selectOption('20')
    await page.getByTestId('can-monitor-play').click()
    await expect(page.getByTestId('can-monitor-play')).toContainText('Pause')
    await expect(page.getByTestId('can-monitor-id-200')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTestId('can-monitor-play')).toContainText('Play', { timeout: 5_000 })
    await expect(page.getByTestId('can-monitor-position')).toHaveText('9.50 / 9.50 s')
    // Every frame played is kept (the view's buffer is sized for the whole log).
    await page.getByTestId('can-monitor-view-stream').click()
    await expect(page.getByTestId('can-monitor-count')).toHaveText('11 frames')
    await page.getByTestId('can-monitor-view-by-id').click()

    // Seek to 3 s: only 0x100 has been seen, four times.
    await page.getByTestId('can-monitor-scrubber').fill('3000')
    await expect(page.getByTestId('can-monitor-position')).toHaveText('3.00 / 9.50 s')
    await expect(page.getByTestId('can-monitor-id-200')).toHaveCount(0)
    await expect(page.getByTestId('can-monitor-id-100')).toContainText('4')

    await page.getByTestId('can-monitor-show-all').click()
    await expect(page.getByTestId('can-monitor-position')).toHaveText('whole log')
    await expect(page.getByTestId('can-monitor-id-200')).toBeVisible()
  })

  test('a CSV saved here opens back', async ({ page }) => {
    const csv = 'timestamp_s,bus,direction,id,extended,fd,remote,error,length,data\n1.000000,1,tx,123,0,0,0,0,2,01 02\n'
    await openLogFile(page, 'capture.csv', csv)
    await page.getByTestId('can-monitor-view-stream').click()
    await expect(page.getByTestId('can-monitor-row')).toHaveCount(1)
    await expect(page.getByTestId('can-monitor-row')).toContainText('TX')
  })

  test('Save… keeps the held frames without a recording, filtered on request', async ({ page }) => {
    await page.goto('/')
    await connectDemo(page)
    await openCanTab(page)
    await page.getByTestId('can-bus-start').click()
    await page.getByTestId('can-subtab-frames').click()
    await expect(page.getByTestId('can-monitor-row').first()).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('can-monitor-filter-ids').fill('123')

    await page.getByTestId('can-monitor-save-buffer').click()
    await expect(page.getByTestId('can-monitor-save-popover')).toBeVisible()
    await expect(page.getByTestId('can-monitor-save-filtered')).toBeChecked()
    const downloadPromise = page.waitForEvent('download')
    await page.getByTestId('can-monitor-save-buffer-candump').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^can-buffer-.*\.log$/)
    const { readFile } = await import('node:fs/promises')
    const text = await readFile((await download.path())!, 'utf8')
    const lines = text.trim().split('\n')
    expect(lines.length).toBeGreaterThan(0)
    // Filtered: only 0x123 frames.
    expect(lines.every((line) => / can0 123#/.test(line))).toBe(true)
    await expect(page.getByTestId('can-monitor-save-popover')).toHaveCount(0)
  })
})

test.describe('CAN tab: Devices, Messages, Plot', () => {
  async function openCan(page: Page): Promise<void> {
    await page.goto('/')
    await connectDemo(page)
    await openCanTab(page)
    await page.getByTestId('can-bus-start').click()
    await expect(page.getByTestId('can-bus-stop')).toBeVisible()
  }

  test('Devices is the default: a node rail, every node card, and selecting one narrows to it', async ({ page }) => {
    await openCan(page)
    await expect(page.getByTestId('can-subtab-devices')).toHaveAttribute('aria-selected', 'true')
    const rail = page.getByTestId('can-node-rail')
    await expect(rail.getByTestId('can-rail-bus')).toHaveAttribute('aria-pressed', 'true')
    await expect(rail.getByTestId('can-rail-node-124')).toContainText('Node 124', { timeout: 15_000 })
    await expect(page.getByTestId('can-bus-node-124')).toBeVisible()
    await expect(page.getByTestId('can-bus-node-50')).toBeVisible()
    await rail.getByTestId('can-rail-node-50').click()
    await expect(page.getByTestId('can-bus-node-50')).toBeVisible()
    await expect(page.getByTestId('can-bus-node-124')).toHaveCount(0)
    await rail.getByTestId('can-rail-bus').click()
    await expect(page.getByTestId('can-bus-node-124')).toBeVisible()
  })

  test('Messages lists every decoded stream, split per ESC, and inspects the selected one', async ({ page }) => {
    await openCan(page)
    await page.getByTestId('can-subtab-messages').click()
    const messages = page.getByTestId('can-messages-bus')
    await expect(messages.getByTestId('can-message-NodeStatus-124')).toContainText('health OK', { timeout: 15_000 })
    // node 50 sends esc.Status for four ESCs: one stream each, not one mixed stream.
    await expect(messages.getByTestId('can-message-Status-50-0')).toContainText('esc.Status #0')
    await expect(messages.getByTestId('can-message-Status-50-3')).toContainText('esc.Status #3')

    await page.getByTestId('can-messages-node-124').click()
    await expect(messages.getByTestId('can-message-Status-50-0')).toHaveCount(0)
    await page.getByTestId('can-messages-node-all').click()

    await messages.getByTestId('can-message-NodeStatus-124').locator('.can-messages__name').click()
    const inspector = page.getByTestId('can-message-inspector')
    await expect(inspector).toContainText('uavcan.protocol.NodeStatus')
    await expect(inspector.locator('.can-monitor__tree-meaning').first()).toHaveText('OK')
  })

  test('Frames from a message points the bus monitor at exactly that stream', async ({ page }) => {
    await openCan(page)
    await page.getByTestId('can-subtab-messages').click()
    const status = page.getByTestId('can-messages-bus').getByTestId('can-message-NodeStatus-124')
    await status.getByTestId('can-message-show-frames').click({ timeout: 15_000 })
    await expect(page.getByTestId('can-subtab-frames')).toHaveAttribute('aria-selected', 'true')
    // id/mask with the priority bits masked off: type 341 (0x155) from node 124 (0x7C).
    await expect(page.getByTestId('can-monitor-filter-ids')).toHaveValue('0001557C/00FFFFFF')
    await expect(page.getByTestId('can-monitor-row').first()).toBeVisible({ timeout: 10_000 })
    const rows = page.getByTestId('can-monitor-row')
    const count = await rows.count()
    for (let index = 0; index < count; index += 1) {
      await expect(rows.nth(index)).toContainText('NodeStatus ← 124')
    }
  })

  test('Plot charts a decoded field and a plain-CAN frame value', async ({ page }) => {
    await openCan(page)
    await page.getByTestId('can-subtab-plot').click()
    await expect(page.getByTestId('can-plot-empty')).toBeVisible()

    await page.getByTestId('can-subtab-messages').click()
    await page.getByTestId('can-messages-bus').getByTestId('can-message-Status-50-1').locator('.can-messages__name').click({ timeout: 15_000 })
    await page.getByTestId('can-message-inspector').getByTestId('can-plot-field-rpm').click()
    await expect(page.getByTestId('can-message-inspector').getByTestId('can-plot-field-rpm')).toHaveText('Plotted')
    // Deselect from Messages, then plot it again.
    await page.getByTestId('can-message-inspector').getByTestId('can-plot-field-rpm').click()
    await expect(page.getByTestId('can-message-inspector').getByTestId('can-plot-field-rpm')).toHaveText('Plot')
    await page.getByTestId('can-message-inspector').getByTestId('can-plot-field-rpm').click()
    await expect(page.getByTestId('can-message-inspector').getByTestId('can-plot-field-rpm')).toHaveText('Plotted')

    await page.getByTestId('can-subtab-plot').click()
    await page.getByTestId('can-plot-side-bytes').click()
    await page.getByTestId('can-plot-bytes-id').fill('2A0')
    await page.getByTestId('can-plot-bytes-width').selectOption('2')
    await page.getByTestId('can-plot-bytes-add').click()

    const series = page.getByTestId('can-plot-series')
    await expect(series).toHaveCount(2)
    await expect(series.nth(0)).toContainText('esc.Status #1 rpm ← 50')
    await expect(series.nth(1)).toContainText('2A0 byte 0..1 uint16 LE')
    // ESC 1 alone: a steady ~5000 rpm (the demo's 5030 + jitter), not four ESCs mixed.
    await expect.poll(async () => Number(await series.nth(0).getByTestId('can-plot-last').textContent()), { timeout: 15_000 }).toBeGreaterThan(4900)
    await expect.poll(async () => Number(await series.nth(1).getByTestId('can-plot-last').textContent()), { timeout: 15_000 }).toBeGreaterThan(900)
    const panes = page.getByTestId('can-plot-pane')
    await expect(panes).toHaveCount(2)
    await expect(panes.nth(0).locator('canvas').first()).toBeVisible()

    // Drag the bytes series onto the rpm chart: one chart, both lines.
    await series.nth(1).getByTestId('can-plot-grip').dragTo(panes.nth(0))
    await expect(panes).toHaveCount(1)
    await expect(panes.nth(0).getByTestId('can-plot-series')).toHaveCount(2)
    // And back out onto a chart of its own, by its chart menu this time.
    await panes.nth(0).getByTestId('can-plot-series').nth(1).getByTestId('can-plot-chart-menu').selectOption({ label: 'Own chart' })
    await expect(panes).toHaveCount(2)
    // Overlay all / Split all.
    await page.getByTestId('can-plot-overlay-all').click()
    await expect(panes).toHaveCount(1)
    await page.getByTestId('can-plot-split-all').click()
    await expect(panes).toHaveCount(2)

    // A saved layout brings the series and their grouping back.
    await series.nth(1).getByTestId('can-plot-grip').dragTo(panes.nth(0))
    await page.getByTestId('can-plot-layout-name').fill('ESC check')
    await page.getByTestId('can-plot-layout-save').click()
    await page.getByRole('button', { name: 'Clear all' }).click()
    await expect(page.getByTestId('can-plot-empty')).toBeVisible()
    await page.getByTestId('can-plot-layouts').selectOption('open:ESC check')
    await expect(series).toHaveCount(2)
    await expect(panes).toHaveCount(1)
  })
})

test.describe('CAN tab: Send', () => {
  async function openSend(page: Page, { expert = true } = {}): Promise<void> {
    if (expert) await page.addInitScript(() => window.sessionStorage.setItem('arduconfig:product-mode', 'expert'))
    await page.goto('/')
    await connectDemo(page)
    await openCanTab(page)
    await page.getByTestId('can-bus-start').click()
    await expect(page.getByTestId('can-bus-stop')).toBeVisible()
    if (expert) await page.getByTestId('can-subtab-send').click()
  }

  test('Send is an Expert tool: absent in Basic', async ({ page }) => {
    await openSend(page, { expert: false })
    await expect(page.getByTestId('can-subtab-plot')).toBeVisible()
    await expect(page.getByTestId('can-subtab-send')).toHaveCount(0)
  })

  test('a service request is built from its DSDL and its reply lands under Sent', async ({ page }) => {
    await openSend(page)
    await page.getByTestId('can-send-type').fill('uavcan.protocol.GetNodeInfo')
    await expect(page.getByTestId('can-send-form')).toContainText('No fields.')
    await expect(page.getByTestId('can-send-once')).toBeDisabled()
    await page.getByTestId('can-send-destination').fill('124')
    // Request, service id 1, to node 124 from this app's node 127, priority 16.
    await expect(page.getByTestId('can-send-preview')).toContainText('ID 1001FCFF')
    await page.getByTestId('can-send-once').click()

    const entry = page.getByTestId('can-send-history-entry').first()
    await expect(entry).toContainText('GetNodeInfo → node 124')
    await expect(entry.getByTestId('can-send-history-status')).toHaveText('answered', { timeout: 10_000 })
    await entry.getByRole('button', { name: 'Reply' }).click()
    await expect(entry.getByTestId('can-send-reply')).toContainText('com.hex.here3')
  })

  test('a message form takes its fields, with the type\'s constants as named values', async ({ page }) => {
    await openSend(page)
    await page.getByTestId('can-send-type').fill('uavcan.protocol.NodeStatus')
    await page.getByTestId('can-send-field-uptime_sec').fill('258')
    await page.getByRole('combobox', { name: 'health: named values' }).selectOption('HEALTH_WARNING')
    await expect(page.getByTestId('can-send-field-health')).toHaveValue('1')
    // uptime 258 = 02 01 00 00, then health 1 in the top two bits of the next byte.
    await expect(page.getByTestId('can-send-preview')).toContainText('02 01 00 00 40')
    await page.getByTestId('can-send-once').click()
    await expect(page.getByTestId('can-send-history-status').first()).toHaveText('sent')
  })

  test('a raw frame waits for the safety box, shows as TX in Frames, and a repeat stops on leaving', async ({ page }) => {
    await openSend(page)
    await page.getByTestId('can-send-mode-raw').click()
    await page.getByTestId('can-send-raw-id').fill('800')
    await expect(page.getByTestId('can-send')).toContainText('A standard ID is at most 7FF')
    await page.getByTestId('can-send-raw-id').fill('5A5')
    await page.getByTestId('can-send-raw-data').fill('de ad be ef')
    await expect(page.getByTestId('can-send-hazard-motion')).toBeVisible()
    await expect(page.getByTestId('can-send-once')).toBeDisabled()
    await page.getByTestId('can-send-props-ack').check()
    await page.getByTestId('can-send-once').click()
    await expect(page.getByTestId('can-send-history-entry').first()).toContainText('5A5 · DE AD BE EF')

    await page.getByTestId('can-send-period').fill('50')
    await page.getByTestId('can-send-repeat').click()
    const repeat = page.getByTestId('can-send-history-entry').first()
    await expect(repeat.getByTestId('can-send-history-status')).toContainText(/repeating every 50 ms · [1-9]/)

    await page.getByTestId('can-subtab-frames').click()
    await page.getByTestId('can-monitor-filter-ids').fill('5A5')
    await expect(page.getByTestId('can-monitor-row').first()).toBeVisible({ timeout: 10_000 })

    await page.getByTestId('can-subtab-send').click()
    await expect(repeat.getByTestId('can-send-history-status')).toContainText('stopped')
    await expect(repeat).toContainText('Stopped: you left the Send page.')
    // What was being composed is still there.
    await expect(page.getByTestId('can-send-raw-id')).toHaveValue('5A5')
  })

  test('a node-changing request asks once more, and starts at the magic number', async ({ page }) => {
    await openSend(page)
    await page.getByTestId('can-send-type').fill('uavcan.protocol.RestartNode')
    await page.getByTestId('can-send-destination').fill('124')
    await expect(page.getByTestId('can-send-hazard-node')).toBeVisible()
    await expect(page.getByTestId('can-send-field-magic_number')).toHaveValue(String(0xacce551b1e))
    await page.getByTestId('can-send-once').click()
    await expect(page.getByTestId('can-send-history-entry')).toHaveCount(0)
    await page.getByTestId('can-send-confirm').click()
    await expect(page.getByTestId('can-send-history-entry').first()).toContainText('RestartNode → node 124')
  })

  test('the Send composer and its history fit a 390px screen', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await openSend(page)
    await page.getByTestId('can-send-type').fill('uavcan.protocol.param.GetSet')
    await page.getByTestId('can-send-destination').fill('124')
    await page.getByTestId('can-send-field-name').fill('GPS_TYPE')
    await page.getByTestId('can-send-once').click()
    await expect(page.getByTestId('can-send-history-status').first()).toHaveText('answered', { timeout: 10_000 })
    expect((await worstViewportOverflow(page)).worst, 'send').toBeLessThanOrEqual(2)
  })
})

test.describe('CAN tab on a USB-CAN adapter (SLCAN)', () => {
  // ?canAdapter=demo opens a simulated SLCAN adapter on the demo bus instead of a serial port.
  test('with no vehicle, an adapter is the bus: nodes, parameters, messages, and sending', async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.setItem('arduconfig:product-mode', 'expert'))
    await page.goto('/?canAdapter=demo')
    await openCanTab(page)
    await expect(page.getByTestId('can-bus-start')).toBeDisabled()
    await page.getByTestId('can-adapter-bitrate').selectOption('1000000')
    await page.getByTestId('can-adapter-connect').click()

    await expect(page.getByText('Connected · USB-CAN adapter')).toBeVisible()
    const gps = page.getByTestId('can-bus-node-124')
    await expect(gps).toContainText('Node 124', { timeout: 15_000 })
    await expect(gps).toContainText('git 4a7c3f01')
    await expect(page.getByTestId('can-bus-node-toggle-124')).toContainText(/Params \([1-9]/, { timeout: 15_000 })

    await page.getByTestId('can-subtab-messages').click()
    await expect(page.getByTestId('can-messages-bus').getByTestId('can-message-NodeStatus-124')).toBeVisible({ timeout: 15_000 })

    await page.getByTestId('can-subtab-send').click()
    await expect(page.getByTestId('can-send')).toContainText('On the USB-CAN adapter as node 127')
    await page.getByTestId('can-send-type').fill('uavcan.protocol.GetNodeInfo')
    await page.getByTestId('can-send-destination').fill('124')
    await page.getByTestId('can-send-once').click()
    await expect(page.getByTestId('can-send-history-status').first()).toHaveText('answered', { timeout: 10_000 })

    await page.getByTestId('can-subtab-devices').click()
    await page.getByTestId('can-bus-stop').click()
    await expect(page.getByTestId('can-adapter-connect')).toBeVisible()
  })
})

test.describe('CAN node tools: node ID allocation and ID changes', () => {
  test('on an adapter bus, the allocator hands an asking node an ID and it joins the rail', async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.setItem('arduconfig:product-mode', 'expert'))
    await page.goto('/?canAdapter=demo')
    await openCanTab(page)
    await page.getByTestId('can-adapter-connect').click()
    const allocator = page.getByTestId('can-allocator')
    // The demo bus has an AP_Periph node with CAN_NODE = 0, asking every second.
    await expect(allocator.getByTestId('can-allocator-status')).toHaveText('A node without an ID is asking for one.', { timeout: 10_000 })
    await allocator.getByTestId('can-allocator-toggle').check()
    await expect(allocator.getByTestId('can-allocator-table')).toContainText('Node 125', { timeout: 10_000 })
    await expect(page.getByTestId('can-rail-node-125')).toBeVisible({ timeout: 10_000 })
  })

  test('over the autopilot, the allocator is not offered: the autopilot allocates', async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.setItem('arduconfig:product-mode', 'expert'))
    await page.goto('/')
    await connectDemo(page)
    await openCanTab(page)
    await page.getByTestId('can-bus-start').click()
    const allocator = page.getByTestId('can-allocator')
    await expect(allocator.getByTestId('can-allocator-toggle')).toBeDisabled()
    await expect(allocator.getByTestId('can-allocator-status')).toContainText('The autopilot hands out node IDs')
  })

  test('a node\'s ID changes: CAN_NODE written, saved, restarted, and it comes back under the new ID', async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.setItem('arduconfig:product-mode', 'expert'))
    await page.goto('/')
    await connectDemo(page)
    await openCanTab(page)
    await page.getByTestId('can-bus-start').click()
    await expect(page.getByTestId('can-bus-node-toggle-124')).toContainText(/Params \([1-9]/, { timeout: 15_000 })
    await page.getByTestId('can-bus-node-actions-124').click()
    await page.getByTestId('dronecan-node-id-124').click()
    const input = page.getByTestId('dronecan-node-id-input-124')
    await input.fill('50')
    await expect(page.getByTestId('dronecan-node-id-form-124')).toContainText('Node 50 is already on the bus.')
    await expect(page.getByTestId('dronecan-node-id-apply-124')).toBeDisabled()
    await input.fill('100')
    await page.getByTestId('dronecan-node-id-apply-124').click()
    await expect(page.getByTestId('can-bus-node-100')).toContainText('Node 100', { timeout: 15_000 })
    await expect(page.getByTestId('can-bus-node-124')).toHaveCount(0)
  })
})

test.describe('CAN tab: frame grouping and plotting vectors', () => {
  async function openCanBusRunning(page: Page): Promise<void> {
    await page.goto('/')
    await connectDemo(page)
    await openCanTab(page)
    await page.getByTestId('can-bus-start').click()
    await expect(page.getByTestId('can-bus-stop')).toBeVisible()
  }

  test('a multi-frame transfer\'s frames share a shade and a part tag; selecting one lights up the rest', async ({ page }) => {
    await openCanBusRunning(page)
    await page.getByTestId('can-subtab-frames').click()
    // esc.Status (1034 = 0x40A) from node 50: three frames per transfer.
    await page.getByTestId('can-monitor-filter-ids').fill('00040A32/00FFFFFF')
    const first = page.locator('[data-testid="can-monitor-row"][data-transfer-part="1/3"]').first()
    await expect(first).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-testid="can-monitor-row"][data-transfer-part="3/3"]').first()).toBeVisible()
    await page.getByTestId('can-monitor-pause').click()
    await first.click()
    await expect(page.locator('[data-testid="can-monitor-row"].is-sibling')).toHaveCount(2)
  })

  test('Plot: an expression over ESC fields, XY of a vector, stats, and node-message markers', async ({ page }) => {
    await openCanBusRunning(page)
    await page.getByTestId('can-subtab-plot').click()

    // ESC 0's power, as an expression over its current and voltage.
    await page.getByTestId('can-plot-side-expression').click()
    await expect(page.getByTestId('can-plot-expression').locator('summary', { hasText: 'esc_Status[0]' })).toHaveCount(1, { timeout: 15_000 })
    await page.getByTestId('can-plot-expression-input').fill('esc_Status[0].current*')
    await page.getByTestId('can-plot-expression-add').click()
    await expect(page.getByTestId('can-plot-expression-error')).toBeVisible()
    await page.getByTestId('can-plot-expression-input').fill('esc_Status[0].current*esc_Status[0].voltage')
    await page.getByTestId('can-plot-expression-add').click()
    const series = page.getByTestId('can-plot-series')
    await expect(series).toHaveCount(1)
    await expect(series.first()).toContainText('esc_Status[0].current*esc_Status[0].voltage')
    await expect.poll(async () => Number(await series.first().getByTestId('can-plot-last').textContent()), { timeout: 15_000 }).toBeGreaterThan(50)

    // The magnetometer vector as XY: x against y.
    await page.getByTestId('can-plot-side-fields').click()
    const picker = page.getByTestId('can-plot-picker')
    await picker.getByTestId('can-plot-pick-device').selectOption('124')
    const message = picker.getByTestId('can-plot-pick-message')
    const magOption = message.locator('option', { hasText: 'MagneticFieldStrength2' })
    await expect(magOption).toHaveCount(1, { timeout: 15_000 })
    await message.selectOption({ value: (await magOption.getAttribute('value'))! })
    await picker.getByTestId('can-plot-pick-fields').getByTestId('can-plot-field-magnetic_field_ga').click()
    const magPane = page.getByTestId('can-plot-pane').nth(1)
    await magPane.getByTestId('can-plot-xy').click()
    await expect(magPane.getByTestId('can-plot-xy-chart').locator('canvas')).toBeVisible()
    await expect(magPane.getByTestId('can-plot-xy-y')).toHaveValue('1')

    // Stats over what is in view: a row per line (1 for the power, 3 for the vector).
    await page.getByTestId('can-plot-stats').click()
    await expect(page.getByTestId('plot-pane-stats').locator('tbody tr')).toHaveCount(4)

    // Each chart's toolbar: zoom in pauses a live chart and zooms; reset gives the view back;
    // pan is a mode; the chart saves as a PNG.
    const powerPane = page.getByTestId('can-plot-pane').first()
    await powerPane.hover()
    await powerPane.getByTestId('can-plot-tool-zoom-in').click()
    await expect(page.getByTestId('can-plot-freeze')).toHaveText('Resume')
    await expect(powerPane.getByTestId('can-plot-tool-reset')).toBeEnabled()
    await powerPane.getByTestId('can-plot-tool-pan').click()
    await expect(powerPane.getByTestId('can-plot-tool-pan')).toHaveAttribute('aria-pressed', 'true')
    const png = page.waitForEvent('download')
    await powerPane.getByTestId('can-plot-tool-png').click()
    expect((await png).suggestedFilename()).toMatch(/\.png$/)
    await powerPane.getByTestId('can-plot-tool-reset').click()
    await page.getByTestId('can-plot-freeze').click()

    // Power (watts) and ESC 1's rpm on one chart: thousands beside a hundred-odd, so each
    // gets its own axis automatically; the toolbar switches back to one shared axis.
    await page.getByTestId('can-plot-side-expression').click()
    await page.getByTestId('can-plot-expression-input').fill('esc_Status[1].rpm*100')
    await page.getByTestId('can-plot-expression-add').click()
    await page.getByTestId('can-plot-series').nth(2).getByTestId('can-plot-chart-menu').selectOption({ index: 1 })
    await expect(powerPane.getByTestId('can-plot-series')).toHaveCount(2)
    await powerPane.hover()
    const scales = powerPane.getByTestId('can-plot-tool-scales')
    await expect(scales).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })
    await scales.click()
    await expect(scales).toHaveAttribute('aria-pressed', 'false')

    // Transforms: ESC power's rate of change, tagged d/dt beside it.
    await powerPane.getByTestId('can-plot-transform').first().selectOption('rate')
    await expect(powerPane.getByTestId('plot-transformed').first()).toContainText('d/dt')
    await powerPane.getByTestId('can-plot-transform').first().selectOption('none')
    // Histogram view, and a typed value range.
    await powerPane.getByTestId('can-plot-hist').click()
    await expect(powerPane.getByTestId('can-plot-hist-chart')).toBeVisible()
    await powerPane.getByRole('radio', { name: 'Time' }).click()
    await powerPane.hover()
    await powerPane.getByTestId('can-plot-tool-scales').click()
    await expect(powerPane.getByTestId('can-plot-tool-scales')).toHaveAttribute('aria-pressed', 'false')
    await powerPane.getByTestId('can-plot-tool-range').click()
    await powerPane.getByTestId('can-plot-range-min').fill('0')
    await powerPane.getByTestId('can-plot-range-max').fill('1000000')
    await powerPane.getByTestId('can-plot-range-set').click()
    await expect(powerPane.getByTestId('can-plot-range-form')).toHaveCount(0)
    await expect(powerPane.getByTestId('can-plot-tool-autoscale')).toBeEnabled()
    // Only when: a condition on an expression.
    await page.getByTestId('can-plot-side-expression').click()
    await page.getByTestId('can-plot-expression-input').fill('esc_Status[2].rpm')
    await page.getByTestId('can-plot-expression-condition').fill('esc_Status[2].rpm > 1000')
    await page.getByTestId('can-plot-expression-add').click()
    await expect(page.getByTestId('can-plot-series').locator('.plot-series__name', { hasText: 'esc_Status[2].rpm{esc_Status[2].rpm>1000}' })).toHaveCount(1)

    // Node messages are marked by default; the toggle turns them off.
    const markers = page.getByTestId('can-plot-node-messages')
    await expect(markers).toHaveAttribute('aria-pressed', 'true')
    await markers.click()
    await expect(markers).toHaveAttribute('aria-pressed', 'false')
  })

  test('Plot picks a device, a message and a field itself, and draws a vector as one chart', async ({ page }) => {
    await openCanBusRunning(page)
    await page.getByTestId('can-subtab-plot').click()
    const picker = page.getByTestId('can-plot-picker')
    await expect(picker.getByTestId('can-plot-pick-device').locator('option', { hasText: '124' })).toHaveCount(1, { timeout: 15_000 })
    await picker.getByTestId('can-plot-pick-device').selectOption('124')
    const message = picker.getByTestId('can-plot-pick-message')
    const magOption = message.locator('option', { hasText: 'MagneticFieldStrength2' })
    await expect(magOption).toHaveCount(1, { timeout: 15_000 })
    await message.selectOption({ value: (await magOption.getAttribute('value'))! })
    const fields = picker.getByTestId('can-plot-pick-fields')
    await fields.getByTestId('can-plot-field-magnetic_field_ga').click()
    await fields.getByTestId('can-plot-field-magnetic_field_ga.2').click()

    const series = page.getByTestId('can-plot-series')
    await expect(series).toHaveCount(2)
    await expect(series.nth(0)).toContainText('ahrs.MagneticFieldStrength2 #0 magnetic_field_ga ← 124')
    // The vector: three lines on one chart, each element's latest value shown.
    await expect(series.nth(0).getByTestId('can-plot-lane')).toHaveCount(3, { timeout: 10_000 })
    await expect(series.nth(1)).toContainText('magnetic_field_ga[2] ← 124')
    await expect.poll(async () => Number(await series.nth(1).getByTestId('can-plot-last').textContent()), { timeout: 10_000 }).toBeGreaterThan(0.4)
    await expect(fields.getByTestId('can-plot-field-magnetic_field_ga')).toHaveText('Plotted')
    // Pause (red) / Resume (green), as in Frames.
    const pause = page.getByTestId('can-plot-freeze')
    await expect(pause).toHaveText('Pause')
    await expect(pause).toHaveClass(/can-monitor__tool--pause/)
    await pause.click()
    await expect(pause).toHaveText('Resume')
    await expect(pause).toHaveClass(/can-monitor__tool--resume/)
    await pause.click()
    // Plotted is a toggle: click it and the series comes off.
    await fields.getByTestId('can-plot-field-magnetic_field_ga.2').click()
    await expect(series).toHaveCount(1)
    await fields.getByTestId('can-plot-field-magnetic_field_ga').click()
    await expect(page.getByTestId('can-plot-empty')).toBeVisible()
    await expect(fields.getByTestId('can-plot-field-magnetic_field_ga')).toHaveText('Plot all')
  })
})

test.describe('CAN bus monitor: name filter', () => {
  test('mag* keeps only the magnetometer frames', async ({ page }) => {
    await page.goto('/')
    await connectDemo(page)
    await openCanTab(page)
    await page.getByTestId('can-bus-start').click()
    await page.getByTestId('can-subtab-frames').click()
    await page.getByTestId('can-monitor-filter-name').fill('mag*')
    const rows = page.getByTestId('can-monitor-row')
    await expect(rows.first()).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('can-monitor-pause').click()
    const count = await rows.count()
    expect(count).toBeGreaterThan(0)
    for (let index = 0; index < Math.min(count, 10); index += 1) {
      await expect(rows.nth(index)).toContainText('MagneticFieldStrength2')
    }
  })
})

test.describe('CAN tab: node messages and bootloader flashing', () => {
  async function openCan(page: Page): Promise<void> {
    await page.addInitScript(() => window.sessionStorage.setItem('arduconfig:product-mode', 'expert'))
    await page.goto('/')
    await connectDemo(page)
    await openCanTab(page)
    await page.getByTestId('can-bus-start').click()
    await expect(page.getByTestId('can-bus-stop')).toBeVisible()
  }

  test('Node messages lists what nodes log, warnings first, folded, per node', async ({ page }) => {
    await openCan(page)
    const messages = page.getByTestId('can-node-messages')
    // The demo ESC node logs a warning every few seconds.
    await expect(messages.getByTestId('can-node-message').first()).toContainText('ESC 2 temperature high', { timeout: 20_000 })
    await expect(messages.getByTestId('can-node-message').first()).toContainText('warning')
    await expect(messages.getByTestId('can-node-message').first()).toContainText('50 org.ardupilot.ap_periph')
    // Narrowed to another node, it is not there.
    await page.getByTestId('can-rail-node-124').click()
    await expect(page.getByTestId('can-node-messages-empty')).toBeVisible()
  })

  test('Flash bootloader asks twice, writes FLASH_BOOTLOADER, and reports what the node says', async ({ page }) => {
    await openCan(page)
    await expect(page.getByTestId('can-bus-node-toggle-50')).toContainText(/Params \([1-9]/, { timeout: 15_000 })
    await page.getByTestId('can-bus-node-actions-50').click()
    await page.getByTestId('dronecan-bootloader-start-50').click()
    await page.getByTestId('dronecan-bootloader-confirm-50').click()
    await expect(page.getByTestId('dronecan-bootloader-50')).toContainText('Keep the node powered')
    await page.getByTestId('dronecan-bootloader-confirm2-50').click()
    await expect(page.getByTestId('dronecan-bootloader-status-50')).toHaveText('Bootloader flashed.', { timeout: 15_000 })
    // The node's answer is in Node messages too.
    await expect(page.getByTestId('can-node-messages')).toContainText('Flash bootloader OK')
    // The params are pulled again: FLASH_BOOTLOADER reads 0.
    await page.getByTestId('can-bus-node-toggle-50').click()
    await expect(page.getByTestId('can-bus-param-input-50-FLASH_BOOTLOADER')).toHaveValue('0', { timeout: 15_000 })
    // A second run finds it current: the node says "Bootloader unchanged", and so does the card.
    await page.getByTestId('can-bus-node-actions-50').click()
    await page.getByTestId('dronecan-bootloader-start-50').click()
    await page.getByTestId('dronecan-bootloader-confirm-50').click()
    await page.getByTestId('dronecan-bootloader-confirm2-50').click()
    await expect(page.getByTestId('dronecan-bootloader-status-50')).toHaveText('Bootloader unchanged: it is already up to date.', { timeout: 15_000 })
    await expect(page.getByTestId('can-node-messages')).toContainText('Bootloader unchanged')
  })
})
