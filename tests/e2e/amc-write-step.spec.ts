import { expect, test } from '@playwright/test'

// Writing one step at a time.
//
// AMC's method is step-by-step: write this step, let the vehicle confirm it,
// reboot if it needs to, then move on. A bulk write at the end is a different
// method — and a step that sets a boot-time parameter has not taken effect
// until the vehicle restarts, so the steps after it would read the old value.
//
// The component test stubs the write. What only a browser answers is whether
// the value actually reaches the vehicle and comes back confirmed.

const VEHICLE_CONNECT_TIMEOUT = 30_000

test('a step\'s parameters reach the vehicle and are confirmed', async ({ page }) => {
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
  await page.getByRole('button', { name: /Imu temperature calibration setup/i }).click()

  const write = page.getByRole('button', { name: /^Write this step$/ })
  await expect(write).toBeEnabled()
  await write.click()

  // The app's own verified write reports what the vehicle confirmed, naming
  // the step rather than "parameters" — so an operator working through the
  // sequence can tell which write they are reading about.
  await expect(
    page.getByText(/Imu temperature calibration setup|Verified \d+ .* change/i).first()
  ).toBeVisible({ timeout: 60_000 })
})
