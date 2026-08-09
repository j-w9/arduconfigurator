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
 *
 * Also undefined until the board has actually identified itself. Board identity
 * arrives on AUTOPILOT_VERSION, some time after the link comes up, so a
 * placeholder key would change once per connection for reasons that have
 * nothing to do with the build — and a caller invalidating on every change
 * would throw away a perfectly good fetch mid-connect. "Not known yet" and "a
 * different build" must not look the same.
 */
export function paramDefaultsIdentity(snapshot: ConfiguratorSnapshot): string | undefined {
  if (snapshot.connection.kind !== 'connected') {
    return undefined
  }
  const board = snapshot.hardware?.board
  if (board?.firmwareVersion === undefined && board?.boardType === undefined) {
    return undefined
  }
  // Firmware version alone is not enough: the same version built for two boards
  // can carry different board-specific defaults.
  return `${board?.firmwareVersion ?? '?'}|${board?.boardType ?? '?'}`
}
