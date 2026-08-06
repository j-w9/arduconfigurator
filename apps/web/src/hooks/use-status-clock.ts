import { useEffect, useState } from 'react'

/**
 * A coarse 1 Hz "what time is it now" clock for freshness readouts.
 *
 * The Status & Info sensor cards have to be able to age from "reporting" into
 * "no data for 12 s" on their own. Everything else in the app re-renders when
 * a snapshot arrives — but a snapshot arriving is exactly what STOPS happening
 * when the sensor being watched dies, so a card that read `Date.now()` during
 * render would freeze at the moment of the last message and keep displaying a
 * stale distance as though the sensor were healthy. That is the single worst
 * failure mode for this feature, so the clock is explicit.
 *
 * 1 Hz because the smallest unit any of these readouts prints is one second;
 * ticking faster would only cost renders. `enabled` keeps it switched off
 * entirely when nothing is displaying a freshness value, so the rest of the
 * app pays nothing for it.
 */
export function useStatusClock(enabled: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) {
      return
    }
    // Re-sync immediately on enable so a tab switch shows a current age
    // rather than whatever the clock read when the app started.
    setNowMs(Date.now())
    const interval = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)
    return () => {
      window.clearInterval(interval)
    }
  }, [enabled])

  return nowMs
}
