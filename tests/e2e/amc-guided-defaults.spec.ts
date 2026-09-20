import { expect, test, type Page } from '@playwright/test'

// The AMC sequence's capture path, end to end over MAVFTP.
//
// 94 of the sequence's steps "capture" what the vehicle already has rather
// than just asserting what it should have, and they can only do that against
// the FIRMWARE's defaults -- a value that equals its default was never chosen
// by anyone. Those defaults arrive as @PARAM/param.pck?withdefaults=1, a
// BURST_READ_FILE off the shared MAVFTP session.
//
// That makes this the one AMC path that depends on something outside the
// evaluator: the steps, the expression port and the summary panel are all
// covered by unit tests in the fork, but none of them can tell whether the
// bytes ever arrive. Driving it by hand in an ordinary tab is not a substitute
// -- a backgrounded tab throttles the mock's own timers hard enough that the
// ~110-packet burst crawls and the queue's stall bound fires, which looks
// exactly like a product bug and is not one. A foregrounded Playwright page
// runs the same code at full speed, so a stall here is real.

const VEHICLE_CONNECT_TIMEOUT = 30_000
// Generous on purpose. @PARAM/param.pck is an ArduPilot VIRTUAL file, so OPEN
// declares size 0 -- and the burst reader needs a declared size to preallocate
// and to know when it is done, so it falls back to the sequential READ_FILE
// loop: ~126 blocking 200-byte round trips for a ~25 KB pack. Through the demo
// transport's pacing that is the better part of a minute. This number tracks
// that cost; if the burst path ever learns to stream a file of unknown size it
// can come down by an order of magnitude.
const DEFAULTS_TIMEOUT = 120_000

async function openAmcGuided(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByTestId('transport-mode-select').selectOption('demo')
  await page.getByTestId('connect-button').click()
  await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter', {
    timeout: VEHICLE_CONNECT_TIMEOUT
  })
  // Connect returns on vehicle-detect, well before the parameter sync. The
  // sequence is evaluated against the vehicle's live values, so until they are
  // there the view has nothing to render and every assertion below would pass
  // vacuously against an empty list.
  await expect(page.getByTestId('session-parameter-summary')).toHaveText(/^(\d+ params|Params \d+)$/, {
    timeout: VEHICLE_CONNECT_TIMEOUT
  })

  // The tab is Expert-only: it is an experiment that writes nothing.
  const sheet = page.getByTestId('header-more-toggle')
  if ((await sheet.isVisible()) && (await sheet.getAttribute('aria-expanded')) !== 'true') {
    await sheet.click()
  }
  await page.getByTestId('product-mode-expert').check()

  await page.getByTestId('view-button-amc-guided').click()
  await expect(page.getByRole('heading', { name: 'AMC guided mode' })).toBeVisible()
}

test.describe('AMC guided mode — firmware defaults', () => {
  test("the vehicle's defaults arrive over MAVFTP", async ({ page }) => {
    await openAmcGuided(page)
    await page.getByTestId('view-button-parameters').click()

    // The Default column is populated from param.pck and from nothing else:
    // an unknown default renders an em dash, deliberately, because a guessed
    // one would not be honest. So a real number here is the burst having
    // completed end to end.
    const unknown = page.locator('.parameter-row__default-unknown')
    await expect(unknown.first()).toBeHidden({ timeout: DEFAULTS_TIMEOUT })
    await expect(unknown).toHaveCount(0)
    // And the flags came through: on a demo vehicle carrying a configured
    // param set, some values differ from their firmware default.
    await expect(page.locator('.parameter-row__default-differs').first()).toBeVisible()
  })

  test('a step that captures can ask for the defaults itself', async ({ page }) => {
    await openAmcGuided(page)

    // The AMC tab deliberately does NOT fetch on its own: the auto-fetch is
    // scoped to the Parameters view, where the Default column is what asked
    // for it. Here the operator asks, so the tag is still up at this point --
    // 60-odd steps' worth of it, which is what makes the assertion below mean
    // something.
    const pending = page.getByText('needs defaults')
    await expect(pending.first()).toBeVisible()

    // The button lives inside a step body, so a step has to be open first.
    await pending.first().click()
    await page.getByRole('button', { name: 'Read them from the vehicle' }).first().click()

    // The tag is rendered from `capturePending`, which is false only once
    // defaults exist. Nothing else clears it.
    await expect(pending).toHaveCount(0, { timeout: DEFAULTS_TIMEOUT })

    // And the capture produced something: the half of the feature the defaults
    // exist for. A value equal to its firmware default was never chosen by
    // anyone, so without them there is nothing to attribute to a step.
    await expect(page.getByText(/values? on this vehicle belong to this step/).first()).toBeVisible()
  })
})
