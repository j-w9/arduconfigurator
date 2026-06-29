// Derives a live frames/sec rate for the DroneCAN inspector from the runtime's
// cumulative framesReceived counter. The counter lives on the snapshot (which
// re-renders App frequently), so we read it through a ref and sample the delta
// on a fixed interval — the interval only resets when the bus goes active /
// idle, never on every frame. Read-only: no runtime interaction.

import { useEffect, useRef, useState } from 'react'

const SAMPLE_INTERVAL_MS = 1000

export function useDronecanBusStats(framesReceived: number, active: boolean): number {
  const framesRef = useRef(framesReceived)
  framesRef.current = framesReceived
  const [framesPerSec, setFramesPerSec] = useState(0)

  useEffect(() => {
    if (!active) {
      setFramesPerSec(0)
      return
    }
    let prevFrames = framesRef.current
    let prevMs = Date.now()
    const interval = setInterval(() => {
      const now = Date.now()
      const elapsedSec = (now - prevMs) / 1000
      if (elapsedSec > 0) {
        setFramesPerSec(Math.max(0, (framesRef.current - prevFrames) / elapsedSec))
      }
      prevFrames = framesRef.current
      prevMs = now
    }, SAMPLE_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [active])

  return framesPerSec
}
