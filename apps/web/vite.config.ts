import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { offlineShellPlugin } from './vite-plugin-offline-shell.js'

const root = new URL('../..', import.meta.url)
const packagesDir = fileURLToPath(new URL('packages/', root))

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

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __GIT_HASH__: JSON.stringify(gitHash),
    __GIT_BRANCH__: JSON.stringify(gitBranch)
  },
  plugins: [
    react(),
    // PWA offline app-shell: inject the precache manifest + version into
    // the SW after build. See vite-plugin-offline-shell.ts for the why.
    // No-op in `vite dev` (apply: 'build' inside the plugin).
    offlineShellPlugin({ base, version: gitHash })
  ],
  resolve: {
    alias: {
      '@arduconfig/transport': fileURLToPath(new URL('packages/transport/src/index.ts', root)),
      '@arduconfig/firmware-flash': fileURLToPath(new URL('packages/firmware-flash/src/index.ts', root)),
      '@arduconfig/protocol-mavlink': fileURLToPath(new URL('packages/protocol-mavlink/src/index.ts', root)),
      '@arduconfig/ardupilot-core': fileURLToPath(new URL('packages/ardupilot-core/src/index.ts', root)),
      '@arduconfig/param-metadata': fileURLToPath(new URL('packages/param-metadata/src/index.ts', root)),
      '@arduconfig/ui-kit': fileURLToPath(new URL('packages/ui-kit/src/index.tsx', root))
    }
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
            if (pkg === 'protocol-mavlink' || pkg === 'transport' || pkg === 'ardupilot-core') {
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
