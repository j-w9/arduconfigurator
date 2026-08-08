import { describe, expect, it } from 'vitest'

import {
  buildSetupPortsEvidence,
  describeDuplicateRcin,
  describeUnconfiguredPort,
  parseUartTraffic
} from './setup-ports-evidence'

// Captured verbatim from a real BROTHERHOBBYH743 with an ELRS receiver wired to
// the RX/SBUS pad (SERIAL2) while SERIAL2_PROTOCOL was still 2 (MAVLink2). The
// 80357 framing errors against 39 received bytes are what a 420000-baud CRSF
// stream looks like sampled at 57600.
const REAL_UARTS_TXT = `UARTV1
SERIAL0 OTG1  TX =  106511 RX =    3410 TXBD= 18692 RXBD=   598 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=1
SERIAL1 UART1 TX =       0 RX =      29 TXBD=     0 RXBD=     5 RXDRP=       0 FE=429 OE=0 NE=0 FlowCtrl=0
SERIAL2 UART2 TX =    1322 RX*=      39 TXBD=   232 RXBD=     6 RXDRP=       0 FE=80357 OE=0 NE=81339 FlowCtrl=0
SERIAL3 UART3 TX =       0 RX*=       0 TXBD=     0 RXBD=     0 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=0
SERIAL5 EMPTY
SERIAL7 UART7 TX =       0 RX =       0 TXBD=     0 RXBD=     0 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=0
`

describe('parseUartTraffic', () => {
  it('reads the per-port counters, DMA marker and all', () => {
    const ports = parseUartTraffic(REAL_UARTS_TXT)
    const serial2 = ports.find((port) => port.portNumber === 2)
    expect(serial2).toEqual({
      portNumber: 2,
      hardwarePort: 'UART2',
      rxBytes: 39,
      txBytes: 1322,
      framingErrors: 80357
    })
  })

  it('skips an unpopulated slot that prints no counters', () => {
    expect(parseUartTraffic(REAL_UARTS_TXT).some((port) => port.portNumber === 5)).toBe(false)
  })

  it('returns nothing when the file was never fetched', () => {
    expect(parseUartTraffic(undefined)).toEqual([])
    expect(parseUartTraffic('')).toEqual([])
  })
})

/**
 * A prior sample in which NO port had yet recorded a framing error.
 *
 * Every "is this port garbled" test needs one, because framing errors are
 * cumulative since boot while byte counts are per-read deltas — only a pair of
 * samples puts both on the same window. Differencing against a zero baseline
 * attributes all the errors to the window, which is what these fixtures mean.
 */
const NO_PRIOR_ERRORS = (rawText: string): string => rawText.replace(/FE=\d+/g, 'FE=0')

describe('buildSetupPortsEvidence', () => {
  it('flags a port receiving UNDECODABLE traffic while set to MAVLink2', () => {
    // The reported case: receiver wired to SERIAL2, port still MAVLink2, and
    // the stream unframeable as a result.
    const evidence = buildSetupPortsEvidence({
      rawText: REAL_UARTS_TXT,
      previousRawText: NO_PRIOR_ERRORS(REAL_UARTS_TXT),
      protocolByPort: { 0: 2, 1: 23, 2: 2, 3: 5, 7: -1 },
      minimumRxBytes: 8
    })
    // SERIAL1 (429 framing errors on 29 bytes) is garbled too and is now
    // reported alongside SERIAL2 — both are genuinely undecodable, and the
    // narrower check used to skip SERIAL1 purely because it was set to RCIN.
    const flagged = evidence.unconfigured.filter((finding) => finding.portNumber === 2)
    expect(flagged).toHaveLength(1)
    expect(flagged[0].garbled).toBe(true)
    expect(flagged[0].kind).toBe('undecodable')
  })

  it('never flags a second USB port either (OTG2 / SERIAL9)', () => {
    // Field report: SERIAL9 (OTG2) was reported as a misconfigured peripheral.
    // H743 boards expose two USB ports; both legitimately carry MAVLink, and
    // excluding only SERIAL0 by index missed the other one.
    const twoUsbPorts = `UARTV1
SERIAL0 OTG1  TX =  106511 RX =    3410 TXBD= 18692 RXBD=   598 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=1
SERIAL9 OTG2  TX =       0 RX =    1128 TXBD=     0 RXBD=   235 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=1
`
    const evidence = buildSetupPortsEvidence({
      rawText: twoUsbPorts,
      protocolByPort: { 0: 2, 9: 2 }
    })
    expect(evidence.unconfigured).toEqual([])
  })

  it('does NOT flag a MAVLink2 port carrying clean traffic — that is a working link', () => {
    // Field report: SERIAL7 (TELEM2) was deliberately MAVLink2 for an ATAK
    // integration and was flagged as misconfigured simply for carrying data.
    // A telemetry radio, companion computer or ATAK link is a port doing its
    // job. It is the GARBLE that identifies a mismatch, not the traffic —
    // calling a working link broken trains operators to ignore this step.
    const withTelemetry = `UARTV1
SERIAL0 OTG1  TX =  106511 RX =    3410 TXBD= 18692 RXBD=   598 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=1
SERIAL7 UART7 TX =   40000 RX =   40061 TXBD=  6600 RXBD=  6677 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=0
SERIAL9 OTG2  TX =       0 RX =    1128 TXBD=     0 RXBD=   235 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=1
`
    const evidence = buildSetupPortsEvidence({
      rawText: withTelemetry,
      protocolByPort: { 0: 2, 7: 2, 9: 2 }
    })
    expect(evidence.unconfigured).toEqual([])
  })

  it('DOES flag a MAVLink2 port whose traffic cannot be framed', () => {
    // The original motivating failure: a receiver wired to a pad still set to
    // MAVLink2, producing far more framing errors than bytes.
    const evidence = buildSetupPortsEvidence({
      rawText: REAL_UARTS_TXT,
      previousRawText: NO_PRIOR_ERRORS(REAL_UARTS_TXT),
      protocolByPort: { 0: 2, 2: 2 },
      minimumRxBytes: 8
    })
    expect(evidence.unconfigured.map((finding) => finding.portNumber)).toEqual([2])
    expect(evidence.unconfigured[0].garbled).toBe(true)
  })

  // The gap that made this widening worth doing: SERIAL2 sat at PROTOCOL=23
  // (RCIN) baud 420 for hours, receiving 4867 bytes with 1508 framing errors,
  // and the step said nothing — because it only ever examined ports set to -1
  // or MAVLink2. A correctly-protocol'd port that still cannot decode its
  // peripheral is the version of this failure nobody suspects.
  it('flags undecodable traffic on a port whose protocol is already RCIN', () => {
    const rcinWrongBaud = `UARTV1
SERIAL2 UART2 TX =       0 RX*=    4867 TXBD=     0 RXBD=  3163 RXDRP=       0 FE=1508 OE=0 NE=1400 FlowCtrl=0
`
    const evidence = buildSetupPortsEvidence({
      rawText: rcinWrongBaud,
      previousRawText: NO_PRIOR_ERRORS(rcinWrongBaud),
      protocolByPort: { 2: 23 }
    })
    expect(evidence.unconfigured.map((finding) => finding.portNumber)).toEqual([2])
    expect(evidence.unconfigured[0].kind).toBe('undecodable')
    expect(describeUnconfiguredPort(evidence.unconfigured[0])).toContain('cannot decode')
  })

  it('leaves a clean RCIN port alone', () => {
    const healthyRcin = `UARTV1
SERIAL2 UART2 TX =     500 RX*=   40000 TXBD=    80 RXBD=  6600 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=0
`
    const evidence = buildSetupPortsEvidence({ rawText: healthyRcin, protocolByPort: { 2: 23 } })
    expect(evidence.unconfigured).toEqual([])
  })

  it('flags a DISABLED port carrying traffic however cleanly it frames', () => {
    // Nothing should be listening on a -1 port, so clean traffic there is still
    // worth reporting — unlike MAVLink2, which is a legitimate listener.
    const cleanOnDisabled = `UARTV1
SERIAL3 UART3 TX =       0 RX =    9000 TXBD=     0 RXBD=  1500 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=0
`
    const evidence = buildSetupPortsEvidence({
      rawText: cleanOnDisabled,
      protocolByPort: { 3: -1 }
    })
    expect(evidence.unconfigured.map((finding) => finding.portNumber)).toEqual([3])
    expect(describeUnconfiguredPort(evidence.unconfigured[0])).toContain('the port is disabled')
  })

  it('never flags SERIAL0 — that is the USB link we are talking over', () => {
    const evidence = buildSetupPortsEvidence({
      rawText: REAL_UARTS_TXT,
      protocolByPort: { 0: 2, 1: 23, 2: 23, 3: 5 }
    })
    expect(evidence.unconfigured.some((finding) => finding.portNumber === 0)).toBe(false)
  })

  it('stays quiet once the port is configured AND its traffic decodes', () => {
    // Setting the protocol is not on its own sufficient: SERIAL2 in the real
    // capture is set to RCIN and still cannot frame what arrives, so the quiet
    // case needs clean counters too.
    const healthy = `UARTV1
SERIAL0 OTG1  TX =  106511 RX =    3410 TXBD= 18692 RXBD=   598 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=1
SERIAL2 UART2 TX =     500 RX*=   40000 TXBD=    80 RXBD=  6600 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=0
SERIAL3 UART3 TX =       0 RX*=    9000 TXBD=     0 RXBD=  1500 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=0
`
    const evidence = buildSetupPortsEvidence({
      rawText: healthy,
      protocolByPort: { 0: 2, 2: 23, 3: 5 }
    })
    expect(evidence.unconfigured).toEqual([])
  })

  it('ignores a stray byte on an otherwise dead pad', () => {
    // SERIAL1 has 29 bytes and is set to RCIN here; drop the threshold and it
    // would still not qualify, but a disabled port with a couple of noise bytes
    // must not raise a finding either.
    const evidence = buildSetupPortsEvidence({
      rawText: REAL_UARTS_TXT,
      protocolByPort: { 1: -1, 2: 23 },
      minimumRxBytes: 32
    })
    // Scoped to SERIAL1: SERIAL2 in this capture is genuinely undecodable and
    // is reported on its own merits.
    expect(evidence.unconfigured.some((finding) => finding.portNumber === 1)).toBe(false)
  })

  it('reports traffic as unknown when uarts.txt was unavailable', () => {
    // Absence of findings must not be presentable as "ports are correct".
    const evidence = buildSetupPortsEvidence({ rawText: undefined, protocolByPort: {} })
    expect(evidence.trafficUnknown).toBe(true)
    expect(evidence.unconfigured).toEqual([])
  })

  it('does not report traffic as unknown once ports were parsed', () => {
    expect(
      buildSetupPortsEvidence({ rawText: REAL_UARTS_TXT, protocolByPort: {} }).trafficUnknown
    ).toBe(false)
  })

  // AP_SerialManager.cpp: exactly one RCIN port is permitted, the lowest index
  // wins, and later ones are refused with a boot STATUSTEXT nobody reads. A
  // receiver moved to a second port therefore looks configured and is ignored.
  it('reports every RCIN port beyond the first, lowest index winning', () => {
    const evidence = buildSetupPortsEvidence({
      rawText: REAL_UARTS_TXT,
      protocolByPort: { 1: 23, 2: 23, 7: 23 }
    })
    expect(evidence.duplicateRcinPorts).toEqual([2, 7])
    expect(describeDuplicateRcin(evidence.duplicateRcinPorts)).toContain('SERIAL2, SERIAL7')
  })

  it('says nothing when exactly one port claims RC input', () => {
    const evidence = buildSetupPortsEvidence({
      rawText: REAL_UARTS_TXT,
      protocolByPort: { 1: 23, 2: 2, 7: -1 }
    })
    expect(evidence.duplicateRcinPorts).toEqual([])
  })

  it('says nothing about a port whose protocol has not synced yet', () => {
    // Unknown is not the same as misconfigured. Accusing a port of being wrong
    // because its SERIALn_PROTOCOL has not arrived would fire on every
    // connection during the sync window — the same class of mistake as judging
    // stored setup progress against a half-synced snapshot.
    const evidence = buildSetupPortsEvidence({
      rawText: REAL_UARTS_TXT,
      protocolByPort: {},
      minimumRxBytes: 8
    })
    expect(evidence.unconfigured).toEqual([])
  })
})

describe('describeUnconfiguredPort', () => {
  it('says the traffic cannot be DECODED, not merely that the port carries data', () => {
    // Wording matters here: "receiving data but set to MAVLink2" described a
    // working telemetry link just as well as a broken receiver, which is how a
    // deliberate ATAK link on TELEM2 came to be reported as misconfigured.
    const [finding] = buildSetupPortsEvidence({
      rawText: REAL_UARTS_TXT,
      previousRawText: NO_PRIOR_ERRORS(REAL_UARTS_TXT),
      protocolByPort: { 2: 2 },
      minimumRxBytes: 8
    }).unconfigured
    // "in the last sample" is deliberate: the number is now errors accrued in
    // the same window as the byte count, not a since-boot total.
    expect(describeUnconfiguredPort(finding)).toBe(
      'SERIAL2 (UART2) is receiving 39 bytes it cannot decode (80357 framing errors in the last sample) — check the baud and protocol for whatever is wired there'
    )
  })
})

// ── Framing errors are cumulative; byte counts are not ────────────────────
//
// Field report: a healthy 460800-baud RC input on UART7 was reported as
// "receiving 123 bytes it cannot decode (95 framing errors)". The link worked.
//
// @SYS/uarts.txt mixes units. RX is `StatsTracker.update()` — "the change since
// last call" (AP_HAL/UARTDriver.h) — while FE is `_rx_stats_framing_errors`
// printed raw, cumulative since boot and never reset
// (AP_HAL_ChibiOS/UARTDriver.cpp). Comparing the two asks "have there EVER been
// errors" while appearing to ask "are there errors NOW".
//
// An RCIN port accrues framing errors at boot while AP_RCProtocol auto-detects
// the protocol. That count never decays, so every later read measured it
// against a fraction of a second of traffic — and the verdict flipped with how
// much happened to arrive between two reads, appearing and disappearing with
// nothing changed on the aircraft.

describe('framing errors are judged over the same window as the bytes', () => {
  const withCounters = (rx: number, fe: number) =>
    `UARTV1\nSERIAL7 UART7 TX =       0 RX*=${String(rx).padStart(8)} TXBD=     0 RXBD=     0 RXDRP=       0 FE=${fe} OE=0 NE=0 FlowCtrl=0\n`

  it('does not condemn a port whose framing errors are all historic', () => {
    // The exact field case: 95 errors banked at boot, 123 bytes in this window,
    // and NOT ONE new error since the previous sample. The port is healthy.
    const evidence = buildSetupPortsEvidence({
      rawText: withCounters(123, 95),
      previousRawText: withCounters(4000, 95),
      protocolByPort: { 7: 23 }
    })
    expect(evidence.unconfigured).toEqual([])
    expect(evidence.decodeVerdictPending).toBe(false)
  })

  it('still condemns a port whose errors are accruing right now', () => {
    // Same totals, but 60 of the 95 arrived during this window — that is a
    // genuinely mis-clocked port and must still be caught.
    const evidence = buildSetupPortsEvidence({
      rawText: withCounters(123, 95),
      previousRawText: withCounters(4000, 35),
      protocolByPort: { 7: 23 }
    })
    expect(evidence.unconfigured).toHaveLength(1)
    expect(evidence.unconfigured[0].kind).toBe('undecodable')
    // The reported number is the window's errors, not the since-boot total.
    expect(evidence.unconfigured[0].framingErrors).toBe(60)
    expect(describeUnconfiguredPort(evidence.unconfigured[0])).toContain('60 framing errors in the last sample')
  })

  it('judges nothing at all from a single sample, and says so', () => {
    // Silence here would read as "all ports check out". It is a missing
    // measurement, not a clean bill of health.
    const evidence = buildSetupPortsEvidence({
      rawText: withCounters(123, 95),
      protocolByPort: { 7: 23 }
    })
    expect(evidence.unconfigured).toEqual([])
    expect(evidence.decodeVerdictPending).toBe(true)
  })

  it('treats a counter that went backwards as zero errors, not a huge negative', () => {
    // The FC rebooted between samples, so the cumulative counter restarted.
    const evidence = buildSetupPortsEvidence({
      rawText: withCounters(123, 5),
      previousRawText: withCounters(4000, 900),
      protocolByPort: { 7: 23 }
    })
    expect(evidence.unconfigured).toEqual([])
  })

  it('does not report a decode verdict as pending once a second sample exists', () => {
    const evidence = buildSetupPortsEvidence({
      rawText: withCounters(4000, 0),
      previousRawText: withCounters(4000, 0),
      protocolByPort: { 7: 23 }
    })
    expect(evidence.decodeVerdictPending).toBe(false)
    expect(evidence.unconfigured).toEqual([])
  })
})
