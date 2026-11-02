import { existsSync } from 'node:fs'

import { defineConfig } from '@playwright/test'

function detectBrowserExecutable(): string | undefined {
  const explicitPath = process.env.ARDUCONFIG_E2E_BROWSER
  if (explicitPath) {
    return explicitPath
  }

  const knownPaths: string[] =
    process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium'
        ]
      : process.platform === 'linux'
        ? [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser'
          ]
        : process.platform === 'win32'
          ? [
              'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
              'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
            ]
          : []

  return knownPaths.find((candidate) => existsSync(candidate))
}

const executablePath = detectBrowserExecutable()

/**
 * Preview port, overridable so two checkouts can run e2e at the same time.
 *
 * Both the preview server and the bridge bind fixed ports, so a second
 * checkout running its own suite takes the server out from under the first
 * mid-run — the failure looks like a pile of ERR_CONNECTION_REFUSED and a
 * `code 143` SIGTERM on the webServer, which reads like a flaky app rather
 * than a port collision. Default unchanged, so CI and a single checkout
 * behave exactly as before; a second checkout sets ARDUCONFIG_E2E_PORT (and
 * ARDUCONFIG_E2E_BRIDGE_PORT, if it runs a bridge too).
 */
const previewPort = Number(process.env.ARDUCONFIG_E2E_PORT ?? 4173)
const bridgePort = Number(process.env.ARDUCONFIG_E2E_BRIDGE_PORT ?? 14550)
const baseURL = `http://127.0.0.1:${previewPort}`

/**
 * Branded-browser projects, opt-in.
 *
 * The flash path talks Web Serial / WebUSB straight to the browser, and
 * those APIs live in Chromium, not in our code: a Chromium release can
 * change them under us, and Chrome, Edge and Brave each ship their own
 * build. The specs listed here flash a fake board through the real app
 * code (tests/e2e/support/fake-serial.ts), so they can run in each of them.
 *
 * ARDUCONFIG_E2E_CHANNELS="chrome,msedge" adds one project per Playwright
 * channel (the browser must be installed: `npx playwright install chrome
 * msedge`). Brave has no channel, so ARDUCONFIG_E2E_BRAVE_PATH points at its
 * executable instead. Unset, nothing here exists and the config is the
 * single implicit project it always was -- CI is untouched.
 */
const BROWSER_FAKE_SPECS = ['tests/e2e/flash-serial.spec.ts']
const BRANDED_CHANNELS = ['chrome', 'msedge'] as const
type BrandedChannel = (typeof BRANDED_CHANNELS)[number]
const requestedChannels = (process.env.ARDUCONFIG_E2E_CHANNELS ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter((name): name is BrandedChannel => (BRANDED_CHANNELS as readonly string[]).includes(name))
const bravePath = process.env.ARDUCONFIG_E2E_BRAVE_PATH
const brandedProjects = [
  ...requestedChannels.map((channel) => ({
    name: channel,
    testMatch: BROWSER_FAKE_SPECS,
    // The project's `use` replaces the top-level launchOptions, so the
    // auto-detected executablePath cannot shadow the channel.
    use: { channel, launchOptions: {} }
  })),
  ...(bravePath
    ? [
        {
          name: 'brave',
          testMatch: BROWSER_FAKE_SPECS,
          use: { launchOptions: { executablePath: bravePath } }
        }
      ]
    : [])
]

export default defineConfig({
  testDir: './tests/e2e',
  // Parallel DISTRIBUTION, serial EXECUTION.
  //
  // `workers: 1` is the load-bearing half: the preview server and the demo
  // MAVLink bridge are on fixed --strictPort ports and share one vehicle
  // session, so parallel workers would collide and interfere with each other's
  // parameter writes. That stays.
  //
  // `fullyParallel: true` changes only how --shard splits the suite. With it
  // false, Playwright shards by FILE, and views.spec.ts alone holds 290 of the
  // ~388 tests -- so CI's four shards would leave one carrying nearly all of
  // them and save nothing. With it true, shards split by test. Every shard was
  // run standalone before adopting this, middle ones included, since that is
  // where a test that depended on a parameter an earlier test wrote would
  // break.
  fullyParallel: true,
  workers: 1,
  timeout: 60_000,
  // GitHub-hosted CI runners occasionally cold-start the bundled vite preview
  // + bridge slowly, eating most of a 60s test budget before the first frame.
  // One retry catches that without masking real regressions; locally retries
  // stay off so genuine logic bugs surface fast.
  retries: process.env.CI === 'true' ? 1 : 0,
  expect: {
    timeout: 15_000
  },
  reporter: 'list',
  use: {
    baseURL,
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: executablePath
      ? {
          executablePath
        }
      : undefined
  },
  // Only when a branded browser was asked for: the default project then
  // gets a name so `--project chrome` can single one out.
  ...(brandedProjects.length > 0 ? { projects: [{ name: 'chromium' }, ...brandedProjects] } : {}),
  webServer: [
    {
      command: `npm run preview --workspace @arduconfig/web -- --host 127.0.0.1 --port ${previewPort} --strictPort`,
      url: baseURL,
      reuseExistingServer: process.env.ARDUCONFIG_E2E_REUSE_EXISTING === '1',
      timeout: 120_000
    },
    {
      command: `node apps/desktop/dist/bridge-websocket.js --demo --host=127.0.0.1 --port=${bridgePort}`,
      url: `http://127.0.0.1:${bridgePort}`,
      reuseExistingServer: process.env.ARDUCONFIG_E2E_REUSE_EXISTING === '1',
      timeout: 120_000
    }
  ]
})
