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

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
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
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: executablePath
      ? {
          executablePath
        }
      : undefined
  },
  webServer: [
    {
      command: 'npm run preview --workspace @arduconfig/web -- --host 127.0.0.1 --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: process.env.ARDUCONFIG_E2E_REUSE_EXISTING === '1',
      timeout: 120_000
    },
    {
      command: 'node apps/desktop/dist/bridge-websocket.js --demo --host=127.0.0.1 --port=14550',
      url: 'http://127.0.0.1:14550',
      reuseExistingServer: process.env.ARDUCONFIG_E2E_REUSE_EXISTING === '1',
      timeout: 120_000
    }
  ]
})
