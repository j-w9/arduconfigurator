import { describe, expect, it } from 'vitest'

import { detectElrsSerialPorts, ELRS_CRSF_PROTOCOL, ELRS_RCIN_PROTOCOL } from './elrs-flash'

function snapshotWith(protocols: Record<string, number>): any {
  return {
    parameters: Object.entries(protocols).map(([id, value]) => ({ id, value, definition: undefined }))
  }
}

describe('detectElrsSerialPorts', () => {
  it('finds RCIN (23) and CRSF (29) ports, sorted by port number', () => {
    const snapshot = snapshotWith({
      SERIAL5_PROTOCOL: ELRS_CRSF_PROTOCOL,
      SERIAL2_PROTOCOL: ELRS_RCIN_PROTOCOL,
      SERIAL1_PROTOCOL: 2 // MAVLink — ignored
    })
    expect(detectElrsSerialPorts(snapshot)).toEqual([
      { portNumber: 2, protocolValue: 23, protocolLabel: 'RC Input (CRSF/ELRS)' },
      { portNumber: 5, protocolValue: 29, protocolLabel: 'CRSF' }
    ])
  })

  it('is empty when no UART carries an ELRS-capable protocol', () => {
    expect(detectElrsSerialPorts(snapshotWith({ SERIAL1_PROTOCOL: 2, SERIAL3_PROTOCOL: 5 }))).toEqual([])
  })

  it('rounds float-widened protocol values and ignores non-PROTOCOL params', () => {
    const snapshot = snapshotWith({ SERIAL6_PROTOCOL: 23.0000001, SERIAL6_BAUD: 23 })
    expect(detectElrsSerialPorts(snapshot)).toEqual([
      { portNumber: 6, protocolValue: 23, protocolLabel: 'RC Input (CRSF/ELRS)' }
    ])
  })
})
