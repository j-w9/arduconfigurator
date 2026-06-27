import { describe, expect, it } from 'vitest'

import type { WebSerialPortLike } from '@arduconfig/transport'

import { detectMavlinkPort } from './serial-autodetect'

const fakePort = (id: string): WebSerialPortLike =>
  ({
    id,
    readable: null,
    writable: null,
    open: async () => {},
    close: async () => {}
  }) as unknown as WebSerialPortLike

describe('detectMavlinkPort', () => {
  it('returns the first port that streams MAVLink and stops probing the rest', async () => {
    const a = fakePort('a')
    const b = fakePort('b')
    const c = fakePort('c')
    const probed: WebSerialPortLike[] = []
    const probe = async (port: WebSerialPortLike) => {
      probed.push(port)
      return port === b
    }

    const result = await detectMavlinkPort([a, b, c], 115200, 100, probe)

    expect(result.mavlinkPort).toBe(b)
    expect(result.results).toEqual([
      { port: a, hasMavlink: false },
      { port: b, hasMavlink: true }
    ])
    expect(probed).toEqual([a, b]) // stopped after the match — never opened c
  })

  it('returns no port when none stream MAVLink (all silent / SLCAN)', async () => {
    const result = await detectMavlinkPort([fakePort('a'), fakePort('b')], 115200, 100, async () => false)
    expect(result.mavlinkPort).toBeUndefined()
    expect(result.results.map((r) => r.hasMavlink)).toEqual([false, false])
  })

  it('handles an empty granted-port list', async () => {
    const result = await detectMavlinkPort([], 115200, 100, async () => true)
    expect(result.mavlinkPort).toBeUndefined()
    expect(result.results).toEqual([])
  })
})
