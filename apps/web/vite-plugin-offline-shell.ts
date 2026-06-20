import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, posix, sep } from 'node:path'

import type { Plugin } from 'vite'

/**
 * Vite plugin that injects the offline-shell precache manifest into
 * `dist/sw.js` after the build emits its assets.
 *
 * The service-worker source (`apps/web/public/sw.js`) ships two marker
 * lines that look like:
 *
 *   const PRECACHE_MANIFEST = [] // INJECT:PRECACHE_MANIFEST
 *   const SW_VERSION = 'dev' // INJECT:SW_VERSION
 *
 * This plugin replaces them in the EMITTED `dist/sw.js` with a literal
 * array of asset URLs and a version string. The source file is left
 * untouched (vite dev keeps shipping the no-op passthrough). The
 * markers are single-line literals so the substitution is byte-robust
 * — no JS parser involved.
 *
 * Cached assets are the minimum shell needed to render the
 * disconnected landing page offline:
 *   - the entry HTML (index.html under the deploy base)
 *   - hashed assets under `assets/`
 *   - favicon, web manifest, install icons
 *
 * Explicitly NOT cached: 3D vehicle models (~7.5 MB total),
 * accel-pose images, demo recordings — none of those matter for an
 * unconnected first-launch and they would blow the cache budget on
 * disks that the browser is strict about.
 *
 * Failing to inject = the SW behaves as a no-op passthrough (the
 * source-level defaults). So an unrelated build break never corrupts
 * the deployed site — at worst it silently regresses to the
 * installable-but-not-offline state.
 */
export interface OfflineShellPluginOptions {
  /** Vite's `base` config. Asset URLs are prefixed with this so they
   *  match what the browser actually requests on the deployed host. */
  base: string
  /** SW cache version string. Changing this on any source change
   *  forces a clean activate + old-cache eviction. Wire it to the git
   *  hash you already inject (`__GIT_HASH__`) so a fresh build always
   *  invalidates the prior shell. */
  version: string
  /** Maximum bytes for any single precached file. Anything larger is
   *  skipped — typically a 3D model or an asset we didn't expect.
   *  Default 2 MiB. */
  maxBytesPerFile?: number
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

// Files we want in the shell: the entry HTML, every hashed asset under
// /assets/, the icons / favicon / web manifest. Anything else (models,
// pose illustrations, demo recordings) is intentionally network-only.
const SHELL_EXTENSIONS = new Set(['.html', '.js', '.css', '.svg', '.png', '.webmanifest'])
const SHELL_DIRECTORY_ALLOWLIST = new Set(['', 'assets', 'icons'])

export function offlineShellPlugin(options: OfflineShellPluginOptions): Plugin {
  const base = normaliseBase(options.base)
  const maxBytes = options.maxBytesPerFile ?? DEFAULT_MAX_BYTES

  return {
    name: 'arduconfig:offline-shell',
    apply: 'build',
    closeBundle: {
      // Run after every other build hook so the dist directory is fully
      // populated by the time we read it.
      order: 'post',
      handler() {
        const distDir = join(process.cwd(), 'dist')
        let entries: string[]
        try {
          entries = collectShellAssets(distDir, maxBytes)
        } catch (error) {
          // A missing dist/ at this point means the rollup build never
          // wrote anything — let the higher-level build failure surface
          // instead of failing with a misleading SW error.
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return
          }
          throw error
        }
        if (entries.length === 0) {
          throw new Error(
            'offline-shell plugin: no shell assets found under dist/. The build emitted nothing matching the allowlist; SW injection would produce an empty precache.'
          )
        }
        // Prefix each path with the deploy base so the URLs match what
        // the browser will actually request. The entry HTML must be
        // FIRST in the manifest — the SW uses it as the navigation
        // fallback (see sw.js NAVIGATION_FALLBACK).
        const indexHtml = entries.find((file) => file === 'index.html')
        if (!indexHtml) {
          throw new Error("offline-shell plugin: dist/ has no index.html; can't seed a navigation fallback.")
        }
        const ordered = [indexHtml, ...entries.filter((file) => file !== indexHtml)]
        const manifest = ordered.map((file) => base + file)
        injectIntoServiceWorker(join(distDir, 'sw.js'), manifest, options.version)
      }
    }
  }
}

function normaliseBase(raw: string): string {
  if (raw === '' || raw === '.' || raw === './') return '/'
  let value = raw
  if (!value.startsWith('/')) value = `/${value}`
  if (!value.endsWith('/')) value = `${value}/`
  return value
}

function collectShellAssets(distDir: string, maxBytes: number): string[] {
  const result: string[] = []
  walk(distDir, '', (relative, absolute) => {
    const stats = statSync(absolute)
    if (stats.isDirectory()) {
      // Recurse only into directories whose top-level segment is
      // allowlisted — keeps `models/`, `accel-poses/`, etc. out of the
      // shell entirely.
      const topSegment = relative.split(posix.sep)[0] ?? ''
      if (relative === '' || SHELL_DIRECTORY_ALLOWLIST.has(topSegment)) {
        return 'recurse'
      }
      return 'skip'
    }
    if (relative === 'sw.js') {
      // Never precache the SW itself — the browser fetches it through
      // its own update channel, not via cache.
      return 'skip'
    }
    if (!SHELL_EXTENSIONS.has(extName(relative))) {
      return 'skip'
    }
    if (stats.size > maxBytes) {
      return 'skip'
    }
    result.push(relative.split(sep).join(posix.sep))
    return 'recurse'
  })
  return result.sort()
}

function walk(
  root: string,
  relative: string,
  visit: (relative: string, absolute: string) => 'recurse' | 'skip'
): void {
  const absolute = join(root, relative)
  const decision = visit(relative, absolute)
  if (decision === 'skip') return
  const stats = statSync(absolute)
  if (!stats.isDirectory()) return
  for (const child of readdirSync(absolute)) {
    walk(root, relative === '' ? child : posix.join(relative, child), visit)
  }
}

function extName(file: string): string {
  const dot = file.lastIndexOf('.')
  if (dot < 0) return ''
  return file.slice(dot)
}

function injectIntoServiceWorker(swPath: string, manifest: string[], version: string): void {
  let source: string
  try {
    source = readFileSync(swPath, 'utf8')
  } catch {
    throw new Error(`offline-shell plugin: expected ${swPath} (copied from public/sw.js) but it was missing.`)
  }
  const manifestLiteral = JSON.stringify(manifest)
  const versionLiteral = JSON.stringify(version)
  const manifestReplaced = source.replace(
    /const PRECACHE_MANIFEST = \[\] \/\/ INJECT:PRECACHE_MANIFEST/,
    `const PRECACHE_MANIFEST = ${manifestLiteral} // INJECTED`
  )
  if (manifestReplaced === source) {
    throw new Error(
      "offline-shell plugin: didn't find the PRECACHE_MANIFEST marker in sw.js — was the source rewritten?"
    )
  }
  const versionReplaced = manifestReplaced.replace(
    /const SW_VERSION = '[^']*' \/\/ INJECT:SW_VERSION/,
    `const SW_VERSION = ${versionLiteral} // INJECTED`
  )
  if (versionReplaced === manifestReplaced) {
    throw new Error(
      "offline-shell plugin: didn't find the SW_VERSION marker in sw.js — was the source rewritten?"
    )
  }
  writeFileSync(swPath, versionReplaced)
}
