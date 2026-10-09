import { expect, test, type Page } from '@playwright/test'
import { worstViewportOverflow } from './support/overflow'

// The DroneCAN inspector was the only main nav view without an e2e smoke test
// (its decode + node-discovery logic is unit-covered by
// runtime.dronecan-nodes.test.mjs / dronecan-decoders.test.mjs, but the view
// itself was never opened in a browser test). These pin:
//   - the tab is reachable after connect and renders the inspector intro,
//   - starting CAN forwarding transitions to the active scanning state.
// The demo emits no CAN nodes, so the active state shows the "no NodeStatus
// broadcasts yet" empty message rather than a populated node list.

async function connectDemo(page: Page): Promise<void> {
  await page.getByTestId('transport-mode-select').selectOption('demo')
  await page.getByTestId('connect-button').click()
  await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter')
}

test.describe('DroneCAN inspector', () => {
  test('CAN tab is reachable and renders the inspector intro', async ({ page }) => {
    await page.goto('/')
    await connectDemo(page)
    await page.getByTestId('view-button-can').click()

    // The inspector panel renders with its bus picker + start control.
    await expect(page.getByRole('heading', { name: 'DroneCAN Bus' })).toBeVisible()
    await expect(page.getByTestId('can-bus-select')).toBeVisible()
    await expect(page.getByTestId('can-bus-start')).toBeEnabled()
    // Pre-scan intro explains the MAV_CMD_CAN_FORWARD flow.
    await expect(page.getByText('MAV_CMD_CAN_FORWARD').first()).toBeVisible()
  })

  test('starting forwarding discovers the simulated DroneCAN nodes + params', async ({ page }) => {
    await page.goto('/')
    await connectDemo(page)
    await page.getByTestId('view-button-can').click()

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
    await page.getByTestId('view-button-can').click()
    await page.getByTestId('can-bus-start').click()

    const toggle = page.getByTestId('can-bus-node-toggle-124')
    await expect(toggle).toContainText(/Params \([1-9]/)
    await toggle.click()

    // Editing a value stages it — nothing is written yet; the staged
    // panel shows the current → new comparison.
    const input = page.getByTestId('can-bus-param-input-124-GPS_TYPE')
    const before = await input.inputValue()
    await input.fill('9')
    const staged = page.getByTestId('can-bus-staged-124')
    await expect(staged).toBeVisible()
    await expect(page.getByTestId('can-bus-staged-row-124-GPS_TYPE')).toContainText(`${before} → 9`)

    // Apply all writes the set; the GetSet read-back lands in the table
    // and the staged panel clears.
    await page.getByTestId('can-bus-apply-all-124').click()
    await expect(staged).toHaveCount(0)
    await expect(input).toHaveValue('9')

    // Dropping a staged edit un-stages without writing.
    await input.fill('3')
    await expect(page.getByTestId('can-bus-staged-124')).toBeVisible()
    await page.getByTestId('can-bus-staged-drop-124-GPS_TYPE').click()
    await expect(page.getByTestId('can-bus-staged-124')).toHaveCount(0)
    await expect(input).toHaveValue('9')
  })

  test('a custom node name persists across reload (keyed by hardware UID)', async ({ page }) => {
    await page.goto('/')
    await connectDemo(page)
    await page.getByTestId('view-button-can').click()
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
    await page.getByTestId('view-button-can').click()
    await page.getByTestId('can-bus-start').click()
    await expect(page.getByTestId('can-bus-node-124').getByText('Front GPS')).toBeVisible()
  })

  test('a device pops out into its own styled window, scoped to that node', async ({ page, context }) => {
    await page.goto('/')
    await connectDemo(page)
    // Expert mode so the popout carries the device actions that used to live in
    // the separate DroneCAN Inspector tab (restart / firmware update).
    await page.getByTestId('product-mode-expert').check()
    await page.getByTestId('view-button-can').click()
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
    await expect(popout.getByTestId('can-bus-param-input-124-GPS_TYPE')).toBeVisible({ timeout: 12000 })
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
    await expect(popout.getByTestId('can-bus-param-input-124-GPS_TYPE')).toBeVisible()
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
    await page.getByTestId('view-button-can').click()
    await page.getByTestId('can-bus-start').click()
    await expect(page.getByTestId('can-bus-stop')).toBeVisible()
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
    await page.getByTestId('can-monitor-pause').click()
    await expect(page.getByTestId('can-monitor-pause')).toHaveText(/Resume \(\+\d[\d,]*\)/, { timeout: 10_000 })
    await page.getByTestId('can-monitor-pause').click()
    await expect(page.getByTestId('can-monitor-pause')).toHaveText('Pause')
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
  test('the bus monitor, node cards and ESC table fit a 390px screen', async ({ page }) => {
    // A content-sized app shell takes its width from the widest thing on the
    // page: the ESC table and the node buttons pushed it to ~790px once the
    // bus came up. Both tables now scroll in their own box.
    await page.setViewportSize({ width: 390, height: 900 })
    await page.goto('/')
    await connectDemo(page)
    await page.getByTestId('view-button-can').click()
    await page.getByTestId('can-bus-start').click()
    await expect(page.getByTestId('dronecan-esc-table')).toBeVisible({ timeout: 15_000 })
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
    await page.getByTestId('view-button-can').click()
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
    await page.getByTestId('view-button-can').click()
    await page.getByTestId('can-bus-start').click()
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
