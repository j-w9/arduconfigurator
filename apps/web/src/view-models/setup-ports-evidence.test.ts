import { describe, expect, it } from 'vitest'

import {
  buildSetupPortsEvidence,
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

describe('buildSetupPortsEvidence', () => {
  it('flags a port receiving real traffic while set to MAVLink2', () => {
    // The reported case: receiver wired to SERIAL2, port still MAVLink2.
    const evidence = buildSetupPortsEvidence({
      rawText: REAL_UARTS_TXT,
      protocolByPort: { 0: 2, 1: 23, 2: 2, 3: 5, 7: -1 },
      minimumRxBytes: 8
    })
    expect(evidence.unconfigured).toHaveLength(1)
    expect(evidence.unconfigured[0].portNumber).toBe(2)
    expect(evidence.unconfigured[0].garbled).toBe(true)
  })

  it('never flags SERIAL0 — that is the USB link we are talking over', () => {
    const evidence = buildSetupPortsEvidence({
      rawText: REAL_UARTS_TXT,
      protocolByPort: { 0: 2, 1: 23, 2: 23, 3: 5 }
    })
    expect(evidence.unconfigured.some((finding) => finding.portNumber === 0)).toBe(false)
  })

  it('stays quiet once the port is configured for what is on it', () => {
    const evidence = buildSetupPortsEvidence({
      rawText: REAL_UARTS_TXT,
      protocolByPort: { 0: 2, 1: 23, 2: 23, 3: 5, 7: -1 }
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
    expect(evidence.unconfigured).toEqual([])
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
  it('names the port, the traffic and what it is wrongly set to', () => {
    const [finding] = buildSetupPortsEvidence({
      rawText: REAL_UARTS_TXT,
      protocolByPort: { 2: 2 },
      minimumRxBytes: 8
    }).unconfigured
    expect(describeUnconfiguredPort(finding)).toBe(
      'SERIAL2 (UART2) is receiving 39 bytes, 80357 framing errors but is set to MAVLink2'
    )
  })
})
