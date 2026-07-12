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

// A real ArduPilot dataflash log file: a zero-padded log number + `.BIN`.
// `/APM/LOGS` also holds non-log files (e.g. `LASTLOG.TXT`) which must not list
// as downloadable "logs" — and whose index-fallback id can collide with a real
// log's number, producing duplicate React keys and an ambiguous download.
const DATAFLASH_LOG_NAME = /^\d+\.bin$/i

/**
 * Normalize MAVFTP `/APM/LOGS` entries into shared log items, sorted by id.
 * Keeps only real dataflash logs (`NNNNNNNN.BIN`), and dedupes by both path and
 * id: a listing can repeat an entry across a pagination boundary (observed on
 * real SITL), and — before the name filter — a non-log file's fallback id could
 * collide with a real log's number; either would produce duplicate rows and
 * colliding React keys.
 */
export function mavftpEntriesToLogItems(entries: readonly MavftpDirectoryEntry[]): MavftpLogItem[] {
  const byPath = new Map<string, MavftpLogItem>()
  const seenIds = new Set<number>()
  entries.forEach((entry, index) => {
    if (!DATAFLASH_LOG_NAME.test(entry.name.trim())) {
      return
    }
    if (byPath.has(entry.path)) {
      return
    }
    const id = parseMavftpLogId(entry.name, index)
    if (seenIds.has(id)) {
      return
    }
    seenIds.add(id)
    byPath.set(entry.path, {
      log: {
        id,
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
