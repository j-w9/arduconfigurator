// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DownloadProgressBar } from './DownloadProgressBar'

let now = 0
beforeEach(() => {
  now = 0
  vi.useFakeTimers()
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const advance = (ms: number) =>
  act(() => {
    now += ms
    vi.advanceTimersByTime(ms)
  })

const MB = 1024 * 1024

describe('the time a download has left', () => {
  it('says nothing in the first second, when there is no rate yet', () => {
    render(<DownloadProgressBar percent={1} bytesReceived={MB} totalBytes={40 * MB} testId="bar" />)
    expect(screen.queryByTestId('bar-remaining')).toBeNull()
  })

  it('then shows it, from the average since the download began', () => {
    const { rerender } = render(<DownloadProgressBar percent={0} bytesReceived={0} totalBytes={40 * MB} testId="bar" />)
    advance(10_000)
    // 10 MB in 10 s is 1 MB/s; 30 MB to go.
    rerender(<DownloadProgressBar percent={25} bytesReceived={10 * MB} totalBytes={40 * MB} testId="bar" />)
    expect(screen.getByTestId('bar-remaining').textContent).toContain('30 s left')
  })

  it('grows while the transfer stalls, without a byte arriving', () => {
    // A stall is exactly when the estimate should be seen to move.
    const { rerender } = render(<DownloadProgressBar percent={0} bytesReceived={0} totalBytes={40 * MB} testId="bar" />)
    advance(10_000)
    rerender(<DownloadProgressBar percent={25} bytesReceived={10 * MB} totalBytes={40 * MB} testId="bar" />)
    advance(10_000)
    expect(screen.getByTestId('bar-remaining').textContent).toContain('1:00 left')
  })

  it('starts the clock again for a new transfer', () => {
    const { rerender } = render(<DownloadProgressBar percent={0} bytesReceived={0} totalBytes={40 * MB} testId="bar" />)
    advance(60_000)
    rerender(<DownloadProgressBar percent={90} bytesReceived={36 * MB} totalBytes={40 * MB} testId="bar" />)
    // A second download reuses the bar: the bytes go back down.
    rerender(<DownloadProgressBar percent={0} bytesReceived={MB} totalBytes={10 * MB} testId="bar" />)
    expect(screen.queryByTestId('bar-remaining')).toBeNull()
  })

  it('says nothing about time without a total to measure against', () => {
    render(<DownloadProgressBar percent={0} bytesReceived={MB} testId="bar" />)
    advance(5_000)
    expect(screen.queryByTestId('bar-remaining')).toBeNull()
  })
})
