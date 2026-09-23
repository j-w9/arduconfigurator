import { expect, test } from '@playwright/test'

// ArduPilot SITL, booted in a real browser.
//
// Everything else about this feature is provable elsewhere: the launch
// arguments are unit-tested, the transport is tested against the real module
// under Node. What only a browser can answer is whether 3.4 MB of WebAssembly
// actually loads over HTTP, instantiates under the page's own CSP, and
// produces a vehicle the app connects to — none of which Node's module loader
// exercises.
//
// Skipped when the site was built without the simulator, so a checkout that
// has never run `npm run sitl:build` still passes the suite.

test.describe('WebAssembly SITL', () => {
  test('the artifacts are served, and as the right type', async ({ page }) => {
    const response = await page.request.get('/sitl/sim-options.json')
    test.skip(!response.ok(), 'no simulator in this build — run npm run sitl:build')

    const options = (await response.json()) as { frames: Record<string, string[]> }
    expect(Object.keys(options.frames).length).toBeGreaterThan(0)

    const wasm = await page.request.get('/sitl/arducopter.wasm')
    expect(wasm.ok()).toBe(true)
    // WebAssembly.instantiateStreaming refuses anything but application/wasm,
    // so a wrong content type here is a simulator that silently will not run.
    expect(wasm.headers()['content-type']).toContain('application/wasm')
  })

  test('a vehicle boots in the browser and the app connects to it', async ({ page }) => {
    const probe = await page.request.get('/sitl/sim-options.json')
    test.skip(!probe.ok(), 'no simulator in this build — run npm run sitl:build')

    await page.goto('/')
    await page.getByTestId('view-button-sitl').click()

    await expect(page.getByRole('button', { name: /Start the simulator/i })).toBeVisible({
      timeout: 20_000
    })
    await page.getByRole('button', { name: /Start the simulator/i }).click()

    // Loading 3.4 MB and instantiating it is not instant, and the vehicle then
    // has to boot far enough to say something.
    await expect(page.getByRole('button', { name: /Stop the simulator/i })).toBeVisible({
      timeout: 120_000
    })

    // The claim that matters: not that the module loaded, but that the app is
    // talking to the vehicle inside it.
    await expect(page.getByText(/Vehicle is alive/i)).toBeVisible({ timeout: 120_000 })
  })

  test("SITL's own console is shown, which is where a failed boot explains itself", async ({ page }) => {
    const probe = await page.request.get('/sitl/sim-options.json')
    test.skip(!probe.ok(), 'no simulator in this build — run npm run sitl:build')

    await page.goto('/')
    await page.getByTestId('view-button-sitl').click()
    await page.getByRole('button', { name: /Start the simulator/i }).click()

    // ArduPilot announces the parameter defaults it loaded from its embedded
    // ROMFS — proof the console is wired to the module and not to nothing.
    await expect(page.getByText(/Loaded defaults from/i)).toBeVisible({ timeout: 120_000 })
  })
})
