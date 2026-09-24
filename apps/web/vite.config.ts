import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'


const root = new URL('../..', import.meta.url)
const packagesDir = fileURLToPath(new URL('packages/', root))

// The AMC guided-mode experiment lives in the arduconfig-amc fork repo, which
// has this repository as a submodule -- so its packages and step data sit two
// levels above this checkout. Resolved here rather than vendored in, so the
// experiment tracks the fork without this branch carrying a copy of it.
const amcRoot = new URL('../../', root)
const amcPackage = (name: string): string => fileURLToPath(new URL(`packages/${name}/src/index.ts`, amcRoot))
const amcDataDir = fileURLToPath(new URL('steps/', amcRoot))

// Build-time metadata surfaced in the UI (System info + header). App
// version comes from this workspace's package.json; the git hash/branch
// are read once at build (best-effort — CI shallow clones / tarball builds
// fall back to placeholders). Overridable via env so the deploy workflow
// can inject values when git isn't available.
function readAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('package.json', import.meta.url)), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}
function gitValue(command: string, envOverride: string | undefined): string {
  if (envOverride && envOverride.trim().length > 0) {
    return envOverride.trim()
  }
  try {
    return execSync(command, { cwd: fileURLToPath(root) }).toString().trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}
const appVersion = readAppVersion()
const gitHash = gitValue('git rev-parse --short HEAD', process.env.ARDUCONFIG_GIT_HASH)
const gitBranch = gitValue('git rev-parse --abbrev-ref HEAD', process.env.ARDUCONFIG_GIT_BRANCH)

// GitHub Pages serves the fork from https://j-w9.github.io/ArduConfigurator/,
// so the production bundle has to emit asset URLs under `/ArduConfigurator/`.
// Local `vite dev` / `vite preview` still want a root-relative base, so the
// env var defaults to `/` when unset. The deploy workflow sets
// ARDUCONFIG_WEB_BASE=/ArduConfigurator/ before invoking `vite build`.
const base = process.env.ARDUCONFIG_WEB_BASE ?? '/'

/** Kept beside the copy in public/_headers, which serves the built site. */
const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp'
}

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __GIT_HASH__: JSON.stringify(gitHash),
    __GIT_BRANCH__: JSON.stringify(gitBranch)
  },
  plugins: [
    react()
    // The offline app-shell SW was retired (it stranded users on a stale shell
    // across deploys); sw.js is now a self-destructing no-op, so there is no
    // precache manifest to inject.
  ],
  resolve: {
    alias: {
      '@arduconfig/transport': fileURLToPath(new URL('packages/transport/src/index.ts', root)),
      '@arduconfig/firmware-flash': fileURLToPath(new URL('packages/firmware-flash/src/index.ts', root)),
      '@arduconfig/protocol-mavlink': fileURLToPath(new URL('packages/protocol-mavlink/src/index.ts', root)),
      '@arduconfig/protocol-msp': fileURLToPath(new URL('packages/protocol-msp/src/index.ts', root)),
      '@arduconfig/ardupilot-core': fileURLToPath(new URL('packages/ardupilot-core/src/index.ts', root)),
      '@arduconfig/param-metadata': fileURLToPath(new URL('packages/param-metadata/src/index.ts', root)),
      '@arduconfig/log-analysis': fileURLToPath(new URL('packages/log-analysis/src/index.ts', root)),
      '@arduconfig/ui-kit': fileURLToPath(new URL('packages/ui-kit/src/index.tsx', root)),
      '@arduconfig/amc-expr': amcPackage('amc-expr'),
      '@arduconfig/amc-steps': amcPackage('amc-steps'),
      '@amc/data': amcDataDir
    }
  },
  // Cross-origin isolation, so `vite dev` and `vite preview` behave like the
  // deployed site. The WebAssembly simulator needs SharedArrayBuffer, which
  // browsers only expose to an isolated page -- without these it silently does
  // not start locally, and production is the only place the feature works.
  // Cloudflare sets the same pair from public/_headers.
  server: {
    headers: ISOLATION_HEADERS,
    fs: {
      // The AMC packages and step data are outside this project root.
      allow: [fileURLToPath(root), fileURLToPath(amcRoot)]
    }
  },
  preview: {
    headers: ISOLATION_HEADERS
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Workspace packages are aliased to their source under packages/<name>/src,
          // so split them by directory rather than by node_modules name.
          if (id.startsWith(packagesDir)) {
            const rest = id.slice(packagesDir.length)
            const pkg = rest.slice(0, rest.indexOf('/'))
            if (
              pkg === 'protocol-mavlink' ||
              pkg === 'protocol-msp' ||
              pkg === 'transport' ||
              pkg === 'ardupilot-core'
            ) {
              return 'runtime'
            }
            if (pkg === 'param-metadata') {
              return 'param-metadata'
            }
          }
          if (id.includes('/node_modules/')) {
            if (
              id.includes('/node_modules/react/') ||
              id.includes('/node_modules/react-dom/') ||
              id.includes('/node_modules/scheduler/')
            ) {
              return 'react-vendor'
            }
            if (id.includes('/node_modules/three/')) {
              // Pull the GLTF/utility surface in examples/jsm out of the core
              // three.module.js bundle so the renderer/math core lands in its own chunk.
              if (id.includes('/node_modules/three/examples/')) {
                return 'three-examples'
              }
              return 'three-vendor'
            }
          }
          return undefined
        }
      }
    }
  }
})
