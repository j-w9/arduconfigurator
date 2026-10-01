// One way to pull a log's bytes off the vehicle, shared by every surface that
// needs them (the Download button, Upload to server, the calibration cards).
//
// There used to be two. The Logs tab's Download went through the onboard-logs
// hook, which knows when MAVFTP has stopped answering on this link and routes
// around it; Upload to server made its own choice from a MAVFTP path captured
// when the dialog opened, and if the burst read failed it simply failed. On a
// board whose MAVFTP is intermittent — the reported one — Download worked and
// Upload stalled, for the same log, in the same session. Two decisions, two
// behaviours; this is the one decision.

import type { LogDownloadProgress } from '@arduconfig/ardupilot-core'

export interface OnboardLogBytesRuntime {
  downloadOnboardLog(
    id: number,
    sizeBytes: number,
    onProgress?: (progress: LogDownloadProgress) => void
  ): Promise<Uint8Array>
  downloadMavftpLog(path: string, onProgress?: (progress: LogDownloadProgress) => void): Promise<Uint8Array>
}

export interface FetchOnboardLogBytesInput {
  runtime: OnboardLogBytesRuntime
  id: number
  sizeBytes: number
  /** The on-FC path, when the MAVFTP listing supplied one. */
  mavftpPath?: string
  onProgress?: (progress: LogDownloadProgress) => void
}

export type OnboardLogTransport = 'mavftp' | 'log-stream'

export interface FetchOnboardLogBytesResult {
  bytes: Uint8Array
  /** Which transport actually delivered the bytes. */
  transport: OnboardLogTransport
  /** Set when the MAVFTP burst was tried first and failed before LOG_* took over. */
  mavftpError?: Error
}

/**
 * MAVFTP burst when a path is known, otherwise the LOG_* stream — and if the
 * burst FAILS, the stream, rather than giving up.
 *
 * The fallback is the point. The two transports fail independently: MAVFTP
 * is one serialised session that can be wedged, queued, or simply absent while
 * LOG_REQUEST_DATA keeps working (measured on the reported board at 628 KiB/s
 * with MAVFTP timing out beside it). A surface that only knows one of them is
 * only as reliable as that one.
 */
export async function fetchOnboardLogBytes(input: FetchOnboardLogBytesInput): Promise<FetchOnboardLogBytesResult> {
  const { runtime, id, sizeBytes, mavftpPath, onProgress } = input

  if (mavftpPath === undefined) {
    return { bytes: await runtime.downloadOnboardLog(id, sizeBytes, onProgress), transport: 'log-stream' }
  }

  let mavftpError: Error
  try {
    return { bytes: await runtime.downloadMavftpLog(mavftpPath, onProgress), transport: 'mavftp' }
  } catch (caught) {
    mavftpError = caught instanceof Error ? caught : new Error(String(caught))
  }

  // Progress restarts from zero on the second transport; a bar that had
  // reached 40% and then shows 0% is honest about what is happening.
  try {
    const bytes = await runtime.downloadOnboardLog(id, sizeBytes, onProgress)
    return { bytes, transport: 'log-stream', mavftpError }
  } catch (caught) {
    const streamError = caught instanceof Error ? caught : new Error(String(caught))
    // Both failed: say so, naming both, rather than reporting only the second.
    throw new Error(
      `Could not read log ${id} over MAVFTP (${mavftpError.message}) or the log stream (${streamError.message}).`
    )
  }
}
