import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

// Unit tests for the framework-agnostic web logic (the pure view-models +
// helpers extracted out of App.tsx). These import the workspace packages by
// their source entry, the same as the app build, so no package build step is
// needed. The app's React components and integration paths stay covered by
// the Playwright e2e suite — this config is scoped to `*.test.ts` only and
// deliberately does NOT pick up the `tests/e2e/*.spec.ts` Playwright specs.
const root = new URL('../../', import.meta.url)
const pkg = (name: string, entry: string) =>
  [name, fileURLToPath(new URL(`packages/${entry}`, root))] as const

export default defineConfig({
  resolve: {
    alias: Object.fromEntries([
      pkg('@arduconfig/transport', 'transport/src/index.ts'),
      pkg('@arduconfig/firmware-flash', 'firmware-flash/src/index.ts'),
      pkg('@arduconfig/protocol-mavlink', 'protocol-mavlink/src/index.ts'),
      pkg('@arduconfig/ardupilot-core', 'ardupilot-core/src/index.ts'),
      pkg('@arduconfig/param-metadata', 'param-metadata/src/index.ts'),
      pkg('@arduconfig/ui-kit', 'ui-kit/src/index.tsx')
    ])
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
