import { useCallback, useRef, useState } from 'react'
import type { ConfiguratorSnapshot, LogDownloadProgress, OnboardLogInfo } from '@arduconfig/ardupilot-core'
import { buildOnboardLogFilename } from '@arduconfig/ardupilot-core'

import { downloadBinaryFile } from '../download-file'

// Minimal structural slice of the runtime the onboard-log surface needs.
export interface OnboardLogCapableRuntime {
  listOnboardLogs(): Promise<OnboardLogInfo[]>
  downloadOnboardLog(
    id: number,
    sizeBytes: number,
    onProgress?: (progress: LogDownloadProgress) => void
  ): Promise<Uint8Array>
  /** Read the live snapshot to tag the downloaded file with the board identity. */
  getSnapshot(): ConfiguratorSnapshot
}

export type OnboardLogsStatus = 'idle' | 'listing' | 'ready' | 'error'

export interface OnboardLogsState {
  status: OnboardLogsStatus
  message?: string
  logs: OnboardLogInfo[]
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
  const [state, setState] = useState<OnboardLogsState>({ status: 'idle', logs: [] })
  // Mirror the latest logs so download() can resolve a log by id without
  // depending on (and being recreated by) state.logs.
  const logsRef = useRef<OnboardLogInfo[]>([])

  const list = useCallback(async () => {
    if (!runtime) return
    setState((prev) => ({ ...prev, status: 'listing', message: undefined }))
    try {
      const logs = await runtime.listOnboardLogs()
      logsRef.current = logs
      setState({
        status: 'ready',
        logs,
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
      setState((prev) => ({ ...prev, activeDownloadId: id, activeDownloadPercent: 0 }))
      try {
        const bytes = await runtime.downloadOnboardLog(id, log.sizeBytes, (progress) => {
          const percent =
            progress.totalBytes > 0 ? Math.round((progress.bytesReceived / progress.totalBytes) * 100) : 0
          setState((prev) =>
            prev.activeDownloadId === id ? { ...prev, activeDownloadPercent: percent } : prev
          )
        })
        const board = runtime.getSnapshot().hardware.board
        downloadBinaryFile(buildOnboardLogFilename(log, board), bytes)
        setState((prev) => ({
          ...prev,
          status: 'ready',
          message: `Downloaded onboard log ${id} (${bytes.length} bytes).`,
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
