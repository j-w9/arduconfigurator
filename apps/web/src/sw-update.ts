// The offline-shell service worker was RETIRED — it stranded users on a stale
// app shell across deploys (white screen until a hard refresh). apps/web/public/
// sw.js is now a self-destructing SW; this module just makes the running app
// unregister any lingering SW and clear its caches, and registers nothing new.
// The app loads fresh from the network on every visit.

import { useState } from 'react'

// Kept as a union (not just 'idle') so consumers that switch on 'available'
// still type-check; the hook now only ever returns 'idle', so no update banner
// is shown.
export type SwUpdateState = { kind: 'idle' } | { kind: 'available'; apply: () => void }

let cleanupStarted = false

/**
 * Unregister any previously-installed service worker and clear its caches;
 * register nothing. Idempotent, safe to call once on app boot.
 *
 * The load-bearing recovery for an already-white-screened tab is the
 * self-destructing sw.js itself (driven by the browser's own SW update check,
 * independent of the page JS). This is the belt-and-suspenders cleanup for tabs
 * whose JS did run.
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

/** The SW update prompt is retired — always idle (no banner renders). */
export function useServiceWorkerUpdate(): SwUpdateState {
  const [state] = useState<SwUpdateState>({ kind: 'idle' })
  return state
}

export function __resetForTests(): void {
  cleanupStarted = false
}
