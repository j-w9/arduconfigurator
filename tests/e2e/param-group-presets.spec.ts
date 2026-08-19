import { expect, test, type Page } from '@playwright/test'

// Parameter-group presets: select rows in the Parameter Editor, answer what the
// group depends on, save, and find it in the Presets tab with those dependencies
// surfaced as warnings. The dependency CLASSIFIER is unit-tested exhaustively in
// apps/web/src/view-models/preset-dependencies.test.ts; what only an e2e run can
// prove is that the selection, the dialog, the storage round-trip, and the
// Presets tab are actually wired to each other.

const VEHICLE_CONNECT_TIMEOUT = 30_000

async function connectAndOpenParameters(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByTestId('transport-mode-select').selectOption('demo')
  await page.getByTestId('connect-button').click()
  await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })
  // Rows stream in with the param sync; selecting before it finishes races it.
  await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
    timeout: VEHICLE_CONNECT_TIMEOUT
  })
  await page.getByTestId('product-mode-expert').click()
  await page.getByTestId('view-button-parameters').click()
}

test.describe('Parameter-group presets', () => {
  test('selects a filtered group, records its dependencies, and saves a preset that appears in Presets', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await connectAndOpenParameters(page)

    // Filter to the battery family, then take every visible row. The
    // visible-rows-only rule means this can only ever capture BATT_* params.
    await page.getByTestId('parameter-search-input').fill('BATT_*')
    await page.getByTestId('parameter-preset-select-all').check()
    const createButton = page.getByTestId('parameter-create-preset')
    await expect(createButton).not.toHaveText('Create preset (0)')
    await createButton.click()

    const dialog = page.getByTestId('create-preset-dialog')
    await expect(dialog).toBeVisible()

    // The battery-pack question must be present AND pre-ticked — the whole
    // point is that the operator corrects an answer rather than authoring one.
    const batteryQuestion = page.getByTestId('create-preset-dependency-battery-pack')
    await expect(batteryQuestion).toBeChecked()

    // Saving is gated on a name.
    const save = page.getByTestId('create-preset-save')
    await expect(save).toBeDisabled()
    await page.getByTestId('create-preset-name').fill('6S pack thresholds')
    await page.getByTestId('create-preset-cell-count').fill('6')
    await expect(save).toBeEnabled()
    await save.click()

    await expect(dialog).toBeHidden()
    await expect(page.getByTestId('parameter-notice')).toContainText('6S pack thresholds')

    // The saved preset is a first-class preset: it shows up in the Presets tab's
    // card grid and selecting it surfaces the recorded dependency.
    await page.getByTestId('view-button-presets').click()
    const card = page.locator('[data-testid^="preset-card-user:"]').first()
    await expect(card).toBeVisible()
    await expect(card).toContainText('6S pack thresholds')
    await card.click()
    await expect(page.getByTestId('preset-dependency-pill-Battery pack (4S / 6S, capacity)')).toBeVisible()
    // Only operator-authored presets are deletable.
    await expect(page.getByTestId('preset-delete-button')).toBeVisible()
  })

  test('edits a saved preset: rename it and drop a captured parameter', async ({ page }) => {
    // A preset is captured from whatever the aircraft happened to hold, so it is
    // routinely almost-right — one stale value, one parameter that should never
    // have been swept in. Without editing the only repair is delete and
    // re-capture, which means getting the aircraft back into that state again.
    await page.setViewportSize({ width: 1280, height: 900 })
    await connectAndOpenParameters(page)

    await page.getByTestId('parameter-search-input').fill('BATT_*')
    await page.getByTestId('parameter-preset-select-all').check()
    await page.getByTestId('parameter-create-preset').click()
    await page.getByTestId('create-preset-name').fill('Editable preset')
    await page.getByTestId('create-preset-save').click()

    await page.getByTestId('view-button-presets').click()
    const card = page.locator('[data-testid^="preset-card-user:"]').first()
    await card.click()

    await page.getByTestId('preset-edit-button').click()
    const editor = page.getByTestId('preset-editor')
    await expect(editor).toBeVisible()

    // Drop the first captured parameter, and rename.
    const firstRemove = editor.locator('[data-testid^="preset-edit-remove-"]').first()
    const removedId = await firstRemove.getAttribute('data-testid')
    const rowCountBefore = await editor.locator('[data-testid^="preset-edit-remove-"]').count()
    await firstRemove.click()
    await expect(editor.locator('[data-testid^="preset-edit-remove-"]')).toHaveCount(rowCountBefore - 1)

    await page.getByTestId('preset-edit-label').fill('Renamed preset')
    await page.getByTestId('preset-edit-save').click()
    await expect(editor).toBeHidden()

    // The rename reaches the card grid, and the dropped parameter is gone for
    // good — re-opening the editor must not resurrect it.
    await expect(page.locator('[data-testid^="preset-card-user:"]').first()).toContainText('Renamed preset')
    await page.getByTestId('preset-edit-button').click()
    await expect(page.getByTestId(removedId!.replace('data-testid=', ''))).toHaveCount(0)
  })

  test('will not save a preset edit that leaves it nameless or empty', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await connectAndOpenParameters(page)

    await page.getByTestId('parameter-search-input').fill('BATT_*')
    await page.getByTestId('parameter-preset-select-all').check()
    await page.getByTestId('parameter-create-preset').click()
    await page.getByTestId('create-preset-name').fill('Guard rails')
    await page.getByTestId('create-preset-save').click()

    await page.getByTestId('view-button-presets').click()
    await page.locator('[data-testid^="preset-card-user:"]').first().click()
    await page.getByTestId('preset-edit-button').click()

    // A nameless preset renders a card that cannot be told from its neighbours.
    await page.getByTestId('preset-edit-label').fill('   ')
    await expect(page.getByTestId('preset-edit-save')).toBeDisabled()
    await page.getByTestId('preset-edit-label').fill('Fine')
    await expect(page.getByTestId('preset-edit-save')).toBeEnabled()

    // A preset with nothing in it would apply nothing.
    const editor = page.getByTestId('preset-editor')
    const removes = editor.locator('[data-testid^="preset-edit-remove-"]')
    let remaining = await removes.count()
    while (remaining > 0) {
      await removes.first().click()
      remaining = await removes.count()
    }
    await expect(page.getByTestId('preset-edit-empty')).toBeVisible()
    await expect(page.getByTestId('preset-edit-save')).toBeDisabled()
  })

  test('offers a serial-port remap for a preset captured on a specific UART', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await connectAndOpenParameters(page)

    await page.getByTestId('parameter-search-input').fill('SERIAL1_*')
    await page.getByTestId('parameter-preset-select-all').check()
    await page.getByTestId('parameter-create-preset').click()

    await expect(page.getByTestId('create-preset-dependency-serial-port')).toBeChecked()
    await page.getByTestId('create-preset-name').fill('Telemetry on UART1')
    await page.getByTestId('create-preset-save').click()

    await page.getByTestId('view-button-presets').click()
    await page.locator('[data-testid^="preset-card-user:"]').first().click()

    const remap = page.getByTestId('preset-serial-remap')
    await expect(remap).toBeVisible()
    await expect(remap).toContainText('SERIAL1')
    // Re-targeting rewrites the diff itself, so the review list the operator
    // acknowledges is the one that will be written.
    await page.getByTestId('preset-serial-remap-select').selectOption('2')
    // `.first()` — the selected panel renders a changed grid and, separately, an
    // invalid grid; the changed one is what the remap must have rewritten.
    await expect(page.locator('.preset-selected .parameter-diff-grid').first()).toContainText('SERIAL2_')
  })

  test('keeps a selection that the filter hides, and never lets a filtered action reach it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await connectAndOpenParameters(page)

    await page.getByTestId('parameter-search-input').fill('BATT_LOW_VOLT')
    await page.getByTestId('parameter-preset-select-BATT_LOW_VOLT').click()
    await expect(page.getByTestId('parameter-create-preset')).toHaveText('Create preset (1)')

    // Filter it away: the row is gone, Create preset drops to 0 (it acts on
    // visible rows only), but the selection itself survives and is reported.
    await page.getByTestId('parameter-search-input').fill('ATC_RAT_RLL_P')
    await expect(page.getByTestId('parameter-create-preset')).toHaveText('Create preset (0)')
    await expect(page.getByTestId('parameter-preset-hidden-count')).toContainText('1 selected row')

    // Clearing the filter brings it back.
    await page.getByTestId('parameter-search-input').fill('BATT_LOW_VOLT')
    await expect(page.getByTestId('parameter-create-preset')).toHaveText('Create preset (1)')
  })

  test('the create dialog fits a phone without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await connectAndOpenParameters(page)

    await page.getByTestId('parameter-search-input').fill('BATT_*')
    await page.getByTestId('parameter-preset-select-all').check()
    await page.getByTestId('parameter-create-preset').click()
    await expect(page.getByTestId('create-preset-dialog')).toBeVisible()

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(2)
  })
})

test.describe('Parameter search strictness', () => {
  // Fuzzy search is the default because it finds a name you half-remember. It
  // also returns every row whose letters appear in order -- 'FS_THR' pulls in
  // FS_EKF_THRESH -- which is the wrong answer when you know the name already.
  test('the Exact match box drops the fuzzy neighbours', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await connectAndOpenParameters(page)

    const rows = page.locator('.parameter-row:not(.parameter-row--header)')
    await page.getByTestId('parameter-search-input').fill('FS_THR')
    await expect(page.locator('.parameter-row[data-param-row="FS_EKF_THRESH"]')).toBeVisible()
    const fuzzyCount = await rows.count()

    await page.getByTestId('parameter-exact-search-toggle').check()
    // The rows that actually contain the typed text survive; the letters-in-order
    // neighbour does not.
    await expect(page.locator('.parameter-row[data-param-row="FS_THR_ENABLE"]')).toBeVisible()
    await expect(page.locator('.parameter-row[data-param-row="FS_EKF_THRESH"]')).toHaveCount(0)
    expect(await rows.count()).toBeLessThan(fuzzyCount)

    // Unticking restores the wider set: a filter, not a mode you get stuck in.
    await page.getByTestId('parameter-exact-search-toggle').uncheck()
    await expect(rows).toHaveCount(fuzzyCount)
  })

  test('wildcards behave the same either way', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await connectAndOpenParameters(page)

    const rows = page.locator('.parameter-row:not(.parameter-row--header)')
    await page.getByTestId('parameter-search-input').fill('BATT*MONITOR')
    await expect(rows.first()).toBeVisible()
    const globCount = await rows.count()
    expect(globCount).toBeGreaterThan(0)

    await page.getByTestId('parameter-exact-search-toggle').check()
    await expect(rows).toHaveCount(globCount)
  })
})

test.describe('Parameter reference with no vehicle', () => {
  // Looking a parameter up is a reading task. With nothing connected the
  // editor used to report "No parameters match the current filter", which is
  // true of the vehicle and false of the question being asked.
  async function openParametersDisconnected(page: Page): Promise<void> {
    await page.goto('/')
    await page.getByTestId('product-mode-expert').check()
    await page.getByTestId('view-button-parameters').click()
  }

  test('searches the built-in reference instead of reporting an empty filter', async ({ page }) => {
    await openParametersDisconnected(page)

    const reference = page.getByTestId('parameter-reference')
    await expect(reference).toBeVisible()
    await expect(reference).toContainText('Not connected')

    await page.getByTestId('parameter-search-input').fill('BATT_MONITOR')
    await page.getByTestId('parameter-exact-search-toggle').check()
    const row = page.getByTestId('parameter-reference-row-BATT_MONITOR')
    await expect(row).toBeVisible()
    // The reference material, not an empty editor row: what it means and what
    // its values are.
    await expect(row).toContainText('Battery Monitor')
    await expect(row).toContainText('Analog Voltage and Current')

    // Nothing is editable, because there is nothing to write to.
    await expect(row.locator('input')).toHaveCount(0)
  })

  test('says when it is showing only the first page of matches', async ({ page }) => {
    await openParametersDisconnected(page)
    // An empty query matches the whole bundle, which is far past the cap.
    await expect(page.getByTestId('parameter-reference-more')).toContainText('narrow the search')
  })

  test('reports a search that matches nothing in the reference', async ({ page }) => {
    await openParametersDisconnected(page)
    await page.getByTestId('parameter-search-input').fill('ZZZ_NOT_A_REAL_PARAM')
    await expect(page.getByTestId('parameter-reference')).toContainText('No parameter in the reference matches')
  })
})
