import { describe, expect, it } from 'vitest'

import { formatUtm, GPS_COORD_FORMAT_VALUES, latLonToUtm } from './gps-coord-format'

describe('formatUtm', () => {
  it('is offered as a coordinate format', () => {
    expect(GPS_COORD_FORMAT_VALUES).toContain('utm')
  })

  it('formats a coordinate as zone + band, easting/northing in metres', () => {
    // San Francisco ~37.7749, -122.4194 -> UTM zone 10, band S.
    expect(latLonToUtm(37.7749, -122.4194)).toMatch(/^10S \d+E \d+N$/)
    // Southern hemisphere keeps the false-northing offset (band T, large N).
    expect(latLonToUtm(-33.8688, 151.2093)).toMatch(/^56H \d+E \d+N$/)
  })

  it('returns Waiting when a coordinate is missing', () => {
    expect(formatUtm(undefined, -122)).toBe('Waiting')
    expect(formatUtm(37, undefined)).toBe('Waiting')
  })

  it('returns Out of UTM range beyond the UTM-covered latitudes', () => {
    expect(formatUtm(85, 0)).toBe('Out of UTM range')
    expect(formatUtm(-81, 0)).toBe('Out of UTM range')
  })
})
