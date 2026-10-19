import { useEffect, useRef, useState, type ReactElement } from 'react'

import { estimateTransfer, formatRemaining } from '../view-models/transfer-estimate'

// The progress bar shown while a file streams off the flight controller over
// MAVFTP. Shared by the Logs tab and the Files browser: a MAVFTP burst read of
// a real log is minutes long, and without continuous movement a button that
// reads "Downloading" is indistinguishable from one that has hung.
//
// Presentational only — the caller owns the transfer and feeds it bytes.

/** Compact MB label (one decimal, MiB base to match the size columns). */
function formatMegabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

export interface DownloadProgressBarProps {
  percent: number
  bytesReceived?: number
  /** Absent until the transfer's size is known; the byte counts are then
   *  omitted rather than rendered against a zero total. */
  totalBytes?: number
  /** Stretch across every column of a parent grid row. */
  spanRow?: boolean
  testId?: string
}

export function DownloadProgressBar(props: DownloadProgressBarProps): ReactElement {
  const { percent, bytesReceived, totalBytes, spanRow = false, testId } = props

  // When this transfer started, for AMC's estimate: an average over the whole
  // transfer, idle stretches included. The bar is mounted for the life of a
  // download, so that is the clock -- restarted if the byte count goes
  // backwards, which is a new transfer reusing the bar.
  const started = useRef(performance.now())
  const lastBytes = useRef(bytesReceived ?? 0)
  if ((bytesReceived ?? 0) < lastBytes.current) started.current = performance.now()
  lastBytes.current = bytesReceived ?? 0

  // Re-render once a second even when no bytes arrive: a stalled transfer is
  // exactly when the time left should be seen to grow.
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const { remainingSeconds } = estimateTransfer(
    bytesReceived ?? 0,
    totalBytes || undefined,
    (performance.now() - started.current) / 1000
  )

  return (
    <div
      className={`download-bar${spanRow ? ' download-bar--span-row' : ''}`}
      data-testid={testId}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className="download-bar__track">
        <div className="download-bar__fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="download-bar__label">
        {percent}%
        {totalBytes ? ` · ${formatMegabytes(bytesReceived ?? 0)} / ${formatMegabytes(totalBytes)} MB` : ''}
        {remainingSeconds !== undefined && percent < 100 ? (
          <span data-testid={testId ? `${testId}-remaining` : undefined}> · {formatRemaining(remainingSeconds)} left</span>
        ) : null}
      </span>
    </div>
  )
}
