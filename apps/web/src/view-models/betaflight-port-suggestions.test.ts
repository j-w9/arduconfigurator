import { describe, expect, it } from 'vitest'

import { buildBetaflightPortSuggestions } from './betaflight-port-suggestions'

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
})
