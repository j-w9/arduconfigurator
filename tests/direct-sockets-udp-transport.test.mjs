import assert from 'node:assert/strict'
import test from 'node:test'

import { DirectSocketsUdpTransport } from '../packages/transport/dist/index.js'

// A mock UDPSocket matching the structural UdpSocketLike contract: a readable
// stream we can push datagrams into and a writable stream that records writes.
function makeMockSocket({ localPort = 14550 } = {}) {
  let controller
  const readable = new ReadableStream({
    start(c) {
      controller = c
    }
  })
  const writes = []
  const writable = new WritableStream({
    write(chunk) {
      writes.push(chunk)
    }
  })
  let closed = false
  return {
    socket: {
      opened: Promise.resolve({ readable, writable, localPort }),
      close() {
        closed = true
        try {
          controller.close()
        } catch {}
      }
    },
    emit: (message) => controller.enqueue(message),
    writes,
    isClosed: () => closed
  }
}

function collectFrames(transport) {
  const frames = []
  transport.onFrame((frame) => frames.push(frame))
  return frames
}

test('bound mode: connects, forwards inbound datagrams, and replies to the learned peer', async () => {
  const mock = makeMockSocket()
  const transport = new DirectSocketsUdpTransport('test-udp', {
    localPort: 14550,
    socketFactory: () => mock.socket
  })
  const frames = collectFrames(transport)

  await transport.connect()
  assert.equal(transport.getStatus().kind, 'connected')

  // Inbound datagram from the flight controller's UDP peer.
  mock.emit({ data: new Uint8Array([0xfd, 0x01, 0x02]), remoteAddress: '127.0.0.1', remotePort: 52000 })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(frames.length, 1)
  assert.deepEqual([...frames[0]], [0xfd, 0x01, 0x02])

  // A write (e.g. PARAM_SET) must be addressed back to that learned peer.
  await transport.send(new Uint8Array([0xfd, 0x09]))
  assert.equal(mock.writes.length, 1)
  assert.equal(mock.writes[0].remoteAddress, '127.0.0.1')
  assert.equal(mock.writes[0].remotePort, 52000)
  assert.deepEqual([...mock.writes[0].data], [0xfd, 0x09])

  await transport.disconnect()
  assert.equal(transport.getStatus().kind, 'disconnected')
  assert.ok(mock.isClosed())
})

test('bound mode: send before any peer is observed rejects', async () => {
  const mock = makeMockSocket()
  const transport = new DirectSocketsUdpTransport('test-udp', {
    localPort: 14550,
    socketFactory: () => mock.socket
  })
  await transport.connect()
  await assert.rejects(() => transport.send(new Uint8Array([0x00])), /has not observed a remote endpoint/)
  await transport.disconnect()
})

test('connected mode: writes carry no per-datagram address', async () => {
  const mock = makeMockSocket()
  const transport = new DirectSocketsUdpTransport('test-udp', {
    remoteAddress: '10.0.0.5',
    remotePort: 14550,
    socketFactory: () => mock.socket
  })
  await transport.connect()
  await transport.send(new Uint8Array([0x42]))
  assert.equal(mock.writes.length, 1)
  assert.equal(mock.writes[0].remoteAddress, undefined)
  assert.equal(mock.writes[0].remotePort, undefined)
  assert.deepEqual([...mock.writes[0].data], [0x42])
  await transport.disconnect()
})

test('isSupported reflects UDPSocket presence on globalThis', () => {
  assert.equal(typeof DirectSocketsUdpTransport.isSupported(), 'boolean')
  globalThis.UDPSocket = function () {}
  try {
    assert.equal(DirectSocketsUdpTransport.isSupported(), true)
  } finally {
    delete globalThis.UDPSocket
  }
  assert.equal(DirectSocketsUdpTransport.isSupported(), false)
})
