import { describe, expect, it } from 'vitest'

import {
  betaflightPortLabel,
  buildBetaflightPortSuggestions,
  parseBetaflightOsdSettings
} from './betaflight-port-suggestions'

// Function bits are Betaflight's (src/main/io/serial.h serialPortFunction_e);
// protocol values are ArduPilot's (AP_SerialManager.cpp, via the catalog).

const port = (identifier: number, functionMask: number) => ({
  identifier,
  functionMask,
  mspBaudIndex: 0,
  gpsBaudIndex: 0,
  telemetryBaudIndex: 0,
  blackboxBaudIndex: 0
})

describe('buildBetaflightPortSuggestions', () => {
  it('translates the real diff from a MATEKH743', () => {
    // From a captured `diff`:
    //   serial 1 64   -> FUNCTION_RX_SERIAL
    //   serial 3 2048 -> FUNCTION_VTX_SMARTAUDIO
    //   serial 5 0    -> nothing
    const suggestions = buildBetaflightPortSuggestions([port(1, 64), port(3, 2048), port(5, 0)])
    expect(suggestions).toHaveLength(2)

    expect(suggestions[0]).toMatchObject({
      identifier: 1,
      betaflightFunction: 'Serial RX',
      ardupilotProtocol: 23,
      ardupilotLabel: 'RCIN'
    })
    expect(suggestions[1]).toMatchObject({
      identifier: 3,
      betaflightFunction: 'VTX (SmartAudio)',
      ardupilotProtocol: 37,
      ardupilotLabel: 'SmartAudio'
    })
  })

  it('reports several functions on one port', () => {
    // A mask is a bitmask: Betaflight happily puts MSP and ESC sensor on one
    // UART, and both matter when re-wiring.
    const suggestions = buildBetaflightPortSuggestions([port(2, (1 << 1) | (1 << 10))])
    expect(suggestions.map((s) => s.ardupilotLabel).sort()).toEqual(['ESC Telemetry', 'GPS'])
  })

  it('says so when ArduPilot has no equivalent instead of inventing one', () => {
    // Blackbox is a serial function in Betaflight and simply is not one in
    // ArduPilot — it logs to dataflash. Offering a protocol number here would
    // be worse than saying there is nothing to set.
    const [blackbox] = buildBetaflightPortSuggestions([port(4, 1 << 7)])
    expect(blackbox.ardupilotProtocol).toBeUndefined()
    expect(blackbox.note).toMatch(/dataflash/i)
  })

  it('does not claim a protocol for Tramp', () => {
    // Tramp has no ArduPilot serial protocol; an earlier table pointed it at
    // AHRS purely because the numbers were adjacent.
    const [tramp] = buildBetaflightPortSuggestions([port(4, 1 << 13)])
    expect(tramp.ardupilotProtocol).toBeUndefined()
    expect(tramp.ardupilotLabel).toBe('no direct equivalent')
  })

  it('ignores unconfigured ports', () => {
    expect(buildBetaflightPortSuggestions([port(0, 0), port(1, 0)])).toEqual([])
  })

  it('names the UART the operator is holding, not the raw identifier', () => {
    // serialPortIdentifier_e: 0 is USART1 and 5 is USART6. Printing the raw
    // number told someone with UART6 wired up that it was "serial 5".
    expect(betaflightPortLabel(0)).toBe('UART1')
    expect(betaflightPortLabel(5)).toBe('UART6')
    expect(betaflightPortLabel(20)).toBe('USB (VCP)')
    expect(betaflightPortLabel(30)).toBe('SOFTSERIAL1')
    expect(betaflightPortLabel(31)).toBe('SOFTSERIAL2')
    expect(betaflightPortLabel(40)).toBe('LPUART1')
    // Current master numbers real UARTs from 50 (UART0) / 51 (USART1).
    expect(betaflightPortLabel(51)).toBe('UART1')
    expect(betaflightPortLabel(70)).toBe('PIOUART0')

    const [rx] = buildBetaflightPortSuggestions([port(0, 1 << 6)])
    expect(rx.portLabel).toBe('UART1')
    expect(rx.identifier).toBe(0)
  })

  it('leaves the USB port out — it is the Configurator link, not wiring', () => {
    // Every Betaflight board carries MSP on the VCP. Listing it sent the
    // operator looking for a UART20 that does not exist on the board.
    const suggestions = buildBetaflightPortSuggestions([port(20, 1), port(0, 1 << 6)])
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].portLabel).toBe('UART1')
  })

  it('reads MSP DisplayPort out of the CLI diff, which the serial config cannot say', () => {
    // The operator's own board: UART1 Serial RX, UART6 goggle OSD. Betaflight
    // reports UART6 as plain MSP — what makes it a display link is the OSD
    // setting, so without the diff it was translated as a configurator port.
    const diff = [
      '# version',
      'serial 0 64 115200 57600 0 115200',
      'serial 5 1 115200 57600 0 115200',
      'set osd_displayport_device = MSP'
    ].join('\n')
    const suggestions = buildBetaflightPortSuggestions([port(20, 1), port(0, 1 << 6), port(5, 1)], diff)

    const displayPort = suggestions.find((entry) => entry.identifier === 5)
    expect(displayPort).toMatchObject({
      portLabel: 'UART6',
      betaflightFunction: 'MSP DisplayPort (OSD)',
      ardupilotProtocol: 42,
      ardupilotLabel: 'DisplayPort'
    })
    // And the USB MSP port is still not listed as a display link (or at all).
    expect(suggestions.some((entry) => entry.identifier === 20)).toBe(false)
  })

  it('leaves MSP as MSP when the OSD is not driven over it', () => {
    const diff = 'set osd_displayport_device = MAX7456'
    const [msp] = buildBetaflightPortSuggestions([port(5, 1)], diff)
    expect(msp.betaflightFunction).toBe('MSP')
    expect(msp.ardupilotProtocol).toBe(32)

    // No diff at all (a board that would not drop into the CLI) behaves the
    // same way — it never guesses a display link it has no evidence for.
    const [noDiff] = buildBetaflightPortSuggestions([port(5, 1)])
    expect(noDiff.ardupilotProtocol).toBe(32)
  })

  it('prefers osd_uart when the firmware names the port outright', () => {
    const diff = ['set osd_displayport_device = MSP', 'set osd_uart = 3'].join('\n')
    const suggestions = buildBetaflightPortSuggestions([port(5, 1), port(3, 1)], diff)
    expect(suggestions.find((entry) => entry.identifier === 3)?.ardupilotProtocol).toBe(42)
    expect(suggestions.find((entry) => entry.identifier === 5)?.ardupilotProtocol).toBe(32)
  })

  it('parses the OSD settings it needs and nothing else', () => {
    expect(parseBetaflightOsdSettings(undefined)).toEqual({ displayPortIsMsp: false })
    expect(parseBetaflightOsdSettings('set osd_displayport_device = msp').displayPortIsMsp).toBe(true)
    expect(parseBetaflightOsdSettings('set osd_displayport_device = NONE').displayPortIsMsp).toBe(false)
    expect(parseBetaflightOsdSettings('set osd_uart = -1').osdUart).toBeUndefined()
  })
})
