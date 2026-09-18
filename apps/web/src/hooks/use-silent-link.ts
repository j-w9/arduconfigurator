// "Connected, but nothing is talking."
//
// A Betaflight board does not speak MAVLink at all — no heartbeat, ever — so
// the unsupported-autopilot banner cannot fire for it: that one needs a
// heartbeat carrying a different autopilot id. What a Betaflight board produces
// is silence, and the app sat on "Waiting for heartbeat" indefinitely while the
// operator waited for something that was never coming.
//
// Silence is only evidence after a while. A healthy ArduPilot link takes a
// moment to produce its first heartbeat, so this deliberately waits rather than
// accusing every connection of being a Betaflight board for its first second.

import { useEffect, useRef, useState } from 'react'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

/**
 * How long a connected link may stay silent before we suggest an explanation.
 *
 * Long enough that a slow ArduPilot boot is never accused: HEARTBEAT is 1 Hz,
 * and a board still initialising can take several seconds to send its first.
 */
const SILENT_LINK_TIMEOUT_MS = 9000

export function useSilentLink(snapshot: ConfiguratorSnapshot): boolean {
  const [silent, setSilent] = useState(false)
  const connectedSinceRef = useRef<number | undefined>(undefined)

  const connected = snapshot.connection.kind === 'connected'
  // A vehicle OR a foreign heartbeat both mean something is talking; only the
  // complete absence of either is the case this describes.
  const heard = snapshot.vehicle !== undefined || snapshot.unsupportedAutopilot !== undefined

  useEffect(() => {
    if (!connected || heard) {
      connectedSinceRef.current = undefined
      setSilent(false)
      return
    }
    if (connectedSinceRef.current === undefined) {
      connectedSinceRef.current = Date.now()
    }
    const elapsed = Date.now() - connectedSinceRef.current
    if (elapsed >= SILENT_LINK_TIMEOUT_MS) {
      setSilent(true)
      return
    }
    const timer = setTimeout(() => setSilent(true), SILENT_LINK_TIMEOUT_MS - elapsed)
    return () => clearTimeout(timer)
  }, [connected, heard])

  return silent
}
