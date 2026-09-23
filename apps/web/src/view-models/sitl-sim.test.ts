import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LOCATION,
  SIM_VEHICLES,
  availableVehicles,
  framesFor,
  isInterestingOutput,
  launchArguments,
  locationNames,
  moduleUrlFor,
  type SimOptions
} from './sitl-sim'

// The options file is produced by scripts/build-sitl-wasm.sh from the same
// ArduPilot checkout that compiled the binaries. This is a small stand-in with
// the same shape.
const options: SimOptions = {
  frames: {
    copter: ['+', 'X', 'airsim-copter', 'hexa', 'octa'],
    plane: ['plane', 'plane-3d', 'quadplane']
  },
  locations: {
    CMAC: { lat: -35.363261, lon: 149.16523, alt: 584, heading: 353 },
    OSRF0: { lat: 37.4003371, lon: -122.0800351, alt: 0, heading: 353 },
    AVC_plane: { lat: 40.072842, lon: -105.230575, alt: 1586, heading: 0 }
  }
}

describe('which vehicles can be offered', () => {
  it('offers only the ones a binary was built for', () => {
    // Rover and Heli are in SIM_VEHICLES but nothing compiled them here, and a
    // picker entry that cannot start is worse than no entry.
    expect(availableVehicles(options).map((vehicle) => vehicle.id)).toEqual(['copter', 'plane'])
  })

  it('offers nothing before the options have loaded', () => {
    expect(availableVehicles(undefined)).toEqual([])
  })
})

describe('frames', () => {
  it('puts the frame almost everyone wants first', () => {
    // SITL lists alphabetically, which buries X under + and airsim-copter.
    expect(framesFor(options, 'copter')[0]).toBe('X')
  })

  it('keeps the rest in the order upstream gave them', () => {
    expect(framesFor(options, 'copter')).toEqual(['X', '+', 'airsim-copter', 'hexa', 'octa'])
  })

  it('leaves the list alone when the default is not in it', () => {
    const odd: SimOptions = { ...options, frames: { copter: ['hexa', 'octa'] } }
    expect(framesFor(odd, 'copter')).toEqual(['hexa', 'octa'])
  })

  it('has nothing to say about a vehicle it does not know', () => {
    expect(framesFor(options, 'submarine')).toEqual([])
  })
})

describe('locations', () => {
  it('leads with CMAC, which is SITL\'s own home', () => {
    expect(locationNames(options)[0]).toBe(DEFAULT_LOCATION)
  })

  it('sorts the rest, so a list of 117 can be read', () => {
    expect(locationNames(options)).toEqual(['CMAC', 'AVC_plane', 'OSRF0'])
  })
})

describe('the command line', () => {
  it('names the frame as the model', () => {
    const args = launchArguments({ vehicle: 'copter', frame: 'X' })
    expect(args.slice(0, 2)).toEqual(['--model', 'X'])
  })

  it('leaves --serial0 to the transport', () => {
    // The transport prepends it, because a call site that forgets produces a
    // vehicle that boots into silence rather than an error.
    expect(launchArguments({ vehicle: 'copter', frame: 'X' })).not.toContain('--serial0')
  })

  it('turns off the serial ports nothing here reads', () => {
    // SITL would try to open them as sockets, which in a browser is a handful
    // of failures on the way up for ports no one is listening to.
    const args = launchArguments({ vehicle: 'copter', frame: 'X' })
    expect(args).toContain('--serial1')
    expect(args).toContain('--serial2')
  })

  it('passes home as the four fields locations.txt holds', () => {
    const args = launchArguments({ vehicle: 'copter', frame: 'X', location: 'CMAC' }, options)
    const home = args[args.indexOf('--home') + 1]
    expect(home).toBe('-35.363261,149.16523,584,353')
  })

  it('omits home when no location was chosen, letting SITL pick', () => {
    expect(launchArguments({ vehicle: 'copter', frame: 'X' }, options)).not.toContain('--home')
  })

  it('omits home for a location the options do not describe', () => {
    const args = launchArguments({ vehicle: 'copter', frame: 'X', location: 'Atlantis' }, options)
    expect(args).not.toContain('--home')
  })

  it('passes a speedup only when it is not real time', () => {
    // --speedup 1 is not the same as passing nothing, and a round trip through
    // the UI should not quietly change the vehicle.
    expect(launchArguments({ vehicle: 'copter', frame: 'X', speedup: 1 })).not.toContain('--speedup')
    const fast = launchArguments({ vehicle: 'copter', frame: 'X', speedup: 5 })
    expect(fast[fast.indexOf('--speedup') + 1]).toBe('5')
  })

  it('wipes only when asked', () => {
    expect(launchArguments({ vehicle: 'copter', frame: 'X' })).not.toContain('--wipe')
    expect(launchArguments({ vehicle: 'copter', frame: 'X', wipe: true })).toContain('--wipe')
  })
})

describe('where the module comes from', () => {
  it('names the binary the build script writes', () => {
    expect(moduleUrlFor('copter')).toBe('/sitl/arducopter.js')
    expect(moduleUrlFor('plane')).toBe('/sitl/arduplane.js')
  })

  it('respects a base path, for a site not served at the root', () => {
    expect(moduleUrlFor('copter', '/app/sitl')).toBe('/app/sitl/arducopter.js')
  })
})

describe('console output', () => {
  it('drops the port-skipping noise SITL emits on every boot', () => {
    expect(isInterestingOutput('Skipping port (null)')).toBe(false)
    expect(isInterestingOutput('   ')).toBe(false)
  })

  it('keeps what says the vehicle is alive, or why it is not', () => {
    expect(isInterestingOutput('Loaded defaults from @ROMFS/models/copter.parm')).toBe(true)
    expect(isInterestingOutput('Failed to open SIM_ port')).toBe(true)
  })
})

describe('the vehicle table itself', () => {
  it('gives every vehicle a default frame, since the picker starts on one', () => {
    for (const vehicle of SIM_VEHICLES) {
      expect(vehicle.defaultFrame.length).toBeGreaterThan(0)
      expect(vehicle.label.length).toBeGreaterThan(0)
    }
  })
})
