// ArduConfigurator service worker — RETIRED (self-destructing).
//
// The offline app-shell cache stranded users on a stale shell across deploys:
// a returning visitor's cached shell referenced an asset hash that a later
// deploy had purged, so the request 404'd to the SPA text/html fallback, the
// module script failed ("Expected a JavaScript module, got text/html"), and the
// app showed a white screen. Only a hard refresh — which bypasses the SW —
// recovered. The app loads fine straight from the network (index.html is served
// no-cache), so the offline shell isn't worth the recurring breakage.
//
// This SW therefore intercepts NOTHING (no fetch handler) and, on activation,
// deletes all caches and unregisters itself, then reloads any open tabs so a
// white-screened document reloads fresh with no SW controlling it. Because the
// browser checks this script for updates on navigation independently of the page
// JS, even a broken (white-screen) tab picks it up and self-heals.

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.map((key) => caches.delete(key)))
      await self.registration.unregister()
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const client of clients) {
        client.navigate(client.url)
      }
    })()
  )
})
