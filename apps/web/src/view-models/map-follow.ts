// Where the live map decides to move, kept apart from the map itself so it can
// be tested without a DOM: importing the component pulls in Leaflet, which
// wants a `window` before it will even load.

/**
 * How much of the map the vehicle may wander over before the view chases it.
 *
 * 0.6 keeps it inside the middle 60%, so there is always a quarter of the
 * map's width of context ahead of it. Lower would centre the vehicle more
 * tightly at the cost of panning constantly; higher lets it reach the edge
 * before anything happens.
 */
export const FOLLOW_MARGIN = 0.6

export interface MapBounds {
  south: number
  west: number
  north: number
  east: number
}

/**
 * Whether the view should move to keep up with the vehicle.
 *
 * Split out from the effect because it is the whole of the decision and the
 * only part worth pinning: the old code re-centred on every fix, which on a
 * sped-up simulation meant reprojecting every tile several times a second for
 * a vehicle that had moved a few pixels.
 */
export function shouldChaseVehicle(
  bounds: MapBounds,
  at: { latitudeDeg: number; longitudeDeg: number },
  margin = FOLLOW_MARGIN
): boolean {
  const latitudeInset = ((bounds.north - bounds.south) * (1 - margin)) / 2
  const longitudeInset = ((bounds.east - bounds.west) * (1 - margin)) / 2
  return (
    at.latitudeDeg < bounds.south + latitudeInset ||
    at.latitudeDeg > bounds.north - latitudeInset ||
    at.longitudeDeg < bounds.west + longitudeInset ||
    at.longitudeDeg > bounds.east - longitudeInset
  )
}

