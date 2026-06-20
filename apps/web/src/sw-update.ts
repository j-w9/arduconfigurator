import { useEffect, useState } from 'react'

// PWA update flow: the service worker (apps/web/public/sw.js) deliberately
// does NOT call skipWaiting() on install — a new SW stays in `waiting`
// until the user opts in. This module registers the SW and exposes a hook
// that returns the latest update state so a banner can surface the prompt.
//
// Why a manual opt-in: an auto-activated SW would still leave the live
// page running the OLD bundle (the new code only loads on refresh), so
// the silent swap buys nothing visible to the user — but it CAN interrupt
// an in-flight MAVLink session (param write, log download, firmware
// flash) if the cache transition races. Opt-in keeps the user in control.

export type SwUpdateState =
  | { kind: 'idle' }
  | { kind: 'available'; apply: () => void }

interface UpdateBus {
  state: SwUpdateState
  listeners: Set<(state: SwUpdateState) => void>
}

const bus: UpdateBus = { state: { kind: 'idle' }, listeners: new Set() }
let registrationStarted = false

function publish(next: SwUpdateState): void {
  bus.state = next
  for (const listener of bus.listeners) listener(next)
}

/**
 * Register the SW once per page. Idempotent — safe to call from main.tsx
 * on app boot regardless of how many times React mounts the consumer hook.
 *
 * Skipped on localhost / 127.0.0.1 because `vite dev` serves /src/main.tsx
 * via HMR and a SW would intercept those requests with a stale cached
 * response.
 */
export function registerServiceWorker(): void {
  if (registrationStarted) return
  registrationStarted = true
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1') return

  // GitHub Pages serves under /ArduConfigurator/, Vercel under /. Derive
  // both the SW URL and its scope from the entry-page path so the same
  // script works on either host without a build-time substitution.
  const basePath = window.location.pathname.replace(/[^/]*$/, '')

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(basePath + 'sw.js', { scope: basePath })
      .then((registration) => {
        // A waiting worker may already be present when this script runs
        // (deploy landed while the tab was open but before SW registration
        // completed). Surface it immediately.
        if (registration.waiting && navigator.serviceWorker.controller) {
          offer(registration.waiting)
        }
        if (registration.installing) {
          watchInstalling(registration.installing)
        }
        registration.addEventListener('updatefound', () => {
          if (registration.installing) watchInstalling(registration.installing)
        })
      })
      .catch(() => {
        // SW registration failure is non-fatal — the app still works
        // without PWA install.
      })
  })
}

function watchInstalling(worker: ServiceWorker): void {
  worker.addEventListener('statechange', () => {
    // `installed` with a controller present = an UPGRADE: there was an
    // existing SW serving this page, and a new one just finished
    // installing. (A first install reaches `installed` with controller
    // still null; clients.claim() in activate sets it shortly after.)
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      offer(worker)
    }
  })
}

function offer(worker: ServiceWorker): void {
  // Always re-publish with a fresh apply tied to THIS worker, even if
  // the bus is already 'available' from a previous offer. A new
  // updatefound during the same session means a newer SW has just
  // installed and the previous waiting worker has been moved to
  // `redundant` (per W3C ServiceWorker spec: a new install supersedes
  // the prior waiting worker, the prior one is discarded). The cached
  // apply closure points at the now-redundant worker; postMessage to
  // it is a silent no-op. So we MUST overwrite the closure here or the
  // banner clicks land on a dead worker and nothing happens.
  const apply = (): void => {
    // controllerchange fires once the new SW takes over (its skipWaiting
    // promotes it from waiting → activating → activated, then clients.claim
    // re-controls this page). Reload then so the live document picks up
    // the new bundle. { once: true } guards against an accidental reload
    // loop if controllerchange ever fires again.
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => window.location.reload(),
      { once: true }
    )
    worker.postMessage({ type: 'SKIP_WAITING' })
  }
  publish({ kind: 'available', apply })
}

/**
 * React hook returning the latest SW update state. Multiple consumers
 * share the same bus, so every mounted hook reflects the same
 * `available` state and the same `apply` callback.
 */
export function useServiceWorkerUpdate(): SwUpdateState {
  const [state, setState] = useState<SwUpdateState>(bus.state)
  useEffect(() => {
    // Re-sync in case the bus advanced between render and mount.
    setState(bus.state)
    const listener = (next: SwUpdateState): void => setState(next)
    bus.listeners.add(listener)
    return () => {
      bus.listeners.delete(listener)
    }
  }, [])
  return state
}

// Test-only: reset the module's singleton bus + registration latch so
// each test can drive the flow from a clean slate. NOT used by the app
// in production.
export function __resetForTests(): void {
  bus.state = { kind: 'idle' }
  bus.listeners.clear()
  registrationStarted = false
}
