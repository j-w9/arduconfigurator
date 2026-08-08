import { describe, expect, it } from 'vitest'

import { buildDownloadProgress } from './download-progress'

describe('buildDownloadProgress', () => {
  it('reports the fraction of the transfer that has arrived', () => {
    const progress = buildDownloadProgress({
      path: '/APM/LOGS/00000003.BIN',
      bytesReceived: 512 * 1024,
      reportedTotalBytes: 1024 * 1024
    })
    expect(progress.percent).toBe(50)
    expect(progress.bytesReceived).toBe(512 * 1024)
    expect(progress.totalBytes).toBe(1024 * 1024)
    expect(progress.path).toBe('/APM/LOGS/00000003.BIN')
  })

  it('falls back to the listed size until the transfer reports its own', () => {
    // A burst read reports totalBytes 0 until the first reply lands. Without
    // the listing's size the first ticks would have no denominator and the bar
    // would sit at 0 while bytes were visibly arriving.
    const progress = buildDownloadProgress({
      path: '/APM/LOGS/00000003.BIN',
      bytesReceived: 250,
      reportedTotalBytes: 0,
      listedSizeBytes: 1000
    })
    expect(progress.percent).toBe(25)
    expect(progress.totalBytes).toBe(1000)
  })

  it('prefers the transfer’s own total once it has one', () => {
    const progress = buildDownloadProgress({
      path: '/APM/LOGS/00000003.BIN',
      bytesReceived: 500,
      reportedTotalBytes: 2000,
      listedSizeBytes: 1000
    })
    expect(progress.percent).toBe(25)
    expect(progress.totalBytes).toBe(2000)
  })

  it('never exceeds 100% when the final chunk overshoots a stale listed size', () => {
    const progress = buildDownloadProgress({
      path: '/APM/LOGS/00000003.BIN',
      bytesReceived: 1030,
      listedSizeBytes: 1000
    })
    expect(progress.percent).toBe(100)
  })

  it('stays at zero for a size-0 @SYS virtual file instead of dividing by zero', () => {
    const progress = buildDownloadProgress({
      path: '@SYS/uarts.txt',
      bytesReceived: 400,
      reportedTotalBytes: 0,
      listedSizeBytes: 0
    })
    expect(progress.percent).toBe(0)
    expect(progress.totalBytes).toBe(0)
    expect(Number.isFinite(progress.percent)).toBe(true)
  })

  it('treats a transfer that has not started as empty, not complete', () => {
    const progress = buildDownloadProgress({
      path: '/APM/LOGS/00000003.BIN',
      bytesReceived: 0,
      listedSizeBytes: 4096
    })
    expect(progress.percent).toBe(0)
  })
})
