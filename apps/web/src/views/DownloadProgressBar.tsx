import type { ReactElement } from 'react'

import { ProgressBar } from '@arduconfig/ui-kit'

// The progress bar shown while a file streams off the flight controller over
// MAVFTP. Shared by the Logs tab and the Files browser: a MAVFTP burst read of
// a real log is minutes long, and without continuous movement a button that
// reads "Downloading" is indistinguishable from one that has hung.
//
// The bar itself is ui-kit's ProgressBar; this adds the MB byte counts.

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
  const detail = totalBytes ? ` · ${formatMegabytes(bytesReceived ?? 0)} / ${formatMegabytes(totalBytes)} MB` : ''
  return <ProgressBar percent={percent} detail={detail} spanRow={spanRow} testId={testId} />
}
