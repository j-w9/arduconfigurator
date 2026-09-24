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
  mergeOnboardLogSources,
  selectOnboardLogSource,
  type MavftpLogItem,
  type OnboardLogSource
} from '../view-models/onboard-log-source'

// Minimal structural slice of the runtime the onboard-log surface needs.
export interface OnboardLogCapableRuntime {
  eraseOnboardLogs(): Promise<void>
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

export type OnboardLogsStatus = 'idle' | 'listing' | 'erasing' | 'ready' | 'error'

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
  /** The log's bytes, for a caller that wants to analyse rather than save it. */
  fetchBytes: (id: number) => Promise<Uint8Array | undefined>
  /** Erase every log on the card. Irreversible; the caller confirms first. */
  erase: () => void
}

/**
 * Onboard dataflash log listing + download state machine. Behaviour-
 * preserving extraction of what previously lived inline in App.tsx.
 */
/** Re-list this many times after an erase before reporting what is left. */
const ERASE_RELIST_ATTEMPTS = 3
const ERASE_RELIST_DELAY_MS = 2500

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

  // `mavftpOnly` exists for the post-erase re-list, where the FILES are the
  // only honest answer to "what is left" — see erase() below. Normal listing
  // takes the union of both sources.
  const listInternal = useCallback(async (options: { mavftpOnly?: boolean } = {}) => {
    if (!runtime) return
    // The capability bit is a hint, not the answer.
    //
    // The LOG_* list is derived on the vehicle from LASTLOG.TXT, not from the
    // files: after a LOG_ERASE an FC can keep reporting logs that are no longer
    // on the card, which is what made this tab disagree with the Files tab
    // about the same directory -- and it survived a reconnect, because the
    // stale number is on the SD card. The files are the ground truth, so try
    // MAVFTP whatever AUTOPILOT_VERSION advertised, and fall back to LOG_* only
    // when MAVFTP genuinely cannot answer.
    const advertised = selectOnboardLogSource(runtime.getSnapshot())
    setState((prev) => ({ ...prev, status: 'listing', source: advertised, message: undefined }))
    try {
      let logs: OnboardLogInfo[]
      let logNamesById: ReadonlyMap<number, string>
      let mavftpPathsById: ReadonlyMap<number, string> = new Map()
      let mavftpEntries: MavftpDirectoryEntry[] | undefined
      try {
        mavftpEntries = await runtime.listMavftpLogs()
      } catch {
        // No MAVFTP (or it failed): the LOG_* list is all there is.
        mavftpEntries = undefined
      }
      const source: OnboardLogSource = mavftpEntries === undefined ? 'mavlink' : 'mavftp'
      if (mavftpEntries !== undefined) {
        const items = mavftpEntriesToLogItems(mavftpEntries)
        mavftpItemsRef.current = new Map(items.map((item) => [item.log.id, item]))
        // MAVFTP directory listings carry no timestamp, so the rows showed
        // "Unknown date". The LOG_ENTRY list does carry time_utc — fetch it and
        // merge by log id. Best-effort: if it fails (or a log predates a GPS
        // time fix, time_utc = 0) that row simply stays "Unknown date".
        let timeUtcById = new Map<number, number>()
        let logEntries: OnboardLogInfo[] = []
        try {
          logEntries = await runtime.listOnboardLogs()
          timeUtcById = new Map(logEntries.map((entry) => [entry.id, entry.timeUtc]))
        } catch {
          // dates (and the union below) are optional — keep the MAVFTP list
        }
        const mavftpLogs = items.map((item) => ({
          ...item.log,
          timeUtc: timeUtcById.get(item.log.id) ?? item.log.timeUtc
        }))
        // A log the LOG_* list knows about but MAVFTP did not report is still a
        // real log, and dropping it is how this surface came to disagree with
        // Mission Planner: MP lists over LOG_* and had the full set on the
        // first connect while this tab was missing the newest one until a
        // reconnect. The two disagree because they measure different things —
        // LOG_* is derived from LASTLOG.TXT, MAVFTP reads the directory — and
        // the directory can lag a log the vehicle has already counted.
        //
        // So the normal listing is the UNION. MAVFTP still wins where both know
        // a log (its name, path and size are the file's own), and the extras
        // simply have no MAVFTP path, which download() already handles by
        // falling back to downloadOnboardLog(id).
        logs = mergeOnboardLogSources(mavftpLogs, logEntries, { mavftpOnly: options.mavftpOnly })
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

  const list = useCallback(() => {
    void listInternal()
  }, [listInternal])

  /**
   * Erase every log on the card.
   *
   * The vehicle acknowledges nothing, so the only honest confirmation is to
   * re-list afterwards and show what is actually left. The erase itself can
   * take a while on a large card, hence the delay before re-listing.
   */
  const erase = useCallback(async () => {
    if (!runtime) return
    setState((current) => ({ ...current, status: 'erasing', message: 'Erasing all onboard logs…' }))
    try {
      await runtime.eraseOnboardLogs()
      // The vehicle acknowledges nothing and erases one log slot at a time, so
      // a single re-list 2.5 s later can land mid-erase and show a card that
      // looks half-cleared. Re-list a few times until it settles, then stop and
      // report whatever is actually there.
      for (let attempt = 0; attempt < ERASE_RELIST_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, ERASE_RELIST_DELAY_MS))
        // Files only: a stale LASTLOG.TXT can still name logs that are gone,
        // and this loop is asking what SURVIVED the erase.
        await listInternal({ mavftpOnly: true })
        if (logsRef.current.length === 0) {
          break
        }
      }
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'error',
        message: error instanceof Error ? error.message : 'Erasing onboard logs failed.'
      }))
    }
  }, [runtime, listInternal])

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

  /**
   * Fetch a log's BYTES instead of saving it to disk.
   *
   * The calibration cards fit a curve from a log; making the operator download
   * one and then hand it back through a file picker is a round trip through the
   * filesystem for a file the vehicle is already holding. Deliberately separate
   * from download(), which saves and must keep doing so for the Logs tab.
   */
  const fetchBytes = useCallback(
    async (id: number): Promise<Uint8Array | undefined> => {
      if (!runtime) return undefined
      const log = logsRef.current.find((entry) => entry.id === id)
      if (!log) return undefined
      const mavftpItem = mavftpItemsRef.current.get(id)
      return mavftpItem
        ? runtime.downloadMavftpLog(mavftpItem.path)
        : runtime.downloadOnboardLog(id, log.sizeBytes)
    },
    [runtime]
  )

  return {
    ...state,
    list: () => void list(),
    download: (id) => void download(id),
    fetchBytes,
    erase: () => void erase()
  }
}
