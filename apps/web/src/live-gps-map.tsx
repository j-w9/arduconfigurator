import { useEffect, useMemo, useState } from 'react'

import type { ConfiguratorSnapshot } from '@arduconfig/ardupilot-core'
import { StatusBadge } from '@arduconfig/ui-kit'

interface LiveGpsMapCardProps {
  snapshot: ConfiguratorSnapshot
  title: string
  subtitle: string
  compact?: boolean
  testId?: string
}

interface StableMapFocus {
  latitudeDeg: number
  longitudeDeg: number
}

// 6 m was 18 m. The original guard kept the OSM iframe from reloading on
// sub-meter GPS drift, but with the new 5 Hz GLOBAL_POSITION_INT cadence
// (see LIVE_TELEMETRY_REQUESTS) operators watching a Here3 said the map
// looked "stuck" for too long when actually moving. 6 m is small enough
// that walking-pace movement re-centers reasonably, large enough that
// the iframe doesn't thrash on stationary GPS jitter (typical drift on a
// good fix is well under that).
const MAP_RECENTER_THRESHOLD_METERS = 6

function formatCoordinate(value: number | undefined, positiveLabel: string, negativeLabel: string): string {
  if (value === undefined) {
    return 'Unknown'
  }

  const hemisphere = value >= 0 ? positiveLabel : negativeLabel
  return `${Math.abs(value).toFixed(5)}° ${hemisphere}`
}

function buildLongitudeDelta(latitudeDeg: number, latitudeDelta: number): number {
  const cosine = Math.cos((latitudeDeg * Math.PI) / 180)
  return latitudeDelta / Math.max(Math.abs(cosine), 0.35)
}

function buildMapBounds(latitudeDeg: number, longitudeDeg: number, compact: boolean): string {
  const latitudeDelta = compact ? 0.0038 : 0.0026
  const longitudeDelta = buildLongitudeDelta(latitudeDeg, latitudeDelta)
  const minLongitude = longitudeDeg - longitudeDelta
  const minLatitude = latitudeDeg - latitudeDelta
  const maxLongitude = longitudeDeg + longitudeDelta
  const maxLatitude = latitudeDeg + latitudeDelta

  return [minLongitude, minLatitude, maxLongitude, maxLatitude].map((value) => value.toFixed(6)).join(',')
}

function buildOpenStreetMapEmbedUrl(latitudeDeg: number, longitudeDeg: number, compact: boolean): string {
  const bbox = buildMapBounds(latitudeDeg, longitudeDeg, compact)
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitudeDeg.toFixed(6)},${longitudeDeg.toFixed(6)}`
}

function buildOpenStreetMapUrl(latitudeDeg: number, longitudeDeg: number, compact: boolean): string {
  const zoom = compact ? 16 : 17
  return `https://www.openstreetmap.org/?mlat=${latitudeDeg.toFixed(6)}&mlon=${longitudeDeg.toFixed(6)}#map=${zoom}/${latitudeDeg.toFixed(6)}/${longitudeDeg.toFixed(6)}`
}

function formatMetric(value: number | undefined, suffix: string): string {
  return value === undefined ? 'Unknown' : `${value.toFixed(1)}${suffix}`
}

function distanceBetweenCoordinatesMeters(a: StableMapFocus, b: StableMapFocus): number {
  const averageLatitudeRad = ((a.latitudeDeg + b.latitudeDeg) * Math.PI) / 360
  const latitudeMeters = (b.latitudeDeg - a.latitudeDeg) * 111_320
  const longitudeMeters = (b.longitudeDeg - a.longitudeDeg) * 111_320 * Math.cos(averageLatitudeRad)
  return Math.hypot(latitudeMeters, longitudeMeters)
}

export function LiveGpsMapCard({ snapshot, title, subtitle, compact = false, testId }: LiveGpsMapCardProps) {
  const position = snapshot.liveVerification.globalPosition
  const latitudeDeg = position.latitudeDeg
  const longitudeDeg = position.longitudeDeg
  const verified = position.verified && latitudeDeg !== undefined && longitudeDeg !== undefined
  const [stableFocus, setStableFocus] = useState<StableMapFocus | undefined>(undefined)

  useEffect(() => {
    if (!verified) {
      return
    }

    const nextFocus = { latitudeDeg, longitudeDeg }
    setStableFocus((currentFocus) => {
      if (!currentFocus) {
        return nextFocus
      }

      return distanceBetweenCoordinatesMeters(currentFocus, nextFocus) >= MAP_RECENTER_THRESHOLD_METERS
        ? nextFocus
        : currentFocus
    })
  }, [verified, latitudeDeg, longitudeDeg])

  const displayFocus = verified
    ? stableFocus ?? { latitudeDeg, longitudeDeg }
    : undefined

  const embedUrl = useMemo(() => {
    if (!displayFocus) {
      return undefined
    }

    return buildOpenStreetMapEmbedUrl(displayFocus.latitudeDeg, displayFocus.longitudeDeg, compact)
  }, [compact, displayFocus])

  const externalUrl = useMemo(() => {
    if (!displayFocus) {
      return undefined
    }

    return buildOpenStreetMapUrl(displayFocus.latitudeDeg, displayFocus.longitudeDeg, compact)
  }, [compact, displayFocus])

  return (
    <div className={`gps-map-card${compact ? ' gps-map-card--compact' : ''}`} data-testid={testId}>
      <div className="gps-map-card__header">
        <div>
          <strong>{title}</strong>
          <p>{subtitle}</p>
        </div>
        <StatusBadge tone={verified ? 'success' : 'warning'}>{verified ? 'position live' : 'waiting'}</StatusBadge>
      </div>

      <div className="gps-map-card__frame">
        {embedUrl ? (
          <iframe
            title={title}
            src={embedUrl}
            loading="lazy"
            referrerPolicy="no-referrer"
            aria-label={title}
          />
        ) : (
          <div className="gps-map-card__placeholder">
            <span>No live global position yet</span>
            <strong>Waiting on GLOBAL_POSITION_INT telemetry</strong>
            <small>Coordinates will appear here as soon as the controller starts reporting a live global position.</small>
          </div>
        )}
      </div>

      <div className="gps-map-card__meta">
        <article>
          <span>Latitude</span>
          <strong>{formatCoordinate(position.latitudeDeg, 'N', 'S')}</strong>
        </article>
        <article>
          <span>Longitude</span>
          <strong>{formatCoordinate(position.longitudeDeg, 'E', 'W')}</strong>
        </article>
        <article>
          <span>Relative alt</span>
          <strong>{formatMetric(position.relativeAltitudeM, ' m')}</strong>
        </article>
        <article>
          <span>Ground speed</span>
          <strong>{formatMetric(position.groundSpeedMs, ' m/s')}</strong>
        </article>
      </div>

      <div className="gps-map-card__footer">
        <small>
          {verified
            ? 'Map tiles come from OpenStreetMap. The view recenters only after meaningful aircraft movement so zoom and pan stay usable during small GPS drift.'
            : 'Mission-control style location review appears automatically when the flight controller reports a live global position.'}
        </small>
        {externalUrl ? (
          <a href={externalUrl} target="_blank" rel="noreferrer">
            Open in OpenStreetMap
          </a>
        ) : null}
      </div>
    </div>
  )
}
