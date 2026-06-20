import { expect, test, type Page } from '@playwright/test'

// The RC option mixer view used to be flag-gated behind ?rcMixer=1 because
// ArduPilot doesn't yet expose multi-function-per-channel with PWM ranges.
// It graduated to the main nav once the persistent "Not available in
// ArduPilot" callout proved load-bearing — operators can't mistake the
// preview for a live write path. These tests pin:
//   - the view is visible by default in the main nav after connect.
//   - the ArduPilot-gap callout + scaffold banner are both visible.
//   - the per-channel PWM chart renders for every channel.
//   - assignment add / edit / remove works against local state.

async function connectViaLandingDemo(page: Page): Promise<void> {
  await page.getByTestId('landing-transport-select').selectOption('demo')
  await page.getByTestId('landing-connect-button').click()
  await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter')
}

test.describe('RC Mixer scaffold', () => {
  test('appears in the main nav after connect', async ({ page }) => {
    await page.goto('/')
    await connectViaLandingDemo(page)
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
