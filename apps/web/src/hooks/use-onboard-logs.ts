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
  activeDownloadId?: number
  activeDownloadPercent?: number
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
    logNamesById: new Map()
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
      if (source === 'mavftp') {
        const items = mavftpEntriesToLogItems(await runtime.listMavftpLogs())
        mavftpItemsRef.current = new Map(items.map((item) => [item.log.id, item]))
        logs = items.map((item) => item.log)
        logNamesById = new Map(items.map((item) => [item.log.id, item.name]))
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
      setState((prev) => ({ ...prev, activeDownloadId: id, activeDownloadPercent: 0 }))
      const onProgress = (progress: LogDownloadProgress) => {
        const percent =
          progress.totalBytes > 0 ? Math.round((progress.bytesReceived / progress.totalBytes) * 100) : 0
        setState((prev) =>
          prev.activeDownloadId === id ? { ...prev, activeDownloadPercent: percent } : prev
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
          activeDownloadPercent: undefined
        }))
      } catch (error) {
        setState((prev) => ({
          ...prev,
          status: 'error',
          message: error instanceof Error ? error.message : 'Onboard log download failed.',
          activeDownloadId: undefined,
          activeDownloadPercent: undefined
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
