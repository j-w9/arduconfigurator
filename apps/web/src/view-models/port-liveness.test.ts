import { describe, expect, it } from 'vitest'
import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'

import { derivePortLiveness } from './port-liveness'

// Protocol values from ARDUCOPTER_SERIAL_PROTOCOL_LABELS (AP_SerialManager.cpp):
// 5 GPS, 9 Rangefinder, 16 ESC Telemetry, 23 RCIN, 37 SmartAudio, 42 DisplayPort.

function snapshotWith(live: Record<string, unknown> = {}): ConfiguratorSnapshot {
  return {
    liveVerification: {
      gpsReceiver: { detected: false },
      rcInput: { verified: false, channelCount: 0, channels: [] },
      escTelemetry: { everReported: false, escs: [] },
      rangefinder: { verified: false },
      ...live
    }
  } as unknown as ConfiguratorSnapshot
}

describe('derivePortLiveness', () => {
  it('believes the peripheral over the byte counter', () => {
    // "Is the GPS working" is answered by satellites, not by UART bytes — and
    // it answers even when the port's counter says nothing arrived this window.
    const verdict = derivePortLiveness(
      snapshotWith({ gpsReceiver: { detected: true, satellitesVisible: 12 } }),
      5,
      false
    )
    expect(verdict.state).toBe('working')
    expect(verdict.detail).toBe('12 satellites')
  })

  it('reports the receiver by its channel count', () => {
    const verdict = derivePortLiveness(
      snapshotWith({ rcInput: { verified: true, channelCount: 16, channels: [] } }),
      23,
      false
    )
    expect(verdict).toEqual({ state: 'working', detail: '16 channels' })
  })

  it('does not call an output-driven port silent', () => {
    // A SmartAudio VTX is mostly talked AT. Calling a working one "silent"
    // would cry wolf, which is the whole reason this is a third state rather
    // than a second guess.
    expect(derivePortLiveness(snapshotWith(), 37, false).state).toBe('output-only')
    expect(derivePortLiveness(snapshotWith(), 42, false).state).toBe('output-only')
  })

  it('DOES call a listening port silent when nothing arrives', () => {
    // A GPS port with no GPS telemetry and no inbound bytes is genuinely
    // suspicious — that is the case worth flagging.
    const verdict = derivePortLiveness(snapshotWith(), 5, false)
    expect(verdict.state).toBe('silent')
    expect(verdict.detail).toMatch(/nothing is arriving/)
  })

  it('separates "unused" from "broken"', () => {
    expect(derivePortLiveness(snapshotWith(), 0, false).detail).toBe('not configured')
  })

  it('says unknown when uarts.txt gave us nothing', () => {
    // No counter and no protocol telemetry is not evidence of absence — the
    // dot is absent rather than wrong.
    expect(derivePortLiveness(snapshotWith(), 2, undefined).state).toBe('unknown')
  })

  it('falls back to inbound bytes for protocols with no telemetry of their own', () => {
    // MAVLink on a telemetry radio: bytes arriving is the right signal, since
    // there is no "MAVLink is working" sensor to consult.
    expect(derivePortLiveness(snapshotWith(), 2, true)).toEqual({
      state: 'working',
      detail: 'receiving data'
    })
  })
})

describe('half-duplex ports', () => {
  it('says the counters cannot answer, rather than implying the port is quiet', () => {
    // AP_HAL_ChibiOS/UARTDriver.cpp never increments _rx_stats_bytes on a
    // half-duplex port: DMA RX setup is gated on `!half_duplex`, and
    // _rx_timer_tick() returns immediately when half_duplex is set. uarts.txt
    // therefore reports RX = 0 whether or not the peripheral replied — a
    // one-wire VTX answering perfectly looks exactly like one that is unplugged.
    //
    // SERIALn_OPTIONS bit 2 is HalfDuplex (AP_SerialManager.cpp @Bitmask).
    const verdict = derivePortLiveness(snapshotWith(), 37, false, 1 << 2)
    expect(verdict.state).toBe('output-only')
    expect(verdict.detail).toMatch(/half-duplex/i)
    expect(verdict.detail).toMatch(/does not count/i)
  })

  it('still trusts real inbound bytes when a port is NOT half-duplex', () => {
    // Full-duplex SmartAudio wiring does get counted, and bytes arriving are
    // proof — the half-duplex note must not swallow a genuine reply.
    expect(derivePortLiveness(snapshotWith(), 37, true, 0)).toEqual({
      state: 'working',
      detail: 'receiving data'
    })
  })

  it('does not apply the note to other option bits', () => {
    // InvertRX (bit 0) and InvertTX (bit 1) say nothing about RX accounting.
    expect(derivePortLiveness(snapshotWith(), 5, false, 0b11).detail).toMatch(/nothing is arriving/)
  })
})
