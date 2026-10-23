import { describe, expect, it } from 'vitest'

import type { WebSerialPortLike } from '@arduconfig/transport'

import { selectGrantedSerialPort } from './use-transport-selection'

// Every ArduPilot board enumerates with the same USB ids, so two boards are
// two ports that look identical to a lookup by id.
const ARDUPILOT = { usbVendorId: 0x1209, usbProductId: 0x5741 }
const fakePort = (id: string, info = ARDUPILOT): WebSerialPortLike =>
  ({ id, getInfo: () => info, readable: null, writable: null, open: async () => {}, close: async () => {} }) as unknown as WebSerialPortLike

describe('selectGrantedSerialPort', () => {
  it('keeps the port the operator picked while the browser still lists it, over an earlier identical board', () => {
    const boardA = fakePort('a')
    const boardB = fakePort('b')
    expect(selectGrantedSerialPort([boardA, boardB], boardB, ARDUPILOT)).toEqual({ port: boardB, matched: true })
  })

  it('falls back to the remembered ids when there is no pick (a reload), then to the first port', () => {
    const other = fakePort('other', { usbVendorId: 0x0483, usbProductId: 0x5740 })
    const board = fakePort('board')
    expect(selectGrantedSerialPort([other, board], undefined, ARDUPILOT)).toEqual({ port: board, matched: true })
    expect(selectGrantedSerialPort([other], undefined, ARDUPILOT)).toEqual({ port: other, matched: false })
    expect(selectGrantedSerialPort([], undefined, ARDUPILOT)).toEqual({ port: undefined, matched: false })
  })

  it('a pick the browser no longer lists (unplugged) gives way to the id match', () => {
    const gone = fakePort('gone')
    const board = fakePort('board')
    expect(selectGrantedSerialPort([board], gone, ARDUPILOT)).toEqual({ port: board, matched: true })
  })
})
