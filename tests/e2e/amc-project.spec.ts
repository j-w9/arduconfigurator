import { expect, test, type Page } from '@playwright/test'

// The configuration directory leaving the browser, and coming back.
//
// The assembly is pure and covered by unit tests on both sides of the repo
// boundary. What only a real browser can answer is whether the download works
// at all: jsdom has no Blob URL, no real anchor click and no file picker, so
// every one of those is stubbed in the component test. Here the archive is
// actually produced, actually downloaded, and actually read back.

const VEHICLE_CONNECT_TIMEOUT = 30_000

async function openAmcGuided(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByTestId('transport-mode-select').selectOption('demo')
  await page.getByTestId('connect-button').click()
  await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', {
    timeout: VEHICLE_CONNECT_TIMEOUT
  })
  await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
    timeout: VEHICLE_CONNECT_TIMEOUT
  })

  const sheet = page.getByTestId('header-more-toggle')
  if ((await sheet.isVisible()) && (await sheet.getAttribute('aria-expanded')) !== 'true') {
    await sheet.click()
  }
  await page.getByTestId('product-mode-expert').check()
  await page.getByTestId('view-button-amc-guided').click()
  await expect(page.getByRole('heading', { name: 'AMC guided mode' })).toBeVisible()
  // The sequence is dynamic-imported, and a directory means nothing without
  // it. Waiting for a step to render is waiting for that.
  await expect(page.getByRole('button', { name: /Imu temperature calibration setup/ })).toBeVisible()
}

/** Declare enough of the vehicle that the sequence derives something. */
async function declare(page: Page): Promise<void> {
  await page.getByRole('spinbutton', { name: 'Diameter_inches' }).first().fill('10')
}

test.describe('the vehicle configuration directory', () => {
  test('downloads as an archive named for the vehicle', async ({ page }) => {
    await openAmcGuided(page)

    // Connected, the firmware version is already read from the vehicle, so
    // something is always declared here — the refusal-when-empty case needs an
    // unconnected tab and is covered in the component test.
    await declare(page)
    const download = page.getByRole('button', { name: 'Download the directory' })
    await expect(download).toBeEnabled()

    const started = page.waitForEvent('download')
    await download.click()
    const file = await started

    expect(file.suggestedFilename()).toMatch(/^ArduCopter.*\.zip$/)

    // A zip's local file header. Cheap, and it is the check that fails if the
    // bytes handed to the Blob were mangled on the way out.
    const path = await file.path()
    const { readFileSync } = await import('node:fs')
    const bytes = readFileSync(path)
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])

    // And it says what it wrote, rather than leaving a silent download as the
    // only evidence. With one field declared most steps cannot be fully
    // evaluated, so the honest notice here is the incomplete one -- both forms
    // are accepted because which one is right depends on how much was
    // declared, and either beats silence.
    await expect(
      page.getByText(/Written: \d+ files, \d+ parameters|Written, but \d+ steps? could not be fully evaluated/)
    ).toBeVisible()
  })

  test('reads a directory back and restores what was declared', async ({ page }) => {
    await openAmcGuided(page)

    // A directory is picked as files. Two is enough to prove both halves: the
    // declaration comes back into the form, and a step file is claimed.
    await page.getByTestId('amc-open-project').setInputFiles([
      {
        name: 'vehicle_components.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify({
            Components: { Propellers: { Specifications: { Diameter_inches: 13 } } }
          })
        )
      },
      {
        name: '02_imu_temperature_calibration_setup.param',
        mimeType: 'text/plain',
        buffer: Buffer.from('INS_TCAL1_ENABLE,2  # Activates the temperature calibration\n')
      }
    ])

    // The declaration is back in the form, which is the thing an operator
    // notices: their vehicle is described again without retyping it.
    await expect(page.getByRole('spinbutton', { name: 'Diameter_inches' }).first()).toHaveValue('13')
    await expect(page.getByText(/Read \d+ step files/)).toBeVisible()
  })

  test('says which files it could not place', async ({ page }) => {
    // Work sitting unread in the directory is the failure that matters, so it
    // cannot be silent.
    await openAmcGuided(page)
    await page.getByTestId('amc-open-project').setInputFiles([
      {
        name: '02_imu_temperature_calibration_setup.param',
        mimeType: 'text/plain',
        buffer: Buffer.from('INS_TCAL1_ENABLE,2\n')
      },
      {
        name: '99_handwritten.param',
        mimeType: 'text/plain',
        buffer: Buffer.from('FOO,1\n')
      }
    ])

    await expect(page.getByText(/99_handwritten\.param/)).toBeVisible()
  })
})
