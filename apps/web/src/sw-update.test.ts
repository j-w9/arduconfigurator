import { describe, expect, it } from 'vitest'

import { extractAppBundlePath } from './sw-update'

describe('extractAppBundlePath', () => {
  it('extracts the hashed entry bundle from a served index.html', () => {
    const html = `<!doctype html><html><head>
      <link rel="modulepreload" href="/assets/react-vendor-C3vNzB_l.js">
      <script type="module" crossorigin src="/assets/index-DZkYp__6.js"></script>
      <link rel="stylesheet" href="/assets/index-DV3veTCI.css">
      </head><body></body></html>`
    expect(extractAppBundlePath(html)).toBe('assets/index-DZkYp__6.js')
  })

  it('extracts from a script src URL (the loaded-tab baseline)', () => {
    expect(extractAppBundlePath('http://127.0.0.1:4173/assets/index-ABC123xy.js')).toBe('assets/index-ABC123xy.js')
  })

  it('matches under a non-root deploy base', () => {
    const html = `<script type="module" src="/ArduConfigurator/assets/index-9zXq-1Ab.js"></script>`
    expect(extractAppBundlePath(html)).toBe('assets/index-9zXq-1Ab.js')
  })

  it('returns null when there is no hashed entry (e.g. vite dev serving /src/main.tsx)', () => {
    expect(extractAppBundlePath('<script type="module" src="/src/main.tsx"></script>')).toBeNull()
  })

  it('does not match the entry stylesheet (.css), only the .js bundle', () => {
    expect(extractAppBundlePath('<link href="/assets/index-DV3veTCI.css">')).toBeNull()
  })

  it('picks the entry index-*.js, not a same-name-prefixed vendor chunk', () => {
    // Only `index-<hash>.js` should match; react-vendor / param-metadata chunks
    // start with a different name and must not be picked up.
    const html = `<link rel="modulepreload" href="/assets/param-metadata-S83YFtaK.js">
      <script type="module" src="/assets/index-DZkYp__6.js"></script>`
    expect(extractAppBundlePath(html)).toBe('assets/index-DZkYp__6.js')
  })
})
