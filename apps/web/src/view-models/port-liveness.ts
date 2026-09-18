// Is anything actually on this port?
//
// A byte counter answers that badly. Counting TX lit every configured port on
// an unsoldered board, because ArduPilot transmits whether or not anything
// listens. Counting only RX fixed that but left a second hole: a SmartAudio VTX
// or a DisplayPort OSD is mostly talked AT, so a working one can look idle.
//
// The better evidence is already arriving. "Is the GPS working" is answered by
// twelve satellites, not by UART bytes — so the port's PROTOCOL picks which
// signal to believe, and the byte counter is the fallback rather than the rule.
//
// Three states, because two of them would be a guess:
//
//   working      the protocol's own telemetry is arriving
//   output-only  ArduPilot drives this port; nothing inbound can confirm it
//   silent       inbound traffic was expected and there is none — suspicious
//   unknown      no evidence either way (uarts.txt absent, protocol unset)

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

export type PortLiveness = 'working' | 'output-only' | 'silent' | 'unknown'

export interface PortLivenessVerdict {
  state: PortLiveness
  /** Short, specific: "12 satellites", "16 channels", "RX 155 bytes". */
  detail?: string
}

/**
 * SERIALn_OPTIONS bit 2, "HalfDuplex" — one-wire, TX and RX share the pin.
 * AP_SerialManager.cpp: "@Bitmask: 0:InvertRX, 1:InvertTX, 2:HalfDuplex, …".
 */
const SERIAL_OPTION_HALF_DUPLEX = 1 << 2

/**
 * Protocols ArduPilot DRIVES, where silence proves nothing.
 *
 * SmartAudio is the interesting one: it is half-duplex bidirectional, so a
 * correctly wired VTX does answer. It sits here anyway because the reply is
 * occasional rather than streaming — a quiet sample is normal, and calling that
 * "silent" would cry wolf on a working VTX.
 *
 * Values from ARDUCOPTER_SERIAL_PROTOCOL_LABELS (AP_SerialManager.cpp):
 * 37 SmartAudio, 42 DisplayPort, 32 MSP, 29 Crossfire VTX, 20 NMEA Output,
 * 15 SBus Servo Out, 14 Volz, 19 RobotisServo.
 */
const OUTPUT_DRIVEN_PROTOCOLS = new Set([14, 15, 19, 20, 29, 32, 37, 42])

/** GPS (5), RCIN (23), ESC Telemetry (16), Rangefinder (9). */
const PROTOCOL_GPS = 5
const PROTOCOL_RANGEFINDER = 9
const PROTOCOL_ESC_TELEMETRY = 16
const PROTOCOL_RCIN = 23

export function derivePortLiveness(
  snapshot: ConfiguratorSnapshot,
  protocolValue: number | undefined,
  rxActive: boolean | undefined,
  optionsValue?: number
): PortLivenessVerdict {
  const live = snapshot.liveVerification

  // Protocol-specific evidence first: it says the PERIPHERAL is working, which
  // is what the operator is actually asking. A byte counter only says the wire
  // is busy.
  switch (protocolValue) {
    case PROTOCOL_GPS: {
      const gps = live.gpsReceiver
      if (gps.detected) {
        const sats = gps.satellitesVisible
        return { state: 'working', detail: sats !== undefined ? `${sats} satellites` : 'GPS reporting' }
      }
      break
    }
    case PROTOCOL_RCIN: {
      const rc = live.rcInput
      if (rc.verified && rc.channelCount > 0) {
        return { state: 'working', detail: `${rc.channelCount} channels` }
      }
      break
    }
    case PROTOCOL_ESC_TELEMETRY: {
      const esc = live.escTelemetry
      if (esc.everReported && esc.escs.length > 0) {
        return { state: 'working', detail: `${esc.escs.length} ESCs reporting` }
      }
      break
    }
    case PROTOCOL_RANGEFINDER: {
      const rangefinder = live.rangefinder
      if (rangefinder.verified) {
        return {
          state: 'working',
          detail:
            rangefinder.distanceM !== undefined
              ? `${rangefinder.distanceM.toFixed(2)} m`
              : 'rangefinder reporting'
        }
      }
      break
    }
    default:
      break
  }

  // No telemetry of its own. Bytes arriving still prove something is talking.
  if (rxActive) {
    return { state: 'working', detail: 'receiving data' }
  }

  // Half-duplex cannot be judged from the byte counters AT ALL, and saying so
  // beats implying the port is quiet.
  //
  // AP_HAL_ChibiOS/UARTDriver.cpp never increments _rx_stats_bytes on a
  // half-duplex port: DMA RX setup is gated on `!half_duplex`, and
  // _rx_timer_tick() returns immediately when half_duplex is set. So uarts.txt
  // reports RX = 0 whether or not the peripheral replied — a one-wire VTX that
  // is answering perfectly looks identical to one that is not plugged in.
  if (optionsValue !== undefined && (optionsValue & SERIAL_OPTION_HALF_DUPLEX) !== 0) {
    return { state: 'output-only', detail: 'half-duplex — ArduPilot does not count received bytes here' }
  }

  // Nothing inbound. Whether that is suspicious depends entirely on whether
  // anything was supposed to arrive.
  if (protocolValue !== undefined && OUTPUT_DRIVEN_PROTOCOLS.has(protocolValue)) {
    return { state: 'output-only', detail: 'ArduPilot drives this port' }
  }

  // uarts.txt never arrived, so there is no counter to read and no verdict to
  // give — deliberately not the same as "nothing is connected".
  if (rxActive === undefined) {
    return { state: 'unknown' }
  }

  // An unconfigured port is not suspicious, it is just unused.
  if (protocolValue === undefined || protocolValue <= 0) {
    return { state: 'silent', detail: 'not configured' }
  }

  return { state: 'silent', detail: 'configured, but nothing is arriving' }
}
