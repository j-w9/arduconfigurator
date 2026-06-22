import { describe, expect, it } from 'vitest'

import type { DesktopSocketApi, DesktopSocketOpenOptions } from './desktop-bridge'
import { DesktopSocketTransport } from './desktop-socket-transport'

function makeMockBridge() {
  const calls: { open: Array<{ id: string; options: DesktopSocketOpenOptions }>; send: Array<{ id: string; frame: Uint8Array }>; closed: string[] } = {
    open: [],
    send: [],
    closed: []
  }
  let onFrameCb: ((frame: Uint8Array) => void) | undefined
  let onStatusCb: ((status: unknown) => void) | undefined
  let unsubscribed = false

  const bridge: DesktopSocketApi = {
    async open(id, options) {
      calls.open.push({ id, options })
    },
    async send(id, frame) {
      calls.send.push({ id, frame })
    },
    async close(id) {
      calls.closed.push(id)
    },
    subscribe(_id, onFrame, onStatus) {
      onFrameCb = onFrame
      onStatusCb = onStatus
      return () => {
        unsubscribed = true
      }
    }
  }

  return {
    bridge,
    calls,
    emitFrame: (frame: Uint8Array) => onFrameCb?.(frame),
    emitStatus: (status: unknown) => onStatusCb?.(status),
    wasUnsubscribed: () => unsubscribed
  }
}

describe('DesktopSocketTransport', () => {
  it('opens with the given options, forwards inbound frames, sends, and disconnects', async () => {
    const mock = makeMockBridge()
    const transport = new DesktopSocketTransport('desktop-udp', {
      bridge: mock.bridge,
      kind: 'udp',
      localPort: 14550
    })
    const frames: number[][] = []
    transport.onFrame((frame) => frames.push([...frame]))

    await transport.connect()
    expect(transport.getStatus().kind).toBe('connected')
    expect(mock.calls.open).toHaveLength(1)
    expect(mock.calls.open[0].options).toMatchObject({ kind: 'udp', localPort: 14550 })

    // Subscribed before open resolved, so a streamed frame reaches listeners.
    mock.emitFrame(new Uint8Array([0xfd, 0x01]))
    expect(frames).toEqual([[0xfd, 0x01]])

    await transport.send(new Uint8Array([0xfd, 0x09]))
    expect(mock.calls.send).toHaveLength(1)
    expect([...mock.calls.send[0].frame]).toEqual([0xfd, 0x09])
    // The send + open target the same client-generated socket id.
    expect(mock.calls.send[0].id).toBe(mock.calls.open[0].id)

    await transport.disconnect()
    expect(transport.getStatus().kind).toBe('disconnected')
    expect(mock.calls.closed).toEqual([mock.calls.open[0].id])
    expect(mock.wasUnsubscribed()).toBe(true)
  })

  it('forwards a main-process status event (e.g. an error) to listeners', async () => {
    const mock = makeMockBridge()
    const transport = new DesktopSocketTransport('desktop-tcp', {
      bridge: mock.bridge,
      kind: 'tcp',
      remoteHost: '127.0.0.1',
      remotePort: 5760
    })
    await transport.connect()
    mock.emitStatus({ kind: 'error', message: 'connection refused' })
    expect(transport.getStatus()).toEqual({ kind: 'error', message: 'connection refused' })
  })
})
