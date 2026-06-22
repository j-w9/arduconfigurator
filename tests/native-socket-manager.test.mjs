import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import test from 'node:test'

import { NativeSocketManager } from '../apps/desktop/dist/native-socket-manager.js'

// The desktop main-process socket manager, exercised against REAL UDP. It wraps
// the sitl-harness UdpTransport, so this proves the open/send/close + frame &
// status relay wiring the renderer's DesktopSocketTransport drives over IPC.
// Pure dgram, no SITL binary, so it runs in CI too.

async function bindUdp() {
  const sock = dgram.createSocket('udp4')
  await new Promise((resolve, reject) => {
    sock.once('error', reject)
    sock.bind(0, '127.0.0.1', resolve)
  })
  return { sock, port: sock.address().port }
}

async function waitFor(predicate, timeoutMs = 1000) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

test('manager opens a bound UDP socket, relays frames, learns the peer, and replies', async () => {
  const manager = new NativeSocketManager()
  const listen = await bindUdp() // pick a free port for the manager to bind
  listen.sock.close() // release it; the manager rebinds it
  const fc = await bindUdp()

  const frames = []
  const statuses = []
  await manager.open(
    's1',
    { kind: 'udp', localPort: listen.port },
    {
      onFrame: (frame) => frames.push(Buffer.from(frame).toString('hex')),
      onStatus: (status) => statuses.push(status.kind)
    }
  )
  assert.ok(statuses.includes('connected'), 'status relay should report connected')

  // FC -> manager: forwarded to the sink, peer learned from the datagram.
  await new Promise((resolve, reject) =>
    fc.sock.send(Buffer.from([0xfd, 0xaa]), listen.port, '127.0.0.1', (e) => (e ? reject(e) : resolve()))
  )
  await waitFor(() => frames.length >= 1)
  assert.equal(frames[0], 'fdaa')

  // manager.send -> back to the learned FC peer over real UDP.
  const received = new Promise((resolve) => fc.sock.once('message', (m) => resolve(Buffer.from(m).toString('hex'))))
  await manager.send('s1', new Uint8Array([0xfd, 0x09]))
  assert.equal(await received, 'fd09')

  await manager.close('s1')
  try {
    fc.sock.close()
  } catch {}
})
