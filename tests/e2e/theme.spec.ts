import { expect, test } from '@playwright/test'

// Light mode: the header theme toggle flips <html data-theme> between dark and
// light, persists across reloads, and repaints the app (a light surface token).

test.describe('UI theme (light mode)', () => {
  test('toggles dark <-> light, persists across reload, and repaints', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('landing-transport-select').selectOption('demo')
    await page.getByTestId('landing-connect-button').click()
    await expect(page.getByTestId('session-vehicle-name')).toHaveText('ArduCopter')

    const html = page.locator('html')
    // Default is the dark brand theme.
    await expect(html).toHaveAttribute('data-theme', 'dark')
    const darkBg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim()
    )

    // Toggle to light.
    await page.getByTestId('theme-toggle').click()
    await expect(html).toHaveAttribute('data-theme', 'light')
    const lightBg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--bg-app').trim()
    )
    expect(lightBg).not.toBe(darkBg) // the surface token actually changed

    // Persists across a reload (applied before React renders — no flash).
    await page.reload()
    await expect(html).toHaveAttribute('data-theme', 'light')

    // Toggle back to dark.
    await page.getByTestId('theme-toggle').click()
    await expect(html).toHaveAttribute('data-theme', 'dark')
  })
})
