import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

/**
 * A key for "which build's parameter defaults are these".
 *
 * Firmware defaults come from the FC's own param.pck and belong to the BUILD,
 * not to the browser session. Caching them for the lifetime of the page means a
 * reconnect to another aircraft — or a flash of a build whose compiled-in
 * default differs — keeps showing the previous build's defaults and marking
 * rows "changed" against a number the connected vehicle never reported.
 *
 * Returns undefined while not connected, so disconnecting invalidates: a map
 * from one vehicle must not be trusted for the next.
 */
export function paramDefaultsIdentity(snapshot: ConfiguratorSnapshot): string | undefined {
  if (snapshot.connection.kind !== 'connected') {
    return undefined
  }
  const board = snapshot.hardware?.board
  // Firmware version alone is not enough: the same version built for two boards
  // can carry different board-specific defaults.
  return `${board?.firmwareVersion ?? '?'}|${board?.boardType ?? '?'}`
}
