import { useCallback, useRef, useState } from 'react'
import type {
  ConfiguratorSnapshot,
  LogDownloadProgress,
  MavftpDirectoryEntry,
  OnboardLogInfo
} from '@arduconfig/ardupilot-core'
import { buildOnboardLogFilename } from '@arduconfig/ardupilot-core'

import { downloadBinaryFile } from '../download-file'
import {
  mavftpEntriesToLogItems,
  selectOnboardLogSource,
  type MavftpLogItem,
  type OnboardLogSource
} from '../view-models/onboard-log-source'

// Minimal structural slice of the runtime the onboard-log surface needs.
export interface OnboardLogCapableRuntime {
  listOnboardLogs(): Promise<OnboardLogInfo[]>
  downloadOnboardLog(
    id: number,
    sizeBytes: number,
    onProgress?: (progress: LogDownloadProgress) => void
  ): Promise<Uint8Array>
  /** List onboard logs over MAVFTP (`/APM/LOGS`) — the faster path when supported. */
  listMavftpLogs(): Promise<MavftpDirectoryEntry[]>
  downloadMavftpLog(
    path: string,
    onProgress?: (progress: LogDownloadProgress) => void
  ): Promise<Uint8Array>
  /** Read the live snapshot to pick the source + tag the file with board identity. */
  getSnapshot(): ConfiguratorSnapshot
}

export type OnboardLogsStatus = 'idle' | 'listing' | 'ready' | 'error'

export interface OnboardLogsState {
  status: OnboardLogsStatus
  /** Which transport the most recent list used (MAVFTP burst vs LOG_* stream). */
  source: OnboardLogSource
  message?: string
  logs: OnboardLogInfo[]
  /** id → real on-FC filename for the MAVFTP source; empty for LOG_*. */
  logNamesById: ReadonlyMap<number, string>
  /**
   * On-FC path per log id, when the MAVFTP listing supplied one.
   *
   * Exposed so an upload can take the same fast burst-read path the download
   * button uses. Empty for the LOG_* source, where there are no paths — the
   * caller falls back to downloadOnboardLog(id).
   */
  mavftpPathsById: ReadonlyMap<number, string>
  activeDownloadId?: number
  activeDownloadPercent?: number
  activeDownloadReceivedBytes?: number
  activeDownloadTotalBytes?: number
}

export interface OnboardLogs extends OnboardLogsState {
  /** List the dataflash logs on the card (`LOG_REQUEST_LIST`). */
  list: () => void
  /** Download one log's bytes to a browser file, reporting progress. */
  download: (id: number) => void
}

/**
 * Onboard dataflash log listing + download state machine. Behaviour-
 * preserving extraction of what previously lived inline in App.tsx.
 */
export function useOnboardLogs(runtime: OnboardLogCapableRuntime | undefined): OnboardLogs {
  const [state, setState] = useState<OnboardLogsState>({
    status: 'idle',
    source: 'mavlink',
    logs: [],
    logNamesById: new Map(),
    mavftpPathsById: new Map()
  })
  // Mirror the latest logs so download() can resolve a log by id without
  // depending on (and being recreated by) state.logs.
  const logsRef = useRef<OnboardLogInfo[]>([])
  // id → MAVFTP path/name for the current listing; empty when the last list
  // used the LOG_* source. download() keys off this to pick the path.
  const mavftpItemsRef = useRef<Map<number, MavftpLogItem>>(new Map())

  const list = useCallback(async () => {
    if (!runtime) return
    const source = selectOnboardLogSource(runtime.getSnapshot())
    setState((prev) => ({ ...prev, status: 'listing', source, message: undefined }))
    try {
      let logs: OnboardLogInfo[]
      let logNamesById: ReadonlyMap<number, string>
      let mavftpPathsById: ReadonlyMap<number, string> = new Map()
      if (source === 'mavftp') {
        const items = mavftpEntriesToLogItems(await runtime.listMavftpLogs())
        mavftpItemsRef.current = new Map(items.map((item) => [item.log.id, item]))
        // MAVFTP directory listings carry no timestamp, so the rows showed
        // "Unknown date". The LOG_ENTRY list does carry time_utc — fetch it and
        // merge by log id. Best-effort: if it fails (or a log predates a GPS
        // time fix, time_utc = 0) that row simply stays "Unknown date".
        let timeUtcById = new Map<number, number>()
        try {
          const entries = await runtime.listOnboardLogs()
          timeUtcById = new Map(entries.map((entry) => [entry.id, entry.timeUtc]))
        } catch {
          // dates are optional — keep the MAVFTP list without them
        }
        logs = items.map((item) => ({ ...item.log, timeUtc: timeUtcById.get(item.log.id) ?? item.log.timeUtc }))
        logNamesById = new Map(items.map((item) => [item.log.id, item.name]))
        mavftpPathsById = new Map(items.map((item) => [item.log.id, item.path]))
      } else {
        mavftpItemsRef.current = new Map()
        logs = await runtime.listOnboardLogs()
        logNamesById = new Map()
      }
      logsRef.current = logs
      setState({
        status: 'ready',
        source,
        logs,
        logNamesById,
        mavftpPathsById,
        message: logs.length === 0 ? 'No logs on the card.' : undefined
      })
    } catch (error) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to list onboard logs.'
      }))
    }
  }, [runtime])

  const download = useCallback(
    async (id: number) => {
      if (!runtime) return
      const log = logsRef.current.find((candidate) => candidate.id === id)
      if (!log) {
        return
      }
      const mavftpItem = mavftpItemsRef.current.get(id)
      setState((prev) => ({
        ...prev,
        activeDownloadId: id,
        activeDownloadPercent: 0,
        activeDownloadReceivedBytes: 0,
        activeDownloadTotalBytes: log.sizeBytes || undefined
      }))
      // onProgress fires once per received burst packet — thousands of times for
      // a large log. Committing state on every packet re-renders the whole app
      // per packet and starves the paint loop, so the UI looks frozen and the
      // percent never visibly moves. Coalesce to one update per whole-percent
      // tick (≤101 renders total): smooth bar, no thrash.
      let lastPercent = -1
      const onProgress = (progress: LogDownloadProgress) => {
        const percent =
          progress.totalBytes > 0 ? Math.round((progress.bytesReceived / progress.totalBytes) * 100) : 0
        if (percent === lastPercent) {
          return
        }
        lastPercent = percent
        setState((prev) =>
          prev.activeDownloadId === id
            ? {
                ...prev,
                activeDownloadPercent: percent,
                activeDownloadReceivedBytes: progress.bytesReceived,
                activeDownloadTotalBytes: progress.totalBytes || prev.activeDownloadTotalBytes
              }
            : prev
        )
      }
      try {
        let bytes: Uint8Array
        if (mavftpItem) {
          bytes = await runtime.downloadMavftpLog(mavftpItem.path, onProgress)
        } else {
          bytes = await runtime.downloadOnboardLog(id, log.sizeBytes, onProgress)
        }
        // Both sources use the descriptive <uid>_log<id>[_date].bin convention.
        // MAVFTP listings carry no timestamp (so no date part), but tagging with
        // the board uid + log number still beats the raw on-FC "00000042.BIN"
        // name and keeps a multi-craft download folder self-describing. (The
        // logs list UI still shows the raw FC name for on-card correlation.)
        const filename = buildOnboardLogFilename(log, runtime.getSnapshot().hardware.board)
        downloadBinaryFile(filename, bytes)
        setState((prev) => ({
          ...prev,
          status: 'ready',
          message: `Downloaded ${filename} (${bytes.length} bytes).`,
          activeDownloadId: undefined,
          activeDownloadPercent: undefined,
          activeDownloadReceivedBytes: undefined,
          activeDownloadTotalBytes: undefined
        }))
      } catch (error) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          message: error instanceof Error ? error.message : 'Onboard log download failed.',
          activeDownloadId: undefined,
          activeDownloadPercent: undefined,
          activeDownloadReceivedBytes: undefined,
          activeDownloadTotalBytes: undefined
        }))
      }
    },
    [runtime]
  )

  return {
    ...state,
    list: () => void list(),
    download: (id) => void download(id)
  }
}
