import assert from 'node:assert/strict'
import { connect } from 'node:net'
import test from 'node:test'

import { MockTransport } from '../packages/transport/dist/index.js'
import { startWebSocketBridgeServer } from '../apps/desktop/dist/websocket-bridge-server.js'

const WEBSOCKET_KEY = 'dGhlIHNhbXBsZSBub25jZQ=='

async function startBridge({ allowedOrigins, authToken } = {}) {
  return startWebSocketBridgeServer({
    host: '127.0.0.1',
    port: 0,
    route: '/mavlink',
    allowedOrigins,
    authToken,
    transport: new MockTransport('origin-check-transport', {
      initialFrames: [],
      respondToOutbound: () => []
    })
  })
}

async function performUpgrade({ host, port, origin, connectHost, path = '/mavlink' }) {
  return new Promise((resolve, reject) => {
    const target = connectHost ?? host
    const socket = connect({ host: target, port }, () => {
      const requestLines = [
        `GET ${path} HTTP/1.1`,
        `Host: ${host}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${WEBSOCKET_KEY}`,
        'Sec-WebSocket-Version: 13'
      ]
      if (origin !== undefined) {
        requestLines.push(`Origin: ${origin}`)
      }
      requestLines.push('', '')
      socket.write(requestLines.join('\r\n'))
    })

    const chunks = []
    let settled = false

    const finish = (err) => {
      if (settled) {
        return
      }
      settled = true
      socket.destroy()
      if (err) {
        reject(err)
      } else {
        const buffer = Buffer.concat(chunks)
        const headerEnd = buffer.indexOf('\r\n\r\n')
        const head = headerEnd >= 0 ? buffer.slice(0, headerEnd).toString('utf-8') : buffer.toString('utf-8')
        const firstLine = head.split('\r\n')[0] ?? ''
        const match = firstLine.match(/^HTTP\/1\.1\s+(\d+)/)
        const status = match ? Number.parseInt(match[1], 10) : 0
        resolve({ status, head })
      }
    }

    socket.on('data', (chunk) => {
      chunks.push(chunk)
      const combined = Buffer.concat(chunks).toString('utf-8')
      if (combined.includes('\r\n\r\n')) {
        finish()
      }
    })
    socket.on('end', () => finish())
    socket.on('close', () => finish())
    socket.on('error', (error) => finish(error))
  })
}

function skipIfListenForbidden(t, error) {
  if (error && typeof error === 'object' && 'code' in error && (error.code === 'EPERM' || error.code === 'EACCES')) {
    t.skip('Listening sockets are not available in the current sandbox.')
    return true
  }
  return false
}

test('WebSocket bridge accepts a same-origin request from http://127.0.0.1:<port>', async (t) => {
  let bridge
  try {
    bridge = await startBridge()
  } catch (error) {
    if (skipIfListenForbidden(t, error)) {
      return
    }
    throw error
  }

  try {
    const result = await performUpgrade({
      host: '127.0.0.1',
      port: bridge.port,
      origin: `http://127.0.0.1:${bridge.port}`
    })
    assert.equal(result.status, 101, `Expected 101 Switching Protocols, got status line:\n${result.head}`)
  } finally {
    await bridge.close().catch(() => {})
  }
})

test('WebSocket bridge rejects a foreign-origin request from http://evil.example.com', async (t) => {
  let bridge
  try {
    bridge = await startBridge()
  } catch (error) {
    if (skipIfListenForbidden(t, error)) {
      return
    }
    throw error
  }

  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => {
    warnings.push(args.join(' '))
  }

  try {
    const result = await performUpgrade({
      host: '127.0.0.1',
      port: bridge.port,
      origin: 'http://evil.example.com'
    })
    assert.equal(result.status, 403, `Expected 403 Forbidden, got status line:\n${result.head}`)
    assert.ok(
      warnings.some((line) => line.includes('evil.example.com')),
      `Expected a console.warn mentioning the rejected origin, got: ${JSON.stringify(warnings)}`
    )
  } finally {
    console.warn = originalWarn
    await bridge.close().catch(() => {})
  }
})

test('WebSocket bridge rejects a missing-Origin request from a non-loopback remote address', async (t) => {
  let bridge
  try {
    bridge = await startWebSocketBridgeServer({
      host: '0.0.0.0',
      port: 0,
      route: '/mavlink',
      transport: new MockTransport('origin-check-transport-public', {
        initialFrames: [],
        respondToOutbound: () => []
      })
    })
  } catch (error) {
    if (skipIfListenForbidden(t, error)) {
      return
    }
    throw error
  }

  let remoteIp
  try {
    const { networkInterfaces } = await import('node:os')
    const interfaces = networkInterfaces()
    for (const entries of Object.values(interfaces)) {
      if (!entries) continue
      for (const entry of entries) {
        if (entry.family === 'IPv4' && !entry.internal) {
          remoteIp = entry.address
          break
        }
      }
      if (remoteIp) break
    }

    if (!remoteIp) {
      t.skip('No non-loopback IPv4 interface available to simulate a remote client.')
      return
    }

    const result = await performUpgrade({
      host: remoteIp,
      port: bridge.port,
      connectHost: remoteIp,
      origin: undefined
    })
    assert.equal(result.status, 403, `Expected 403 Forbidden, got status line:\n${result.head}`)
  } finally {
    await bridge.close().catch(() => {})
  }
})

test('WebSocket bridge accepts a missing-Origin request from 127.0.0.1', async (t) => {
  let bridge
  try {
    bridge = await startBridge()
  } catch (error) {
    if (skipIfListenForbidden(t, error)) {
      return
    }
    throw error
  }

  try {
    const result = await performUpgrade({
      host: '127.0.0.1',
      port: bridge.port,
      origin: undefined
    })
    assert.equal(result.status, 101, `Expected 101 Switching Protocols, got status line:\n${result.head}`)
  } finally {
    await bridge.close().catch(() => {})
  }
})

test('WebSocket bridge allowedOrigins option grants extra origins', async (t) => {
  let bridge
  try {
    bridge = await startBridge({ allowedOrigins: ['https://configurator.example.com'] })
  } catch (error) {
    if (skipIfListenForbidden(t, error)) {
      return
    }
    throw error
  }

  try {
    const accepted = await performUpgrade({
      host: '127.0.0.1',
      port: bridge.port,
      origin: 'https://configurator.example.com'
    })
    assert.equal(
      accepted.status,
      101,
      `Expected 101 Switching Protocols for allowlisted origin, got status line:\n${accepted.head}`
    )
  } finally {
    await bridge.close().catch(() => {})
  }

  let secondBridge
  try {
    secondBridge = await startBridge({ allowedOrigins: ['https://configurator.example.com'] })
  } catch (error) {
    if (skipIfListenForbidden(t, error)) {
      return
    }
    throw error
  }

  try {
    const rejected = await performUpgrade({
      host: '127.0.0.1',
      port: secondBridge.port,
      origin: 'https://other.example.com'
    })
    assert.equal(
      rejected.status,
      403,
      `Expected 403 Forbidden for non-allowlisted origin, got status line:\n${rejected.head}`
    )
  } finally {
    await secondBridge.close().catch(() => {})
  }
})

test('WebSocket bridge with authToken rejects an upgrade missing the token', async (t) => {
  let bridge
  try {
    bridge = await startBridge({ authToken: 's3cret-token' })
  } catch (error) {
    if (skipIfListenForbidden(t, error)) {
      return
    }
    throw error
  }

  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))

  try {
    const result = await performUpgrade({
      host: '127.0.0.1',
      port: bridge.port,
      origin: `http://127.0.0.1:${bridge.port}`
    })
    assert.equal(result.status, 401, `Expected 401 Unauthorized, got status line:\n${result.head}`)
    assert.ok(
      warnings.some((line) => line.includes('missing or invalid token')),
      `Expected a console.warn about the missing token, got: ${JSON.stringify(warnings)}`
    )
    assert.ok(
      !warnings.some((line) => line.includes('s3cret-token')),
      'the token must never be logged'
    )
  } finally {
    console.warn = originalWarn
    await bridge.close().catch(() => {})
  }
})

test('WebSocket bridge with authToken rejects a wrong token and accepts the right one', async (t) => {
  let bridge
  try {
    bridge = await startBridge({ authToken: 's3cret-token' })
  } catch (error) {
    if (skipIfListenForbidden(t, error)) {
      return
    }
    throw error
  }

  try {
    const wrong = await performUpgrade({
      host: '127.0.0.1',
      port: bridge.port,
      origin: `http://127.0.0.1:${bridge.port}`,
      path: '/mavlink?token=wrong'
    })
    assert.equal(wrong.status, 401, `Expected 401 for a wrong token, got status line:\n${wrong.head}`)
  } finally {
    await bridge.close().catch(() => {})
  }

  let secondBridge
  try {
    secondBridge = await startBridge({ authToken: 's3cret-token' })
  } catch (error) {
    if (skipIfListenForbidden(t, error)) {
      return
    }
    throw error
  }

  try {
    const accepted = await performUpgrade({
      host: '127.0.0.1',
      port: secondBridge.port,
      origin: `http://127.0.0.1:${secondBridge.port}`,
      path: '/mavlink?token=s3cret-token'
    })
    assert.equal(
      accepted.status,
      101,
      `Expected 101 Switching Protocols for the correct token, got status line:\n${accepted.head}`
    )
  } finally {
    await secondBridge.close().catch(() => {})
  }
})

test('WebSocket bridge: server.close() during in-flight transport.connect() still disconnects the transport (audit-36)', async (t) => {
  // Pre-audit-36 the bridge tracked transportConnected as a single boolean
  // set ONLY after `await transport.connect()` resolved. If close() ran
  // during that await, transportConnected was still false → disconnect
  // was skipped → the connect then resolved against a closed server and
  // left the underlying transport open (FC serial port held, TCP socket
  // dangling). For the Electron desktop case this meant the next bridge
  // start failed with "port already open". The fix awaits the in-flight
  // connect inside close() before deciding to disconnect.

  // Deferred-resolve transport. connect() blocks on connectGate; release
  // is triggered explicitly so the test can drive the race deterministically.
  let releaseConnect
  const connectGate = new Promise((resolve) => {
    releaseConnect = resolve
  })
  let disconnectCalled = false
  const transport = {
    kind: 'mock',
    id: 'audit-36-deferred',
    async connect() {
      await connectGate
    },
    async disconnect() {
      disconnectCalled = true
    },
    async send() {},
    getStatus() {
      return { kind: 'connecting' }
    },
    onFrame() {
      return () => {}
    },
    onStatus() {
      return () => {}
    }
  }

  let bridge
  try {
    bridge = await startWebSocketBridgeServer({
      host: '127.0.0.1',
      port: 0,
      route: '/mavlink',
      transport
    })
  } catch (error) {
    if (skipIfListenForbidden(t, error)) {
      return
    }
    throw error
  }

  // Open a real WebSocket upgrade — the upgrade handler enters the
  // `await transport.connect()` inside the bridge and parks there.
  const upgradePromise = performUpgrade({
    host: '127.0.0.1',
    port: bridge.port,
    origin: `http://127.0.0.1:${bridge.port}`
  })

  // Give the upgrade handler a tick to reach the connect await. The
  // server is now in the exact state pre-audit-36 would race against:
  // an in-flight transport.connect with transportConnected === false.
  await new Promise((resolve) => setTimeout(resolve, 25))

  // Start the close concurrently. With the fix, close() awaits the
  // in-flight connect before checking transportConnected — so once the
  // connect resolves and transportConnected flips to true, the
  // disconnect path runs. Without the fix, close() would see
  // transportConnected === false, skip disconnect, and return.
  const closePromise = bridge.close().catch(() => undefined)

  // Give close() a tick to enter its body and reach the
  // `await activeTransportConnect` inside.
  await new Promise((resolve) => setTimeout(resolve, 25))

  // Release the deferred connect. Both the upgrade handler's await and
  // close()'s await resolve in microtask FIFO order: upgrade handler
  // continues first (sets transportConnected = true), then close()
  // continues (observes transportConnected === true and disconnects).
  releaseConnect()

  // We poll for the disconnect rather than awaiting closePromise — Node's
  // http server keeps the upgrade socket "tracked" past the BridgeClient's
  // close event in some configurations, so server.close() can lag. The
  // assertion here is the audit-36 contract: disconnect ran on a close
  // that overlapped an in-flight connect. The hang on server.close is a
  // separate concern (handled by closeAllConnections() in the same PR,
  // but not load-bearing for the regression we're locking).
  const deadline = Date.now() + 1000
  while (!disconnectCalled && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  assert.equal(
    disconnectCalled,
    true,
    'transport.disconnect() must be called even though close() ran during the connecting window'
  )

  // Best-effort cleanup so the test runner doesn't hold the port — but
  // do not block on it. Node's test runner will reap any leftover
  // resources at process exit.
  await Promise.race([
    closePromise,
    new Promise((resolve) => setTimeout(resolve, 200))
  ])
  await upgradePromise.catch(() => {})
})

test('WebSocket bridge without authToken still accepts (token check is opt-in)', async (t) => {
  let bridge
  try {
    bridge = await startBridge()
  } catch (error) {
    if (skipIfListenForbidden(t, error)) {
      return
    }
    throw error
  }

  try {
    const result = await performUpgrade({
      host: '127.0.0.1',
      port: bridge.port,
      origin: `http://127.0.0.1:${bridge.port}`,
      path: '/mavlink?token=anything'
    })
    assert.equal(
      result.status,
      101,
      `Expected 101 (no token configured ⇒ no token required), got status line:\n${result.head}`
    )
  } finally {
    await bridge.close().catch(() => {})
  }
})
