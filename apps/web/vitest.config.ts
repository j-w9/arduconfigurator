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

// The AMC guided-mode experiment's packages and step data live in the
// arduconfig-amc fork that has this repository as a submodule, two levels up.
// Aliased here for the same reason as the workspace packages above: the tests
// import the sources the app build uses, with no build step in between.
const amcRoot = new URL('../../', root)
const amc = (name: string, entry: string) =>
  [name, fileURLToPath(new URL(entry, amcRoot))] as const

export default defineConfig({
  resolve: {
    alias: Object.fromEntries([
      pkg('@arduconfig/transport', 'transport/src/index.ts'),
      pkg('@arduconfig/firmware-flash', 'firmware-flash/src/index.ts'),
      pkg('@arduconfig/protocol-mavlink', 'protocol-mavlink/src/index.ts'),
      pkg('@arduconfig/ardupilot-core', 'ardupilot-core/src/index.ts'),
      pkg('@arduconfig/param-metadata', 'param-metadata/src/index.ts'),
      pkg('@arduconfig/ai-assistant', 'ai-assistant/src/index.ts'),
      pkg('@arduconfig/ui-kit', 'ui-kit/src/index.tsx'),
      amc('@arduconfig/amc-expr', 'packages/amc-expr/src/index.ts'),
      amc('@arduconfig/amc-steps', 'packages/amc-steps/src/index.ts'),
      amc('@amc/data', 'steps')
    ])
  },
  test: {
    // node by default: the view-models are pure and this keeps them fast. A
    // component test opts into a DOM per file with
    // `// @vitest-environment jsdom`, so only the files that need one pay for
    // it. Component tests exist because two bugs shipped that the pure tests
    // could not see -- a hook reading a ref declared below it, and an effect
    // saving one vehicle's work under another's key.
    environment: 'node',
    // .tsx included too: a component test written as `.test.tsx` would
    // otherwise be silently never run, which looks identical to passing.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx']
  }
})
