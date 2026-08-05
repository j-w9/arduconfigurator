// The offline service worker's fetch strategy.
//
// This SW replaces one that was RETIRED for stranding users on a stale shell:
// a cached index.html referenced asset hashes a later deploy had purged, the
// 404 fell through to the SPA's text/html fallback, the module script failed
// with "Expected a JavaScript module, got text/html", and the app white-screened
// until a hard refresh.
//
// So the load-bearing assertions here are the ones that make that impossible:
//   - navigations go to the NETWORK FIRST (an online user can never be served a
//     shell referencing purged hashes)
//   - a script/style request NEVER resolves to HTML, cache-miss or not
//
// The worker is executed against a fake ServiceWorkerGlobalScope rather than
// mocked, so the real branching is what gets exercised.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const SOURCE = readFileSync(new URL('../apps/web/public/sw.js', import.meta.url), 'utf8')
const ORIGIN = 'https://arduconfigurator.com'

/** Minimal Response stand-in: real Response can't report type 'basic'. */
class FakeResponse {
  constructor(body, { status = 200, type = 'basic', contentType = 'text/plain' } = {}) {
    this.body = body
    this.status = status
    this.ok = status >= 200 && status < 300
    this.type = type
    this.contentType = contentType
  }
  clone() {
    return new FakeResponse(this.body, { status: this.status, type: this.type, contentType: this.contentType })
  }
  async text() {
    return String(this.body)
  }
}

/** Request stand-in. Node's Request rejects relative URLs; a real SW resolves
 *  them against its scope, which is what the worker relies on. */
class FakeRequest {
  constructor(url, init = {}) {
    this.url = new URL(url, ORIGIN).toString()
    this.method = init.method ?? 'GET'
    this.mode = init.mode ?? 'cors'
    this.destination = init.destination ?? ''
    this.headers = new Headers(init.headers ?? {})
  }
}

class FakeCache {
  constructor() {
    this.entries = new Map()
  }
  async put(key, response) {
    this.entries.set(typeof key === 'string' ? key : key.url, response)
  }
  async add() {
    /* shell warm-up; irrelevant to the fetch strategy */
  }
  async match(key) {
    return this.entries.get(typeof key === 'string' ? key : key.url)
  }
}

function loadWorker({ network }) {
  const caches = {
    store: new Map(),
    async open(name) {
      if (!this.store.has(name)) this.store.set(name, new FakeCache())
      return this.store.get(name)
    },
    async keys() {
      return [...this.store.keys()]
    },
    async delete(name) {
      return this.store.delete(name)
    },
    async match(key) {
      for (const cache of this.store.values()) {
        const hit = await cache.match(key)
        if (hit) return hit
      }
      return undefined
    }
  }

  const listeners = new Map()
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, handler) => listeners.set(type, handler),
    skipWaiting: async () => {},
    clients: { claim: async () => {} }
  }

  const fetchImpl = async (request) => network(typeof request === 'string' ? request : request.url)

  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Response', 'Request', 'URL', SOURCE)(
    self,
    caches,
    fetchImpl,
    FakeResponse,
    FakeRequest,
    URL
  )

  const dispatch = async (type, request) => {
    let responded
    let pending
    listeners.get(type)({
      request,
      respondWith: (value) => { responded = value },
      waitUntil: (value) => { pending = value }
    })
    if (pending !== undefined) await pending
    return responded === undefined ? undefined : await responded
  }

  return { dispatch, caches }
}

const navigationRequest = (path = '/') => ({
  url: `${ORIGIN}${path}`,
  method: 'GET',
  mode: 'navigate',
  destination: 'document',
  headers: new Headers()
})

const scriptRequest = (path) => ({
  url: `${ORIGIN}${path}`,
  method: 'GET',
  mode: 'cors',
  destination: 'script',
  headers: new Headers()
})

const html = () => new FakeResponse('<!doctype html><html></html>', { contentType: 'text/html' })
const js = (body = 'export default 1') => new FakeResponse(body, { contentType: 'text/javascript' })

test('a navigation goes to the network first, so an online user never gets a stale shell', async () => {
  const seen = []
  const { dispatch } = loadWorker({
    network: async (url) => {
      seen.push(url)
      return html()
    }
  })
  const response = await dispatch('fetch', navigationRequest('/'))
  assert.equal(response.contentType, 'text/html')
  assert.deepEqual(seen, [`${ORIGIN}/`], 'the network was consulted, not the cache')
})

test('a navigation falls back to the cached shell only when the network is gone', async () => {
  let online = true
  const { dispatch } = loadWorker({
    network: async () => {
      if (!online) throw new Error('offline')
      return html()
    }
  })
  // Prime the cache from an online navigation...
  await dispatch('fetch', navigationRequest('/'))
  online = false
  // ...then a deep link while offline still resolves to the shell.
  const offlineResponse = await dispatch('fetch', navigationRequest('/setup'))
  assert.ok(offlineResponse, 'offline navigation should resolve')
  assert.equal(offlineResponse.contentType, 'text/html')
})

test('a hashed asset is served from cache on the second request (immutable by hash)', async () => {
  let hits = 0
  const { dispatch } = loadWorker({
    network: async () => {
      hits += 1
      return js()
    }
  })
  const path = '/assets/index-abc123.js'
  await dispatch('fetch', scriptRequest(path))
  await dispatch('fetch', scriptRequest(path))
  assert.equal(hits, 1, 'the second request should be served from cache')
})

// THE REGRESSION GUARD. This is the precise failure that retired the previous
// worker: an asset request resolving to the HTML shell.
test('a script request that misses cache AND network never resolves to HTML', async () => {
  const { dispatch } = loadWorker({
    network: async (url) => {
      // The shell is reachable; the asset is not — exactly the purged-hash case.
      if (url.endsWith('/')) return html()
      throw new Error('asset 404 / offline')
    }
  })
  // Warm the shell cache so an HTML fallback is actually available to leak.
  await dispatch('fetch', navigationRequest('/'))

  const response = await dispatch('fetch', scriptRequest('/assets/index-purged.js'))
  assert.ok(response, 'the request must still be answered')
  assert.notEqual(response.contentType, 'text/html', 'MUST NOT serve the HTML shell for a script request')
  assert.equal(response.ok, false)
  assert.equal(response.status, 504)
})

test('a non-hashed script miss also refuses to return HTML', async () => {
  const { dispatch } = loadWorker({
    network: async (url) => {
      if (url.endsWith('/')) return html()
      throw new Error('offline')
    }
  })
  await dispatch('fetch', navigationRequest('/'))
  const response = await dispatch('fetch', scriptRequest('/legacy/entry.js'))
  assert.notEqual(response.contentType, 'text/html')
  assert.equal(response.status, 504)
})

test('non-GET and cross-origin requests are passed straight through, untouched', async () => {
  const { dispatch } = loadWorker({ network: async () => js() })

  const post = await dispatch('fetch', {
    url: `${ORIGIN}/api`,
    method: 'POST',
    mode: 'cors',
    destination: '',
    headers: new Headers()
  })
  assert.equal(post, undefined, 'a POST must not be intercepted')

  const crossOrigin = await dispatch('fetch', {
    url: 'https://firmware.ardupilot.org/x.apj',
    method: 'GET',
    mode: 'cors',
    destination: '',
    headers: new Headers()
  })
  assert.equal(crossOrigin, undefined, 'firmware downloads must not be intercepted')
})

test('range requests are passed through rather than answered from a full cached body', async () => {
  const { dispatch } = loadWorker({ network: async () => js() })
  const ranged = await dispatch('fetch', {
    url: `${ORIGIN}/models/quad.glb`,
    method: 'GET',
    mode: 'cors',
    destination: '',
    headers: new Headers({ range: 'bytes=0-1023' })
  })
  assert.equal(ranged, undefined)
})

// Install-time precache. Both of these were real gaps: caching only index.html
// left "install, then go offline" with a blank app (no module bundle), and the
// craft view drew an empty box with no model available.
test('install precaches the entry bundle, not just the shell', async () => {
  const html = () =>
    new FakeResponse(
      '<!doctype html><script type="module" src="/assets/index-abc.js"></script><link rel="stylesheet" href="/assets/index-abc.css">',
      { contentType: 'text/html' }
    )
  const requested = []
  const { dispatch, caches } = loadWorker({
    network: async (url) => {
      requested.push(url)
      return url.endsWith('.html') ? html() : new FakeResponse('asset')
    }
  })
  await dispatch('install')
  assert.ok(
    requested.some((url) => url.endsWith('/assets/index-abc.js')),
    'the module bundle must be precached — index.html alone is not a usable app'
  )
  assert.ok(requested.some((url) => url.endsWith('/assets/index-abc.css')))
  assert.ok(await caches.match(`${ORIGIN}/assets/index-abc.js`) ?? await caches.match('/assets/index-abc.js'))
})

test('install precaches the fallback craft model so the 3D view is never empty offline', async () => {
  // Frame-specific models total ~12 MB and are cached opportunistically; the
  // small generic one ships up front so something always renders.
  const requested = []
  const { dispatch } = loadWorker({
    network: async (url) => {
      requested.push(url)
      return url.endsWith('.html')
        ? new FakeResponse('<!doctype html>', { contentType: 'text/html' })
        : new FakeResponse('{}')
    }
  })
  await dispatch('install')
  assert.ok(
    requested.some((url) => url.endsWith('/models/fallback.gltf')),
    'the fallback model must be precached'
  )
})

test('a precache failure does not abort installation', async () => {
  // Installing on a flaky link must still leave a working ONLINE app.
  const { dispatch } = loadWorker({
    network: async () => {
      throw new Error('flaky')
    }
  })
  await assert.doesNotReject(() => dispatch('install'))
})

test('an opaque cross-origin response is never persisted', async () => {
  const { dispatch, caches } = loadWorker({
    network: async () => new FakeResponse('', { type: 'opaque' })
  })
  await dispatch('fetch', scriptRequest('/assets/x-hash.js'))
  const cached = await caches.match(`${ORIGIN}/assets/x-hash.js`)
  assert.equal(cached, undefined, 'only inspectable basic responses may be cached')
})
