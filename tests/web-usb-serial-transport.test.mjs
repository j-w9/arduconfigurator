// Serial-over-WebUSB, driven against a fake USB device.
//
// WebUSB cannot be exercised headlessly, so the device is faked at the same
// seam the DFU flasher uses. What that buys is real: interface selection,
// endpoint discovery, the claim/release lifecycle, read framing and the
// disconnect ordering are all decided in this code, not in the browser, and
// all of it is wrong-able without a tablet in hand.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  WebUsbSerialTransport,
  describeUsbError,
  findCdcSerialPorts,
  selectCdcSerialPort,
  alignReadSize
} from '../packages/transport/dist/index.js'

/** ArduPilot's dual-CDC descriptor, from AP_HAL_ChibiOS usbcfg_dualcdc.c. */
function ardupilotDualCdcConfiguration() {
  const comm = (interfaceNumber, notifyEndpoint) => ({
    interfaceNumber,
    alternate: {
      alternateSetting: 0,
      interfaceClass: 0x02,
      interfaceSubclass: 0x02,
      interfaceProtocol: 0x01,
      endpoints: [{ endpointNumber: notifyEndpoint, direction: 'in', type: 'interrupt', packetSize: 16 }]
    }
  })
  const data = (interfaceNumber, endpoint) => ({
    interfaceNumber,
    alternate: {
      alternateSetting: 0,
      interfaceClass: 0x0a,
      interfaceSubclass: 0x00,
      interfaceProtocol: 0x00,
      endpoints: [
        { endpointNumber: endpoint, direction: 'out', type: 'bulk', packetSize: 64 },
        { endpointNumber: endpoint, direction: 'in', type: 'bulk', packetSize: 64 }
      ]
    }
  })
  return {
    configurationValue: 1,
    // IF0 comm + IF1 data (MAVLink), IF2 comm + IF3 data (SLCAN).
    interfaces: [comm(0, 1), data(1, 2), comm(2, 3), data(3, 4)]
  }
}

function fakeDevice(options = {}) {
  const calls = []
  const inbound = [...(options.inbound ?? [])]
  let resolveIdle
  const device = {
    opened: false,
    configuration: options.configuration ?? ardupilotDualCdcConfiguration(),
    productName: 'CubeOrange',
    calls,
    written: [],
    async open() {
      calls.push('open')
      device.opened = true
    },
    async close() {
      calls.push('close')
      device.opened = false
    },
    async selectConfiguration(value) {
      calls.push(`selectConfiguration:${value}`)
    },
    async claimInterface(interfaceNumber) {
      calls.push(`claim:${interfaceNumber}`)
      if (options.claimError) {
        throw options.claimError
      }
    },
    async releaseInterface(interfaceNumber) {
      calls.push(`release:${interfaceNumber}`)
    },
    async controlTransferOut(setup) {
      calls.push(`control:${setup.request}:${setup.index}`)
      return { bytesWritten: 0, status: 'ok' }
    },
    async transferIn(endpointNumber, length) {
      calls.push(`in:${endpointNumber}:${length}`)
      const next = inbound.shift()
      if (next) {
        return { status: 'ok', data: { buffer: next.buffer, byteOffset: 0, byteLength: next.byteLength } }
      }
      // Park so the loop stays alive without spinning, exactly as a real
      // transferIn does between packets.
      return new Promise((resolve) => {
        resolveIdle = () => resolve({ status: 'ok', data: undefined })
      })
    },
    async transferOut(endpointNumber, data) {
      calls.push(`out:${endpointNumber}`)
      device.written.push(new Uint8Array(data.buffer ?? data))
      return { bytesWritten: data.byteLength ?? data.length, status: 'ok' }
    },
    releaseIdleRead() {
      resolveIdle?.()
    }
  }
  return device
}

test('finds both CDC ports on an ArduPilot dual-CDC board, in descriptor order', () => {
  const ports = findCdcSerialPorts(ardupilotDualCdcConfiguration())
  assert.equal(ports.length, 2, 'MAVLink and SLCAN')
  // Interface 1, endpoints 2/0x82 — MAVLink is the first port, which is the
  // same ordering the two-port serial probe relies on.
  assert.deepEqual(
    { interfaceNumber: ports[0].interfaceNumber, in: ports[0].inEndpoint, out: ports[0].outEndpoint },
    { interfaceNumber: 1, in: 2, out: 2 }
  )
  assert.equal(ports[0].controlInterfaceNumber, 0, 'paired with the comm interface before it')
  assert.equal(ports[1].interfaceNumber, 3)
  assert.equal(ports[1].controlInterfaceNumber, 2)
})

test('ignores a data interface with no bulk pair rather than claiming a dead one', () => {
  const configuration = {
    configurationValue: 1,
    interfaces: [
      {
        interfaceNumber: 0,
        alternate: {
          alternateSetting: 0,
          interfaceClass: 0x0a,
          interfaceSubclass: 0,
          interfaceProtocol: 0,
          // IN only: nothing to write to.
          endpoints: [{ endpointNumber: 2, direction: 'in', type: 'bulk', packetSize: 64 }]
        }
      }
    ]
  }
  assert.deepEqual(findCdcSerialPorts(configuration), [])
})

test('a single-CDC board asked for its second port still gets its first', () => {
  const ports = findCdcSerialPorts(ardupilotDualCdcConfiguration()).slice(0, 1)
  assert.equal(selectCdcSerialPort(ports, 1)?.interfaceNumber, 1)
  assert.equal(selectCdcSerialPort([], 0), undefined)
})

test('reads are rounded up to whole packets so the endpoint cannot babble', () => {
  assert.equal(alignReadSize(512, 64), 512)
  assert.equal(alignReadSize(100, 64), 128)
  assert.equal(alignReadSize(1, 64), 64)
  // A nonsense packet size must not produce a zero-length read.
  assert.equal(alignReadSize(64, 0), 64)
})

test('connects to the MAVLink interface and hands received bytes to listeners', async () => {
  const device = fakeDevice({ inbound: [new Uint8Array([0xfd, 0x01, 0x02])] })
  const transport = new WebUsbSerialTransport('t', { device })
  const frames = []
  transport.onFrame((frame) => frames.push(frame))

  await transport.connect()
  assert.equal(transport.getStatus().kind, 'connected')
  await new Promise((resolve) => setTimeout(resolve, 10))

  assert.deepEqual(Array.from(frames[0] ?? []), [0xfd, 0x01, 0x02])
  assert.ok(device.calls.includes('claim:1'), 'claims the MAVLink data interface, not the comm one')
  // SET_LINE_CODING and SET_CONTROL_LINE_STATE go to the COMM interface (0),
  // which is what the CDC spec addresses them to.
  assert.ok(device.calls.includes('control:32:0'))
  assert.ok(device.calls.includes('control:34:0'))

  await transport.disconnect()
  assert.equal(transport.getStatus().kind, 'disconnected')
  assert.ok(device.calls.includes('release:1'))
  assert.ok(device.calls.includes('close'))
})

test('portIndex 1 selects SLCAN without touching the MAVLink interface', async () => {
  const device = fakeDevice()
  const transport = new WebUsbSerialTransport('t', { device, portIndex: 1 })
  await transport.connect()
  assert.ok(device.calls.includes('claim:3'))
  assert.ok(!device.calls.includes('claim:1'))
  await transport.disconnect()
})

test('sends on the bulk OUT endpoint of the claimed port', async () => {
  const device = fakeDevice()
  const transport = new WebUsbSerialTransport('t', { device })
  await transport.connect()
  await transport.send(new Uint8Array([1, 2, 3]))
  assert.ok(device.calls.includes('out:2'))
  assert.deepEqual(Array.from(device.written[0]), [1, 2, 3])
  await transport.disconnect()
})

test('refuses to send before connecting rather than throwing from the device', async () => {
  const transport = new WebUsbSerialTransport('t', { device: fakeDevice() })
  await assert.rejects(transport.send(new Uint8Array([1])), /not connected/i)
})

test('every CDC interface is unclaimable: says what was tried, leaves nothing claimed', async () => {
  // The failure a Samsung Galaxy reported: the device enumerates and appears in
  // the picker, and then claimInterface is refused because something already
  // owns it.
  const device = fakeDevice({ claimError: new Error('Unable to claim interface.') })
  const transport = new WebUsbSerialTransport('t', { device })
  await assert.rejects(transport.connect(), /Could not claim a serial interface/i)
  const status = transport.getStatus()
  assert.equal(status.kind, 'error')
  // Both CDC interfaces named, so a report says which failed rather than "it
  // did not work".
  assert.match(status.message, /interface 1:/)
  assert.match(status.message, /interface 3:/)
  assert.match(status.message, /Android builds ship a driver/i)
  assert.ok(!device.calls.some((call) => call.startsWith('release:')), 'nothing claimed, nothing to release')
})

test('falls back to the second CDC interface when the first is taken', async () => {
  // A host that binds the first interface does not necessarily hold the
  // second. Trying costs one failed call and turns a dead end into a link.
  const device = fakeDevice()
  const originalClaim = device.claimInterface
  device.claimInterface = async (interfaceNumber) => {
    if (interfaceNumber === 1) {
      device.calls.push('claim:1')
      throw new Error('Unable to claim interface.')
    }
    return originalClaim.call(device, interfaceNumber)
  }
  const transport = new WebUsbSerialTransport('t', { device })
  await transport.connect()
  assert.equal(transport.getStatus().kind, 'connected')
  assert.ok(device.calls.includes('claim:3'), 'claimed the other CDC port')
  // And it then talks on THAT port's endpoints, not the one it could not claim.
  await transport.send(new Uint8Array([1]))
  assert.ok(device.calls.includes('out:4'))
  await transport.disconnect()
  assert.ok(device.calls.includes('release:3'))
})

test('a device with no CDC interface is refused with a usable reason', async () => {
  const device = fakeDevice({
    configuration: {
      configurationValue: 1,
      interfaces: [
        {
          interfaceNumber: 0,
          alternate: {
            alternateSetting: 0,
            interfaceClass: 0x03,
            interfaceSubclass: 0,
            interfaceProtocol: 0,
            endpoints: []
          }
        }
      ]
    }
  })
  const transport = new WebUsbSerialTransport('t', { device })
  await assert.rejects(transport.connect(), /No CDC serial interface/i)
})

test('a mid-read USB failure ends as disconnected, not as a silent stall', async () => {
  const device = fakeDevice()
  let reads = 0
  // First read returns nothing (a normal idle poll), the second fails the way
  // an unplugged board does.
  device.transferIn = async () => {
    reads += 1
    if (reads > 1) {
      throw new Error('The device was disconnected.')
    }
    return { status: 'ok', data: undefined }
  }
  const transport = new WebUsbSerialTransport('t', { device })
  const statuses = []
  transport.onStatus((status) => statuses.push(status.kind))
  await transport.connect()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(transport.getStatus().kind, 'disconnected')
  assert.match(transport.getStatus().reason, /unplugged or reset/i)
})

test('describeUsbError explains the two failures that actually happen', () => {
  assert.match(describeUsbError(new Error('The device is busy')), /another driver or tab/i)
  assert.match(describeUsbError(new Error('Access denied')), /permission was refused/i)
  // Anything else is passed through rather than dressed up.
  assert.equal(describeUsbError(new Error('boom')), 'boom')
})

test('claims the paired comm interface too, and releases both', async () => {
  // Some hosts bind a CDC function as a unit and refuse an app that owns only
  // half of it. Claiming the comm interface first is free where that is not so.
  const device = fakeDevice()
  const transport = new WebUsbSerialTransport('t', { device })
  await transport.connect()
  assert.ok(device.calls.includes('claim:0'), 'comm interface of the MAVLink port')
  assert.ok(device.calls.includes('claim:1'), 'and its data interface')
  await transport.disconnect()
  assert.ok(device.calls.includes('release:0'))
  assert.ok(device.calls.includes('release:1'))
})

test('a comm interface that cannot be claimed does not block the data interface', async () => {
  // The claim that matters is the data one. If the host holds only the comm
  // half, the link should still come up.
  const device = fakeDevice()
  const originalClaim = device.claimInterface
  device.claimInterface = async (interfaceNumber) => {
    if (interfaceNumber === 0) {
      device.calls.push('claim:0')
      throw new Error('Unable to claim interface.')
    }
    return originalClaim.call(device, interfaceNumber)
  }
  const transport = new WebUsbSerialTransport('t', { device })
  await transport.connect()
  assert.equal(transport.getStatus().kind, 'connected')
  await transport.disconnect()
})
