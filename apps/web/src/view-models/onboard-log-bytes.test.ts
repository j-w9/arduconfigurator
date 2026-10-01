import { describe, expect, it } from 'vitest'

import { fetchOnboardLogBytes, type OnboardLogBytesRuntime } from './onboard-log-bytes'

const BYTES = new Uint8Array([0xa3, 0x95, 1, 2, 3])

function runtime(overrides: Partial<OnboardLogBytesRuntime> = {}): OnboardLogBytesRuntime & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    downloadOnboardLog: async (id) => {
      calls.push(`log-stream:${id}`)
      return BYTES
    },
    downloadMavftpLog: async (path) => {
      calls.push(`mavftp:${path}`)
      return BYTES
    },
    ...overrides
  }
}

describe('fetchOnboardLogBytes', () => {
  it('uses the log stream when no MAVFTP path is known', async () => {
    const rt = runtime()
    const result = await fetchOnboardLogBytes({ runtime: rt, id: 7, sizeBytes: 5 })
    expect(result.transport).toBe('log-stream')
    expect(rt.calls).toEqual(['log-stream:7'])
  })

  it('prefers the MAVFTP burst when a path is known', async () => {
    const rt = runtime()
    const result = await fetchOnboardLogBytes({ runtime: rt, id: 7, sizeBytes: 5, mavftpPath: '/APM/LOGS/00000007.BIN' })
    expect(result.transport).toBe('mavftp')
    expect(result.mavftpError).toBeUndefined()
    expect(rt.calls).toEqual(['mavftp:/APM/LOGS/00000007.BIN'])
  })

  // The reported case: Download worked and Upload stalled on the same log,
  // because Upload went MAVFTP with no way out when the burst failed.
  it('falls back to the log stream when the MAVFTP burst fails', async () => {
    const rt = runtime({
      downloadMavftpLog: async () => {
        throw new Error('Timed out waiting for MAVFTP response after 6000ms.')
      }
    })
    const result = await fetchOnboardLogBytes({ runtime: rt, id: 7, sizeBytes: 5, mavftpPath: '/APM/LOGS/00000007.BIN' })
    expect(result.transport).toBe('log-stream')
    expect(result.bytes).toBe(BYTES)
    expect(result.mavftpError?.message).toMatch(/Timed out/)
    expect(rt.calls).toEqual(['log-stream:7'])
  })

  it('names both transports when both fail', async () => {
    const rt = runtime({
      downloadMavftpLog: async () => {
        throw new Error('ftp dead')
      },
      downloadOnboardLog: async () => {
        throw new Error('stream dead')
      }
    })
    await expect(
      fetchOnboardLogBytes({ runtime: rt, id: 7, sizeBytes: 5, mavftpPath: '/APM/LOGS/00000007.BIN' })
    ).rejects.toThrow(/MAVFTP \(ftp dead\).*log stream \(stream dead\)/)
  })

  it('hands the same progress callback to whichever transport runs', async () => {
    const seen: string[] = []
    const rt = runtime({
      downloadMavftpLog: async (_path, onProgress) => {
        onProgress?.({ bytesReceived: 1, totalBytes: 5 })
        throw new Error('gone')
      },
      downloadOnboardLog: async (_id, _size, onProgress) => {
        onProgress?.({ bytesReceived: 5, totalBytes: 5 })
        return BYTES
      }
    })
    await fetchOnboardLogBytes({
      runtime: rt,
      id: 7,
      sizeBytes: 5,
      mavftpPath: '/x',
      onProgress: (p) => seen.push(`${p.bytesReceived}/${p.totalBytes}`)
    })
    expect(seen).toEqual(['1/5', '5/5'])
  })
})
