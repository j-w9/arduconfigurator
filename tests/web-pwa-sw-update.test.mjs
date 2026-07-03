// The service worker was retired (see web-pwa-offline-shell.test.mjs). The app's
// SW module (apps/web/src/sw-update.ts) must now UNREGISTER any lingering SW and
// register nothing — so a returning visitor loads fresh from the network and no
// stale shell can be served. Guards the client-side half of the retirement.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { test } from 'node:test'
import assert from 'node:assert/strict'

const swUpdatePath = fileURLToPath(new URL('../apps/web/src/sw-update.ts', import.meta.url))

test('the app unregisters any existing service worker on boot', () => {
  const source = readFileSync(swUpdatePath, 'utf8')
  assert.match(source, /getRegistrations\(\)/, 'must enumerate existing SW registrations')
  assert.match(source, /\.unregister\(\)/, 'must unregister them')
})

test('the app registers NO service worker (offline shell retired)', () => {
  const source = readFileSync(swUpdatePath, 'utf8')
  const code = source.replace(/\/\/[^\n]*/g, '') // strip comments
  assert.doesNotMatch(
    code,
    /serviceWorker\s*\.\s*register\s*\(/,
    'sw-update.ts must not call serviceWorker.register — the offline-shell SW is retired'
  )
})
