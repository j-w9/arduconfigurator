// ArduConfigurator service worker: PWA installability + offline app-shell cache.
// Connected/network flows are never faked — only the app shell is cached.

// Markers below are replaced verbatim at build time; keep them as simple,
// single-line assignments. In dev they keep their defaults (passthrough SW).
const PRECACHE_MANIFEST = [] // INJECT:PRECACHE_MANIFEST
const SW_VERSION = 'dev' // INJECT:SW_VERSION

const CACHE_NAME = `arduconfig-shell-${SW_VERSION}`
const PRECACHE_SET = new Set(PRECACHE_MANIFEST)
// Entry HTML path is injected as the first element of the manifest.
const NAVIGATION_FALLBACK = PRECACHE_MANIFEST[0]

self.addEventListener('install', (event) => {
  // No unconditional skipWaiting(): a new SW waits until the client posts
  // SKIP_WAITING so an in-flight session isn't interrupted by a silent swap.
  if (PRECACHE_MANIFEST.length === 0) {
    return
  }
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      // addAll is atomic-ish: any failed request fails the whole install and
      // we retry on next reload, rather than caching a half-broken shell.
      await cache.addAll(PRECACHE_MANIFEST)
    })()
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous SW versions.
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

  // Only same-origin GETs are cache-eligible; everything else hits the network.
  if (request.method !== 'GET') {
    return
  }
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) {
    return
  }

  // Navigations: network-first with cached-shell fallback when offline.
  if (request.mode === 'navigate') {
    event.respondWith(navigationStrategy(request))
    return
  }

  // Content-addressed static assets in the precache list: cache-first.
  if (PRECACHE_SET.has(url.pathname)) {
    event.respondWith(cacheFirst(url.pathname, request))
    return
  }

  // Everything else: passthrough.
})

async function navigationStrategy(request) {
  try {
    // Force the index fresh from the origin (bypass HTTP/edge cache). Without
    // this, a returning visitor after a deploy could get a stale index.html that
    // references purged asset hashes — those 404, hit the SPA fallback, and come
    // back as text/html, so the module script fails ("Expected JS, got text/html")
    // and the app never mounts (blue screen). A cache-reload navigation always
    // references the current deploy's assets.
    const fresh = await fetch(request.url, { cache: 'reload' })
    // Refresh the cached shell on a successful response only.
    if (fresh.ok && NAVIGATION_FALLBACK) {
      const cache = await caches.open(CACHE_NAME)
      // clone() so the body can be both returned and cached.
      await cache.put(NAVIGATION_FALLBACK, fresh.clone())
    }
    return fresh
  } catch {
    // Offline: serve the cached shell, or an honest 503 if there is none.
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
  // Cache miss: fall back to the network and store for next time.
  const fresh = await fetch(request)
  if (fresh.ok) {
    await cache.put(cacheKey, fresh.clone())
  }
  return fresh
}
