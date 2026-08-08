import type { EscTelemetryState } from '@arduconfig/ardupilot-core'
import { describe, expect, it } from 'vitest'

import { buildEscRpmReadoutViewModel } from './esc-rpm-readout'

const T0 = 1_700_000_000_000

const QUAD = [
  { motorNumber: 1, outputLabel: 'OUT1' },
  { motorNumber: 2, outputLabel: 'OUT2' },
  { motorNumber: 3, outputLabel: 'OUT3' },
  { motorNumber: 4, outputLabel: 'OUT4' }
]

function esc(escNumber: number, rpm: number, lastSeenAtMs = T0) {
  return {
    escNumber,
    lastSeenAtMs,
    rpm,
    voltageV: 16.1,
    currentA: 2.5,
    consumedMah: 100,
    temperatureC: 31,
    count: 42
  }
}

function telemetry(overrides: Partial<EscTelemetryState> = {}): EscTelemetryState {
  return { everReported: true, lastSeenAtMs: T0, escs: [], ...overrides }
}

describe('buildEscRpmReadoutViewModel', () => {
  it('says the vehicle has no ESC telemetry rather than showing an empty table', () => {
    // The common case: a quad on plain DShot with no telemetry wire. ArduPilot
    // sends nothing at all, and "blank" would read as a fault rather than as
    // "you have not set this up".
    const model = buildEscRpmReadoutViewModel({
      escTelemetry: telemetry({ everReported: false, lastSeenAtMs: undefined }),
      motors: QUAD,
      nowMs: T0
    })
    expect(model.status).toBe('unavailable')
    expect(model.rows).toEqual([])
    expect(model.summary).toMatch(/bidirectional DShot/)
  })

  it('reports live RPM for every motor when all ESCs are talking', () => {
    const model = buildEscRpmReadoutViewModel({
      escTelemetry: telemetry({ escs: [esc(1, 8000), esc(2, 8100), esc(3, 8200), esc(4, 8300)] }),
      motors: QUAD,
      nowMs: T0 + 200
    })
    expect(model.status).toBe('live')
    expect(model.rows.map((row) => row.rpm)).toEqual([8000, 8100, 8200, 8300])
    expect(model.rows.every((row) => row.fresh)).toBe(true)
    expect(model.rows[0].outputLabel).toBe('OUT1')
  })

  it('keeps a row for an expected motor whose ESC never reported', () => {
    // Three rows and no fourth would hide the one thing worth noticing.
    const model = buildEscRpmReadoutViewModel({
      escTelemetry: telemetry({ escs: [esc(1, 8000), esc(2, 8100), esc(4, 8300)] }),
      motors: QUAD,
      nowMs: T0
    })
    expect(model.rows).toHaveLength(4)
    const motor3 = model.rows.find((row) => row.motorNumber === 3)
    expect(motor3?.rpm).toBeUndefined()
    expect(motor3?.fresh).toBe(false)
    expect(model.summary).toMatch(/1 expected motor is not reporting/)
  })

  it('marks readings stale rather than freezing at the last RPM', () => {
    // A motor that has spun down still holds its last reported RPM. Rendering
    // that as a live number would say "still spinning" about a stopped motor.
    const model = buildEscRpmReadoutViewModel({
      escTelemetry: telemetry({ escs: [esc(1, 8000, T0), esc(2, 8100, T0)] }),
      motors: QUAD.slice(0, 2),
      nowMs: T0 + 5_000
    })
    expect(model.status).toBe('stale')
    expect(model.rows.every((row) => row.fresh)).toBe(false)
    expect(model.rows[0].rpm).toBe(8000)
  })

  it('shows an ESC reporting on a motor number the frame did not expect', () => {
    const model = buildEscRpmReadoutViewModel({
      escTelemetry: telemetry({ escs: [esc(1, 8000), esc(9, 500)] }),
      motors: QUAD.slice(0, 1),
      nowMs: T0
    })
    expect(model.rows.map((row) => row.motorNumber)).toEqual([1, 9])
    expect(model.rows[1].outputLabel).toBeUndefined()
  })

  it('falls back to the reporting ESCs when the frame is not known yet', () => {
    const model = buildEscRpmReadoutViewModel({
      escTelemetry: telemetry({ escs: [esc(1, 8000), esc(2, 8100)] }),
      motors: [],
      nowMs: T0
    })
    expect(model.status).toBe('live')
    expect(model.rows).toHaveLength(2)
  })
})
