// Client-side half of offline support: apps/web/src/sw-update.ts must actually
// register the worker, and must never let a registration failure break the app.
//
// This file previously asserted the OPPOSITE — that the app unregisters any SW
// and registers none — because the offline shell had been retired for stranding
// users on a stale shell. Offline support was reinstated deliberately for the
// installed app (a maintenance operator on a bench with no network), with a
// worker redesigned so that failure cannot recur.
//
// The guard that matters now lives in service-worker-offline.test.mjs, which
// exercises the real fetch strategy: navigations are network-first, and an
// asset request never resolves to the HTML shell. These are only the coarse
// source-level checks that the registration side is wired at all.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { test } from 'node:test'
import assert from 'node:assert/strict'

const swUpdatePath = fileURLToPath(new URL('../apps/web/src/sw-update.ts', import.meta.url))

test('the app registers the service worker', () => {
  const source = readFileSync(swUpdatePath, 'utf8')
  const code = source.replace(/\/\/[^\n]*/g, '')
  assert.match(code, /serviceWorker\s*\.\s*register\s*\(\s*'\/sw\.js'\s*\)/, 'must register /sw.js')
})

test('a registration failure is swallowed — offline support is never a requirement to run', () => {
  // A blocked or unavailable SW (private window, enterprise policy, insecure
  // origin) must leave a perfectly working ONLINE app rather than an error.
  const source = readFileSync(swUpdatePath, 'utf8')
  assert.match(source, /register\([^)]*\)\s*\.catch\(/, 'registration must be .catch()-guarded')
})

test('the update prompt stays a network poll, independent of service-worker state', () => {
  // Deliberate: keeping "is there a new deploy" off the SW lifecycle means a
  // wedged or superseded worker cannot suppress the prompt.
  const source = readFileSync(swUpdatePath, 'utf8')
  assert.match(source, /cache:\s*'no-store'/, 'the version poll must bypass the HTTP cache')
  assert.match(source, /extractAppBundlePath/, 'the poll compares hashed entry-bundle names')
})
