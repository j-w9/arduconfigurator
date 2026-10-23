// Where the firmware finder gets ArduPilot's builds: the private deploy's
// same-origin index and relay (functions/fw/apj.ts, scripts/build-firmware-
// index.mjs). A site without them (the public build, the desktop shell's
// file:// bundle) answers with the SPA page or nothing, and the finder stays
// hidden -- the Flash tab keeps its download link.

import { parseFirmwareIndex, type FirmwareIndexRow } from '../view-models/firmware-finder'

export interface FirmwareIndexSource {
  loadIndex(): Promise<FirmwareIndexRow[]>
  /** One .apj, by its path under firmware.ardupilot.org, and its build commit when known. */
  download(path: string, gitSha?: string): Promise<string>
}

/** The site's index at `indexPath`, and its one relay for the files. */
function relaySource(indexPath: string): FirmwareIndexSource {
  return {
    async loadIndex() {
      const response = await fetch(indexPath, { cache: 'no-cache' })
      if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) {
        throw new Error('No firmware index on this site.')
      }
      return parseFirmwareIndex(await response.json())
    },
    async download(path, gitSha) {
      // The commit in the URL gives each build its own cache entry, here and at the edge.
      const response = await fetch(`/fw/apj?path=${encodeURIComponent(path)}${gitSha ? `&sha=${encodeURIComponent(gitSha)}` : ''}`)
      if (!response.ok) throw new Error((await response.text()) || `Download failed (HTTP ${response.status}).`)
      return response.text()
    }
  }
}

/** The Flash tab's .apj builds. */
export const relayFirmwareSource: FirmwareIndexSource = relaySource('/fw/index.json')

/** The DFU tab's *_with_bl.hex builds: the same targets, firmware with the
 *  bootloader in front, for a board in STM32 DFU mode. */
export const relayHexFirmwareSource: FirmwareIndexSource = relaySource('/fw/hex-index.json')

/** The desktop shell's source: its main process reaches firmware.ardupilot.org directly. */
export function desktopFirmwareSource(bridge: {
  index?(): Promise<unknown>
  download(url: string): Promise<Uint8Array>
}): FirmwareIndexSource {
  return {
    async loadIndex() {
      if (!bridge.index) throw new Error('This desktop app cannot list firmware.')
      return parseFirmwareIndex(await bridge.index())
    },
    async download(path) {
      return new TextDecoder().decode(await bridge.download(`https://firmware.ardupilot.org/${path}`))
    }
  }
}
