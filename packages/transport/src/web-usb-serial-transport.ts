// A serial link over WebUSB, for platforms that have no Web Serial API.
//
// This exists for Android. Chrome ships Web Serial on the desktop only, so a
// tablet at the field could not talk to a board over USB at all. WebUSB IS on
// Android, and Android ships no CDC-ACM driver to claim the interface first --
// Chrome's own guidance notes that more devices are reachable there than on
// desktop Linux for exactly that reason -- so the page can drive the port.
//
// Deliberately NOT offered on desktop: there the OS owns the CDC interface,
// claimInterface fails with "busy", and Web Serial is both available and
// better. Same reason the picker only shows this option when Web Serial is
// missing.
//
// The device is injected as an interface rather than reached for directly, so
// the whole flow is testable against a fake device -- the pattern the DFU
// flasher already uses.

import {
  alignReadSize,
  findCdcSerialPorts,
  selectCdcSerialPort,
  type CdcSerialPort,
  type UsbConfigurationLike
} from './web-usb-cdc.js'
import type { FrameListener, StatusListener, Transport, TransportStatus, Unsubscribe } from './types.js'

export interface UsbInTransferResultLike {
  data?: { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }
  status?: 'ok' | 'stall' | 'babble'
}

export interface UsbOutTransferResultLike {
  bytesWritten: number
  status?: 'ok' | 'stall'
}

export interface UsbControlSetupLike {
  requestType: 'standard' | 'class' | 'vendor'
  recipient: 'device' | 'interface' | 'endpoint' | 'other'
  request: number
  value: number
  index: number
}

/** The subset of USBDevice this transport uses. */
export interface UsbSerialDeviceLike {
  readonly opened?: boolean
  readonly configuration?: UsbConfigurationLike | null
  readonly configurations?: UsbConfigurationLike[]
  readonly productName?: string
  readonly serialNumber?: string
  open(): Promise<void>
  close(): Promise<void>
  selectConfiguration(configurationValue: number): Promise<void>
  claimInterface(interfaceNumber: number): Promise<void>
  releaseInterface(interfaceNumber: number): Promise<void>
  selectAlternateInterface?(interfaceNumber: number, alternateSetting: number): Promise<void>
  controlTransferOut(setup: UsbControlSetupLike, data?: ArrayBufferView): Promise<UsbOutTransferResultLike>
  transferIn(endpointNumber: number, length: number): Promise<UsbInTransferResultLike>
  transferOut(endpointNumber: number, data: ArrayBufferView): Promise<UsbOutTransferResultLike>
}

export interface WebUsbSerialTransportOptions {
  /** The device, or a resolver read at connect() time (see WebSerialTransport). */
  device?: UsbSerialDeviceLike | (() => UsbSerialDeviceLike | undefined)
  /**
   * Which CDC port to use: 0 is MAVLink on an ArduPilot board, 1 is SLCAN.
   */
  portIndex?: number
  /** Bytes per read. Rounded up to a whole number of packets. */
  readSize?: number
  onDeviceSelected?: (device: UsbSerialDeviceLike) => void
}

/** CDC class requests (USB CDC spec, table 46). */
const CDC_SET_LINE_CODING = 0x20
const CDC_SET_CONTROL_LINE_STATE = 0x22

/**
 * 115200 8N1. The value is arbitrary over USB -- there is no UART behind it --
 * but ArduPilot reads it back through get_usb_baud() for SERIAL_PASS
 * passthrough, so sending something sane beats sending nothing.
 */
const DEFAULT_LINE_CODING = new Uint8Array([0x00, 0xc2, 0x01, 0x00, 0x00, 0x00, 0x08])

export class WebUsbSerialTransport implements Transport {
  readonly kind = 'web-usb-serial' as const
  readonly id: string

  private readonly frameListeners = new Set<FrameListener>()
  private readonly statusListeners = new Set<StatusListener>()
  private readonly options: WebUsbSerialTransportOptions

  private status: TransportStatus = { kind: 'idle' }
  private device?: UsbSerialDeviceLike
  private port?: CdcSerialPort
  private intentionalDisconnect = false
  private connectPromise?: Promise<void>
  private readLoopPromise?: Promise<void>
  /** The comm interface, when claiming it was possible and necessary. */
  private claimedControlInterface?: number

  constructor(id = 'web-usb-serial', options: WebUsbSerialTransportOptions = {}) {
    this.id = id
    this.options = options
    this.device = typeof options.device === 'function' ? undefined : options.device
  }

  getStatus(): TransportStatus {
    return this.status
  }

  onFrame(listener: FrameListener): Unsubscribe {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }

  onStatus(listener: StatusListener): Unsubscribe {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  private updateStatus(next: TransportStatus): void {
    this.status = next
    this.statusListeners.forEach((listener) => listener(next))
  }

  private resolveDevice(): UsbSerialDeviceLike | undefined {
    const provided = this.options.device
    return typeof provided === 'function' ? provided() : provided
  }

  async connect(): Promise<void> {
    if (this.connectPromise) {
      return this.connectPromise
    }
    this.connectPromise = this.doConnect().finally(() => {
      this.connectPromise = undefined
    })
    return this.connectPromise
  }

  private async doConnect(): Promise<void> {
    if (typeof this.options.device === 'function' || !this.device) {
      this.device = this.resolveDevice()
    }
    if (!this.device) {
      const error = new Error('No USB device selected. Choose the flight controller first.')
      this.updateStatus({ kind: 'error', message: error.message })
      throw error
    }

    this.updateStatus({ kind: 'connecting' })
    this.intentionalDisconnect = false

    const device = this.device
    let claimedInterface: number | undefined
    try {
      this.options.onDeviceSelected?.(device)
      if (!device.opened) {
        await device.open()
      }
      // A device with no active configuration has to be given one before its
      // interfaces can be read, let alone claimed.
      const configuration =
        device.configuration ?? device.configurations?.[0] ?? undefined
      if (!configuration) {
        throw new Error('The USB device exposes no configuration.')
      }
      if (!device.configuration) {
        await device.selectConfiguration(configuration.configurationValue)
      }

      const ports = findCdcSerialPorts(device.configuration ?? configuration)
      const preferred = selectCdcSerialPort(ports, this.options.portIndex ?? 0)
      if (!preferred) {
        throw new Error(
          'No CDC serial interface on this USB device. Pick the flight controller, not a hub or adapter.'
        )
      }

      // Try the preferred port first, then every other CDC port on the device.
      //
      // A driver claiming one interface does not always hold the others: a
      // dual-CDC board offers a second, and a host that binds the first may
      // leave it free. Trying rather than assuming costs one failed call and
      // turns a dead end into a working link on exactly the devices where the
      // first interface is spoken for.
      const candidates = [preferred, ...ports.filter((candidate) => candidate !== preferred)]
      const attempts: string[] = []
      let port: CdcSerialPort | undefined
      for (const candidate of candidates) {
        // Claim the paired COMM interface first where there is one. Some hosts
        // bind a CDC function as a unit, and owning only half of it is refused;
        // where that is not so, this is a harmless extra claim. Failure here is
        // ignored on purpose -- the data interface is the one that matters, and
        // it may well be free even when this is not.
        let claimedComm: number | undefined
        if (candidate.controlInterfaceNumber !== undefined) {
          try {
            await device.claimInterface(candidate.controlInterfaceNumber)
            claimedComm = candidate.controlInterfaceNumber
          } catch {
            claimedComm = undefined
          }
        }
        try {
          await device.claimInterface(candidate.interfaceNumber)
          port = candidate
          claimedInterface = candidate.interfaceNumber
          this.claimedControlInterface = claimedComm
          break
        } catch (claimError) {
          if (claimedComm !== undefined) {
            await device.releaseInterface(claimedComm).catch(() => {})
          }
          attempts.push(
            `interface ${candidate.interfaceNumber}: ${claimError instanceof Error ? claimError.message : String(claimError)}`
          )
        }
      }
      if (!port) {
        throw new Error(
          `Could not claim a serial interface on this device (${attempts.join('; ')}). ` +
            'Something else already owns it: close other apps or browser tabs using the board, unplug and replug it, ' +
            'and try again. Some Android builds ship a driver that claims the port permanently — there is no way ' +
            'around that from a web page, so use the WebSocket bridge or the desktop app on those.'
        )
      }
      this.port = port

      if (port.alternateSetting !== 0 && device.selectAlternateInterface) {
        await device.selectAlternateInterface(port.interfaceNumber, port.alternateSetting)
      }

      if (this.intentionalDisconnect) {
        throw new Error('WebUSB connect aborted by disconnect.')
      }

      await this.configureLine(device, port)

      this.updateStatus({ kind: 'connected' })
      this.readLoopPromise = this.readLoop(device, port)
    } catch (error) {
      if (claimedInterface !== undefined) {
        await device.releaseInterface(claimedInterface).catch(() => {})
      }
      if (typeof this.options.device === 'function') {
        this.device = undefined
      }
      this.port = undefined
      const message = describeUsbError(error)
      if (!this.intentionalDisconnect) {
        this.updateStatus({ kind: 'error', message })
      }
      throw error instanceof Error ? error : new Error(message)
    }
  }

  /**
   * Line coding and control lines.
   *
   * Both are best-effort: ArduPilot answers SET_CONTROL_LINE_STATE with
   * "Nothing to do, there are no control lines" (usbcfg_dualcdc.c), so a device
   * that rejects either is not a device that cannot talk. Failing the whole
   * connect over an optional request would be worse than sending it and
   * carrying on.
   */
  private async configureLine(device: UsbSerialDeviceLike, port: CdcSerialPort): Promise<void> {
    const index = port.controlInterfaceNumber ?? port.interfaceNumber
    await device
      .controlTransferOut(
        {
          requestType: 'class',
          recipient: 'interface',
          request: CDC_SET_LINE_CODING,
          value: 0,
          index
        },
        DEFAULT_LINE_CODING
      )
      .catch(() => undefined)
    await device
      .controlTransferOut({
        requestType: 'class',
        recipient: 'interface',
        request: CDC_SET_CONTROL_LINE_STATE,
        // DTR | RTS asserted.
        value: 0x03,
        index
      })
      .catch(() => undefined)
  }

  private async readLoop(device: UsbSerialDeviceLike, port: CdcSerialPort): Promise<void> {
    const length = alignReadSize(this.options.readSize ?? 512, port.inPacketSize)
    while (!this.intentionalDisconnect) {
      try {
        const result = await device.transferIn(port.inEndpoint, length)
        if (this.intentionalDisconnect) {
          return
        }
        if (result.status === 'stall') {
          // A stalled endpoint is recoverable in principle, but not without a
          // clearHalt this interface does not expose. Treat it as link loss so
          // the app can offer a reconnect rather than spinning on a dead pipe.
          throw new Error('USB endpoint stalled.')
        }
        const data = result.data
        if (data && data.byteLength > 0) {
          const frame = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
          this.frameListeners.forEach((listener) => listener(frame))
        }
      } catch (error) {
        if (this.intentionalDisconnect) {
          return
        }
        this.updateStatus({ kind: 'disconnected', reason: describeUsbError(error) })
        return
      }
    }
  }

  async send(frame: Uint8Array): Promise<void> {
    if (!this.device || !this.port || this.status.kind !== 'connected') {
      throw new Error('WebUsbSerialTransport is not connected.')
    }
    const result = await this.device.transferOut(this.port.outEndpoint, frame)
    if (result.status === 'stall') {
      throw new Error('USB write stalled.')
    }
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true
    const device = this.device
    const port = this.port

    // Let the read loop observe the flag and exit before the interface is
    // released; releasing under an in-flight transferIn leaves the next
    // connect fighting a half-torn-down handle. Bounded, so a wedged transfer
    // cannot hang disconnect -- transferIn has no cancel of its own.
    if (this.readLoopPromise) {
      await Promise.race([
        this.readLoopPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 1000))
      ]).catch(() => {})
      this.readLoopPromise = undefined
    }

    let reason = 'USB serial link closed.'
    if (device && this.claimedControlInterface !== undefined) {
      await device.releaseInterface(this.claimedControlInterface).catch(() => {})
      this.claimedControlInterface = undefined
    }
    if (device && port) {
      try {
        await device.releaseInterface(port.interfaceNumber)
      } catch (error) {
        reason = `Releasing the USB interface failed: ${describeUsbError(error)}`
      }
      // Closing is what returns the device to the system; a failure here is
      // worth reporting because the next connect will meet the consequences.
      try {
        await device.close()
      } catch (error) {
        reason = `Closing the USB device failed: ${describeUsbError(error)}`
      }
    }

    this.port = undefined
    if (typeof this.options.device === 'function') {
      this.device = undefined
    }
    this.updateStatus({ kind: 'disconnected', reason })
  }
}

/**
 * Turn WebUSB's failures into something an operator can act on.
 *
 * "The device is busy" and "access denied" are the two that actually happen in
 * the field, and both have a specific cause worth naming: another driver owns
 * the port, or the permission was never granted.
 */
export function describeUsbError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/busy|in use|claimed/i.test(message)) {
    return `${message} — another driver or tab already owns this interface. Close other GCS software, or unplug and replug the board.`
  }
  if (/access denied|permission|not allowed/i.test(message)) {
    return `${message} — USB permission was refused for this device.`
  }
  if (/no device selected|device unavailable|disconnected/i.test(message)) {
    return `${message} — the board was unplugged or reset.`
  }
  return message
}
