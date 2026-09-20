import { expect, test, type Page } from '@playwright/test'

// A step that needs a Lua applet on the flight controller.
//
// Two of the sequence's steps do nothing until their script is on the vehicle.
// This used to stop at "download it and copy it across with the Files tab",
// partly because the MAVFTP transfer it needs was, at the time, known to hang.
// It no longer is, and both script sources send `Access-Control-Allow-Origin: *`,
// so the browser can fetch them directly.
//
// Only a real browser can answer whether that works: a component test stubs
// both the fetch and the upload, which is every part that could fail. Here the
// file is actually fetched over the network and actually written to the mock
// vehicle over MAVFTP.

const VEHICLE_CONNECT_TIMEOUT = 30_000

async function openQuickTuneStep(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByTestId('transport-mode-select').selectOption('demo')
  await page.getByTestId('connect-button').click()
  await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', {
    timeout: VEHICLE_CONNECT_TIMEOUT
  })
  await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
    timeout: VEHICLE_CONNECT_TIMEOUT
  })
  await page.getByTestId('view-button-amc-guided').click()
  await page.getByRole('button', { name: /Quick tune setup/i }).click()
}

test.describe('installing a step\'s script', () => {
  test('fetches it and writes it to the vehicle', async ({ page }) => {
    // The network is stubbed at the BROWSER's edge rather than in the app, so
    // the app's own fetch path runs and the test does not depend on GitHub
    // being reachable from CI.
    await page.route('**/VTOL-quicktune.lua', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: '-- quicktune\n' })
    )
    await openQuickTuneStep(page)

    const install = page.getByRole('button', { name: /put it on the vehicle/i })
    await expect(install).toBeEnabled()
    await install.click()

    // Written over MAVFTP to the path the SEQUENCE names. Scripts run from
    // boot, so saying "installed" without saying "reboot" would be half an
    // instruction.
    await expect(page.getByText(/Reboot the vehicle to start it/i)).toBeVisible({ timeout: 60_000 })
  })

  test('reports a fetch that fails instead of claiming success', async ({ page }) => {
    await page.route('**/VTOL-quicktune.lua', (route) => route.fulfill({ status: 404, body: 'nope' }))
    await openQuickTuneStep(page)

    await page.getByRole('button', { name: /put it on the vehicle/i }).click()
    await expect(page.getByText(/Could not fetch VTOL-quicktune\.lua: 404/)).toBeVisible({
      timeout: 30_000
    })
  })
})
