import assert from 'node:assert/strict'
import test from 'node:test'

import { DirectSocketsTcpTransport } from '../packages/transport/dist/index.js'

function makeMockSocket() {
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
      opened: Promise.resolve({ readable, writable }),
      close() {
        closed = true
        try {
          controller.close()
        } catch {}
      }
    },
    emit: (bytes) => controller.enqueue(bytes),
    writes,
    isClosed: () => closed
  }
}

test('connects, forwards inbound byte chunks, sends, and disconnects', async () => {
  const mock = makeMockSocket()
  const transport = new DirectSocketsTcpTransport('test-tcp', {
    remoteAddress: '127.0.0.1',
    remotePort: 5760,
    socketFactory: () => mock.socket
  })
  const frames = []
  transport.onFrame((frame) => frames.push([...frame]))

  await transport.connect()
  assert.equal(transport.getStatus().kind, 'connected')

  mock.emit(new Uint8Array([0xfd, 0x00, 0x11]))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(frames, [[0xfd, 0x00, 0x11]])

  await transport.send(new Uint8Array([0xfd, 0x09]))
  assert.equal(mock.writes.length, 1)
  assert.deepEqual([...mock.writes[0]], [0xfd, 0x09])

  await transport.disconnect()
  assert.equal(transport.getStatus().kind, 'disconnected')
  assert.ok(mock.isClosed())
})

test('isSupported reflects TCPSocket presence on globalThis', () => {
  assert.equal(DirectSocketsTcpTransport.isSupported(), false)
  globalThis.TCPSocket = function () {}
  try {
    assert.equal(DirectSocketsTcpTransport.isSupported(), true)
  } finally {
    delete globalThis.TCPSocket
  }
})
