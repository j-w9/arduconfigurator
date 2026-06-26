import { expect, test, type Page } from '@playwright/test'

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
    await expect(page.getByText('Discover DroneCAN devices on the CAN bus', { exact: false })).toBeVisible()
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
})
