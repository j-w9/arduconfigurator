// ArduPilot SITL compiled to WebAssembly, driven through the transport layer.
//
// The vehicle firmware runs in-process: no socket, no child process, no
// bridge. `--serial0 wasm` routes SITL's MAVLink console to a pair of exported
// functions and the transport reads and writes them, so everything above --
// the codec, the parameter model, the app -- sees an ordinary byte stream.
//
// Most of this runs against a stub, because the behaviour worth pinning is the
// transport's own: buffer reuse, copying out of a heap that moves, status
// transitions. The last test drives the REAL 3.4 MB ArduCopter build when one
// is present, which is what proves the stub resembles anything.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'

import { WasmSitlTransport } from '../packages/transport/dist/index.js'

/** An Emscripten-shaped module whose serial ports are arrays. */
function stubModule({ outbound = [], heapBytes = 1 << 16 } = {}) {
  const heap = new Uint8Array(heapBytes)
  let next = 8
  const written = []
  const pending = [...outbound]
  const calls = { malloc: 0, free: 0 }

  const module = {
    HEAPU8: heap,
    written,
    calls,
    pushInbound(bytes) {
      pending.push(bytes)
    },
    cwrap(name) {
      switch (name) {
        case 'ardupilot_malloc':
          return (size) => {
            calls.malloc += 1
            const pointer = next
            next += size
            return pointer
          }
        case 'ardupilot_free':
          return () => {
            calls.free += 1
            return 0
          }
        case 'ardupilot_serial_read':
          return (_port, buffer, max) => {
            const chunk = pending.shift()
            if (!chunk) return 0
            const length = Math.min(chunk.length, max)
            heap.set(chunk.subarray(0, length), buffer)
            if (length < chunk.length) pending.unshift(chunk.subarray(length))
            return length
          }
        case 'ardupilot_serial_write':
          return (port, buffer, length) => {
            written.push({ port, bytes: heap.slice(buffer, buffer + length) })
            return length
          }
        default:
          throw new Error(`unexpected export ${name}`)
      }
    }
  }
  return module
}

function stubTransport(options = {}) {
  const module = options.module ?? stubModule()
  let seenArgs
  const transport = new WasmSitlTransport({
    loadModule: async () => async (opts) => {
      seenArgs = opts.arguments
      return module
    },
    pollIntervalMs: 1,
    ...options
  })
  return { transport, module, args: () => seenArgs }
}

test('the console is routed to the wasm exports, whatever else is asked for', async () => {
  // Without --serial0 wasm, SITL opens a socket the browser cannot reach and
  // the vehicle boots into silence. It is prepended rather than left to the
  // caller so no call site can forget it.
  const { transport, args } = stubTransport({ args: ['--model', 'quad', '--speedup', '5'] })
  await transport.connect()
  assert.deepEqual(args().slice(0, 2), ['--serial0', 'wasm'])
  assert.ok(args().includes('--model'))
  await transport.disconnect()
})

test('bytes the vehicle sends arrive as frames', async () => {
  const module = stubModule({ outbound: [Uint8Array.from([0xfd, 0x09, 0x00, 0x01])] })
  const { transport } = stubTransport({ module })
  const frames = []
  transport.onFrame((frame) => frames.push(frame))

  await transport.connect()
  await new Promise((resolve) => setTimeout(resolve, 30))
  await transport.disconnect()

  assert.ok(frames.length >= 1)
  assert.deepEqual([...frames[0]], [0xfd, 0x09, 0x00, 0x01])
})

test('a frame is copied out of the heap, not handed a view of it', async () => {
  // HEAPU8 is a window onto memory the module overwrites on the next read and
  // may detach entirely when the heap grows. A listener that kept the view
  // would see its own data change underneath it.
  const module = stubModule({ outbound: [Uint8Array.from([0xfd, 1, 2, 3])] })
  const { transport } = stubTransport({ module })
  const frames = []
  transport.onFrame((frame) => frames.push(frame))

  await transport.connect()
  await new Promise((resolve) => setTimeout(resolve, 30))
  module.HEAPU8.fill(0xee)
  assert.deepEqual([...frames[0]], [0xfd, 1, 2, 3])
  await transport.disconnect()
})

test('what is sent reaches the vehicle, on the console port', async () => {
  const { transport, module } = stubTransport()
  await transport.connect()
  await transport.send(Uint8Array.from([0xfd, 0x21, 0x00]))
  assert.equal(module.written.length, 1)
  assert.equal(module.written[0].port, 0)
  assert.deepEqual([...module.written[0].bytes], [0xfd, 0x21, 0x00])
  await transport.disconnect()
})

test('the write buffer is reused rather than allocated per frame', async () => {
  // A parameter sync is hundreds of small writes; churning the heap for each
  // would be a lot of allocation for frames that are all much the same size.
  const { transport, module } = stubTransport()
  await transport.connect()
  const afterConnect = module.calls.malloc
  for (let i = 0; i < 10; i += 1) await transport.send(Uint8Array.from([0xfd, i]))
  // One allocation for the first write, none after.
  assert.equal(module.calls.malloc - afterConnect, 1)
  await transport.disconnect()
})

test('a bigger frame grows the buffer, and the old one is released', async () => {
  const { transport, module } = stubTransport()
  await transport.connect()
  await transport.send(new Uint8Array(8))
  const before = module.calls.free
  await transport.send(new Uint8Array(512))
  assert.equal(module.calls.free - before, 1)
  assert.deepEqual([...module.written[1].bytes].length, 512)
  await transport.disconnect()
})

test('status goes idle, connecting, connected, disconnected', async () => {
  const { transport } = stubTransport()
  const seen = []
  transport.onStatus((status) => seen.push(status.kind))
  assert.equal(transport.getStatus().kind, 'idle')
  await transport.connect()
  assert.equal(transport.getStatus().kind, 'connected')
  await transport.disconnect()
  assert.deepEqual(seen, ['connecting', 'connected', 'disconnected'])
})

test('two connects boot one vehicle, not two', async () => {
  let built = 0
  const module = stubModule()
  const transport = new WasmSitlTransport({
    loadModule: async () => async () => {
      built += 1
      return module
    },
    pollIntervalMs: 1
  })
  await Promise.all([transport.connect(), transport.connect()])
  assert.equal(built, 1)
  await transport.disconnect()
})

test('a module that will not load reports why, rather than hanging', async () => {
  const transport = new WasmSitlTransport({
    loadModule: async () => {
      throw new Error('arducopter.wasm 404')
    }
  })
  await assert.rejects(() => transport.connect(), /arducopter\.wasm 404/)
  assert.equal(transport.getStatus().kind, 'error')
  assert.match(transport.getStatus().message, /WASM SITL failed to start/)
})

test('sending before connecting is refused, not silently dropped', async () => {
  const { transport } = stubTransport()
  await assert.rejects(() => transport.send(Uint8Array.from([1])), /not connected/)
})

test('polling stops once disconnected', async () => {
  const module = stubModule()
  let reads = 0
  const inner = module.cwrap.bind(module)
  module.cwrap = (name) => {
    const fn = inner(name)
    return name === 'ardupilot_serial_read' ? (...a) => (reads += 1, fn(...a)) : fn
  }
  const { transport } = stubTransport({ module })
  await transport.connect()
  await new Promise((resolve) => setTimeout(resolve, 20))
  await transport.disconnect()
  const settled = reads
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(reads, settled, 'the poll timer kept running after disconnect')
})

// The one that proves the stub resembles reality. Set ARDUPILOT_WASM_DIR to a
// build/wasm/bin directory holding arducopter.js + arducopter.wasm.
const wasmDir = process.env.ARDUPILOT_WASM_DIR
const wasmEntry = wasmDir ? `${wasmDir}/arducopter.js` : undefined

test(
  'the real ArduCopter WebAssembly build sends MAVLink through this transport',
  { skip: wasmEntry && existsSync(wasmEntry) ? false : 'set ARDUPILOT_WASM_DIR to a wasm build', timeout: 120000 },
  async () => {
    const transport = new WasmSitlTransport({
      loadModule: async () => (await import(`file://${wasmEntry}`)).default,
      args: ['--model', 'quad', '--serial1', 'none', '--serial2', 'none'],
      pollIntervalMs: 5
    })

    const heartbeat = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no MAVLink within 60s')), 60000)
      transport.onFrame((frame) => {
        const start = frame.indexOf(0xfd)
        if (start === -1) return
        const msgid = frame[start + 7] | (frame[start + 8] << 8) | (frame[start + 9] << 16)
        // 0 is HEARTBEAT: the vehicle is not merely emitting bytes, it is alive.
        if (msgid === 0) {
          clearTimeout(timer)
          resolve(msgid)
        }
      })
    })

    await transport.connect()
    assert.equal(await heartbeat, 0)
    await transport.disconnect()
  }
)
