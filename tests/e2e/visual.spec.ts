import { expect, test, type Page } from '@playwright/test'

// Visual regression scaffold — CURRENTLY PROVIDES NO PROTECTION.
//
// Read this before counting it as coverage: there is no
// `tests/e2e/__screenshots__/` directory in the repo, so these six specs have
// never run anywhere and have been skipped since they landed. In the meantime a
// real visual regression (#167) had to be caught by hand-written layout
// assertions in `table-layout.spec.ts` — written from scratch, because this
// suite was not there to catch it.
//
// It is kept rather than deleted only because the regeneration procedure below
// is the documented one (CONTRIBUTING.md / CLAUDE.md). Landing Linux baselines
// on `main` and gating this on `process.env.CI` would make it real; until then,
// prefer adding layout assertions like table-layout.spec.ts, which run on every
// platform and fail readably.
//
// These specs capture full-page screenshots of high-traffic views and compare
// them against committed baselines under `tests/e2e/__screenshots__/visual.spec.ts/`.
// Baselines are platform-specific (Linux Chromium in CI; macOS / Windows
// locally produce subtly different renders), so the suite stays skipped until
// a deliberate baseline-generation run lands the Linux baselines on `main`.
//
// To regenerate baselines from a Linux-equivalent environment:
//
//   ARDUCONFIG_VISUAL_REGEN=1 npx playwright test tests/e2e/visual.spec.ts --update-snapshots
//
// Run under the same Chromium + viewport size CI uses (chromium, default
// viewport). Inspect every produced PNG before committing — the screenshot
// snapshot becomes the source of truth.

const isRegenerating = process.env.ARDUCONFIG_VISUAL_REGEN === '1'

test.skip(
  !isRegenerating,
  'SKIPPED — no visual baselines exist in this repo, so this suite has never run and protects nothing. See the header.'
)

async function connectViaHeader(page: Page): Promise<void> {
  await page.getByTestId('transport-mode-select').selectOption('demo')
  await page.getByTestId('connect-button').click()
  await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter')
}

async function openView(page: Page, viewId: string): Promise<void> {
  await page.getByTestId(`view-button-${viewId}`).click()
}

test.describe('visual regression: high-traffic views', () => {
  test('disconnected landing matches baseline', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('disconnected-landing')).toBeVisible()
    await expect(page).toHaveScreenshot('landing.png', { fullPage: true, maxDiffPixelRatio: 0.02 })
  })

  test('Setup view (post-connect) matches baseline', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await expect(page.getByTestId('workspace-view-title')).toHaveText('Status & Info')
    await expect(page).toHaveScreenshot('setup.png', { fullPage: true, maxDiffPixelRatio: 0.02 })
  })

  test('Modes view matches baseline', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'config')
    await page.locator('.tab-strip__tab', { hasText: 'Flight Modes' }).first().click()
    await expect(page.getByTestId('workspace-view-title')).toHaveText('Modes')
    await expect(page).toHaveScreenshot('modes.png', { fullPage: true, maxDiffPixelRatio: 0.02 })
  })

  test('Failsafe view matches baseline', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'failsafe')
    await expect(page.getByTestId('workspace-view-title')).toHaveText('Failsafe')
    await expect(page).toHaveScreenshot('failsafe.png', { fullPage: true, maxDiffPixelRatio: 0.02 })
  })

  test('Logs view matches baseline', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'logs')
    await expect(page.getByTestId('workspace-view-title')).toHaveText('Logs')
    await expect(page).toHaveScreenshot('logs.png', { fullPage: true, maxDiffPixelRatio: 0.02 })
  })

  test('OSD view matches baseline', async ({ page }) => {
    await page.goto('/')
    await connectViaHeader(page)
    await openView(page, 'osd')
    await expect(page.getByTestId('workspace-view-title')).toHaveText('On-Screen Display')
    await expect(page).toHaveScreenshot('osd.png', { fullPage: true, maxDiffPixelRatio: 0.02 })
  })
})
