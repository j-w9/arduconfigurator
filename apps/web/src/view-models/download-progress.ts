// Percent math for the MAVFTP download progress bar, kept pure so it can be
// tested without a transfer. Used by the Files browser; the Logs tab computes
// the same shape from its own download service.

export interface DownloadProgressState {
  /** Full remote path of the file being downloaded. */
  path: string
  percent: number
  bytesReceived: number
  /** 0 when the size is not known yet. */
  totalBytes: number
}

export interface DownloadProgressInput {
  path: string
  bytesReceived: number
  /** What the transfer reports, which is 0 until the first burst reply. */
  reportedTotalBytes?: number
  /** What the directory listing said, used until the transfer knows better. */
  listedSizeBytes?: number
}

/**
 * Build the bar's state for one progress tick.
 *
 * The total comes from the transfer when it knows it and the directory listing
 * otherwise: a burst read reports 0 bytes total until the first reply lands, and
 * an unknown total must not render as a full or wildly overshooting bar.
 *
 * `@SYS` virtual files list as size 0 and are read in one shot, so they stay at
 * 0% for their whole (instant) life rather than dividing by zero.
 */
export function buildDownloadProgress(input: DownloadProgressInput): DownloadProgressState {
  const totalBytes = input.reportedTotalBytes || input.listedSizeBytes || 0
  const bytesReceived = Math.max(0, input.bytesReceived)
  // Clamped because a burst read's final chunk can overshoot a stale listed
  // size, and a bar reading 103% looks broken.
  const percent = totalBytes > 0 ? Math.min(100, Math.round((bytesReceived / totalBytes) * 100)) : 0
  return { path: input.path, percent, bytesReceived, totalBytes }
}
