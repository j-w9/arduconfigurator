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

export interface BetaflightPortSuggestion {
  /** Betaflight's own serial identifier, as shown in its Ports tab. */
  identifier: number
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

export function buildBetaflightPortSuggestions(
  ports: readonly MspSerialPortConfig[]
): BetaflightPortSuggestion[] {
  const suggestions: BetaflightPortSuggestion[] = []
  for (const port of ports) {
    if (port.functionMask === 0) {
      continue
    }
    for (const mapping of FUNCTION_MAPPINGS) {
      if ((port.functionMask & mapping.bit) === 0) {
        continue
      }
      suggestions.push({
        identifier: port.identifier,
        betaflightFunction: mapping.betaflight,
        ardupilotProtocol: mapping.protocol,
        ardupilotLabel: mapping.label,
        note: mapping.note
      })
    }
  }
  return suggestions
}
