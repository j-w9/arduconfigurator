import { describe, expect, it } from 'vitest'

import { describeConnectionError } from './connection-error-help'

describe('describeConnectionError', () => {
  it('explains a WebSocket open failure is not a UDP connection and points to the app', () => {
    const raw = 'Failed to open WebSocket ws://127.0.0.1:14550.'
    const result = describeConnectionError(raw)
    expect(result.startsWith(raw)).toBe(true)
    expect(result).toContain('WebSocket is not a UDP connection')
    expect(result).toContain('downloadable app')
  })

  it('leaves a mid-session / unrelated message unchanged', () => {
    const drop = 'WebSocket closed (code 1006).'
    expect(describeConnectionError(drop)).toBe(drop)
    const abort = 'WebSocket connect aborted by disconnect.'
    expect(describeConnectionError(abort)).toBe(abort)
  })
})
