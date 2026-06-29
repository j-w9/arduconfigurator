import { expect, test, type Page } from '@playwright/test'

// The RC option mixer view is an Expert-only scaffold: ArduPilot doesn't yet
// expose multi-function-per-channel with PWM ranges, so it's gated behind Expert
// mode (alongside the inspectors) and carries a persistent "Not available in
// ArduPilot" callout so operators can't mistake the preview for a live write
// path. These tests pin:
//   - the view is gated behind Expert mode, then visible in the nav.
//   - the ArduPilot-gap callout + scaffold banner are both visible.
//   - the per-channel PWM chart renders for every channel.
//   - assignment add / edit / remove works against local state.

async function connectViaLandingDemo(page: Page): Promise<void> {
  await page.getByTestId('landing-transport-select').selectOption('demo')
  await page.getByTestId('landing-connect-button').click()
  await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter')
  // RC Mixer is Expert-only — reveal it before the tests reach for its nav tab.
  await page.getByTestId('product-mode-expert').check()
}

test.describe('RC Mixer scaffold', () => {
  test('is gated behind Expert mode, then appears in the nav', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('landing-transport-select').selectOption('demo')
    await page.getByTestId('landing-connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter')
    // Hidden until Expert mode is on.
    await expect(page.getByTestId('view-button-rc-mixer')).toHaveCount(0)
    await page.getByTestId('product-mode-expert').check()
    await expect(page.getByTestId('view-button-rc-mixer')).toBeVisible()
  })

  test('renders the ArduPilot-gap callout and the per-channel PWM chart', async ({ page }) => {
    await page.goto('/')
    await connectViaLandingDemo(page)
    await page.getByTestId('view-button-rc-mixer').click()

    // The permanent warning callout — mirroring the VTX "Table not available"
    // pattern — must be visible and must name ArduPilot, so reviewers can
    // never mistake the surface for a live write path.
    const callout = page.getByTestId('rc-mixer-ardupilot-gap-callout')
    await expect(callout).toBeVisible()
    await expect(callout).toContainText('Not available in ArduPilot')
    await expect(callout).toContainText('RCn_OPTION')

    // The chart visualizer renders for every channel even when empty.
    await expect(page.getByTestId('rc-mixer-track-1')).toBeVisible()
    await expect(page.getByTestId('rc-mixer-track-16')).toBeVisible()

    // Add an assignment to channel 5 and confirm the band materializes.
    await page.getByTestId('rc-mixer-add-channel-5').click()
    const band = page.locator('[data-testid^="rc-mixer-track-band-"]').first()
    await expect(band).toBeVisible()
  })

  test('add / edit / remove a channel assignment', async ({ page }) => {
    await page.goto('/')
    await connectViaLandingDemo(page)
    await page.getByTestId('view-button-rc-mixer').click()

    // Scaffold banner is always visible — second line of defense against
    // operators mistaking the preview for a live write surface.
    await expect(page.getByTestId('rc-mixer-scaffold-banner')).toBeVisible()
    await expect(page.getByTestId('rc-mixer-scaffold-banner')).toContainText('Local-only preview')

    await page.getByTestId('rc-mixer-add-channel-5').click()
    const assignmentRow = page.locator('[data-testid^="rc-mixer-assignment-"]').first()
    await expect(assignmentRow).toBeVisible()

    const assignmentTestId = await assignmentRow.getAttribute('data-testid')
    expect(assignmentTestId).toBeTruthy()
    const assignmentId = assignmentTestId!.replace('rc-mixer-assignment-', '')

    await page.getByTestId(`rc-mixer-function-${assignmentId}`).selectOption('27')

    await page.getByTestId(`rc-mixer-low-${assignmentId}`).fill('1800')
    await page.getByTestId(`rc-mixer-high-${assignmentId}`).fill('2000')

    const invertedToggle = page.getByTestId(`rc-mixer-inverted-${assignmentId}`)
    await expect(invertedToggle).not.toBeChecked()
    await invertedToggle.check()
    await expect(invertedToggle).toBeChecked()

    await page.getByTestId(`rc-mixer-remove-${assignmentId}`).click()
    await expect(page.getByTestId(assignmentTestId!)).toHaveCount(0)
    const channelFive = page.getByTestId('rc-mixer-channel-5')
    await expect(channelFive).toContainText('No functions assigned to this channel.')
  })
})
