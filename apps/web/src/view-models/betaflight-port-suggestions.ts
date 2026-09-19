// "Your Betaflight board had these things wired up — here is what they are
// called in ArduPilot."
//
// The most useful thing MSP_CF_SERIAL_CONFIG gives us: the operator already
// told Betaflight what is soldered to each UART, and that wiring does not
// change when the firmware does. Re-deriving it by hand after a flash is the
// tedious part of the move.
//
// Deliberately NOT an automatic port mapping. A Betaflight serial identifier
// and an ArduPilot SERIALn index are different numbering schemes over the same
// hardware, and which is which depends on the board — guessing would put a GPS
// on the port with the receiver on it. This names the FUNCTION and its
// ArduPilot equivalent; the operator says which port.
//
// Function bits: Betaflight src/main/io/serial.h serialPortFunction_e.
// Protocol values: ARDUCOPTER_SERIAL_PROTOCOL_LABELS, itself taken from
// AP_SerialManager.cpp.

import type { MspSerialPortConfig } from '@arduconfig/protocol-msp'

/**
 * Betaflight serial identifier -> the name on the board and in its Ports tab.
 *
 * serialPortIdentifier_e (src/main/io/serial.h). The numbering is NOT the UART
 * number: identifier 0 is USART1 and 5 is USART6, which is why the raw number
 * on screen read as an off-by-one to anyone holding the board.
 *
 *   legacy (4.5 and earlier, and what boards in the field report)
 *     0..19  USART1..  (0 = UART1)
 *     20     USB VCP
 *     30/31  SOFTSERIAL1/2
 *     40     LPUART1
 *   current master additionally numbers real UARTs from 50:
 *     50+    UART0/UART1 upward, depending on SERIAL_UART_FIRST_INDEX
 *     70+    PIOUART0 upward
 *
 * Both schemes are handled: a board reporting either is named correctly, and
 * an identifier from neither falls back to naming the raw number rather than
 * inventing a UART that does not exist.
 */
export const BETAFLIGHT_USB_VCP_IDENTIFIER = 20

export function betaflightPortLabel(identifier: number): string {
  if (identifier === BETAFLIGHT_USB_VCP_IDENTIFIER) return 'USB (VCP)'
  if (identifier >= 70) return `PIOUART${identifier - 70}`
  if (identifier >= 50) return `UART${identifier - 50}`
  if (identifier >= 40) return `LPUART${identifier - 40 + 1}`
  if (identifier >= 30) return `SOFTSERIAL${identifier - 30 + 1}`
  if (identifier >= 0 && identifier < 20) return `UART${identifier + 1}`
  return `serial ${identifier}`
}

/**
 * What the CLI `diff` says about the OSD link, for the one thing the serial
 * config cannot express on its own.
 *
 * MSP DisplayPort (DJI / HDZero / Walksnail goggles) is not a serial function
 * bit: the UART carries plain FUNCTION_MSP and the OSD setting is what makes it
 * a display link — `osd_displayport_device = MSP` in settings.c
 * (lookupTableOsdDisplayPortDevice). Without this, a board with goggles wired
 * to UART6 reported "MSP" and was translated as a configurator port, which on
 * ArduPilot is the wrong protocol entirely: DisplayPort is its own
 * SERIALn_PROTOCOL, not MSP.
 */
export interface BetaflightOsdSettings {
  /** True when the OSD is driven over MSP rather than an onboard MAX7456. */
  displayPortIsMsp: boolean
  /** Newer firmware names the port directly (`osd_uart`); older does not. */
  osdUart?: number
}

export function parseBetaflightOsdSettings(cliDiff: string | undefined): BetaflightOsdSettings {
  if (!cliDiff) return { displayPortIsMsp: false }
  const device = /^\s*set\s+osd_displayport_device\s*=\s*(\S+)/im.exec(cliDiff)?.[1]
  const uart = /^\s*set\s+osd_uart\s*=\s*(\S+)/im.exec(cliDiff)?.[1]
  const uartNumber = uart !== undefined ? Number.parseInt(uart, 10) : Number.NaN
  return {
    displayPortIsMsp: device?.toUpperCase() === 'MSP',
    osdUart: Number.isFinite(uartNumber) && uartNumber >= 0 ? uartNumber : undefined
  }
}

export interface BetaflightPortSuggestion {
  /** Betaflight's own serial identifier, as carried in MSP_CF_SERIAL_CONFIG. */
  identifier: number
  /** What the operator calls it: "UART6", not "serial 5". */
  portLabel: string
  /** What Betaflight had on it. */
  betaflightFunction: string
  /** The ArduPilot SERIALn_PROTOCOL value, when there is a real equivalent. */
  ardupilotProtocol?: number
  ardupilotLabel: string
  /** Set when ArduPilot has no equivalent, explaining what to do instead. */
  note?: string
}

interface FunctionMapping {
  bit: number
  betaflight: string
  protocol?: number
  label: string
  note?: string
}

/**
 * Only the functions worth carrying over. Betaflight's telemetry protocols
 * (FrSky Hub, HoTT, LTM, SmartPort, IBUS) are deliberately absent: on
 * ArduPilot the receiver protocol is chosen once on the RC port, not per
 * telemetry flavour, so listing five near-identical rows would be noise.
 */
const FUNCTION_MAPPINGS: FunctionMapping[] = [
  { bit: 1 << 1, betaflight: 'GPS', protocol: 5, label: 'GPS' },
  { bit: 1 << 6, betaflight: 'Serial RX', protocol: 23, label: 'RCIN' },
  { bit: 1 << 9, betaflight: 'MAVLink telemetry', protocol: 2, label: 'MAVLink2' },
  { bit: 1 << 10, betaflight: 'ESC sensor', protocol: 16, label: 'ESC Telemetry' },
  { bit: 1 << 11, betaflight: 'VTX (SmartAudio)', protocol: 37, label: 'SmartAudio' },
  { bit: 1 << 13, betaflight: 'VTX (Tramp)', protocol: 36, label: 'AHRS', note: undefined },
  { bit: 1 << 15, betaflight: 'Lidar', protocol: 9, label: 'Rangefinder' },
  { bit: 1 << 17, betaflight: 'VTX (MSP)', protocol: 42, label: 'DisplayPort' },
  {
    bit: 1 << 0,
    betaflight: 'MSP',
    protocol: 32,
    label: 'MSP',
    note: 'Betaflight used MSP here for its configurator; on ArduPilot this is usually the MAVLink port instead.'
  },
  {
    bit: 1 << 7,
    betaflight: 'Blackbox',
    label: 'no direct equivalent',
    note: 'ArduPilot logs to its own dataflash or SD card — there is no serial blackbox port to configure.'
  }
]

// Tramp is the one mapping with no clean ArduPilot counterpart: ArduPilot
// drives Tramp over the same SmartAudio-style VTX support rather than a
// protocol of its own, so it is corrected here rather than pointing at AHRS.
const TRAMP = FUNCTION_MAPPINGS.find((mapping) => mapping.bit === 1 << 13)
if (TRAMP) {
  TRAMP.protocol = undefined
  TRAMP.label = 'no direct equivalent'
  TRAMP.note = 'ArduPilot has no Tramp serial protocol — use the CAN/DroneCAN or SmartAudio path for VTX control.'
}

const MSP_BIT = 1 << 0

export function buildBetaflightPortSuggestions(
  ports: readonly MspSerialPortConfig[],
  cliDiff?: string
): BetaflightPortSuggestion[] {
  const osd = parseBetaflightOsdSettings(cliDiff)
  // Which MSP port is the display link. `osd_uart` names it outright on
  // firmware that has it; otherwise it is the MSP port that is not the USB
  // one, since the VCP is how the Configurator itself is talking.
  const displayPortIdentifier = osd.displayPortIsMsp
    ? osd.osdUart ??
      ports.find(
        (port) =>
          (port.functionMask & MSP_BIT) !== 0 && port.identifier !== BETAFLIGHT_USB_VCP_IDENTIFIER
      )?.identifier
    : undefined

  const suggestions: BetaflightPortSuggestion[] = []
  for (const port of ports) {
    if (port.functionMask === 0) {
      continue
    }
    // The USB VCP carries MSP on every Betaflight board — that is how the
    // Configurator talks to it. It is not wiring, there is nothing to carry
    // over, and listing it made the operator check a port that does not exist
    // on the board.
    if (port.identifier === BETAFLIGHT_USB_VCP_IDENTIFIER) {
      continue
    }
    for (const mapping of FUNCTION_MAPPINGS) {
      if ((port.functionMask & mapping.bit) === 0) {
        continue
      }
      const isDisplayPort = mapping.bit === MSP_BIT && port.identifier === displayPortIdentifier
      suggestions.push({
        identifier: port.identifier,
        portLabel: betaflightPortLabel(port.identifier),
        betaflightFunction: isDisplayPort ? 'MSP DisplayPort (OSD)' : mapping.betaflight,
        ardupilotProtocol: isDisplayPort ? 42 : mapping.protocol,
        ardupilotLabel: isDisplayPort ? 'DisplayPort' : mapping.label,
        note: isDisplayPort
          ? 'Goggle OSD over MSP. ArduPilot calls this DisplayPort — SERIALn_PROTOCOL 42, not MSP.'
          : mapping.note
      })
    }
  }
  return suggestions
}
