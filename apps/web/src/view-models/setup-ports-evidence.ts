// Guided-setup Ports step evidence: what the FC is actually receiving on each
// serial port, versus what that port is configured as.
//
// The motivating failure: a receiver wired to the board's RX pad while
// SERIAL2_PROTOCOL was still 2 (MAVLink2). The bytes arrive, the UART cannot
// frame them, and nothing anywhere says so — the operator sees a Radio step
// that simply never completes. @SYS/uarts.txt already carries per-port RX/TX
// byte counts and framing-error counts, so the wizard can name the mismatch
// instead of leaving it to be discovered with a logic analyser.
//
// Pure parsing + comparison: no runtime, no MAVLink, no React.

/** SERIALn_PROTOCOL values that mean "nothing meaningful is expected here". */
const PROTOCOL_NONE = -1
/** SERIALn_PROTOCOL = 2 is MAVLink2 — the default on unused ports, and so the
 *  overwhelmingly common value to find still sitting on a port that has had a
 *  peripheral soldered to it. */
const PROTOCOL_MAVLINK2 = 2

export interface UartPortTraffic {
  /** SERIALn index, as printed by uarts.txt. */
  portNumber: number
  /** Hardware name (UART1, OTG1, EMPTY, ...). */
  hardwarePort: string
  rxBytes: number
  txBytes: number
  /** Framing errors — high relative to rxBytes means the UART cannot frame
   *  what is arriving, i.e. a baud or protocol mismatch rather than silence. */
  framingErrors: number
}

/**
 * Parse the per-port counters out of an @SYS/uarts.txt body.
 *
 * Lines look like:
 *   SERIAL2 UART2 TX =    1322 RX*=      39 TXBD=   232 RXBD=     6 RXDRP= 0 FE=80357 ...
 * The `*` marks a DMA-enabled direction and is not otherwise significant here.
 * Note the space before `=` on the non-DMA form (`RX =`) but not the DMA form
 * (`RX*=`), hence the optional whitespace on both sides.
 */
export function parseUartTraffic(rawText: string | undefined): UartPortTraffic[] {
  if (!rawText) {
    return []
  }

  const ports: UartPortTraffic[] = []
  for (const line of rawText.split('\n')) {
    const match = /^SERIAL(\d+)\s+(\S+)/.exec(line.trim())
    if (!match) {
      continue
    }
    // An unpopulated slot prints "SERIAL5 EMPTY" with no counters at all.
    const rx = /RX\*?\s*=\s*(\d+)/.exec(line)
    const tx = /TX\*?\s*=\s*(\d+)/.exec(line)
    if (!rx || !tx) {
      continue
    }
    const fe = /FE=(\d+)/.exec(line)
    ports.push({
      portNumber: Number(match[1]),
      hardwarePort: match[2],
      rxBytes: Number(rx[1]),
      txBytes: Number(tx[1]),
      framingErrors: fe ? Number(fe[1]) : 0
    })
  }
  return ports
}

export interface UnconfiguredPortFinding {
  portNumber: number
  hardwarePort: string
  rxBytes: number
  framingErrors: number
  /** The SERIALn_PROTOCOL currently set, or undefined if not synced. */
  protocolValue: number | undefined
  /** True when the traffic is arriving but cannot be framed — the signature of
   *  a peripheral talking at a rate/protocol the port is not set up for. */
  garbled: boolean
}

export interface SetupPortsEvidenceInputs {
  rawText: string | undefined
  /** SERIALn_PROTOCOL by port number, as synced. */
  protocolByPort: Record<number, number | undefined>
  /** Ignore ports below this many received bytes — avoids flagging a stray
   *  line-noise byte on a genuinely empty pad. */
  minimumRxBytes?: number
}

export interface SetupPortsEvidence {
  ports: UartPortTraffic[]
  /** Ports receiving real traffic while configured as None or MAVLink2. */
  unconfigured: UnconfiguredPortFinding[]
  /** True when uarts.txt was unavailable, so absence of findings proves
   *  nothing and the step must not claim the ports are correct. */
  trafficUnknown: boolean
}

/**
 * Ports that are receiving data while configured as if nothing were attached.
 *
 * USB ports are excluded, identified by their OTG hardware name rather than by
 * index: a board exposes more than one (OTG1 as SERIAL0, OTG2 as SERIAL9 on
 * H743), both legitimately carry MAVLink, and one of them is how the
 * configurator is talking to the vehicle right now. Excluding only SERIAL0
 * reported the second USB port as a misconfigured peripheral.
 */
export function buildSetupPortsEvidence({
  rawText,
  protocolByPort,
  minimumRxBytes = 32
}: SetupPortsEvidenceInputs): SetupPortsEvidence {
  const ports = parseUartTraffic(rawText)
  const unconfigured: UnconfiguredPortFinding[] = []

  for (const port of ports) {
    if (port.hardwarePort.toUpperCase().startsWith('OTG') || port.rxBytes < minimumRxBytes) {
      continue
    }
    const protocolValue = protocolByPort[port.portNumber]
    if (protocolValue !== PROTOCOL_NONE && protocolValue !== PROTOCOL_MAVLINK2) {
      continue
    }
    // A tenth of the received bytes failing to frame is well beyond incidental
    // noise and means the port is mis-clocked for what is on it.
    const garbled = port.framingErrors > port.rxBytes / 10

    // MAVLink2 carrying CLEAN traffic is a port doing its job — a telemetry
    // radio, a companion computer, an ATAK link. Flagging it was wrong: the
    // original failure was a receiver on a MAVLink2 port producing 80357
    // framing errors against 39 bytes, and it is the GARBLE that identifies a
    // mismatch, not the traffic. A working telemetry link is not a
    // misconfiguration, and saying so trains operators to ignore this step.
    //
    // A DISABLED port (-1) is different: nothing should be listening at all, so
    // any real traffic there is worth reporting however cleanly it frames.
    if (protocolValue === PROTOCOL_MAVLINK2 && !garbled) {
      continue
    }

    unconfigured.push({
      portNumber: port.portNumber,
      hardwarePort: port.hardwarePort,
      rxBytes: port.rxBytes,
      framingErrors: port.framingErrors,
      protocolValue,
      garbled
    })
  }

  return { ports, unconfigured, trafficUnknown: ports.length === 0 }
}

/** One-line description of a finding, for the wizard's evidence pills. */
export function describeUnconfiguredPort(finding: UnconfiguredPortFinding): string {
  if (finding.protocolValue === PROTOCOL_NONE) {
    return `SERIAL${finding.portNumber} (${finding.hardwarePort}) is receiving ${finding.rxBytes} bytes but the port is disabled`
  }
  // Only reachable when the stream cannot be framed — a clean MAVLink2 port is
  // not a finding at all.
  return `SERIAL${finding.portNumber} (${finding.hardwarePort}) is receiving ${finding.rxBytes} bytes it cannot decode (${finding.framingErrors} framing errors) while set to MAVLink2`
}
