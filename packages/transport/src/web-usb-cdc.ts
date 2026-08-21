// Finding the serial endpoints inside a USB CDC-ACM device.
//
// Android has no Web Serial API and no kernel CDC-ACM driver. The second fact
// is what makes the first survivable: with nothing claiming the interface, a
// page can claim it over WebUSB and drive the port itself. Chrome permits this
// -- its protected-class list is audio (0x01), HID (0x03), mass storage (0x08),
// smart card (0x0B), video (0x0E), audio/video (0x10) and wireless (0xE0);
// neither CDC (0x02) nor CDC-Data (0x0A) is on it.
//
// An ArduPilot board (VID 0x1209, PID 0x5740 dual / 0x5741 single) is an IAD
// composite: interface 0 comm + interface 1 data, and on dual-CDC boards
// interface 2 comm + interface 3 data. MAVLink is the first port, SLCAN the
// second (AP_HAL_ChibiOS/hwdef/common/usbcfg_dualcdc.c).
//
// This module is the part of that worth testing without hardware: given a
// configuration descriptor, which interface do we claim and which endpoints do
// we read and write. Deliberately descriptor-driven rather than hard-coded to
// those numbers -- the layout above is what ArduPilot ships today, not a
// promise, and a board with one CDC or a different endpoint map should still
// work.

/** USB class codes, from the USB CDC specification. */
export const USB_CLASS_CDC = 0x02
export const USB_CLASS_CDC_DATA = 0x0a

/** ArduPilot's allocated pid.codes identifiers. */
export const ARDUPILOT_USB_VENDOR_ID = 0x1209
export const ARDUPILOT_USB_PRODUCT_IDS = [0x5740, 0x5741] as const

/** Minimal shapes of the WebUSB objects this module reads. */
export interface UsbEndpointLike {
  endpointNumber: number
  direction: 'in' | 'out'
  type: 'bulk' | 'interrupt' | 'isochronous'
  packetSize: number
}

export interface UsbAlternateInterfaceLike {
  alternateSetting: number
  interfaceClass: number
  interfaceSubclass: number
  interfaceProtocol: number
  endpoints: UsbEndpointLike[]
}

export interface UsbInterfaceLike {
  interfaceNumber: number
  alternate: UsbAlternateInterfaceLike
  alternates?: UsbAlternateInterfaceLike[]
}

export interface UsbConfigurationLike {
  configurationValue: number
  interfaces: UsbInterfaceLike[]
}

/** One usable serial port found in a device's configuration. */
export interface CdcSerialPort {
  /** The DATA interface to claim. */
  interfaceNumber: number
  alternateSetting: number
  /** Bulk endpoints, by number (direction is implied by which field). */
  inEndpoint: number
  outEndpoint: number
  /** wMaxPacketSize of the IN endpoint; reads must be a multiple of it. */
  inPacketSize: number
  /**
   * The paired communications interface, when one precedes this data
   * interface. SET_LINE_CODING and SET_CONTROL_LINE_STATE are addressed to it.
   */
  controlInterfaceNumber?: number
}

/**
 * Every CDC data interface in a configuration, in descriptor order.
 *
 * Order is the contract: on an ArduPilot board the first is MAVLink and the
 * second is SLCAN, which is the same ordering the two-port serial probe
 * relies on.
 */
export function findCdcSerialPorts(configuration: UsbConfigurationLike): CdcSerialPort[] {
  const ports: CdcSerialPort[] = []
  let lastCommInterface: number | undefined

  for (const usbInterface of configuration.interfaces) {
    const alternates = usbInterface.alternates ?? [usbInterface.alternate]
    for (const alternate of alternates) {
      if (alternate.interfaceClass === USB_CLASS_CDC) {
        // A comm interface pairs with the data interface that follows it (the
        // Union functional descriptor says so explicitly, but ArduPilot's
        // layout -- and the CDC spec's own example -- is simply adjacency).
        lastCommInterface = usbInterface.interfaceNumber
        continue
      }
      if (alternate.interfaceClass !== USB_CLASS_CDC_DATA) {
        continue
      }
      const inEndpoint = alternate.endpoints.find(
        (endpoint) => endpoint.direction === 'in' && endpoint.type === 'bulk'
      )
      const outEndpoint = alternate.endpoints.find(
        (endpoint) => endpoint.direction === 'out' && endpoint.type === 'bulk'
      )
      // A data interface without both bulk endpoints cannot carry a serial
      // stream. Skipping it is better than claiming it and stalling.
      if (!inEndpoint || !outEndpoint) {
        continue
      }
      ports.push({
        interfaceNumber: usbInterface.interfaceNumber,
        alternateSetting: alternate.alternateSetting,
        inEndpoint: inEndpoint.endpointNumber,
        outEndpoint: outEndpoint.endpointNumber,
        inPacketSize: inEndpoint.packetSize,
        controlInterfaceNumber: lastCommInterface
      })
      lastCommInterface = undefined
    }
  }

  return ports
}

/**
 * Pick the port to use, by index into what the device exposes.
 *
 * Index 0 is MAVLink on an ArduPilot board; index 1 is SLCAN. Out of range
 * falls back to the first port rather than failing: a single-CDC board asked
 * for its "second" port should still connect over the one it has.
 */
export function selectCdcSerialPort(
  ports: readonly CdcSerialPort[],
  index = 0
): CdcSerialPort | undefined {
  if (ports.length === 0) {
    return undefined
  }
  return ports[index] ?? ports[0]
}

/**
 * Round a read size up to a whole number of packets.
 *
 * A bulk IN transfer shorter than the endpoint's packet size can babble: the
 * device sends a full packet, the host buffer cannot hold it, and the transfer
 * errors instead of returning data.
 */
export function alignReadSize(requested: number, packetSize: number): number {
  if (!Number.isFinite(packetSize) || packetSize <= 0) {
    return Math.max(1, Math.floor(requested))
  }
  const packets = Math.max(1, Math.ceil(requested / packetSize))
  return packets * packetSize
}
