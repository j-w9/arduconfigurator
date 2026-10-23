import { describe, expect, it } from 'vitest'

import { describeUserAgent, formatFlashDebugLine, safeStringify } from './use-flash-debug-log'

describe('describeUserAgent', () => {
  it('names the engine and OS behind the Mozilla/5.0 prefix', () => {
    expect(
      describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36')
    ).toBe('Chrome 155, Windows')
    expect(
      describeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0')
    ).toBe('Edge 155, Windows')
    expect(
      describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15')
    ).toBe('Safari 18, macOS')
    expect(describeUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/150.0.0.0 Mobile Safari/537.36')).toBe('Chrome 150, Android')
  })
})

describe('safeStringify', () => {
  it('keeps byte arrays and errors to one short token', () => {
    expect(safeStringify(new Uint8Array(1_000_000))).toBe('<1000000 bytes>')
    expect(safeStringify(new Error('boom'))).toBe('Error: boom')
  })
})

describe('formatFlashDebugLine', () => {
  it('prefixes a fixed-width timestamp the repeat-collapse can strip', () => {
    const line = formatFlashDebugLine('phase: idle', [], new Date(2026, 9, 23, 14, 39, 32, 766))
    expect(line).toBe('14:39:32.766 phase: idle')
    expect(line.slice(13)).toBe('phase: idle')
  })
})
