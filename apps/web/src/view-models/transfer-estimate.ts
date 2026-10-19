/**
 * How long a transfer has left.
 *
 * AMC's estimate_transfer (data_model_transfer_progress). An average over the
 * whole transfer so far, idle stretches included, rather than the last
 * second's rate: a MAVFTP burst stalls and resumes, and an instantaneous rate
 * makes the estimate jump between seconds and hours. Nothing is offered until
 * a second has passed and some bytes have moved, because before that there is
 * no rate worth dividing by.
 */

export interface TransferEstimate {
  /** Average since the start, in bytes per second. */
  readonly bytesPerSecond: number | undefined
  /** Whole seconds left, rounded up. Undefined when the total is unknown. */
  readonly remainingSeconds: number | undefined
}

export function estimateTransfer(
  transferredBytes: number,
  totalBytes: number | undefined,
  elapsedSeconds: number
): TransferEstimate {
  if (elapsedSeconds < 1 || transferredBytes <= 0) {
    return { bytesPerSecond: undefined, remainingSeconds: undefined }
  }
  const rate = transferredBytes / elapsedSeconds
  return {
    bytesPerSecond: rate,
    remainingSeconds:
      totalBytes === undefined ? undefined : Math.ceil(Math.max(0, totalBytes - transferredBytes) / rate)
  }
}

/** `45 s`, `2:05`, `1:02:05` -- short, because it sits beside a percentage. */
export function formatRemaining(seconds: number): string {
  if (seconds < 60) return `${seconds} s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}
