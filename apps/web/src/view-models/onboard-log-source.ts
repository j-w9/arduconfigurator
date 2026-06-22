import type {
  ConfiguratorSnapshot,
  MavftpDirectoryEntry,
  OnboardLogInfo
} from '@arduconfig/ardupilot-core'

export type OnboardLogSource = 'mavftp' | 'mavlink'

/**
 * A MAVFTP log entry normalized for the shared onboard-log list, plus the
 * on-FC path/filename needed to download it and name the saved file.
 */
export interface MavftpLogItem {
  log: OnboardLogInfo
  path: string
  name: string
}

/**
 * ArduPilot dataflash log files are named by their zero-padded log number
 * (e.g. `00000001.BIN`). Parse that number so a MAVFTP-sourced log slots into
 * the same numeric-id list the LOG_* path uses. Falls back to a 1-based index
 * when the name has no leading digits, so unparseable names still list.
 */
export function parseMavftpLogId(name: string, fallbackIndex: number): number {
  const match = /^(\d+)/.exec(name.trim())
  if (match) {
    const parsed = Number.parseInt(match[1], 10)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallbackIndex + 1
}

/**
 * Prefer MAVFTP (faster burst read + real filenames) when the board reports
 * FTP support; fall back to the LOG_* dataflash path otherwise.
 */
export function selectOnboardLogSource(snapshot: ConfiguratorSnapshot): OnboardLogSource {
  return snapshot.hardware.board?.ftpSupported ? 'mavftp' : 'mavlink'
}

/**
 * Normalize MAVFTP `/APM/LOGS` entries into shared log items, sorted by id.
 * Dedupes by path: a MAVFTP directory listing can repeat an entry across a
 * pagination boundary (observed against real SITL), which would otherwise
 * produce duplicate rows and colliding React keys.
 */
export function mavftpEntriesToLogItems(entries: readonly MavftpDirectoryEntry[]): MavftpLogItem[] {
  const byPath = new Map<string, MavftpLogItem>()
  entries.forEach((entry, index) => {
    if (byPath.has(entry.path)) {
      return
    }
    byPath.set(entry.path, {
      log: {
        id: parseMavftpLogId(entry.name, index),
        sizeBytes: entry.sizeBytes ?? 0,
        // MAVFTP directory listings carry no log timestamp; the filename
        // carries identity, so the UI shows the name rather than a date.
        timeUtc: 0
      },
      path: entry.path,
      name: entry.name
    })
  })
  return [...byPath.values()].sort((left, right) => left.log.id - right.log.id)
}
