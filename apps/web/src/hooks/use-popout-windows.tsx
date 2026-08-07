// Multi-window "pop out" support for inspector surfaces.
//
// Mission Planner and the DroneCAN GUI both let an operator tear a device
// inspector off into its own window so several devices can be watched side by
// side. This hook is the browser equivalent: it opens child windows and hands
// back a DOM container per window that the caller renders into with
// createPortal. The portal keeps the popped-out content INSIDE the opener's
// React tree, so it shares the same runtime snapshot, the same subscriptions,
// and the same draft state — there is exactly one session, and a popout is a
// second view onto it, never a second transport.
//
// Three things make or break popouts, and all three are handled here:
//
//  1. Popup blockers. window.open() only survives a blocker when it is called
//     synchronously from a real user gesture, so `open` is designed to be
//     invoked straight from an onClick handler (never from an effect, where the
//     user-activation window has already closed). A blocked open is reported
//     back so the caller can explain it instead of failing silently.
//  2. Styling. A fresh about:blank document inherits nothing, so every <style>
//     and <link rel=stylesheet> in the opener is cloned into the child, and the
//     <html data-theme> / color-scheme are mirrored (and kept mirrored) so the
//     popout matches the app's theme rather than rendering as raw HTML.
//  3. Lifecycle. Windows can go away three ways — the operator closes the
//     popout, the operator closes/navigates the opener, or the component
//     unmounts. All three are covered (pagehide + a closed-window poll for the
//     browsers that skip pagehide on about:blank), so no portal is left
//     pointing at a dead document and no subscription leaks per popout.

import { useCallback, useEffect, useRef, useState } from 'react'

/** One live popout window and the element to portal into. */
export interface PopoutWindowHandle {
  /** Caller-chosen identity (one window per key). */
  key: string
  /** Window title, shown in the child's title bar / taskbar. */
  title: string
  /** The element inside the child document to render into. */
  container: HTMLElement
  /** The child window itself (exposed so callers can focus/close it). */
  win: Window
}

export interface UsePopoutWindowsResult {
  /** Currently open popouts, in open order. */
  popouts: PopoutWindowHandle[]
  /**
   * Open (or re-focus) a popout. MUST be called directly from a user gesture
   * handler. Returns false when the browser blocked the window — the caller is
   * expected to surface that to the operator.
   */
  open: (key: string, title: string) => boolean
  /** Close one popout by key (no-op when it isn't open). */
  close: (key: string) => void
  /** Is a popout with this key currently open? */
  isOpen: (key: string) => boolean
  /** Key of the most recent blocked open, or undefined. Cleared by dismissBlocked. */
  blockedKey: string | undefined
  dismissBlocked: () => void
}

const POPOUT_FEATURES =
  'popup=yes,width=620,height=820,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes'

/**
 * Clone the opener's styling into a popout document. Covers both shapes Vite
 * produces: injected <style> blocks in dev and a hashed <link rel=stylesheet>
 * in a production build. Constructed stylesheets (adoptedStyleSheets) are
 * re-adopted directly since they are not DOM nodes and cannot be cloned.
 */
function copyDocumentStyles(source: Document, target: Document): void {
  for (const node of Array.from(source.querySelectorAll('style, link[rel="stylesheet"]'))) {
    target.head.appendChild(node.cloneNode(true))
  }
  const sourceAdopted = (source as Document & { adoptedStyleSheets?: unknown }).adoptedStyleSheets
  if (Array.isArray(sourceAdopted) && sourceAdopted.length > 0) {
    try {
      ;(target as Document & { adoptedStyleSheets?: unknown }).adoptedStyleSheets = [...sourceAdopted]
    } catch {
      // Cross-document adoption is not allowed everywhere; the cloned <style>
      // nodes above already carry the app's own CSS, so this is a bonus only.
    }
  }
}

/** Mirror the opener's theme onto a popout root so it renders in the same
 *  light/dark tokens. Called on open and whenever the opener's theme changes. */
function mirrorTheme(source: Document, target: Document): void {
  const theme = source.documentElement.getAttribute('data-theme')
  if (theme) {
    target.documentElement.setAttribute('data-theme', theme)
  }
  target.documentElement.style.colorScheme = source.documentElement.style.colorScheme
}

export function usePopoutWindows(): UsePopoutWindowsResult {
  const [popouts, setPopouts] = useState<PopoutWindowHandle[]>([])
  const [blockedKey, setBlockedKey] = useState<string | undefined>(undefined)
  // Ref mirror so the unmount cleanup and the closed-window poll can see the
  // current set without re-subscribing on every open/close.
  const popoutsRef = useRef<PopoutWindowHandle[]>([])
  popoutsRef.current = popouts

  const forget = useCallback((key: string) => {
    setPopouts((current) => current.filter((handle) => handle.key !== key))
  }, [])

  const open = useCallback(
    (key: string, title: string): boolean => {
      const existing = popoutsRef.current.find((handle) => handle.key === key)
      if (existing && !existing.win.closed) {
        // Already open — bring it forward rather than spawning a duplicate.
        existing.win.focus()
        return true
      }
      // Called synchronously from the click handler: this is the only moment the
      // browser will honour window.open without a blocker.
      const win = window.open('', `arduconfig-popout-${key}`, POPOUT_FEATURES)
      if (!win) {
        setBlockedKey(key)
        return false
      }
      setBlockedKey(undefined)
      const doc = win.document
      doc.title = title
      doc.body.innerHTML = ''
      doc.body.className = 'arduconfig-popout-body'
      copyDocumentStyles(document, doc)
      mirrorTheme(document, doc)
      const container = doc.createElement('div')
      container.className = 'arduconfig-popout'
      doc.body.appendChild(container)
      // The operator closing the popout directly must drop the portal, or React
      // keeps rendering into a detached document.
      win.addEventListener('pagehide', () => forget(key))
      setPopouts((current) => [...current.filter((handle) => handle.key !== key), { key, title, container, win }])
      return true
    },
    [forget]
  )

  const close = useCallback(
    (key: string) => {
      const handle = popoutsRef.current.find((entry) => entry.key === key)
      if (handle && !handle.win.closed) {
        handle.win.close()
      }
      forget(key)
    },
    [forget]
  )

  const isOpen = useCallback(
    (key: string) => popoutsRef.current.some((handle) => handle.key === key && !handle.win.closed),
    []
  )

  // Belt-and-braces reaper: a few browsers skip pagehide for about:blank child
  // windows, which would leave a portal rendering into a dead document forever.
  useEffect(() => {
    if (popouts.length === 0) {
      return
    }
    const timer = window.setInterval(() => {
      const dead = popoutsRef.current.filter((handle) => handle.win.closed)
      if (dead.length > 0) {
        setPopouts((current) => current.filter((handle) => !handle.win.closed))
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [popouts.length])

  // Keep popouts on the opener's theme while they're open.
  useEffect(() => {
    if (popouts.length === 0) {
      return
    }
    const observer = new MutationObserver(() => {
      for (const handle of popoutsRef.current) {
        if (!handle.win.closed) {
          mirrorTheme(document, handle.win.document)
        }
      }
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    return () => observer.disconnect()
  }, [popouts.length])

  // Close every child when the opener goes away (unmount, reload, navigation) —
  // orphaned popouts would show frozen data with no session behind them.
  useEffect(() => {
    const closeAll = (): void => {
      for (const handle of popoutsRef.current) {
        if (!handle.win.closed) {
          handle.win.close()
        }
      }
    }
    window.addEventListener('pagehide', closeAll)
    return () => {
      window.removeEventListener('pagehide', closeAll)
      closeAll()
    }
  }, [])

  const dismissBlocked = useCallback(() => setBlockedKey(undefined), [])

  return { popouts, open, close, isOpen, blockedKey, dismissBlocked }
}
