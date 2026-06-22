import { describe, expect, it } from 'vitest'

import { parseTcpTarget, parseUdpTarget } from './runtime-factory'

describe('parseUdpTarget', () => {
  it('treats ":port" as bound/listen on a local port', () => {
    expect(parseUdpTarget(':14550')).toEqual({ localPort: 14550 })
  })

  it('treats a bare "port" as bound/listen', () => {
    expect(parseUdpTarget('14550')).toEqual({ localPort: 14550 })
  })

  it('treats "host:port" as a connected remote', () => {
    expect(parseUdpTarget('10.0.0.5:14550')).toEqual({ remoteHost: '10.0.0.5', remotePort: 14550 })
  })

  it('trims surrounding whitespace', () => {
    expect(parseUdpTarget('  127.0.0.1:14550  ')).toEqual({ remoteHost: '127.0.0.1', remotePort: 14550 })
  })
})

describe('parseTcpTarget', () => {
  it('parses "host:port" into a fixed remote', () => {
    expect(parseTcpTarget('127.0.0.1:5760')).toEqual({ host: '127.0.0.1', port: 5760 })
  })

  it('returns undefined without a host:port (TCP needs a remote)', () => {
    expect(parseTcpTarget(':5760')).toBeUndefined()
    expect(parseTcpTarget('5760')).toBeUndefined()
  })
})
