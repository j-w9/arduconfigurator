// Ask before the page is left while something live would be lost.
//
// The app has no routing, so the browser's Back button leaves it outright —
// and with it the MAVLink session and any guided exercise in flight. The
// guard is deliberately narrow: it is only armed while the caller says a
// session is active, so an operator browsing a connected vehicle at rest is
// never nagged. Browsers show their own generic prompt; the text is theirs.

import { useEffect } from 'react'

export function useUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active || typeof window === 'undefined') {
      return
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Legacy engines still read the return value.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [active])
}
