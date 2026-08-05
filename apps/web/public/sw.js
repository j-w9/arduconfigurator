// ArduConfigurator service worker — offline support for the installed app.
//
// HISTORY, because this was retired once and the reason still governs the
// design. The original SW precached the app shell CACHE-FIRST. Across a deploy
// a returning visitor got the cached index.html, which referenced asset hashes
// the new deploy had purged; those requests 404'd to the SPA's text/html
// fallback, the module script failed with "Expected a JavaScript module, got
// text/html", and the app showed a white screen recoverable only by a hard
// refresh. It was retired rather than fixed.
//
// This one is deliberately shaped so that failure cannot recur:
//
//   1. NAVIGATIONS ARE NETWORK-FIRST. An online user always gets the current
//      index.html, so the shell can never reference purged asset hashes. The
//      cached copy is a fallback for when the network is genuinely gone.
//
//   2. A NON-NAVIGATION REQUEST NEVER FALLS BACK TO HTML. This is the literal
//      bug above: an asset miss must fail as an asset, not resolve to the SPA
//      shell. Script/style/worker requests that miss both cache and network
//      return a 504 with an empty body, never index.html.
//
//   3. ONLY HASHED ASSETS ARE CACHE-FIRST. Vite's /assets/<name>-<hash>.<ext>
//      URLs are content-addressed and immutable, so serving them from cache
//      cannot be stale — a changed file is a different URL. Everything else is
//      network-first.
//
// Stale entries under dead hashes are inert: nothing requests them again, and
// the browser evicts them under quota pressure. They cannot be served in place
// of anything current, because the hash IS the identity.

const VERSION = 'v2'
const SHELL_CACHE = `arduconfig-shell-${VERSION}`
const ASSET_CACHE = `arduconfig-assets-${VERSION}`
const CURRENT_CACHES = new Set([SHELL_CACHE, ASSET_CACHE])
// The navigation fallback. Keyed by path, not by the requested URL, so any
// deep link resolves to the SPA shell when offline.
const SHELL_URL = '/index.html'

// Craft models, precached in full (~12 MB) so an installed app shows the RIGHT
// airframe offline rather than a generic stand-in. Deliberate: the app is used
// on benches with no network, where an empty or wrong-looking 3D view is worse
// than the one-off download. Precaching is best-effort per file, so a partial
// download degrades to "some models offline" rather than failing the install.
//
// Keep in sync with apps/web/public/models/ — pinned by a test, since a model
// added later would otherwise silently not be available offline.
const MODEL_URLS = [
  '/models/fallback.gltf',
  '/models/alti.gltf',
  '/models/bixler.gltf',
  '/models/hex_plus.gltf',
  '/models/hex_x.gltf',
  '/models/plane.gltf',
  '/models/quad_atail.gltf',
  '/models/quad_vtail.gltf',
  '/models/quad_x.gltf',
  '/models/rover.gltf',
  '/models/sub.gltf',
  '/models/tricopter.gltf',
  '/models/y6.gltf'
]

/**
 * The hashed /assets/ URLs index.html references — the entry JS and CSS.
 *
 * Precaching the shell alone was not enough: index.html is useless without its
 * module bundle, so "install, then go offline" produced a blank app. The URLs
 * are read out of index.html rather than hardcoded because their hashes change
 * on every deploy.
 */
function assetUrlsFrom(html) {
  const urls = new Set()
  for (const match of html.matchAll(/["'](\/assets\/[A-Za-z0-9._-]+\.(?:js|css))["']/g)) {
    urls.add(match[1])
  }
  return [...urls]
}

self.addEventListener('install', (event) => {
  // Warm the shell, its entry bundle and the fallback model so the very first
  // offline launch actually works. Failure here must NOT block installation —
  // a user who installs on a flaky link still gets a working online app.
  event.waitUntil(
    (async () => {
      try {
        const response = await fetch(new Request(SHELL_URL, { cache: 'reload' }))
        if (isCacheableResponse(response)) {
          const html = await response.clone().text()
          const shell = await caches.open(SHELL_CACHE)
          await shell.put(SHELL_URL, response)

          const assets = await caches.open(ASSET_CACHE)
          await Promise.all(
            [...assetUrlsFrom(html), ...MODEL_URLS].map(async (url) => {
              try {
                const asset = await fetch(new Request(url, { cache: 'reload' }))
                if (isCacheableResponse(asset)) {
                  await assets.put(url, asset)
                }
              } catch {
                // One missing asset must not abort the whole precache.
              }
            })
          )
        }
      } catch {
        // Non-fatal by design.
      }
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older versions of this SW (and from the retired one).
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => !CURRENT_CACHES.has(key)).map((key) => caches.delete(key)))
      await self.clients.claim()
    })()
  )
})

/** Vite emits content-hashed, immutable URLs under /assets/. */
function isImmutableAsset(url) {
  return url.origin === self.location.origin && url.pathname.startsWith('/assets/')
}

/** Requests that must NEVER be answered with the HTML shell. */
function expectsNonHtml(request) {
  return request.destination === 'script' || request.destination === 'style' || request.destination === 'worker'
}

function isCacheableResponse(response) {
  // 'basic' excludes opaque cross-origin responses, which we cannot inspect
  // and must not persist.
  return Boolean(response) && response.ok && response.type === 'basic'
}

async function handleNavigation(request) {
  try {
    const response = await fetch(request)
    if (isCacheableResponse(response)) {
      const cache = await caches.open(SHELL_CACHE)
      // Store under the shell key so any route restores the same shell.
      await cache.put(SHELL_URL, response.clone())
    }
    return response
  } catch {
    const cached = (await caches.match(SHELL_URL)) ?? (await caches.match(request))
    if (cached) {
      return cached
    }
    // Nothing cached and no network: let the browser show its offline page
    // rather than inventing our own broken one.
    throw new Error('offline and no cached shell')
  }
}

async function handleImmutableAsset(request) {
  const cached = await caches.match(request)
  if (cached) {
    return cached
  }
  const response = await fetch(request)
  if (isCacheableResponse(response)) {
    const cache = await caches.open(ASSET_CACHE)
    await cache.put(request, response.clone())
  }
  return response
}

async function handleOther(request) {
  try {
    const response = await fetch(request)
    if (isCacheableResponse(response)) {
      const cache = await caches.open(ASSET_CACHE)
      await cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    const cached = await caches.match(request)
    if (cached) {
      return cached
    }
    throw error
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Only GET is cacheable, and only our own origin is ours to serve. Anything
  // else (MAVLink bridges, firmware downloads, POSTs) passes straight through
  // untouched.
  if (request.method !== 'GET') {
    return
  }
  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }
  if (url.origin !== self.location.origin) {
    return
  }
  // Range requests (media seeking) must not be answered from a full cached
  // body — pass them through.
  if (request.headers.has('range')) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request))
    return
  }

  if (isImmutableAsset(url)) {
    event.respondWith(
      handleImmutableAsset(request).catch(
        // Guard 2: an asset miss fails AS AN ASSET. Returning the HTML shell
        // here is exactly what white-screened the app before.
        () => new Response('', { status: 504, statusText: 'offline' })
      )
    )
    return
  }

  event.respondWith(
    handleOther(request).catch(() =>
      expectsNonHtml(request)
        ? new Response('', { status: 504, statusText: 'offline' })
        : new Response('', { status: 504, statusText: 'offline' })
    )
  )
})
