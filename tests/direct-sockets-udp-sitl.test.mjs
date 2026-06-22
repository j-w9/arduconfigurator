import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { MavlinkSession, MavlinkV2Codec } from '../packages/protocol-mavlink/dist/index.js'
import { DirectSocketsUdpTransport } from '../packages/transport/dist/index.js'

// The most SITL-like check we can run without an ArduPilot tree: a real UDP
// peer streams genuine MAVLink v2 HEARTBEAT frames, and the FULL stack —
// DirectSocketsUdpTransport (bound mode, dgram-backed) -> MavlinkSession ->
// ArduPilotConfiguratorRuntime — must identify the vehicle from them. A real
// SITL emits the same MAVLink-over-UDP; the transport is agnostic to the
// source. Only the socket implementation differs from the browser (a dgram
// adapter satisfying the same UdpSocketLike streams contract).

async function bindUdp() {
  const sock = dgram.createSocket('udp4')
  await new Promise((resolve, reject) => {
    sock.once('error', reject)
    sock.bind(0, '127.0.0.1', resolve)
  })
  return { sock, port: sock.address().port }
}

function adapterFor(sock) {
  return () => {
    let controller
    const readable = new ReadableStream({
      start(c) {
        controller = c
      }
    })
    sock.on('message', (msg, rinfo) => {
      controller.enqueue({ data: new Uint8Array(msg), remoteAddress: rinfo.address, remotePort: rinfo.port })
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

test('SITL-style: ArduCopter HEARTBEATs over real UDP drive vehicle detection through the Direct Sockets transport', async () => {
  const gcs = await bindUdp()
  const vehicle = await bindUdp()

  const codec = new MavlinkV2Codec()
  let seq = 0
  const heartbeat = () =>
    codec.encode({
      header: { systemId: 1, componentId: 1, sequence: seq++ },
      // vehicleType 2 (quadrotor) + autopilot 3 (ArduPilotMega) => ArduCopter.
      message: { type: 'HEARTBEAT', customMode: 0, vehicleType: 2, autopilot: 3, baseMode: 0, systemStatus: 4, mavlinkVersion: 3 },
      timestampMs: 0
    })

  // A real FC streams telemetry continuously; mirror that over the wire.
  const timer = setInterval(() => {
    vehicle.sock.send(Buffer.from(heartbeat()), gcs.port, '127.0.0.1', () => {})
  }, 30)

  const transport = new DirectSocketsUdpTransport('sitl-udp', {
    localPort: gcs.port,
    socketFactory: adapterFor(gcs.sock)
  })
  const runtime = new ArduPilotConfiguratorRuntime(new MavlinkSession(transport, new MavlinkV2Codec()), arducopterMetadata)

  try {
    await runtime.connect()
    const deadline = Date.now() + 3000
    let detected
    while (Date.now() < deadline) {
      const vehicleId = runtime.getSnapshot().vehicle?.vehicle
      if (vehicleId === 'ArduCopter') {
        detected = vehicleId
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    assert.equal(detected, 'ArduCopter', 'vehicle must be identified from real HEARTBEATs carried over real UDP')
  } finally {
    clearInterval(timer)
    await runtime.disconnect().catch(() => {})
    try {
      vehicle.sock.close()
    } catch {}
  }
})
