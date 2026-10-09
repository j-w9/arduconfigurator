// The CAN tab's online node firmware on the website: AP_Periph builds from the
// private deploy's index (/fw/periph-index.json) and relay (/fw/apj), matched
// to a node by its board id -- what the desktop shell does with its native
// fetch, for a browser that cannot reach firmware.ardupilot.org itself.

import { decodeApjImage, dronecanNodeBoardId, parseApj } from '@arduconfig/firmware-flash'
import type { DronecanInspectedNode } from '@arduconfig/ardupilot-core'

import { inflateZlib } from './web-serial-bootloader'
import { relayFirmwareSource } from './firmware-index-source'
import { apjBuildMismatch, parseFirmwareIndex, type FirmwareIndexRow } from '../view-models/firmware-finder'
import type { DronecanFirmwareCandidate, DronecanFirmwareOnlineSource } from '../views/CanDeviceInspector'

/** The AP_Periph index, or why there is none (a site without the relay). */
export async function loadPeriphIndex(): Promise<FirmwareIndexRow[]> {
  const response = await fetch('/fw/periph-index.json', { cache: 'no-cache' })
  if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) {
    throw new Error('No AP_Periph firmware index on this site.')
  }
  return parseFirmwareIndex(await response.json())
}

const CHANNEL_LABEL: Record<string, string> = { OFFICIAL: 'Stable', BETA: 'Beta', DEV: 'Dev' }
const CHANNEL_ORDER = ['OFFICIAL', 'BETA', 'DEV']
const HOST = 'https://firmware.ardupilot.org/'

/** The node's builds, stable first. */
export function periphCandidates(rows: readonly FirmwareIndexRow[], boardId: number): DronecanFirmwareCandidate[] {
  return rows
    .filter((row) => row.boardId === boardId)
    .sort((left, right) => CHANNEL_ORDER.indexOf(left.channel) - CHANNEL_ORDER.indexOf(right.channel) || left.platform.localeCompare(right.platform))
    .map((row) => ({
      url: HOST + row.path,
      versionLabel: row.version || 'unknown',
      releaseLabel: CHANNEL_LABEL[row.channel] ?? row.channel,
      platform: row.platform,
      boardId: row.boardId,
      // Each channel's entry IS its current build.
      latest: true,
      gitSha: row.gitSha
    }))
}

export function relayPeriphFirmwareSource(rows: readonly FirmwareIndexRow[]): DronecanFirmwareOnlineSource {
  return {
    available: true,
    findCandidates: async (node: DronecanInspectedNode) => {
      const boardId = dronecanNodeBoardId(node.hwVersion)
      if (boardId === undefined) {
        throw new Error('This node hasn’t reported its hardware version yet — wait for its identity to fill in, then try again.')
      }
      return periphCandidates(rows, boardId)
    },
    download: async (candidate) => {
      const path = candidate.url.startsWith(HOST) ? candidate.url.slice(HOST.length) : candidate.url
      const text = await relayFirmwareSource.download(path, candidate.gitSha)
      // The file's own commit must be the listed one (a cache or a mid-release
      // mirror can hand back another build at the same path).
      const mismatch = apjBuildMismatch(text, candidate.gitSha ?? '')
      if (mismatch) throw new Error(mismatch)
      // AP_Periph comes as .apj (zlib image); the node's bootloader flashes raw bytes.
      const image = await decodeApjImage(parseApj(text), inflateZlib)
      return { fileName: path.split('/').slice(-2).join('/'), image }
    }
  }
}
