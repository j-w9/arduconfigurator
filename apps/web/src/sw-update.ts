// The offline-shell service worker was RETIRED — it stranded users on a stale
// app shell across deploys (white screen until a hard refresh). apps/web/public/
// sw.js is now a self-destructing SW; registerServiceWorker() makes the running
// app unregister any lingering SW and clear its caches, and registers nothing.
//
// But retiring the SW also removed the "new version is ready — Refresh" prompt:
// a tab left open across a deploy keeps running the old bundle with no signal.
// useServiceWorkerUpdate() brings that prompt back WITHOUT a service worker, by
// polling the deployed index.html and comparing its hashed entry-bundle name to
// the one THIS tab loaded. No SW = no stale-shell risk; the check is pure
// network polling. Refresh does a plain location.reload() to pick up the new
// bundle.

import { useEffect, useRef, useState } from 'react'

// Kept as a union so App.tsx's banner can switch on 'available'.
export type SwUpdateState = { kind: 'idle' } | { kind: 'available'; apply: () => void }

// How often to re-check for a new deploy while the tab stays open. Also checked
// on tab refocus (visibilitychange) so an app left open overnight notices a
// deploy promptly on the next glance, without hammering the server in between.
const UPDATE_POLL_INTERVAL_MS = 5 * 60 * 1000
// Debounce refocus checks so rapid tab switching doesn't fire a burst of fetches.
const REFOCUS_DEBOUNCE_MS = 30 * 1000

let cleanupStarted = false

/**
 * Unregister any previously-installed service worker and clear its caches;
 * register nothing. Idempotent, safe to call once on app boot.
 */
export function registerServiceWorker(): void {
  if (cleanupStarted) return
  cleanupStarted = true
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        for (const registration of registrations) void registration.unregister()
      })
      .catch(() => {})
    if ('caches' in window) {
      caches
        .keys()
        .then((keys) => {
          for (const key of keys) void caches.delete(key)
        })
        .catch(() => {})
    }
  })
}

/**
 * Extract the hashed entry-bundle path (`assets/index-<hash>.js`) from a string —
 * either the served index.html or a script `src`. Vite emits the app entry as a
 * single `assets/index-<hash>.js` whose hash changes on every build, so this is
 * a stable per-deploy fingerprint. Returns null when no hashed entry is present
 * (e.g. `vite dev`, where the entry is an un-hashed `/src/main.tsx`), which
 * disables the check rather than false-prompting. Pure — unit-tested.
 */
export function extractAppBundlePath(text: string): string | null {
  const match = text.match(/assets\/index-[A-Za-z0-9_-]+\.js/)
  return match ? match[0] : null
}

/** The entry bundle THIS tab actually loaded, read from the live document's
 *  module script tag. This is the baseline the poll compares against — using
 *  the running tab's bundle (not a first-fetch of index.html) means a deploy
 *  that lands between page-load and the first poll is still detected. */
function readLoadedAppBundlePath(): string | null {
  if (typeof document === 'undefined') return null
  const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))
  for (const script of scripts) {
    const path = extractAppBundlePath(script.src)
    if (path) return path
  }
  return null
}

/** Fetch the deployed index.html (bypassing the browser cache) and return its
 *  current entry-bundle path, or null on any failure (offline, blip) so the
 *  caller simply retries next interval. */
async function fetchDeployedAppBundlePath(): Promise<string | null> {
  try {
    const url = `${import.meta.env.BASE_URL}index.html`
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) return null
    return extractAppBundlePath(await response.text())
  } catch {
    return null
  }
}

/**
 * Returns `{ kind: 'available', apply }` once a newer deployment is detected
 * (the deployed index.html points at a different entry bundle than this tab
 * loaded); `{ kind: 'idle' }` otherwise. `apply` reloads the page.
 *
 * e2e seam: `?appUpdate=available` forces the available state immediately
 * (mirrors the app's other URL-param test seams), so the banner can be
 * exercised without an actual redeploy.
 */
export function useServiceWorkerUpdate(): SwUpdateState {
  const [available, setAvailable] = useState(false)
  const loadedBundleRef = useRef<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    if (new URLSearchParams(window.location.search).get('appUpdate') === 'available') {
      setAvailable(true)
      return
    }

    // Baseline: the bundle this tab is running. If it can't be determined
    // (dev server, no hashed entry), skip the check entirely — never prompt.
    loadedBundleRef.current = readLoadedAppBundlePath()
    if (!loadedBundleRef.current) return

    let cancelled = false
    let lastRefocusCheck = 0

    const check = async (): Promise<void> => {
      const deployed = await fetchDeployedAppBundlePath()
      if (cancelled || deployed === null) return
      if (deployed !== loadedBundleRef.current) {
        setAvailable(true)
      }
    }

    const interval = window.setInterval(() => void check(), UPDATE_POLL_INTERVAL_MS)
    const onVisibility = (): void => {
      if (document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastRefocusCheck < REFOCUS_DEBOUNCE_MS) return
      lastRefocusCheck = now
      void check()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  if (!available) return { kind: 'idle' }
  return { kind: 'available', apply: () => window.location.reload() }
}

export function __resetForTests(): void {
  cleanupStarted = false
}
