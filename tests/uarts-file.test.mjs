import assert from 'node:assert/strict'
import test from 'node:test'

import { parseUartsFile } from '../packages/ardupilot-core/dist/index.js'

// A real @SYS/uarts.txt line, in the format AP_HAL_ChibiOS/UARTDriver.cpp
// actually prints:
//
//   TX%c=%8u RX%c=%8u TXBD=%6u RXBD=%6u RXDRP=%8u [FE OE NE] FlowCtrl=%u
//
// The parser used to anchor on `RXBD=(\d+)$`, so it never matched any of this —
// every port fell through to the name-only branch and came back with
// txActive/rxActive hardcoded false and no counters. The Ports tab's traffic
// summary therefore read "Idle" on every port of every real board.
const REAL_UARTS = [
  'UARTV1',
  'SERIAL0 OTG1    TX =    120 RX =     18 TXBD=     0 RXBD=     0 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=0',
  'SERIAL1 UART7   TX =    802 RX =    155 TXBD=  1200 RXBD=   300 RXDRP=      12 FE=0 OE=0 NE=0 FlowCtrl=0',
  'SERIAL2 UART5   TX*=     63 RX*=      0 TXBD=   128 RXBD=     0 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=0',
  'SERIAL3 USART1  TX =      0 RX =      0 TXBD=     0 RXBD=     0 RXDRP=       0 FE=0 OE=0 NE=0 FlowCtrl=0'
].join('\n')

test('uarts.txt parses the format ArduPilot actually prints', () => {
  const ports = parseUartsFile(REAL_UARTS)
  assert.equal(ports.length, 4)

  const [serial0, serial1, serial2, serial3] = ports
  assert.equal(serial0.hardwarePort, 'OTG1')
  assert.equal(serial0.txBytes, 120)
  assert.equal(serial0.rxBytes, 18)

  // TX/RX are the change since the last read (StatsTracker::update), so a
  // non-zero count is the activity signal.
  assert.equal(serial1.txActive, true)
  assert.equal(serial1.rxActive, true)
  assert.equal(serial3.txActive, false)
  assert.equal(serial3.rxActive, false)
})

test('the asterisk is DMA, not activity', () => {
  // SERIAL2 prints TX*/RX* and has RX = 0. The star says the port has DMA
  // enabled; reading it as "active" would light up a port moving no bytes.
  const serial2 = parseUartsFile(REAL_UARTS)[2]
  assert.equal(serial2.txDma, true)
  assert.equal(serial2.rxDma, true)
  assert.equal(serial2.txActive, true, 'TX moved 63 bytes')
  assert.equal(serial2.rxActive, false, 'RX moved none, despite the star')
})

test('TXBD/RXBD are throughput and RXDRP is the drop counter', () => {
  // These were read as "buffer drops" and summarised to the operator as such,
  // so a busy port reported drops it never had. UARTDriver.cpp computes them as
  // (bytes * 10000) / dt_ms — a rate. The real dropped-byte counter is RXDRP.
  const serial1 = parseUartsFile(REAL_UARTS)[1]
  assert.equal(serial1.txThroughput, 1200)
  assert.equal(serial1.rxThroughput, 300)
  assert.equal(serial1.rxDroppedBytes, 12)
})

test('a line without the counters still yields the port name', () => {
  // FE/OE/NE are compiled out when CH_CFG_USE_EVENTS is off, and some builds
  // print a bare mapping. Neither should lose the port.
  const ports = parseUartsFile(
    ['UARTV1', 'SERIAL4 UART8   TX =     10 RX =      5 TXBD=     0 RXBD=     0 RXDRP=       0 FlowCtrl=0', 'SERIAL5 USART2'].join('\n')
  )
  assert.equal(ports.length, 2)
  assert.equal(ports[0].txActive, true, 'parses without the FE/OE/NE block')
  assert.equal(ports[1].hardwarePort, 'USART2')
  assert.equal(ports[1].txActive, false)
})
