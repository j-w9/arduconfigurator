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
/** SerialProtocol_RCIN. ArduPilot permits exactly ONE — see below. */
const PROTOCOL_RCIN = 23

export interface UartPortTraffic {
  /** SERIALn index, as printed by uarts.txt. */
  portNumber: number
  /** Hardware name (UART1, OTG1, EMPTY, ...). */
  hardwarePort: string
  /**
   * Bytes received SINCE THE LAST READ of uarts.txt, not since boot.
   *
   * ArduPilot prints this through `StatsTracker.update()`, documented in
   * AP_HAL/UARTDriver.h as "Take cumulative bytes and return the change since
   * last call". The tracker lives on the flight controller and persists across
   * GCS connections, so on any read after the first of a given boot this is a
   * short window — often a fraction of a second's traffic.
   */
  rxBytes: number
  txBytes: number
  /**
   * Framing errors SINCE BOOT — a raw cumulative counter
   * (`_rx_stats_framing_errors`, AP_HAL_ChibiOS/UARTDriver.cpp), never reset.
   *
   * DIFFERENT UNITS FROM rxBytes ABOVE, which is the whole trap: comparing
   * this directly against a windowed byte count asks "have there ever been
   * errors" while pretending to ask "are there errors now".
   */
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

export type PortFindingKind =
  /** Traffic arriving that the UART cannot frame — a peripheral talking at a
   *  rate or in a protocol the port is not set up for. Reported for ANY
   *  protocol: a receiver on a port already set to RCIN but at the wrong baud
   *  looks correctly configured and still cannot work, which is the harder
   *  version of this failure to spot. */
  | 'undecodable'
  /** A disabled port (-1) carrying real traffic — something is wired to a port
   *  the flight controller ignores entirely. */
  | 'unclaimed'

export interface UnconfiguredPortFinding {
  portNumber: number
  hardwarePort: string
  rxBytes: number
  framingErrors: number
  /** The SERIALn_PROTOCOL currently set. */
  protocolValue: number
  /** True when the traffic is arriving but cannot be framed. */
  garbled: boolean
  kind: PortFindingKind
}

export interface SetupPortsEvidenceInputs {
  rawText: string | undefined
  /**
   * The PREVIOUS uarts.txt body, so framing errors can be differenced over the
   * same window the byte counts already cover. Undefined until a second sample
   * exists, and while it is undefined no port is judged undecodable.
   */
  previousRawText?: string
  /** SERIALn_PROTOCOL by port number, as synced. */
  protocolByPort: Record<number, number | undefined>
  /** Ignore ports below this many received bytes — avoids flagging a stray
   *  line-noise byte on a genuinely empty pad. */
  minimumRxBytes?: number
}

export interface SetupPortsEvidence {
  ports: UartPortTraffic[]
  /** Ports whose traffic cannot be decoded, or which carry traffic while
   *  disabled. */
  unconfigured: UnconfiguredPortFinding[]
  /**
   * SERIALn indices beyond the first that also claim RCIN.
   *
   * AP_SerialManager.cpp permits exactly one RCIN port: the lowest index wins
   * and every later one is refused with "duplicate RCIN not permitted". The
   * refusal appears only in a boot STATUSTEXT, so a receiver moved to a second
   * port looks correctly configured and is silently ignored.
   */
  duplicateRcinPorts: number[]
  /** True when uarts.txt was unavailable, so absence of findings proves
   *  nothing and the step must not claim the ports are correct. */
  trafficUnknown: boolean
  /**
   * True while only ONE uarts.txt sample exists, so framing errors cannot yet
   * be differenced and no port has been judged decodable or not. Distinct from
   * trafficUnknown (no counters at all) — here the byte counts are real and
   * only the error verdict is pending.
   */
  decodeVerdictPending: boolean
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
  previousRawText,
  protocolByPort,
  minimumRxBytes = 32
}: SetupPortsEvidenceInputs): SetupPortsEvidence {
  const ports = parseUartTraffic(rawText)
  // Framing errors are cumulative since boot while rxBytes is a per-read
  // delta, so the two are only comparable across a PAIR of samples. Without a
  // previous one there is no honest garbled verdict to give — see below.
  const previousFramingErrors = new Map(
    parseUartTraffic(previousRawText).map((port) => [port.portNumber, port.framingErrors])
  )
  const unconfigured: UnconfiguredPortFinding[] = []

  for (const port of ports) {
    if (port.hardwarePort.toUpperCase().startsWith('OTG') || port.rxBytes < minimumRxBytes) {
      continue
    }
    const protocolValue = protocolByPort[port.portNumber]
    // Unknown is not misconfigured. Judging a port before its SERIALn_PROTOCOL
    // has arrived would fire on every connection during the sync window.
    if (protocolValue === undefined) {
      continue
    }
    // Errors ACCRUED IN THE SAME WINDOW as the bytes, so both sides of the
    // ratio cover the same slice of time.
    //
    // Comparing the lifetime error count against a windowed byte count is what
    // produced a false "cannot decode" on a healthy 460800-baud RC input: an
    // RCIN port accumulates framing errors at boot while AP_RCProtocol
    // auto-detects the protocol, that count never decays, and every later read
    // measured it against a fraction of a second of traffic. The verdict then
    // depended on how much happened to arrive between two reads, so it
    // appeared and disappeared with nothing changed on the aircraft.
    const previousErrors = previousFramingErrors.get(port.portNumber)
    const framingErrorsInWindow =
      previousErrors === undefined ? undefined : Math.max(0, port.framingErrors - previousErrors)
    // No second sample yet: report the port, judge nothing. Silence here is a
    // missing measurement, not a clean bill of health — trafficUnknown and the
    // step's own copy carry that.
    const garbled = framingErrorsInWindow !== undefined && framingErrorsInWindow > port.rxBytes / 10

    if (garbled) {
      // Checked BEFORE the protocol, deliberately. Undecodable traffic is a
      // fault whatever the port claims to be — a receiver on a port already set
      // to RCIN but at the wrong baud reads as correctly configured and still
      // cannot work, which is the version of this that goes undiagnosed.
      unconfigured.push({
        portNumber: port.portNumber,
        hardwarePort: port.hardwarePort,
        rxBytes: port.rxBytes,
        framingErrors: framingErrorsInWindow ?? port.framingErrors,
        protocolValue,
        garbled,
        kind: 'undecodable'
      })
      continue
    }

    // Clean traffic on a configured port is a port doing its job — a telemetry
    // radio, a companion computer, an ATAK link. Only a DISABLED port is
    // suspect, because nothing should be listening there at all.
    if (protocolValue !== PROTOCOL_NONE) {
      continue
    }
    unconfigured.push({
      portNumber: port.portNumber,
      hardwarePort: port.hardwarePort,
      rxBytes: port.rxBytes,
      framingErrors: port.framingErrors,
      protocolValue,
      garbled,
      kind: 'unclaimed'
    })
  }

  // Duplicate RCIN: lowest index wins, the rest are silently refused.
  const rcinPorts = Object.entries(protocolByPort)
    .filter(([, value]) => value === PROTOCOL_RCIN)
    .map(([port]) => Number(port))
    .sort((a, b) => a - b)
  const duplicateRcinPorts = rcinPorts.slice(1)

  return {
    ports,
    unconfigured,
    duplicateRcinPorts,
    trafficUnknown: ports.length === 0,
    decodeVerdictPending: ports.length > 0 && previousFramingErrors.size === 0
  }
}

/** One-line description of a finding, for the wizard's evidence pills. */
export function describeUnconfiguredPort(finding: UnconfiguredPortFinding): string {
  if (finding.kind === 'unclaimed') {
    return `SERIAL${finding.portNumber} (${finding.hardwarePort}) is receiving ${finding.rxBytes} bytes but the port is disabled`
  }
  // "in the last sample" is load-bearing: it is what distinguishes errors
  // happening NOW from a boot-time count that never decays.
  return `SERIAL${finding.portNumber} (${finding.hardwarePort}) is receiving ${finding.rxBytes} bytes it cannot decode (${finding.framingErrors} framing errors in the last sample) — check the baud and protocol for whatever is wired there`
}

/** One-line description of the duplicate-RCIN condition. */
export function describeDuplicateRcin(duplicateRcinPorts: readonly number[]): string {
  const list = duplicateRcinPorts.map((port) => `SERIAL${port}`).join(', ')
  return `${list} also set to RCIN — ArduPilot uses only the lowest-numbered RC input port and silently ignores the rest`
}
