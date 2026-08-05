// Source-level guards on the offline service worker's SHAPE.
//
// This file previously asserted the worker intercepted nothing, because the
// offline shell had been retired: a cache-first shell referenced asset hashes a
// later deploy had purged, the 404 fell through to the SPA's text/html
// fallback, and the app white-screened until a hard refresh.
//
// Offline support is back by request (an installed app used on a bench with no
// network), and the worker is redesigned so that specific failure cannot recur.
// What follows guards the STRUCTURE of that design; the behaviour it is meant
// to produce is exercised properly in service-worker-offline.test.mjs, which
// runs the real fetch handler against a fake ServiceWorkerGlobalScope.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { test } from 'node:test'
import assert from 'node:assert/strict'

const swSourcePath = fileURLToPath(new URL('../apps/web/public/sw.js', import.meta.url))
const source = () => readFileSync(swSourcePath, 'utf8')

test('the SW serves requests (offline support is present, not a stub)', () => {
  assert.match(source(), /addEventListener\(\s*'fetch'/, 'must install a fetch handler')
})

test('navigations are network-first, which is what makes a stale shell impossible', () => {
  // The retired worker was cache-first for the shell. An online user must
  // always receive the CURRENT index.html, so it can never reference asset
  // hashes a later deploy purged.
  const code = source()
  const navigation = code.slice(code.indexOf('async function handleNavigation'))
  const fetchIndex = navigation.indexOf('await fetch(request)')
  const cacheIndex = navigation.indexOf('caches.match')
  assert.ok(fetchIndex > -1, 'handleNavigation must attempt the network')
  assert.ok(cacheIndex > -1, 'handleNavigation must have a cache fallback')
  assert.ok(fetchIndex < cacheIndex, 'the network attempt must come BEFORE the cache fallback')
})

test('only content-hashed assets may be served cache-first', () => {
  // Hashed URLs are immutable — a changed file is a different URL — so a cache
  // hit cannot be stale. Nothing else may take that path.
  assert.match(source(), /pathname\.startsWith\('\/assets\/'\)/)
})

test('an asset miss returns an error status, never the HTML shell', () => {
  // The literal regression: "Expected a JavaScript module, got text/html".
  assert.match(source(), /status:\s*504/, 'asset failures must surface as a non-HTML error response')
})

test('stale caches from older worker versions are purged on activate', () => {
  const code = source()
  assert.match(code, /caches\.delete\(/, 'must delete caches it no longer owns')
  assert.match(code, /CURRENT_CACHES/, 'must keep only the current version’s caches')
})

test('cross-origin and non-GET traffic is left alone', () => {
  // Firmware downloads, MAVLink bridges and POSTs must pass through untouched.
  const code = source()
  assert.match(code, /request\.method\s*!==\s*'GET'/)
  assert.match(code, /url\.origin\s*!==\s*self\.location\.origin/)
})

test('only inspectable same-origin responses are cached', () => {
  // Opaque cross-origin responses cannot be validated and must not be stored.
  assert.match(source(), /response\.type\s*===\s*'basic'/)
})
