import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import test from 'node:test'

import { DirectSocketsUdpTransport } from '../packages/transport/dist/index.js'

// Realistic integration: exercise the transport's actual bound-mode logic
// (peer-learning + addressed replies + stream plumbing) against REAL UDP
// datagrams over real loopback ports. Only the socket implementation differs
// from the browser: a Node `dgram`-backed adapter that satisfies the same
// UdpSocketLike streams contract the browser's UDPSocket exposes. The code
// under test — DirectSocketsUdpTransport — is byte-for-byte what ships.

async function bindUdp() {
  const sock = dgram.createSocket('udp4')
  await new Promise((resolve, reject) => {
    sock.once('error', reject)
    sock.bind(0, '127.0.0.1', resolve)
  })
  return { sock, port: sock.address().port }
}

// A UdpSocketLike backed by an already-bound dgram socket.
function adapterFor(sock) {
  return () => {
    let controller
    const readable = new ReadableStream({
      start(c) {
        controller = c
      }
    })
    sock.on('message', (msg, rinfo) => {
      controller.enqueue({
        data: new Uint8Array(msg),
        remoteAddress: rinfo.address,
        remotePort: rinfo.port
      })
    })
    const writable = new WritableStream({
      write(chunk) {
        return new Promise((resolve, reject) => {
          sock.send(Buffer.from(chunk.data), chunk.remotePort, chunk.remoteAddress, (error) =>
            error ? reject(error) : resolve()
          )
        })
      }
    })
    return {
      opened: Promise.resolve({ readable, writable, localPort: sock.address().port }),
      close() {
        try {
          sock.close()
        } catch {}
      }
    }
  }
}

async function waitFor(predicate, timeoutMs = 1000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

test('real UDP: forwards an inbound datagram and replies to the learned peer over the wire', async () => {
  const gcs = await bindUdp() // the port the transport listens on
  const fc = await bindUdp() // stands in for the flight controller / ELRS sender

  const transport = new DirectSocketsUdpTransport('it-udp', {
    localPort: gcs.port,
    socketFactory: adapterFor(gcs.sock)
  })

  const frames = []
  transport.onFrame((frame) => frames.push(Buffer.from(frame).toString('hex')))
  await transport.connect()
  assert.equal(transport.getStatus().kind, 'connected')

  // FC -> GCS: a MAVLink-ish datagram. The transport must forward the payload
  // and learn the FC's (address, port) from the packet.
  await new Promise((resolve, reject) => {
    fc.sock.send(Buffer.from([0xfd, 0xaa, 0xbb]), gcs.port, '127.0.0.1', (error) =>
      error ? reject(error) : resolve()
    )
  })
  await waitFor(() => frames.length >= 1)
  assert.equal(frames[0], 'fdaabb')

  // GCS -> FC: a write (e.g. PARAM_SET) must travel back to the learned peer.
  const fcReceived = new Promise((resolve) => {
    fc.sock.once('message', (msg) => resolve(Buffer.from(msg).toString('hex')))
  })
  await transport.send(new Uint8Array([0xfd, 0x09, 0x09]))
  assert.equal(await fcReceived, 'fd0909')

  await transport.disconnect()
  assert.equal(transport.getStatus().kind, 'disconnected')
  try {
    fc.sock.close()
  } catch {}
})
