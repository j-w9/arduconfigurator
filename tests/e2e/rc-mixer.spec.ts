import { expect, test, type Page } from '@playwright/test'

// RC Mixer binds to the AP_RC_Logic engine (RCL_* params). When the connected
// firmware reports RCL_ENABLE it is a real, param-backed editor — edits stage as
// RCL_* drafts through the normal write path. The demo Copter streams RCL_ENABLE
// plus two example range terms (ch5 -> ArmDisarm, ch6 -> LAND), so these tests
// exercise the real path. A firmware without AP_RC_Logic (the Plane demo) still
// gets the preview scaffold. The view stays Expert-only.

async function connectCopterDemo(page: Page): Promise<void> {
  await page.getByTestId('landing-transport-select').selectOption('demo')
  await page.getByTestId('landing-connect-button').click()
  await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter')
  await page.getByTestId('product-mode-expert').check()
}

test.describe('RC Mixer (AP_RC_Logic)', () => {
  test('is gated behind Expert mode, then appears in the nav', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('landing-transport-select').selectOption('demo')
    await page.getByTestId('landing-connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter')
    await expect(page.getByTestId('view-button-rc-mixer')).toHaveCount(0)
    await page.getByTestId('product-mode-expert').check()
    await expect(page.getByTestId('view-button-rc-mixer')).toBeVisible()
  })

  test('binds to RCL_* when supported: engine toggle + example terms, no preview callout', async ({ page }) => {
    await page.goto('/')
    await connectCopterDemo(page)
    await page.getByTestId('view-button-rc-mixer').click()

    // Real editor: engine controls, RCL_ENABLE reflected as enabled.
    await expect(page.getByTestId('rc-mixer-engine-controls')).toBeVisible()
    await expect(page.getByTestId('rc-mixer-engine-enable')).toBeChecked()
    // The preview scaffold must NOT show when the firmware supports the engine.
    await expect(page.getByTestId('rc-mixer-ardupilot-gap-callout')).toHaveCount(0)
    await expect(page.getByTestId('rc-mixer-scaffold-banner')).toHaveCount(0)

    // The two seeded range terms read back as bands (ch5 -> rcl-1, ch6 -> rcl-2).
    await expect(page.getByTestId('rc-mixer-track-band-rcl-1')).toBeVisible()
    await expect(page.getByTestId('rc-mixer-track-band-rcl-2')).toBeVisible()
    await expect(page.getByTestId('rc-mixer-channel-5')).toContainText('ArmDisarm')
  })

  test('add / edit / remove a term round-trips through the RCL_* drafts', async ({ page }) => {
    await page.goto('/')
    await connectCopterDemo(page)
    await page.getByTestId('view-button-rc-mixer').click()
    // Wait until the seeded terms have synced (model populated) before adding —
    // otherwise the free-slot allocation races an empty model.
    await expect(page.getByTestId('rc-mixer-track-band-rcl-2')).toBeVisible()

    // Add a term on channel 7 -> allocates the first free slot (term 3) and the
    // pending row appears, driven entirely by the staged RCL3_* drafts.
    await page.getByTestId('rc-mixer-add-channel-7').click()
    await expect(page.getByTestId('rc-mixer-assignment-rcl-3')).toBeVisible()
    await expect(page.getByTestId('rc-mixer-track-band-rcl-3')).toBeVisible()

    // Editing round-trips through the model (reads back the draft immediately).
    await page.getByTestId('rc-mixer-function-rcl-3').selectOption('16') // AUTO Mode
    await page.getByTestId('rc-mixer-low-rcl-3').fill('1800')
    await page.getByTestId('rc-mixer-high-rcl-3').fill('2000')
    await expect(page.getByTestId('rc-mixer-channel-7')).toContainText('AUTO Mode')

    // Remove clears the term drafts -> row gone, channel 7 empty again.
    await page.getByTestId('rc-mixer-remove-rcl-3').click()
    await expect(page.getByTestId('rc-mixer-assignment-rcl-3')).toHaveCount(0)
    await expect(page.getByTestId('rc-mixer-channel-7')).toContainText('No functions assigned to this channel.')
  })

  test('range edges adjust via the drag handle (keyboard + pointer)', async ({ page }) => {
    await page.goto('/')
    await connectCopterDemo(page)
    await page.getByTestId('view-button-rc-mixer').click()
    await expect(page.getByTestId('rc-mixer-track-band-rcl-1')).toBeVisible()

    const highInput = page.getByTestId('rc-mixer-high-rcl-1')
    await expect(highInput).toHaveValue('2100')

    // Keyboard: focus the high grip and nudge it one 25 μs step down.
    const highHandle = page.getByTestId('rc-mixer-handle-high-rcl-1')
    await highHandle.focus()
    await highHandle.press('ArrowLeft')
    await expect(highInput).toHaveValue('2075')

    // Pointer: drag the high grip further left -> the value shrinks, staying in range.
    const box = await highHandle.boundingBox()
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x - 80, box.y + box.height / 2, { steps: 6 })
      await page.mouse.up()
      const dragged = Number(await highInput.inputValue())
      expect(dragged).toBeLessThan(2075)
      expect(dragged).toBeGreaterThanOrEqual(800)
    }
    // The manual input still works alongside the handle.
    await highInput.fill('1950')
    await expect(highInput).toHaveValue('1950')
  })

  test('a firmware without AP_RC_Logic keeps the preview scaffold', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo-plane')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduPlane')
    await page.getByTestId('product-mode-expert').check()
    await page.getByTestId('view-button-rc-mixer').click()

    const callout = page.getByTestId('rc-mixer-ardupilot-gap-callout')
    await expect(callout).toBeVisible()
    await expect(callout).toContainText('Not available in ArduPilot')
    // No real engine controls without RCL_*.
    await expect(page.getByTestId('rc-mixer-engine-controls')).toHaveCount(0)
  })
})
