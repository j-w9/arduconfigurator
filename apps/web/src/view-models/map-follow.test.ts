import { describe, expect, it } from 'vitest'

import { shouldChaseVehicle } from './map-follow'

/** A one-degree square, so the arithmetic is readable. */
const bounds = { south: 0, west: 0, north: 1, east: 1 }

describe('deciding when the map chases the vehicle', () => {
  it('leaves the view alone while the vehicle is near the middle', () => {
    // This is the whole point. The old code re-centred on every fix, which on
    // a sped-up simulation reprojects every tile several times a second for a
    // vehicle that has moved a few pixels -- the stutter this replaced.
    expect(shouldChaseVehicle(bounds, { latitudeDeg: 0.5, longitudeDeg: 0.5 })).toBe(false)
    expect(shouldChaseVehicle(bounds, { latitudeDeg: 0.45, longitudeDeg: 0.55 })).toBe(false)
  })

  it('chases once the vehicle nears an edge', () => {
    // The default margin keeps it inside the middle 60%, so the comfort zone
    // runs 0.2 to 0.8 on this square.
    expect(shouldChaseVehicle(bounds, { latitudeDeg: 0.85, longitudeDeg: 0.5 })).toBe(true)
    expect(shouldChaseVehicle(bounds, { latitudeDeg: 0.15, longitudeDeg: 0.5 })).toBe(true)
    expect(shouldChaseVehicle(bounds, { latitudeDeg: 0.5, longitudeDeg: 0.9 })).toBe(true)
    expect(shouldChaseVehicle(bounds, { latitudeDeg: 0.5, longitudeDeg: 0.1 })).toBe(true)
  })

  it('puts the boundary where the margin says', () => {
    expect(shouldChaseVehicle(bounds, { latitudeDeg: 0.79, longitudeDeg: 0.5 })).toBe(false)
    expect(shouldChaseVehicle(bounds, { latitudeDeg: 0.81, longitudeDeg: 0.5 })).toBe(true)
  })

  it('always chases with a zero margin, and never with a full one', () => {
    // Zero margin is the old behaviour -- the comfort zone collapses to a
    // point, so every fix that is not dead centre re-centres the map.
    expect(shouldChaseVehicle(bounds, { latitudeDeg: 0.5001, longitudeDeg: 0.5 }, 0)).toBe(true)
    expect(shouldChaseVehicle(bounds, { latitudeDeg: 0.99, longitudeDeg: 0.99 }, 1)).toBe(false)
  })

  it('handles a rectangular viewport on each axis independently', () => {
    // A wide map tolerates more longitude drift than latitude, which is the
    // usual shape of the card.
    const wide = { south: 0, west: 0, north: 1, east: 4 }
    expect(shouldChaseVehicle(wide, { latitudeDeg: 0.5, longitudeDeg: 3.1 })).toBe(false)
    expect(shouldChaseVehicle(wide, { latitudeDeg: 0.85, longitudeDeg: 2 })).toBe(true)
  })

  it('works south of the equator and west of Greenwich', () => {
    // CMAC, SITL's own default home, is at -35.36, 149.16; negative
    // coordinates must not invert the comparison.
    const southern = { south: -36, west: -1, north: -35, east: 1 }
    expect(shouldChaseVehicle(southern, { latitudeDeg: -35.5, longitudeDeg: 0 })).toBe(false)
    expect(shouldChaseVehicle(southern, { latitudeDeg: -35.05, longitudeDeg: 0 })).toBe(true)
  })
})
