// Verify the offline-shell Vite plugin substituted the SW source markers
// correctly during the web build. Runs against the actual `apps/web/dist/`
// emitted by `npm run build:web` (which `npm run test` invokes first).
//
// The plugin lives at apps/web/vite-plugin-offline-shell.ts; the SW source
// at apps/web/public/sw.js. A failing test here means either (a) the
// markers in the SW source were renamed without updating the plugin,
// (b) the plugin's allowlist drifted and the shell missed a needed file,
// or (c) something started ending up in the cache that shouldn't.

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { test } from 'node:test'
import assert from 'node:assert/strict'

const distSwPath = fileURLToPath(new URL('../apps/web/dist/sw.js', import.meta.url))

test('PWA offline shell: vite plugin replaced the precache and version markers in dist/sw.js', () => {
  assert.ok(existsSync(distSwPath), `expected ${distSwPath} (run npm run build:web first)`)
  const source = readFileSync(distSwPath, 'utf8')

  // The plugin replaces the marker comment from "INJECT:..." to "INJECTED".
  // If a test failure shows the marker text unchanged, the plugin didn't
  // run (or the markers were renamed and the plugin's regex missed them).
  assert.match(source, /INJECTED/, 'plugin should mark its substitutions as INJECTED')
  assert.doesNotMatch(source, /INJECT:PRECACHE_MANIFEST/, 'PRECACHE marker should be gone')
  assert.doesNotMatch(source, /INJECT:SW_VERSION/, 'SW_VERSION marker should be gone')

  // Extract the manifest array literal from the injected line so we can
  // make structural assertions on its contents.
  const manifestMatch = source.match(/const PRECACHE_MANIFEST = (\[[^\]]+\]) \/\/ INJECTED/)
  assert.ok(manifestMatch, 'PRECACHE_MANIFEST literal should be present + parseable')
  const manifest = JSON.parse(manifestMatch[1])
  assert.ok(Array.isArray(manifest), 'manifest is a JSON array of URL paths')
  assert.ok(manifest.length >= 5, `manifest should hold at least the shell minimum, got ${manifest.length}`)

  // The first entry MUST be the entry HTML — the SW uses it as the
  // navigation fallback (see sw.js NAVIGATION_FALLBACK).
  assert.ok(
    manifest[0].endsWith('index.html'),
    `manifest[0] should be the entry HTML (the navigation fallback), got ${manifest[0]}`
  )
  // Every URL is a same-origin absolute path (starts with "/"), never a
  // bare filename or a cross-origin URL.
  for (const url of manifest) {
    assert.ok(url.startsWith('/'), `every manifest URL is an absolute path, got ${url}`)
    assert.ok(!url.startsWith('//'), `not a protocol-relative URL, got ${url}`)
  }

  // The plugin's allowlist explicitly excludes large model directories,
  // accelerometer pose images and demo recordings — none of those help
  // an unconnected first-launch. This is the regression guard against
  // someone accidentally relaxing the allowlist.
  for (const url of manifest) {
    assert.ok(!url.includes('/models/'), `models should NOT be precached (saw ${url})`)
    assert.ok(!url.includes('/accel-poses/'), `accel-poses should NOT be precached (saw ${url})`)
    assert.ok(!url.includes('/betaflight-header/'), `betaflight-header art should NOT be precached (saw ${url})`)
    assert.ok(!url.includes('/boards/'), `board images should NOT be precached (saw ${url})`)
    assert.ok(!url.endsWith('.map'), `source maps should NOT be precached (saw ${url})`)
    assert.ok(!url.endsWith('/sw.js'), 'the SW itself must not be in its own precache')
  }

  // Static-shell essentials: every build needs to ship these.
  assert.ok(
    manifest.some((url) => url.endsWith('/manifest.webmanifest')),
    'web app manifest is in the precache so the install icon resolves offline'
  )
  assert.ok(
    manifest.some((url) => url.endsWith('/favicon.svg')),
    'favicon is in the precache so the installed PWA renders its icon offline'
  )
  assert.ok(
    manifest.some((url) => /\/icons\/icon-\d+\.png$/.test(url)),
    'at least one install-prompt icon is in the precache'
  )

  // SW_VERSION should be a non-empty string AND not the source default
  // ('dev') — the plugin wires it to the git hash so each build has a
  // distinct cache name.
  const versionMatch = source.match(/const SW_VERSION = ("[^"]+") \/\/ INJECTED/)
  assert.ok(versionMatch, 'SW_VERSION literal should be present')
  const version = JSON.parse(versionMatch[1])
  assert.ok(typeof version === 'string' && version.length > 0)
  assert.notEqual(version, 'dev', 'plugin should overwrite the source default')
})

test('PWA offline shell: CACHE_NAME embeds the version so an upgrade evicts old caches', () => {
  const source = readFileSync(distSwPath, 'utf8')
  // The activate handler keys old-cache eviction off the shared
  // 'arduconfig-shell-' prefix; this guard locks the naming.
  assert.match(source, /arduconfig-shell-/, 'cache name uses the documented prefix')
})
