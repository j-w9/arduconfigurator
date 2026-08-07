// Popped-out CAN device inspectors: one window per DroneCAN node.
//
// Hosted at the App level rather than inside the CAN tab on purpose — an
// operator who pops a device out is doing it precisely so they can watch it
// while working somewhere else, so the windows must survive a tab switch (a
// popout owned by the CAN tab would be torn down the moment the tab unmounted).
//
// The windows are portals into the opener's React tree, so they read the same
// runtime snapshot and re-render from the same subscription. Nothing here starts
// or stops CAN forwarding: forwarding is armed once by the runtime's CAN bus
// service and kept alive by ITS keep-alive timer (ArduPilot drops GCS forwarding
// ~5s after the last MAV_CMD_CAN_FORWARD), independent of how many windows are
// looking at it. Opening or closing a popout therefore cannot starve — or tear
// down — the tunnel another window is using.

import { useCallback, useMemo, useState } from 'react'

import { usePopoutWindows, type PopoutWindowHandle } from './use-popout-windows'
import { canDevicePopoutKey, canDevicePopoutTitle } from '../view-models/can-device-inspector'

export interface CanDevicePopouts {
  /** Live device windows, each carrying the node id it is scoped to. */
  windows: Array<{ nodeId: number; handle: PopoutWindowHandle }>
  /** Node ids currently open in a window. */
  openNodeIds: number[]
  /** Open (or re-focus) a device window. MUST be called from a click handler —
   *  window.open outside a user gesture is killed by popup blockers. Returns
   *  false when the browser blocked it. */
  openDevice: (nodeId: number, label: string | undefined) => boolean
  closeDevice: (nodeId: number) => void
  /** Node id whose last open attempt was blocked by the browser, if any. */
  blockedNodeId: number | undefined
  dismissBlocked: () => void
  /** Draft parameter edits inside popped-out windows, keyed `${nodeId}:${name}`.
   *  Separate from the CAN tab's own draft map: a popped-out device is not shown
   *  inline at the same time, so there is exactly one editor per device. */
  draftValues: Record<string, string>
  setDraft: (nodeId: number, name: string, raw: string) => void
  dropDraft: (nodeId: number, name: string) => void
  dropAllDrafts: (nodeId: number) => void
  /** Drop every draft for a set of names on a node (used after Apply & Save so
   *  the rows fall back to each write's GetSet read-back). */
  dropDrafts: (nodeId: number, names: string[]) => void
}

/** Recover the node id encoded in a popout key (`can-device-<id>`). */
function nodeIdFromKey(key: string): number | undefined {
  const match = /^can-device-(\d+)$/.exec(key)
  return match ? Number(match[1]) : undefined
}

export function useCanDevicePopouts(): CanDevicePopouts {
  const popouts = usePopoutWindows()
  const [draftValues, setDraftValues] = useState<Record<string, string>>({})

  const windows = useMemo(
    () =>
      popouts.popouts
        .map((handle) => ({ nodeId: nodeIdFromKey(handle.key), handle }))
        .filter((entry): entry is { nodeId: number; handle: PopoutWindowHandle } => entry.nodeId !== undefined),
    [popouts.popouts]
  )

  const openDevice = useCallback(
    (nodeId: number, label: string | undefined) =>
      popouts.open(canDevicePopoutKey(nodeId), canDevicePopoutTitle(nodeId, label)),
    [popouts]
  )

  const closeDevice = useCallback(
    (nodeId: number) => popouts.close(canDevicePopoutKey(nodeId)),
    [popouts]
  )

  const setDraft = useCallback((nodeId: number, name: string, raw: string) => {
    setDraftValues((current) => ({ ...current, [`${nodeId}:${name}`]: raw }))
  }, [])

  const dropDraft = useCallback((nodeId: number, name: string) => {
    setDraftValues((current) => {
      const next = { ...current }
      delete next[`${nodeId}:${name}`]
      return next
    })
  }, [])

  const dropAllDrafts = useCallback((nodeId: number) => {
    setDraftValues((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${nodeId}:`)))
    )
  }, [])

  const dropDrafts = useCallback((nodeId: number, names: string[]) => {
    setDraftValues((current) => {
      const next = { ...current }
      for (const name of names) {
        delete next[`${nodeId}:${name}`]
      }
      return next
    })
  }, [])

  const blockedNodeId = popouts.blockedKey ? nodeIdFromKey(popouts.blockedKey) : undefined

  return {
    windows,
    openNodeIds: windows.map((entry) => entry.nodeId),
    openDevice,
    closeDevice,
    blockedNodeId,
    dismissBlocked: popouts.dismissBlocked,
    draftValues,
    setDraft,
    dropDraft,
    dropAllDrafts,
    dropDrafts
  }
}
