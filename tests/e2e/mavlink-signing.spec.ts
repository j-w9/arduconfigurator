import { expect, test } from '@playwright/test'

// Exercises the MAVLink signing control in the Ports view: enter a passphrase,
// enable signing (status flips on), and confirm the rejection-count readout +
// "send to vehicle" provisioning action are present and behave.
const VEHICLE_CONNECT_TIMEOUT = 30_000

test.describe('MAVLink signing control', () => {
  test('enables signing from a passphrase and shows status + rejection count', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })

    await page.getByTestId('view-button-ports').click()

    const panel = page.getByTestId('mavlink-signing-panel')
    await expect(panel).toBeVisible()

    // Starts off.
    await expect(page.getByTestId('signing-status')).toHaveText('Signing off')
    await expect(page.getByTestId('signing-rejection-count')).toHaveText('0')

    // Enter a passphrase and enable.
    await page.getByTestId('signing-passphrase-input').fill('correct horse battery staple')
    await page.getByTestId('signing-apply-button').click()

    await expect(page.getByTestId('signing-status')).toHaveText('Signing on')
    await expect(page.getByTestId('signing-feedback')).toContainText('Signing enabled')

    // "Send key to vehicle" is enabled once a key is applied and connected.
    const sendButton = page.getByTestId('signing-send-to-vehicle-button')
    await expect(sendButton).toBeEnabled()
    await sendButton.click()
    await expect(page.getByTestId('signing-feedback')).toContainText('SETUP_SIGNING')

    // Disable flips status back off.
    await page.getByTestId('signing-disable-button').click()
    await expect(page.getByTestId('signing-status')).toHaveText('Signing off')
  })

  test('validates a pasted hex key', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('transport-mode-select').selectOption('demo')
    await page.getByTestId('connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', { timeout: VEHICLE_CONNECT_TIMEOUT })

    await page.getByTestId('view-button-ports').click()
    await expect(page.getByTestId('mavlink-signing-panel')).toBeVisible()

    await page.getByTestId('signing-mode-hex').click()
    // Too-short key is rejected.
    await page.getByTestId('signing-hex-input').fill('deadbeef')
    await page.getByTestId('signing-apply-button').click()
    await expect(page.getByTestId('signing-feedback')).toContainText('64 hex characters')
    await expect(page.getByTestId('signing-status')).toHaveText('Signing off')

    // A valid 32-byte (64-hex) key enables signing.
    await page.getByTestId('signing-hex-input').fill('a'.repeat(64))
    await page.getByTestId('signing-apply-button').click()
    await expect(page.getByTestId('signing-status')).toHaveText('Signing on')
  })
})
