// Fetch-and-hash side of the expert bootloader hash preview.
//
// Stateful, so it lives in hooks/ rather than view-models/; the derivation of
// what may honestly be SHOWN from what was read is a separate pure builder
// (view-models/bootloader-hash-preview.ts) with its own tests.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArduPilotConfiguratorRuntime } from '@arduconfig/ardupilot-core'
import { describeBootloaderImage, type BootloaderImageIdentity } from '@arduconfig/firmware-flash'

import {
  buildBootloaderHashPreview,
  type BootloaderHashPreview,
  type BootloaderHashPreviewStatus
} from '../view-models/bootloader-hash-preview'

interface BootloaderIdentityState {
  status: BootloaderHashPreviewStatus
  embedded?: BootloaderImageIdentity
  embeddedError?: string
  installed?: BootloaderImageIdentity
  installedError?: string
}

const IDLE: BootloaderIdentityState = { status: 'idle' }

export interface BootloaderIdentityHandle {
  preview: BootloaderHashPreview
  /**
   * Read both images. Calls made while a read is in flight are dropped, so the
   * arming effect can call this freely without turning into a MAVFTP read per
   * render.
   *
   * A COMPLETED result is deliberately not cached across arms. The obvious
   * saving is wrong here: once the operator actually flashes, the installed
   * image has changed, and a cached "the bootloader will change" would then be
   * a confident lie about the very thing this feature exists to report.
   */
  load: () => void
}

export function useBootloaderIdentity(
  runtime: ArduPilotConfiguratorRuntime | undefined,
  connected: boolean
): BootloaderIdentityHandle {
  const [state, setState] = useState<BootloaderIdentityState>(IDLE)
  // Guards re-entry without going through state, so the arming effect can call
  // load() freely without a render-loop of reads. Cleared when the read ends,
  // so the NEXT arm re-reads rather than showing a possibly-stale comparison.
  const inFlightRef = useRef(false)
  // Results describe one specific board on one specific link. A reconnect may
  // be a different board, or the same board after a reflash, so a stale
  // comparison must never survive it.
  const runtimeRef = useRef(runtime)

  useEffect(() => {
    if (runtimeRef.current !== runtime || !connected) {
      runtimeRef.current = runtime
      inFlightRef.current = false
      // Reset through the previous value rather than unconditionally: this
      // effect re-runs on every render while disconnected, and handing back a
      // fresh object each time would re-render forever.
      setState((previous) => (previous.status === 'idle' ? previous : IDLE))
    }
  }, [runtime, connected])

  const load = useCallback(() => {
    if (!runtime || !connected || inFlightRef.current) {
      return
    }
    inFlightRef.current = true
    setState({ status: 'loading' })

    void (async () => {
      try {
        const pair = await runtime.readBootloaderImages()
        // Hashing is local and cheap, but a WebCrypto failure must degrade to
        // "unavailable" exactly like a failed read — never to a thrown error
        // that could interrupt the operator mid-flash.
        const [embedded, installed] = await Promise.all([
          pair.embedded ? describeBootloaderImage(pair.embedded).catch(() => undefined) : undefined,
          pair.installed ? describeBootloaderImage(pair.installed).catch(() => undefined) : undefined
        ])
        setState({
          status: 'ready',
          embedded,
          // Three distinct cases, and they must not be collapsed: bytes that
          // hashed (no error), bytes that failed to hash (say so), and no bytes
          // at all (keep the read's own reason, which may itself be undefined
          // when that side was never attempted).
          embeddedError: embedded
            ? undefined
            : pair.embedded
              ? 'Could not hash the image.'
              : pair.embeddedError,
          installed,
          installedError: installed
            ? undefined
            : pair.installed
              ? 'Could not hash the image.'
              : pair.installedError
        })
      } catch (error) {
        // readBootloaderImages is written not to throw, but a link that dies
        // mid-read still can. The update path is unaffected either way: the
        // preview simply reports that nothing could be read.
        const message = error instanceof Error ? error.message : 'Could not read the bootloader images.'
        setState({ status: 'ready', embeddedError: message, installedError: message })
      } finally {
        inFlightRef.current = false
      }
    })()
  }, [runtime, connected])

  return { preview: buildBootloaderHashPreview(state), load }
}
