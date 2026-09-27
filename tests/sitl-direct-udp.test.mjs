import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import dgram from 'node:dgram'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { ArduPilotConfiguratorRuntime } from '../packages/ardupilot-core/dist/index.js'
import { arducopterMetadata } from '../packages/param-metadata/dist/index.js'
import { MavlinkSession, MavlinkV2Codec } from '../packages/protocol-mavlink/dist/index.js'
import { DirectSocketsUdpTransport } from '../packages/transport/dist/index.js'

// Opt-in rung-4 (true SITL): launch the REAL ArduCopter SITL binary with a UDP
// MAVLink output and drive the full stack — DirectSocketsUdpTransport (bound,
// dgram-backed) -> MavlinkSession -> runtime — against it. This is the genuine
// local-testing path for the Direct Sockets transport; the only difference
// from the browser is the Node dgram socket vs the browser UDPSocket (same
// UdpSocketLike streams contract). Skipped automatically when the SITL binary
// is absent, so CI stays green without an ArduPilot tree.

const repoPath = process.env.ARDUPILOT_REPO_PATH ?? join(homedir(), 'ardupilot')
const binary = resolve(repoPath, 'build/sitl/bin/arducopter')
const params = resolve(repoPath, 'Tools/autotest/default_params/copter.parm')
const UDP_PORT = 14560

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
        return new Promise((resolve2, reject) => {
          sock.send(Buffer.from(chunk.data), chunk.remotePort, chunk.remoteAddress, (error) =>
            error ? reject(error) : resolve2()
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

test(
  'true SITL: real ArduCopter SITL over UDP is detected through the Direct Sockets transport',
  { skip: existsSync(binary) ? false : `SITL binary not found at ${binary} (build it or set ARDUPILOT_REPO_PATH)` },
  async () => {
    const log = []

    // Bind BEFORE spawning. The previous order spawned SITL first and bound
    // second, with only the spawn's cleanup inside the try/finally below -- so
    // a bind that failed threw past the kill and orphaned the SITL it had just
    // started. That orphan then held this port, so the next run's bind failed
    // and orphaned another: one flake left the suite hanging at this file
    // forever after, on every machine with an ArduPilot build.
    //
    // Binding first also removes a race: SITL is a udpclient and starts
    // sending immediately, so the socket should already be listening.
    const sock = dgram.createSocket('udp4')
    await new Promise((res, rej) => {
      sock.once('error', rej)
      sock.bind(UDP_PORT, '127.0.0.1', res)
    })

    const sitl = spawn(
      binary,
      ['--model', 'quad', '--speedup', '1', '--defaults', params, '-I0', '--serial0', `udpclient:127.0.0.1:${UDP_PORT}`],
      { cwd: repoPath, stdio: ['ignore', 'pipe', 'pipe'] }
    )
    sitl.stdout.on('data', (c) => log.push(String(c)))
    sitl.stderr.on('data', (c) => log.push(String(c)))

    const transport = new DirectSocketsUdpTransport('sitl-udp', { localPort: UDP_PORT, socketFactory: adapterFor(sock) })
    const runtime = new ArduPilotConfiguratorRuntime(new MavlinkSession(transport, new MavlinkV2Codec()), arducopterMetadata)

    try {
      await runtime.connect()
      const deadline = Date.now() + 45000
      let detected
      while (Date.now() < deadline) {
        const vehicleId = runtime.getSnapshot().vehicle?.vehicle
        if (vehicleId === 'ArduCopter') {
          detected = vehicleId
          break
        }
        await new Promise((r) => setTimeout(r, 100))
      }
      assert.equal(
        detected,
        'ArduCopter',
        `vehicle never identified from real SITL UDP. Recent SITL output:\n${log.slice(-20).join('')}`
      )
    } finally {
      await runtime.disconnect().catch(() => {})
      try {
        sock.close()
      } catch {}
      sitl.kill('SIGTERM')
      // SIGTERM is a request. Give it a moment, then insist -- an ArduPilot
      // that ignores it keeps this port and breaks every later run.
      await new Promise((resolve2) => setTimeout(resolve2, 500))
      if (sitl.exitCode === null && sitl.signalCode === null) sitl.kill('SIGKILL')
    }
  }
)
