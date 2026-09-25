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

/**
 * How long to wait on the MAVFTP directory read before settling with whatever
 * the LOG_* list gave us.
 *
 * The directory read paginates: one LIST_DIRECTORY round trip per chunk, each
 * with its own 20 s timeout and no ceiling on the whole listing, plus up to
 * 30 s queued behind another FTP operation. On a card with many logs, or a slow
 * link, "slow" becomes "never" from where the operator is sitting. MAVFTP only
 * ADDS filenames, paths and sizes to a list the LOG_* stream already has, so
 * waiting past this point buys detail at the cost of the whole surface.
 */
const MAVFTP_LIST_DEADLINE_MS = 20_000

/** A sentinel distinct from `undefined` (MAVFTP failed) and a real listing. */
const MAVFTP_TIMED_OUT = Symbol('mavftp-timed-out')

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
  // Monotonic id for the in-flight list, so a slow source from an earlier
  // press can never paint over a newer one.
  const listRunRef = useRef(0)

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
    const run = listRunRef.current + 1
    listRunRef.current = run

    // BOTH sources start now, and neither waits on the other.
    //
    // They used to run in sequence -- the MAVFTP directory listing, then the
    // LOG_* list for timestamps -- so the tab showed nothing until the slower
    // one finished and the wait was their SUM. Worse, MAVFTP is strictly
    // serialised (withExclusiveSession), so a log listing queues behind any
    // other FTP work on the link and can sit there for a long time. The LOG_*
    // list needs no FTP at all, which is why Mission Planner has the list
    // immediately while this tab was still waiting.
    let mavftpTimer: ReturnType<typeof setTimeout> | undefined
    const mavftpPromise: Promise<MavftpDirectoryEntry[] | undefined | typeof MAVFTP_TIMED_OUT> =
      Promise.race([
        runtime.listMavftpLogs().then(
          (entries) => entries,
          () => undefined
        ),
        // Not a cancellation — the FTP request keeps running and simply stops
        // being waited on. There is no safe way to abort a session the vehicle
        // is mid-transfer on.
        new Promise<typeof MAVFTP_TIMED_OUT>((resolve) => {
          mavftpTimer = setTimeout(() => resolve(MAVFTP_TIMED_OUT), MAVFTP_LIST_DEADLINE_MS)
        })
      ]).finally(() => {
        if (mavftpTimer !== undefined) {
          clearTimeout(mavftpTimer)
        }
      })
    // Post-erase the FILES are the only honest answer to "what is left", so
    // that path does not ask the LOG_* list at all -- a stale LASTLOG.TXT
    // would report logs that are gone.
    const logEntriesPromise: Promise<OnboardLogInfo[]> = options.mavftpOnly
      ? Promise.resolve([])
      : runtime.listOnboardLogs().then(
          (entries) => entries,
          () => []
        )

    // Paint the LOG_* list the moment it lands rather than holding it back for
    // the directory read. These rows carry no on-FC filename and no MAVFTP
    // path, which download() already handles by falling back to
    // downloadOnboardLog(id) -- so they are usable, not just decorative.
    void logEntriesPromise.then((entries) => {
      if (listRunRef.current !== run || entries.length === 0) {
        return
      }
      setState((prev) => {
        if (prev.status !== 'listing') {
          return prev
        }
        logsRef.current = entries
        return {
          ...prev,
          source: 'mavlink',
          logs: entries,
          logNamesById: new Map(),
          mavftpPathsById: new Map(),
          message: 'Reading the card for filenames and sizes…'
        }
      })
    })

    try {
      const [mavftpEntries, logEntries] = await Promise.all([mavftpPromise, logEntriesPromise])
      if (listRunRef.current !== run) {
        return
      }
      const timedOut = mavftpEntries === MAVFTP_TIMED_OUT
      const directory = timedOut ? undefined : mavftpEntries
      let logs: OnboardLogInfo[]
      let logNamesById: ReadonlyMap<number, string>
      let mavftpPathsById: ReadonlyMap<number, string> = new Map()
      const source: OnboardLogSource = directory === undefined ? 'mavlink' : 'mavftp'
      if (directory !== undefined) {
        const items = mavftpEntriesToLogItems(directory)
        mavftpItemsRef.current = new Map(items.map((item) => [item.log.id, item]))
        // MAVFTP directory listings carry no timestamp, so the rows showed
        // "Unknown date". The LOG_ENTRY list does carry time_utc — merge it in
        // by log id. If it failed (or a log predates a GPS time fix,
        // time_utc = 0) that row simply stays "Unknown date".
        const timeUtcById = new Map(logEntries.map((entry) => [entry.id, entry.timeUtc]))
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
        logs = mergeOnboardLogSources(mavftpLogs, logEntries, { mavftpOnly: options.mavftpOnly })
        logNamesById = new Map(items.map((item) => [item.log.id, item.name]))
        mavftpPathsById = new Map(items.map((item) => [item.log.id, item.path]))
      } else {
        mavftpItemsRef.current = new Map()
        logs = logEntries
        logNamesById = new Map()
      }
      logsRef.current = logs
      setState({
        status: 'ready',
        source,
        logs,
        logNamesById,
        mavftpPathsById,
        // An empty list after a timed-out directory read is NOT "no logs" — it
        // is "we never got an answer", and saying the former would be a lie
        // about the card.
        message: timedOut
          ? logs.length === 0
            ? 'The card did not answer in time — no log list was read. Try again.'
            : 'Showing the vehicle\u2019s own log list; the card did not answer in time, so filenames and sizes are missing.'
          : logs.length === 0
            ? 'No logs on the card.'
            : undefined
      })
    } catch (error) {
      if (listRunRef.current !== run) {
        return
      }
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
