// ArduConfigurator service worker.
//
// Two responsibilities:
// 1. Satisfy Chromium's installability check (Brave / Chrome / Edge "Install
//    ArduConfigurator" prompt). Any registered SW with a fetch handler ticks
//    that box.
// 2. Cache the built app shell so a launched PWA boots when the user has no
//    network. The CONNECTED flows (Web Serial picker, WebSocket bridge, live
//    MAVLink, firmware.ardupilot.org fetches) still require network — we
//    deliberately don't fake any of that — but the page itself loads.
//
// Precache is **injected at build time** by the offline-shell Vite plugin
// (apps/web/vite-plugin-offline-shell.ts). The two consts below are markers
// the plugin grep-and-replaces verbatim — they must stay simple, single-line
// assignments so the replacement is robust. In dev (vite dev) the plugin
// does not run; defaults stand and the SW behaves as a passthrough.

const PRECACHE_MANIFEST = [] // INJECT:PRECACHE_MANIFEST
const SW_VERSION = 'dev' // INJECT:SW_VERSION

const CACHE_NAME = `arduconfig-shell-${SW_VERSION}`
const PRECACHE_SET = new Set(PRECACHE_MANIFEST)
// The navigation fallback: when offline and the user opens the PWA, return
// the cached app shell HTML for any same-origin navigation. The plugin
// injects the entry HTML path as the FIRST element of the manifest.
const NAVIGATION_FALLBACK = PRECACHE_MANIFEST[0]

self.addEventListener('install', (event) => {
  // Deliberately NO unconditional skipWaiting() — a new SW stays in the
  // `waiting` state until the client postMessages SKIP_WAITING (see the
  // message handler below). The web app surfaces a "New version available"
  // prompt (apps/web/src/sw-update.ts) and only activates the new SW when
  // the user opts in. That avoids interrupting an in-flight MAVLink
  // session (parameter write, log download, firmware flash) with a silent
  // SW swap whose new code the live page wouldn't see until reload anyway.
  if (PRECACHE_MANIFEST.length === 0) {
    return
  }
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      // Use addAll for atomic-ish behavior: if any request fails the whole
      // install fails and we'll retry on next reload. That's safer than a
      // half-cached shell that crashes mid-boot offline.
      await cache.addAll(PRECACHE_MANIFEST)
    })()
  )
})

self.addEventListener('message', (event) => {
  // The client (sw-update.ts) posts { type: 'SKIP_WAITING' } when the
  // user clicks "Refresh" on the update banner. skipWaiting() promotes
  // this SW from `waiting` to `activating`; clients.claim() in activate
  // then takes over and the client's controllerchange listener reloads
  // the page to pick up the new bundle.
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous SW versions so an upgraded shell doesn't
      // accumulate orphan storage. Anything not named `arduconfig-shell-<this version>`
      // is fair game.
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => key.startsWith('arduconfig-shell-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only same-origin GETs are eligible for our cache. Cross-origin requests
  // (firmware.ardupilot.org, analytics, Vercel functions) ALWAYS go to the
  // network — the SW must not silently intercept them.
  if (request.method !== 'GET') {
    return
  }
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) {
    return
  }

  // Navigation requests (the address bar / a PWA launch) want the latest
  // HTML when online but must fall back to the cached shell when offline.
  // network-first with shell-fallback is the right trade: an online user
  // never sees a stale shell, an offline user still launches the PWA.
  if (request.mode === 'navigate') {
    event.respondWith(navigationStrategy(request))
    return
  }

  // Static assets in the precache list (hashed JS/CSS, icons, manifest,
  // favicon). The hashed filenames are content-addressed so cache-first
  // is correct without staleness risk: a content change ships a NEW URL.
  if (PRECACHE_SET.has(url.pathname)) {
    event.respondWith(cacheFirst(url.pathname, request))
    return
  }

  // Everything else: passthrough. Lazy-loaded models, demo recordings,
  // accel-pose images — none of those are part of the offline app shell.
})

async function navigationStrategy(request) {
  try {
    const fresh = await fetch(request)
    // Update the cached shell so a future offline launch gets the latest
    // — but only if the network response is OK (no 5xx / 4xx caching).
    if (fresh.ok && NAVIGATION_FALLBACK) {
      const cache = await caches.open(CACHE_NAME)
      // clone() so we can both return the response AND put it in cache;
      // a Response body can only be consumed once.
      await cache.put(NAVIGATION_FALLBACK, fresh.clone())
    }
    return fresh
  } catch {
    // Offline: serve the cached shell. If we have no shell either,
    // surface an honest 503 — the browser shows its built-in offline UI.
    if (NAVIGATION_FALLBACK) {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(NAVIGATION_FALLBACK)
      if (cached) {
        return cached
      }
    }
    return new Response('ArduConfigurator is offline and no cached app shell is available.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    })
  }
}

async function cacheFirst(cacheKey, request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(cacheKey)
  if (cached) {
    return cached
  }
  // Cache miss (precache failed or a different SW build is active). Fall
  // back to the network and lazily store the response so subsequent loads
  // are cache-hit.
  const fresh = await fetch(request)
  if (fresh.ok) {
    await cache.put(cacheKey, fresh.clone())
  }
  return fresh
}
