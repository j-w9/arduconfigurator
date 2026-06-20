import { expect, test, type Page } from '@playwright/test'

// Visual regression scaffold.
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

test.skip(!isRegenerating, 'Visual regression baselines have not been generated for this platform yet. Run with ARDUCONFIG_VISUAL_REGEN=1 to regenerate.')

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
    await openView(page, 'modes')
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
