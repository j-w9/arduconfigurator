export type GpsCoordFormat = 'decimal' | 'dms' | 'mgrs'

export const GPS_COORD_FORMAT_VALUES: readonly GpsCoordFormat[] = ['decimal', 'dms', 'mgrs'] as const

export const GPS_COORD_FORMAT_LABELS: Record<GpsCoordFormat, string> = {
  decimal: 'Decimal',
  dms: 'DMS',
  mgrs: 'MGRS'
}

export function isGpsCoordFormat(value: unknown): value is GpsCoordFormat {
  return typeof value === 'string' && (GPS_COORD_FORMAT_VALUES as readonly string[]).includes(value)
}

function isFiniteNumber(value: number | undefined | null): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function formatLatitudeDecimal(deg: number | undefined): string {
  if (!isFiniteNumber(deg)) {
    return 'Waiting'
  }
  return `${Math.abs(deg).toFixed(6)}° ${deg >= 0 ? 'N' : 'S'}`
}

export function formatLongitudeDecimal(deg: number | undefined): string {
  if (!isFiniteNumber(deg)) {
    return 'Waiting'
  }
  return `${Math.abs(deg).toFixed(6)}° ${deg >= 0 ? 'E' : 'W'}`
}

function formatDmsCommon(deg: number): { d: number; m: number; s: number } {
  const abs = Math.abs(deg)
  let d = Math.floor(abs)
  const minutesFloat = (abs - d) * 60
  let m = Math.floor(minutesFloat)
  // Round seconds to the displayed precision (2dp), then carry overflow so we
  // never render "...60.00″" — e.g. 59.997″ becomes +1′, 60′ becomes +1°.
  let s = Math.round((minutesFloat - m) * 60 * 100) / 100
  if (s >= 60) {
    s -= 60
    m += 1
  }
  if (m >= 60) {
    m -= 60
    d += 1
  }
  return { d, m, s }
}

export function formatLatitudeDms(deg: number | undefined): string {
  if (!isFiniteNumber(deg)) {
    return 'Waiting'
  }
  const { d, m, s } = formatDmsCommon(deg)
  return `${d}° ${String(m).padStart(2, '0')}′ ${s.toFixed(2).padStart(5, '0')}″ ${deg >= 0 ? 'N' : 'S'}`
}

export function formatLongitudeDms(deg: number | undefined): string {
  if (!isFiniteNumber(deg)) {
    return 'Waiting'
  }
  const { d, m, s } = formatDmsCommon(deg)
  return `${d}° ${String(m).padStart(2, '0')}′ ${s.toFixed(2).padStart(5, '0')}″ ${deg >= 0 ? 'E' : 'W'}`
}

// WGS84 ellipsoid constants used for the UTM step of the MGRS conversion.
const WGS84_A = 6378137.0
const WGS84_F = 1 / 298.257223563
const WGS84_E2 = WGS84_F * (2 - WGS84_F)
const WGS84_EP2 = WGS84_E2 / (1 - WGS84_E2)
const UTM_K0 = 0.9996
const FALSE_EASTING = 500000
const FALSE_NORTHING_SOUTH = 10000000
const LAT_BANDS = 'CDEFGHJKLMNPQRSTUVWX'

function latitudeBand(latDeg: number): string | undefined {
  if (latDeg < -80 || latDeg > 84) {
    return undefined
  }
  // 8 degree bands C..W; X covers 72..84.
  const index = Math.min(Math.floor((latDeg + 80) / 8), LAT_BANDS.length - 1)
  return LAT_BANDS.charAt(index)
}

function columnLetter(zone: number, easting: number): string {
  const sets = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ']
  const set = sets[(zone - 1) % 3]
  // Eastings live in 100000..899999; floor(e/100000) is in [1, 8].
  const idx = Math.max(1, Math.min(8, Math.floor(easting / 100000)))
  return set.charAt(idx - 1)
}

function rowLetter(zone: number, northing: number): string {
  const setOdd = 'ABCDEFGHJKLMNPQRSTUV'
  const setEven = 'FGHJKLMNPQRSTUVABCDE'
  const set = zone % 2 === 1 ? setOdd : setEven
  const idx = Math.floor(northing / 100000) % 20
  return set.charAt(idx)
}

function utmForward(latDeg: number, lonDeg: number): { zone: number; easting: number; northing: number } {
  const lat = (latDeg * Math.PI) / 180
  const lon = (lonDeg * Math.PI) / 180
  const zone = Math.floor((lonDeg + 180) / 6) + 1
  const lon0 = ((zone * 6 - 183) * Math.PI) / 180

  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const tanLat = Math.tan(lat)

  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat)
  const T = tanLat * tanLat
  const C = WGS84_EP2 * cosLat * cosLat
  const A = cosLat * (lon - lon0)

  const M =
    WGS84_A *
    ((1 - WGS84_E2 / 4 - (3 * WGS84_E2 * WGS84_E2) / 64 - (5 * WGS84_E2 * WGS84_E2 * WGS84_E2) / 256) * lat -
      ((3 * WGS84_E2) / 8 + (3 * WGS84_E2 * WGS84_E2) / 32 + (45 * WGS84_E2 * WGS84_E2 * WGS84_E2) / 1024) *
        Math.sin(2 * lat) +
      ((15 * WGS84_E2 * WGS84_E2) / 256 + (45 * WGS84_E2 * WGS84_E2 * WGS84_E2) / 1024) * Math.sin(4 * lat) -
      ((35 * WGS84_E2 * WGS84_E2 * WGS84_E2) / 3072) * Math.sin(6 * lat))

  const easting =
    UTM_K0 *
      N *
      (A +
        ((1 - T + C) * Math.pow(A, 3)) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * WGS84_EP2) * Math.pow(A, 5)) / 120) +
    FALSE_EASTING

  let northing =
    UTM_K0 *
    (M +
      N *
        tanLat *
        ((A * A) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4)) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * WGS84_EP2) * Math.pow(A, 6)) / 720))

  if (latDeg < 0) {
    northing += FALSE_NORTHING_SOUTH
  }

  return { zone, easting, northing }
}

/**
 * Convert WGS84 lat/lon to an MGRS reference at 1-meter precision (5+5 digits).
 * Returns undefined outside the UTM-covered range (|lat| > 84/80).
 */
export function latLonToMgrs(latDeg: number | undefined, lonDeg: number | undefined): string | undefined {
  if (!isFiniteNumber(latDeg) || !isFiniteNumber(lonDeg)) {
    return undefined
  }
  const band = latitudeBand(latDeg)
  if (band === undefined) {
    return undefined
  }
  const { zone, easting, northing } = utmForward(latDeg, lonDeg)
  const col = columnLetter(zone, easting)
  const row = rowLetter(zone, northing)
  const e5 = String(Math.floor(easting) % 100000).padStart(5, '0')
  const n5 = String(Math.floor(northing) % 100000).padStart(5, '0')
  return `${zone}${band} ${col}${row} ${e5} ${n5}`
}

export function formatMgrs(latDeg: number | undefined, lonDeg: number | undefined): string {
  if (!isFiniteNumber(latDeg) || !isFiniteNumber(lonDeg)) {
    return 'Waiting'
  }
  const mgrs = latLonToMgrs(latDeg, lonDeg)
  return mgrs ?? 'Out of UTM range'
}
