import type { ReactElement } from 'react'

// A thin progress bar for a long transfer: a MAVFTP log download, a firmware
// write. Without continuous movement a button that reads "Downloading" is
// indistinguishable from one that has hung. Styled by `.download-bar*` in this
// package's styles.css.
//
// Presentational only — the caller owns the transfer and feeds it a percentage.

export interface ProgressBarProps {
  percent: number
  /** Shown after the percentage, e.g. " · 1.2 / 3.4 MB". */
  detail?: string
  /** Stretch across every column of a parent grid row. */
  spanRow?: boolean
  testId?: string
}

export function ProgressBar(props: ProgressBarProps): ReactElement {
  const { percent, detail = '', spanRow = false, testId } = props
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
        {detail}
      </span>
    </div>
  )
}
