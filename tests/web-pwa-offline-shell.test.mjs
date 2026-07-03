// The offline-shell service worker was RETIRED — it stranded users on a stale
// app shell across deploys (a purged asset hash → SPA text/html fallback →
// white screen; only a hard refresh recovered). sw.js is now a self-destructing
// no-op. These guards lock that in: the SW must intercept nothing and must
// unregister itself + clear caches, and the old precache/shell logic must be gone.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { test } from 'node:test'
import assert from 'node:assert/strict'

const swSourcePath = fileURLToPath(new URL('../apps/web/public/sw.js', import.meta.url))

test('SW is self-destructing: unregisters itself and clears all caches on activate', () => {
  const source = readFileSync(swSourcePath, 'utf8')
  assert.match(source, /self\.registration\.unregister\(\)/, 'SW must unregister itself')
  assert.match(source, /caches\.delete\(/, 'SW must delete caches')
  assert.match(source, /self\.skipWaiting\(\)/, 'SW must skipWaiting so the self-destruct activates immediately')
})

test('SW intercepts nothing (no fetch handler) so it can never serve a stale asset', () => {
  const source = readFileSync(swSourcePath, 'utf8')
  const code = source.replace(/\/\/[^\n]*/g, '') // strip comments so prose doesn't count
  assert.doesNotMatch(code, /addEventListener\(\s*['"]fetch['"]/, 'SW must NOT register a fetch handler')
})

test('the retired SW no longer carries the offline-shell precache logic', () => {
  const source = readFileSync(swSourcePath, 'utf8')
  const code = source.replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(code, /PRECACHE_MANIFEST/, 'precache manifest logic must be gone')
  assert.doesNotMatch(code, /navigationStrategy/, 'navigation-shell caching must be gone')
  assert.doesNotMatch(code, /INJECT:/, 'no build-time injection markers remain')
})
