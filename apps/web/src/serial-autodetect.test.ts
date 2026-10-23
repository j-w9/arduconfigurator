import { describe, expect, it } from 'vitest'

import type { WebSerialPortLike } from '@arduconfig/transport'

import { detectMavlinkPort, orderPortsForDetection } from './serial-autodetect'

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

describe('orderPortsForDetection', () => {
  it('probes the operator\'s chosen port first, so two boards plugged in connect to the one picked', () => {
    const a = fakePort('a')
    const b = fakePort('b')
    const c = fakePort('c')
    expect(orderPortsForDetection([a, b, c], c)).toEqual([c, a, b])
  })

  it('keeps the browser order when nothing was chosen', () => {
    const a = fakePort('a')
    const b = fakePort('b')
    expect(orderPortsForDetection([a, b], undefined)).toEqual([a, b])
  })

  it('the chosen port still wins the detect when it speaks MAVLink and an earlier port does too', async () => {
    const other = fakePort('other-board')
    const chosen = fakePort('chosen-board')
    const probe = async () => true
    const result = await detectMavlinkPort(orderPortsForDetection([other, chosen], chosen), 115200, 100, probe)
    expect(result.mavlinkPort).toBe(chosen)
    expect(result.results).toHaveLength(1)
  })
})
