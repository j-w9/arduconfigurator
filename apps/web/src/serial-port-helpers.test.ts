import { describe, expect, it } from 'vitest'

import {
  describeSerialPortUsage,
  isAnalogVtxControlSerialProtocol,
  isDigitalVtxSerialProtocol,
  isNotificationLedServoFunction,
  isOsdSerialProtocol,
  isReceiverSerialProtocol,
  isVtxControlSerialProtocol,
  parseSerialPortNumber,
  parseServoOutputChannelNumber,
  serialPortDisplayName
} from './serial-port-helpers'

describe('serialPortDisplayName', () => {
  it('names the well-known ports and falls back to "Serial N"', () => {
    expect(serialPortDisplayName(0)).toBe('USB / Console')
    expect(serialPortDisplayName(1)).toBe('Telemetry 1')
    expect(serialPortDisplayName(3)).toBe('GPS / UART3')
    expect(serialPortDisplayName(7)).toBe('Serial 7')
  })
})

describe('describeSerialPortUsage', () => {
  it('maps protocol codes to human descriptions', () => {
    expect(describeSerialPortUsage(-1)).toMatch(/Disabled/)
    expect(describeSerialPortUsage(5)).toMatch(/GPS/)
    expect(describeSerialPortUsage(23)).toMatch(/receiver/i)
    expect(describeSerialPortUsage(42)).toMatch(/DisplayPort|OSD/)
    expect(describeSerialPortUsage(9999)).toBe('Peripheral or accessory link.')
  })
})

describe('protocol classifiers', () => {
  it('recognizes receiver, VTX-control and OSD protocols', () => {
    expect(isReceiverSerialProtocol(23)).toBe(true)
    expect(isReceiverSerialProtocol(18)).toBe(false) // 18 = OpticalFlow, not RC in
    expect(isReceiverSerialProtocol(5)).toBe(false)

    expect(isVtxControlSerialProtocol(29)).toBe(true)
    expect(isVtxControlSerialProtocol(44)).toBe(true) // 44 = IRC Tramp
    expect(isVtxControlSerialProtocol(5)).toBe(false)

    expect(isOsdSerialProtocol(42)).toBe(true)
    expect(isOsdSerialProtocol(32)).toBe(true)
    expect(isOsdSerialProtocol(29)).toBe(false)
  })

  it('splits analog VTX-control links from digital (table-learning) video links', () => {
    // Analog control = the operator authors the @VTX table.
    expect(isAnalogVtxControlSerialProtocol(37)).toBe(true) // SmartAudio
    expect(isAnalogVtxControlSerialProtocol(44)).toBe(true) // IRC Tramp
    expect(isAnalogVtxControlSerialProtocol(29)).toBe(true) // Crossfire VTX
    expect(isAnalogVtxControlSerialProtocol(33)).toBe(false) // DJI is digital
    expect(isAnalogVtxControlSerialProtocol(42)).toBe(false) // DisplayPort is digital

    // Digital = the goggles push (learn) the table over MSP.
    expect(isDigitalVtxSerialProtocol(42)).toBe(true) // MSP DisplayPort
    expect(isDigitalVtxSerialProtocol(33)).toBe(true) // DJI FPV
    expect(isDigitalVtxSerialProtocol(32)).toBe(false) // plain MSP telemetry is not a VTX
    expect(isDigitalVtxSerialProtocol(37)).toBe(false) // SmartAudio is analog

    // The demo's SmartAudio (37) + DisplayPort (42) combo: analog control is
    // present, so the table stays operator-authored (editable), not learned.
    const demo = [37, 42]
    const learned =
      demo.some((p) => isDigitalVtxSerialProtocol(p)) && !demo.some((p) => isAnalogVtxControlSerialProtocol(p))
    expect(learned).toBe(false)
    // A pure digital rig (DisplayPort only) learns the table.
    const digitalOnly = [42]
    expect(
      digitalOnly.some((p) => isDigitalVtxSerialProtocol(p)) &&
        !digitalOnly.some((p) => isAnalogVtxControlSerialProtocol(p))
    ).toBe(true)
  })

  it('flags only the NeoPixel/notification LED servo-function band (120..123)', () => {
    expect(isNotificationLedServoFunction(120)).toBe(true)
    expect(isNotificationLedServoFunction(123)).toBe(true)
    expect(isNotificationLedServoFunction(119)).toBe(false)
    expect(isNotificationLedServoFunction(124)).toBe(false)
    expect(isNotificationLedServoFunction(undefined)).toBe(false)
  })
})

describe('param-id parsers', () => {
  it('parseServoOutputChannelNumber extracts n only from SERVOn_FUNCTION', () => {
    expect(parseServoOutputChannelNumber('SERVO5_FUNCTION')).toBe(5)
    expect(parseServoOutputChannelNumber('SERVO12_FUNCTION')).toBe(12)
    expect(parseServoOutputChannelNumber('SERVO5_MIN')).toBeUndefined()
    expect(parseServoOutputChannelNumber('GPS_TYPE')).toBeUndefined()
  })

  it('parseSerialPortNumber extracts n from SERIALn_{PROTOCOL,BAUD,OPTIONS}', () => {
    expect(parseSerialPortNumber('SERIAL2_PROTOCOL')).toBe(2)
    expect(parseSerialPortNumber('SERIAL3_BAUD')).toBe(3)
    expect(parseSerialPortNumber('SERIAL1_OPTIONS')).toBe(1)
    expect(parseSerialPortNumber('SERIAL1_FOO')).toBeUndefined()
    expect(parseSerialPortNumber('BRD_SERIAL_NUM')).toBeUndefined()
  })
})
